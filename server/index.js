const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'musette2026';

// ── Persistent race config ─────────────────────────────────────────────────
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const raceFile = path.join(dataDir, 'race.json');

function loadRace() {
  try { return JSON.parse(fs.readFileSync(raceFile, 'utf-8')); }
  catch { return { checkpoints: [], routeCoords: [] }; }
}
function saveRace(r) { fs.writeFileSync(raceFile, JSON.stringify(r)); }
let race = loadRace();

// ── File uploads ───────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const photoStorage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname)}`)
});
const photoUpload = multer({ storage: photoStorage, limits: { fileSize: 5 * 1024 * 1024 } });
const gpxUpload   = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── In-memory state ────────────────────────────────────────────────────────
const participants = new Map(); // id → participant
const clients      = new Map(); // ws → id
const adminTokens  = new Set();

// ── Admin auth ─────────────────────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Fel lösenord' });
  const token = crypto.randomBytes(32).toString('hex');
  adminTokens.add(token);
  res.json({ token });
});

function adminOnly(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!adminTokens.has(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── Admin routes ───────────────────────────────────────────────────────────
app.get('/admin', (req, res) =>
  res.sendFile(path.join(__dirname, '../public/admin.html')));

app.get('/api/admin/race', adminOnly, (req, res) => res.json(race));

app.post('/api/admin/checkpoints', adminOnly, (req, res) => {
  race.checkpoints = req.body.checkpoints || [];
  saveRace(race);
  broadcast({ type: 'race_update', checkpoints: race.checkpoints });
  res.json({ ok: true });
});

app.post('/api/admin/route', adminOnly, gpxUpload.single('gpx'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Ingen fil' });
  const coords = parseGPX(req.file.buffer.toString('utf-8'));
  if (!coords.length) return res.status(400).json({ error: 'Inga koordinater hittades' });
  race.routeCoords = coords;
  saveRace(race);
  broadcast({ type: 'race_update', routeCoords: race.routeCoords });
  res.json({ ok: true, points: coords.length });
});

app.get('/api/admin/participants', adminOnly, (req, res) =>
  res.json([...participants.values()]));

app.post('/api/admin/reset', adminOnly, (req, res) => {
  participants.clear();
  broadcast({ type: 'reset' });
  res.json({ ok: true });
});

// ── Public routes ──────────────────────────────────────────────────────────
app.get('/api/race', (req, res) =>
  res.json({ checkpoints: race.checkpoints, routeCoords: race.routeCoords }));

app.get('/api/leaderboard', (req, res) => {
  const ps = [...participants.values()].map(p => ({
    id: p.id, name: p.name, photo: p.photo,
    checkIns: p.checkIns, status: p.status
  }));
  res.json({ checkpoints: race.checkpoints, participants: ps });
});

app.get('/leaderboard', (req, res) =>
  res.sendFile(path.join(__dirname, '../public/leaderboard.html')));

app.post('/api/upload', photoUpload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Ingen fil' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// ── Helpers ────────────────────────────────────────────────────────────────
function parseGPX(xml) {
  const coords = [];
  let m;
  let re = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"/g;
  while ((m = re.exec(xml))) coords.push([parseFloat(m[1]), parseFloat(m[2])]);
  if (!coords.length) {
    re = /<rtept\s+lat="([^"]+)"\s+lon="([^"]+)"/g;
    while ((m = re.exec(xml))) coords.push([parseFloat(m[1]), parseFloat(m[2])]);
  }
  const step = Math.max(1, Math.floor(coords.length / 2000));
  return coords.filter((_, i) => i % step === 0);
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = d => d * Math.PI / 180;
  const dLat = r(lat2 - lat1), dLng = r(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function broadcast(data, excludeWs = null) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(ws => {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

// ── WebSocket ──────────────────────────────────────────────────────────────
wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'join': {
        const p = {
          id: msg.id, name: msg.name, photo: msg.photo || null,
          checkIns: [], lastSeen: Date.now(), status: 'active'
        };
        participants.set(msg.id, p);
        clients.set(ws, msg.id);
        ws.send(JSON.stringify({
          type: 'init',
          participants: [...participants.values()],
          checkpoints: race.checkpoints
        }));
        broadcast({ type: 'joined', participant: p }, ws);
        break;
      }

      case 'checkin': {
        const id = clients.get(ws);
        if (!id) break;
        const p = participants.get(id);
        if (!p || p.status === 'dnf') break;

        const cp = race.checkpoints.find(c => c.id === msg.checkpointId);
        if (!cp) break;
        if (p.checkIns.find(c => c.checkpointId === msg.checkpointId)) break;

        // Proximity check — only if client sent coordinates
        if (msg.lat != null && msg.lng != null) {
          const dist = haversine(msg.lat, msg.lng, cp.lat, cp.lng);
          const radius = cp.radius || 500;
          if (dist > radius) {
            ws.send(JSON.stringify({
              type: 'checkin_error',
              message: `Du är ${Math.round(dist)} m från checkpointen (max ${radius} m krävs)`
            }));
            break;
          }
        }

        const checkIn = { checkpointId: msg.checkpointId, time: Date.now() };
        p.checkIns.push(checkIn);
        p.lastSeen = Date.now();
        broadcast({ type: 'checkin', participantId: id, checkpointId: msg.checkpointId, time: checkIn.time });
        break;
      }

      case 'dnf': {
        const id = clients.get(ws);
        if (!id) break;
        const p = participants.get(id);
        if (!p) break;
        p.status = 'dnf';
        p.lastSeen = Date.now();
        broadcast({ type: 'dnf', id });
        break;
      }
    }
  });

  ws.on('close', () => {
    const id = clients.get(ws);
    if (id) {
      clients.delete(ws);
      const p = participants.get(id);
      if (p) p.lastSeen = Date.now();
    }
  });
});

// Clean up participants older than 24 h
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, p] of participants) {
    if (p.lastSeen < cutoff) participants.delete(id);
  }
}, 60 * 60 * 1000);

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
