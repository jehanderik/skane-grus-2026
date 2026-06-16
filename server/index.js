const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Storage for participant photos
const uploadDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).substr(2, 6)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// In-memory participant store
// { id: { id, name, photo, lat, lng, lastSeen, status } }
const participants = new Map();
const clients = new Map(); // ws -> participantId

// Photo upload endpoint
app.post('/api/upload', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// Get all current participants (for initial load)
app.get('/api/participants', (req, res) => {
  const active = [...participants.values()].filter(p => p.status !== 'dnf');
  res.json(active);
});

// Broadcast to all connected clients
function broadcast(data, excludeWs = null) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(ws => {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  });
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'join': {
        const { id, name, photo } = msg;
        const participant = {
          id, name, photo,
          lat: null, lng: null,
          lastSeen: Date.now(),
          status: 'active'
        };
        participants.set(id, participant);
        clients.set(ws, id);

        // Send current state to the new participant
        ws.send(JSON.stringify({
          type: 'init',
          participants: [...participants.values()]
        }));

        // Tell everyone else about the new participant
        broadcast({ type: 'joined', participant }, ws);
        break;
      }

      case 'position': {
        const id = clients.get(ws);
        if (!id) break;
        const p = participants.get(id);
        if (!p) break;

        p.lat = msg.lat;
        p.lng = msg.lng;
        p.lastSeen = Date.now();

        broadcast({ type: 'position', id, lat: msg.lat, lng: msg.lng, lastSeen: p.lastSeen });
        break;
      }

      case 'dnf': {
        const id = clients.get(ws);
        if (!id) break;
        const p = participants.get(id);
        if (!p) break;

        p.status = 'dnf';
        broadcast({ type: 'dnf', id });
        break;
      }
    }
  });

  ws.on('close', () => {
    const id = clients.get(ws);
    if (id) {
      clients.delete(ws);
      // Keep participant in map but mark as disconnected
      const p = participants.get(id);
      if (p) p.lastSeen = Date.now();
    }
  });
});

// Clean up stale participants after 2 hours of inactivity
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, p] of participants) {
    if (p.lastSeen < cutoff && p.status !== 'active') {
      participants.delete(id);
    }
  }
}, 30 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`Gravel Race server running on port ${PORT}`);
});
