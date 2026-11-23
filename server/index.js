// RWTRP Broadcast — server. Serves the landing page, /host (director) and
// /checker (player view), keeps the authoritative race state, syncs it to all
// connected clients over WebSocket and persists it to data/state.json.
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { buildDefaultState, blankRaceState, uid, tyreCycle, NAMED_TRACKS } from './demo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PORT = Number(process.env.PORT || 3000);

// ---------- state load / save ----------
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (parsed && parsed.version === 1 && parsed.race && parsed.championship) {
        console.log('[state] loaded from data/state.json');
        return parsed;
      }
      console.warn('[state] version mismatch — falling back to factory demo');
    }
  } catch (err) {
    console.warn('[state] failed to load, using factory demo:', err.message);
  }
  return buildDefaultState();
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = STATE_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state, null, 0));
      fs.renameSync(tmp, STATE_FILE);
    } catch (err) {
      console.warn('[state] persist failed:', err.message);
    }
  }, 200);
}

const state = loadState();

// ---------- helpers ----------
const sortedDrivers = () => [...state.race.drivers].sort((a, b) => a.pos - b.pos);

function pushFeed(type, text, driverId = null) {
  state.race.feed.push({ id: uid(), lap: state.race.currentLap, at: Date.now(), type, text, driverId });
  if (state.race.feed.length > 300) state.race.feed = state.race.feed.slice(-300);
}

function renumber() {
  sortedDrivers().forEach((d, i) => { d.pos = i + 1; });
  // leader never has a gap
  const ordered = sortedDrivers();
  if (ordered[0]) ordered[0].gap = null;
}

function bestLapOverall() {
  let best = null;
  for (const d of state.race.drivers) {
    if (d.bestLap != null && (best == null || d.bestLap < best.timeMs)) best = { driverId: d.id, timeMs: d.bestLap, lap: state.race.currentLap };
  }
  return best;
}

const FEED_LABEL = {
  flag: 'FLAG', radio: 'RADIO', spotter: 'SPOTTER', incident: 'INCIDENT',
  pit: 'PIT', note: 'NOTE', fastest: 'FASTEST', weather: 'WEATHER', penalty: 'PENALTY', strategy: 'STRATEGY', system: 'INFO',
};
console.assert(FEED_LABEL, 'feed labels');

const actions = {
  // ---------- session meta ----------
  setMeta({ patch = {} }) {
    const allowed = ['raceName', 'round', 'trackName', 'trackSeed', 'totalLaps', 'sessionType', 'drsEnabled', 'gapModeIgnored'];
    for (const k of Object.keys(patch)) {
      if (allowed.includes(k)) state.race[k] = patch[k];
    }
    if (patch.trackSeed != null) {
      const known = NAMED_TRACKS.find((t) => t.seed === Number(patch.trackSeed));
      if (known && !patch.trackName) state.race.trackName = known.name;
    }
  },
  setStatus({ status }) {
    if (!['pre', 'live', 'finished'].includes(status)) return;
    state.race.status = status;
    if (status === 'live') pushFeed('system', 'SESSION GREEN — the session is live.');
    if (status === 'pre') pushFeed('system', 'Session reset to pre-race.');
  },
  setScene({ scene }) {
    if (!['race', 'feed', 'results', 'standings', 'analysis'].includes(scene)) return;
    state.race.scene = scene;
  },
  setClock({ clockSec }) {
    const v = Number(clockSec);
    if (Number.isFinite(v) && v >= 0) { state.race.clockSec = Math.floor(v); state.race.clockAt = Date.now(); }
  },
  setFlag({ flag }) {
    const valid = ['green', 'yellow', 'red', 'sc', 'vsc', 'blue', 'chequered', null];
    if (!valid.includes(flag)) return;
    state.race.flag = flag;
    state.race.flagSetAt = Date.now();
    const label = { green: 'GREEN FLAG — track clear', yellow: 'YELLOW FLAG — no overtaking', red: 'RED FLAG — session stopped', sc: 'SAFETY CAR deployed', vsc: 'VIRTUAL SAFETY CAR', blue: 'BLUE FLAG — lapped traffic', chequered: 'CHEQUERED FLAG' }[flag];
    if (label) pushFeed('flag', label);
    if (flag === 'chequered') {
      state.race.status = 'finished';
      state.race.scene = 'results';
      pushFeed('system', 'SESSION COMPLETE — chequered flag.');
    }
    if (flag === 'red') state.race.drsEnabled && (state.race.drsLocked = true);
  },
  setSectorFlag({ index, value }) {
    const i = Number(index);
    if (![0, 1, 2].includes(i)) return;
    if (![null, 'yellow', 'double'].includes(value)) return;
    state.race.sectorFlags[i] = value;
    if (value) pushFeed('flag', `SECTOR ${i + 1} — ${value === 'double' ? 'DOUBLE YELLOW' : 'YELLOW'}`);
    else pushFeed('flag', `SECTOR ${i + 1} — clear`);
  },
  setWeather({ patch = {} }) {
    const prev = state.race.weather.condition;
    const allowed = ['condition', 'air', 'track', 'wind', 'humidity'];
    for (const k of Object.keys(patch)) if (allowed.includes(k)) state.race.weather[k] = patch[k];
    if (patch.condition && patch.condition !== prev) {
      const label = { dry: 'DRY', cloudy: 'CLOUDY', rain: 'RAIN', storm: 'STORM' }[patch.condition] || patch.condition;
      pushFeed('weather', `WEATHER UPDATE — ${label}`);
    }
  },
  nextLap() {
    if (state.race.status !== 'live') return;
    const ordered = sortedDrivers();
    state.race.lapSnapshots.push({ lap: state.race.currentLap, order: ordered.map((d) => d.id) });
    if (state.race.lapSnapshots.length > 400) state.race.lapSnapshots = state.race.lapSnapshots.slice(-400);
    // advance clock by an estimated lap time (leader best or 95s)
    const leader = ordered[0];
    const est = leader && leader.bestLap ? Math.round(leader.bestLap / 1000) : 95;
    state.race.clockSec += est;
    for (const d of state.race.drivers) {
      if (d.status === 'racing' || d.status === 'pit') d.tyreAge += 1;
    }
    if (state.race.currentLap >= state.race.totalLaps) {
      actions.setFlag({ flag: 'chequered' });
      return;
    }
    state.race.currentLap += 1;
    pushFeed('system', `LAP ${state.race.currentLap}/${state.race.totalLaps}`);
  },
  setLap({ lap }) {
    const v = Math.floor(Number(lap));
    if (Number.isFinite(v) && v >= 1 && v <= state.race.totalLaps) state.race.currentLap = v;
  },
  restartRace() {
    state.race.currentLap = 1;
    state.race.clockSec = 0;
    state.race.clockAt = Date.now();
    state.race.status = 'pre';
    state.race.flag = null;
    state.race.sectorFlags = [null, null, null];
    state.race.lapSnapshots = [];
    state.race.fastestLap = null;
    state.race.spotter = null; state.race.radio = null;
    for (const d of state.race.drivers) {
      d.tyreAge = 0; d.lastLap = null; d.bestLap = null; d.pits = 0;
      if (d.status !== 'racing') d.status = 'racing';
    }
    renumber();
    pushFeed('system', 'SESSION RESTARTED — back to lap 1.');
  },
  finishRace() { actions.setFlag({ flag: 'chequered' }); },

  // ---------- field control ----------
  addDriver({ driver = {} }) {
    const d = {
      id: uid(),
      number: Number(driver.number) || (100 + state.race.drivers.length),
      short: (driver.short || 'NEW').slice(0, 3).toUpperCase(),
      name: driver.name || 'New Driver',
      team: driver.team || 'Private Entry',
      color: driver.color || '#8f9aa8',
      isPlayer: !!driver.isPlayer,
      pos: state.race.drivers.length + 1,
      gap: null, tyre: 'M', tyreAge: 0, lastLap: null, bestLap: null,
      pits: 0, drs: false, status: 'racing',
    };
    state.race.drivers.push(d);
    renumber();
    pushFeed('system', `#${d.number} ${d.name} added to the field.`);
    return { id: d.id };
  },
  updateDriver({ id, patch = {} }) {
    const d = state.race.drivers.find((x) => x.id === id);
    if (!d) return;
    const allowed = ['number', 'short', 'name', 'team', 'color', 'isPlayer', 'status', 'tyre', 'tyreAge', 'drs', 'gap'];
    for (const k of Object.keys(patch)) {
      if (!allowed.includes(k)) continue;
      if (k === 'number') d.number = Number(patch.number) || d.number;
      else if (k === 'tyreAge') d.tyreAge = Math.max(0, Number(patch.tyreAge) || 0);
      else if (k === 'gap') d.gap = patch.gap === null ? null : Math.max(0, Number(patch.gap) || 0);
      else if (k === 'short') d.short = String(patch.short).slice(0, 3).toUpperCase();
      else d[k] = patch[k];
    }
    renumber();
  },
  removeDriver({ id }) {
    const d = state.race.drivers.find((x) => x.id === id);
    if (!d) return;
    state.race.drivers = state.race.drivers.filter((x) => x.id !== id);
    renumber();
    pushFeed('system', `#${d.number} ${d.name} removed from the field.`);
  },
  setGap({ id, delta, value }) {
    const d = state.race.drivers.find((x) => x.id === id);
    if (!d) return;
    if (delta != null) d.gap = Math.max(0, (d.gap ?? 0) + Number(delta));
    if (value != null) d.gap = Math.max(0, Number(value) || 0);
    renumber();
  },
  moveDriver({ id, dir }) {
    const ordered = sortedDrivers();
    const i = ordered.findIndex((x) => x.id === id);
    const j = i + Number(dir);
    if (i < 0 || j < 0 || j >= ordered.length) return;
    [ordered[i].pos, ordered[j].pos] = [ordered[j].pos, ordered[i].pos];
    renumber();
  },
  setOrder({ ids }) {
    if (!Array.isArray(ids)) return;
    const map = new Map(state.race.drivers.map((d) => [d.id, d]));
    ids.forEach((id, idx) => { const d = map.get(id); if (d) d.pos = idx + 1; });
    renumber();
    pushFeed('system', 'Running order updated.');
  },
  setLapTime({ id, timeMs }) {
    const d = state.race.drivers.find((x) => x.id === id);
    const ms = Number(timeMs);
    if (!d || !Number.isFinite(ms) || ms <= 0) return;
    d.lastLap = ms;
    if (d.bestLap == null || ms < d.bestLap) d.bestLap = ms;
    const overall = bestLapOverall();
    if (overall && (!state.race.fastestLap || ms <= state.race.fastestLap.timeMs)) {
      const improved = !state.race.fastestLap || ms < state.race.fastestLap.timeMs;
      state.race.fastestLap = { driverId: d.id, timeMs: ms, lap: state.race.currentLap };
      if (improved) pushFeed('fastest', `FASTEST LAP — #${d.number} ${d.short} · ${fmtLapServer(ms)}`);
    }
  },
  cycleTyre({ id }) {
    const d = state.race.drivers.find((x) => x.id === id);
    if (!d) return;
    d.tyre = tyreCycle(d.tyre);
    d.tyreAge = 0;
  },
  pitAction({ id }) {
    const d = state.race.drivers.find((x) => x.id === id);
    if (!d) return;
    if (d.status === 'pit') {
      d.status = 'racing';
      pushFeed('pit', `PIT EXIT — #${d.number} ${d.short} rejoins the track`);
    } else if (d.status === 'racing') {
      d.status = 'pit';
      d.pits += 1;
      d.tyreAge = 0;
      pushFeed('pit', `PIT IN — #${d.number} ${d.short} · stop #${d.pits}`);
    }
  },
  retireDriver({ id }) {
    const d = state.race.drivers.find((x) => x.id === id);
    if (!d) return;
    if (d.status === 'dnf') { d.status = 'racing'; pushFeed('system', `#${d.number} ${d.short} back in the fight (undeclared).`); }
    else { d.status = 'dnf'; pushFeed('incident', `DNF — #${d.number} ${d.short} retires from the race`); }
    renumber();
  },
  toggleDrs({ id }) {
    const d = state.race.drivers.find((x) => x.id === id);
    if (d) d.drs = !d.drs;
  },

  // ---------- overlays & feed ----------
  spotter({ driverId = null, text }) {
    if (!text || !String(text).trim()) return;
    state.race.spotter = { id: uid(), driverId, text: String(text).trim(), at: Date.now() };
    const d = driverId ? state.race.drivers.find((x) => x.id === driverId) : null;
    pushFeed('spotter', `${d ? d.short + ': ' : ''}“${String(text).trim()}”`, driverId);
  },
  radio({ driverId = null, text }) {
    if (!text || !String(text).trim()) return;
    state.race.radio = { id: uid(), driverId, text: String(text).trim(), at: Date.now() };
    const d = driverId ? state.race.drivers.find((x) => x.id === driverId) : null;
    pushFeed('radio', `${d ? d.short + ' (' + d.team + '): ' : ''}“${String(text).trim()}”`, driverId);
  },
  clearOverlay({ which = 'both' }) {
    if (which === 'spotter' || which === 'both') state.race.spotter = null;
    if (which === 'radio' || which === 'both') state.race.radio = null;
  },
  pushFeed({ type = 'note', text, driverId = null }) {
    if (!text || !String(text).trim()) return;
    pushFeed(FEED_LABEL[type] ? type : 'note', String(text).trim(), driverId);
  },
  removeFeedItem({ id }) { state.race.feed = state.race.feed.filter((f) => f.id !== id); },
  clearFeed() { state.race.feed = []; },

  // ---------- championship ----------
  setChampMeta({ patch = {} }) {
    const c = state.championship;
    const allowed = ['name', 'season', 'fastestLapPoint'];
    for (const k of Object.keys(patch)) if (allowed.includes(k)) c[k] = patch[k];
  },
  addSeasonDriver({ driver = {} }) {
    state.championship.roster.push({
      id: uid(),
      number: Number(driver.number) || 100 + state.championship.roster.length,
      short: (driver.short || 'NEW').slice(0, 3).toUpperCase(),
      name: driver.name || 'New Driver',
      team: driver.team || 'Private Entry',
      color: driver.color || '#8f9aa8',
      isPlayer: !!driver.isPlayer,
    });
  },
  updateSeasonDriver({ id, patch = {} }) {
    const d = state.championship.roster.find((x) => x.id === id);
    if (!d) return;
    const allowed = ['number', 'short', 'name', 'team', 'color', 'isPlayer'];
    for (const k of Object.keys(patch)) {
      if (!allowed.includes(k)) continue;
      if (k === 'number') d.number = Number(patch.number) || d.number;
      else if (k === 'short') d.short = String(patch.short).slice(0, 3).toUpperCase();
      else d[k] = patch[k];
    }
  },
  removeSeasonDriver({ id }) {
    state.championship.roster = state.championship.roster.filter((x) => x.id !== id);
  },
  importRoster() {
    const roster = state.championship.roster;
    if (!roster.length) return;
    state.race.drivers = roster.map((d, i) => ({
      id: uid(), number: d.number, short: d.short, name: d.name, team: d.team,
      color: d.color, isPlayer: d.isPlayer, pos: i + 1,
      gap: i === 0 ? null : null, tyre: 'M', tyreAge: 0, lastLap: null, bestLap: null,
      pits: 0, drs: false, status: 'racing',
    }));
    // stagger gaps so demo sanity holds even pre-race
    state.race.drivers.forEach((d, i) => { d.gap = i === 0 ? null : null; });
    state.race.currentLap = 1;
    state.race.clockSec = 0; state.race.clockAt = Date.now();
    state.race.status = 'pre';
    state.race.flag = null; state.race.sectorFlags = [null, null, null];
    state.race.lapSnapshots = []; state.race.fastestLap = null;
    state.race.spotter = null; state.race.radio = null;
    pushFeed('system', 'Grid imported from championship roster. Lights out when you are ready.');
  },
  applyRaceToChampionship() {
    const ordered = sortedDrivers();
    if (!ordered.length) return;
    const pts = state.championship.pointsSystem;
    const fl = state.race.fastestLap;
    const results = ordered.map((d) => {
      const position = d.pos;
      let points = d.status === 'dnf' ? 0 : (pts[position - 1] ?? 0);
      if (state.championship.fastestLapPoint && fl && fl.driverId === d.id && position <= 10 && d.status !== 'dnf') points += 1;
      return {
        number: d.number, name: d.name, team: d.team, color: d.color, short: d.short,
        position, status: d.status, points,
      };
    });
    const flName = fl ? (state.race.drivers.find((d) => d.id === fl.driverId) || {}).name : null;
    state.championship.races.push({
      id: uid(),
      round: state.race.round || state.championship.races.length + 1,
      name: state.race.raceName,
      trackName: state.race.trackName,
      sessionType: state.race.sessionType,
      date: new Date().toISOString().slice(0, 10),
      results,
      fastestLap: fl ? { name: flName, timeMs: fl.timeMs } : null,
    });
    pushFeed('system', 'Result applied to the championship standings.');
    return { applied: true };
  },
  removeArchiveRace({ id }) {
    state.championship.races = state.championship.races.filter((r) => r.id !== id);
  },
  resetChampionship() {
    state.championship.races = [];
    pushFeed('system', 'Championship results cleared. Season starts fresh.');
  },
  resetDemo() {
    const fresh = buildDefaultState();
    state.version = fresh.version;
    state.championship = fresh.championship;
    state.race = fresh.race;
  },
  blankRace() {
    const fresh = blankRaceState();
    state.championship = fresh.championship;
    state.race = fresh.race;
  },
};

function fmtLapServer(ms) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
}

// ---------- express app ----------
const app = express();
app.disable('x-powered-by');
app.use(express.json());

app.use('/vendor/titillium-web', express.static(path.join(ROOT, 'node_modules/@fontsource/titillium-web'), { maxAge: '7d' }));
app.use('/vendor/jetbrains-mono', express.static(path.join(ROOT, 'node_modules/@fontsource/jetbrains-mono'), { maxAge: '7d' }));

app.get('/', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
app.get('/host', (req, res) => res.sendFile(path.join(PUBLIC, 'host.html')));
app.get('/checker', (req, res) => res.sendFile(path.join(PUBLIC, 'checker.html')));
app.use(express.static(PUBLIC, { maxAge: '1h', extensions: ['html'] }));

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

app.get('/api/network', async (req, res) => {
  const ips = lanAddresses();
  const host = req.headers.host || `localhost:${PORT}`;
  const checkerPath = '/checker';
  const primary = ips.length ? `http://${ips[0]}:${PORT}${checkerPath}` : `http://localhost:${PORT}${checkerPath}`;
  let qrSvg = null;
  try { qrSvg = await QRCode.toString(primary, { type: 'svg', margin: 0, color: { dark: '#ffd60a', light: '#00000000' } }); } catch { /* qr optional */ }
  res.json({
    port: PORT,
    host,
    ips,
    checkerPath,
    checkerUrl: primary,
    localChecker: `http://localhost:${PORT}${checkerPath}`,
    hostUrl: `http://localhost:${PORT}/host`,
    qrSvg,
    namedTracks: NAMED_TRACKS,
  });
});

app.get('/api/state', (req, res) => res.json(state));
app.get('/api/health', (req, res) => res.json({ ok: true, clients: wss.clients.size }));

const server = http.createServer(app);

// ---------- websocket ----------
const wss = new WebSocketServer({ server, path: '/ws' });
const ACTION_TIMEOUT_MS = 15000;

function broadcastState() {
  const msg = JSON.stringify({ t: 'state', state, serverTime: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(msg);
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.send(JSON.stringify({ t: 'state', state, serverTime: Date.now() }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || msg.t !== 'action' || !msg.action) return;
    const { name, ...payload } = msg.action;
    const handler = actions[name];
    if (!handler) {
      ws.send(JSON.stringify({ t: 'error', message: `Unknown action: ${name}` }));
      return;
    }
    try {
      const started = Date.now();
      handler(payload);
      if (Date.now() - started > ACTION_TIMEOUT_MS) console.warn(`[action] ${name} was slow`);
      persist();
      broadcastState();
    } catch (err) {
      console.error(`[action] ${name} failed:`, err);
      ws.send(JSON.stringify({ t: 'error', message: `Action "${name}" failed: ${err.message}` }));
    }
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanAddresses();
  console.log('');
  console.log('  ██████╗ ██╗    ██╗████████╗██████╗ ██████╗ ██████╗  ');
  console.log('  ██╔══██╗██║    ██║╚══██╔══╝██╔══██╗██╔══██╗██╔══██╗ ');
  console.log('  ██████╔╝██║ █╗ ██║   ██║   ██████╔╝██████╔╝██████╔╝ ');
  console.log('  ██╔══██╗██║███╗██║   ██║   ██╔══██╗██╔═══╝ ██╔══██╗ ');
  console.log('  ██║  ██║╚███╔███╔╝   ██║   ██║  ██║██║     ██║  ██║ ');
  console.log('  ╚═╝  ╚═╝ ╚══╝╚══╝    ╚═╝   ╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝ ');
  console.log('');
  console.log(`  RWTRP Broadcast — Race Weekend Text Role Play`);
  console.log(`  ─────────────────────────────────────────────`);
  console.log(`  Host (режиссёр) :  http://localhost:${PORT}/host`);
  console.log(`  Checker (игроки):  http://localhost:${PORT}/checker`);
  for (const ip of ips) {
    console.log(`  LAN checker     :  http://${ip}:${PORT}/checker`);
  }
  console.log('');
});

process.on('SIGINT', () => { persist(); process.exit(0); });
process.on('SIGTERM', () => { persist(); process.exit(0); });
