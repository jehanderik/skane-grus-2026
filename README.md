# Skåne Grus 2026 – Live GPS Tracker

PWA med realtids-GPS-spårning för upp till 50+ cyklister.

---

## Funktioner

- ✅ Registrering med namn + profilbild
- ✅ Realtidskarta med alla deltagares positioner
- ✅ Route ritad på kartan (efter GPX-import)
- ✅ DNF-knapp (markerar avbrott för alla)
- ✅ Installeras som app på iOS & Android
- ✅ GPS pollar var 30:e sekund (batterisnålt)
- ✅ Mörkt tema optimerat för utomhusbruk

---

## Deploy på Railway (gratis)

### 1. Skapa konto
Gå till [railway.app](https://railway.app) och skapa ett gratis konto.

### 2. Deploya från GitHub
```bash
# Pusha projektet till GitHub
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/DITT_ANVÄNDARNAMN/gravel-race.git
git push -u origin main
```

Sedan i Railway:
1. Klicka **New Project → Deploy from GitHub repo**
2. Välj ditt repo
3. Railway hittar automatiskt `package.json` och startar appen

### 3. Hämta din URL
Railway ger dig en URL som `https://gravel-race-production-xxxx.railway.app`

### 4. Uppdatera SERVER_URL i index.html
Öppna `public/index.html` och kontrollera att `SERVER_URL` pekar rätt.
Eftersom appen använder `window.location.origin` behöver du inte ändra något om
frontend och backend körs på samma domän (vilket de gör på Railway).

---

## Lägga in GPX-rutten

### Steg 1: Exportera GPX från Strava
1. Gå till din rutt på Strava
2. Klicka på de tre prickarna → **Exportera GPX**

### Steg 2: Konvertera till koordinater
```bash
node gpx-to-route.js din-rutt.gpx
```

### Steg 3: Klistra in i index.html
Öppna `route-coords.js` som skapades och kopiera innehållet.
I `public/index.html`, ersätt:
```js
const ROUTE_COORDS = null;
```
med:
```js
const ROUTE_COORDS = [[55.123, 13.456], ...]; // data från route-coords.js
```

---

## Dela med deltagarna

Skicka bara URL:en till alla deltagare inför loppet, t.ex.:
```
https://gravel-race-production-xxxx.railway.app
```

**iOS (iPhone):** Öppna i Safari → Dela → Lägg till på hemskärmen  
**Android:** Öppna i Chrome → Meny → Lägg till på startskärmen

---

## Lokal testning

```bash
npm install
npm start
# Öppna http://localhost:3000
```

---

## Batterioptimering – varför det fungerar

| Inställning | Värde | Effekt |
|---|---|---|
| GPS-polling | Var 30 sek | 98% mindre GPS-aktivitet vs. kontinuerlig |
| `maximumAge` | 25 000 ms | Återanvänder cachad position |
| Karttiles | Laddas en gång | Inget kontinuerligt nedladdat |
| WebSocket | Keep-alive | Minimal nätverkstrafik |

Med skärmen av i fickan och GPS aktiv: ca 8-12% batteridrain per timme på moderna telefoner.
Rekommendation till deltagarna: ladda till 100% och ta med ett powerbank (20 000 mAh räcker i 15 timmar).

---

## Arkitektur

```
Railway Server
├── Express (HTTP + static files)
├── WebSocket server (ws)
└── In-memory participant store

Browser/PWA
├── Leaflet.js + OpenStreetMap
├── WebSocket client
└── navigator.geolocation
```
# skane-grus-2026
