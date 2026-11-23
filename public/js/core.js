// Shared client core — WebSocket sync, formatting, championship math, exporters, audio.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- formatting ----------
export function fmtLap(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
}

export function parseLap(str) {
  if (str == null) return null;
  const t = String(str).trim().replace(',', '.');
  if (!t) return null;
  let m = /^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(t);
  if (m) {
    const min = Number(m[1]);
    const sec = Number(m[2]);
    const milli = Number((m[3] || '0').padEnd(3, '0'));
    return min * 60000 + sec * 1000 + milli;
  }
  m = /^(\d{1,3})(?:\.(\d{1,3}))?$/.exec(t);
  if (m) {
    const sec = Number(m[1]);
    const milli = Number((m[2] || '0').padEnd(3, '0'));
    return sec * 1000 + milli;
  }
  return null;
}

export const fmtGap = (sec) => (sec == null ? '—' : `+${Number(sec).toFixed(3)}`);
export const fmtClock = (sec) => {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export const SESSION_LABEL = { FP1: 'PRACTICE 1', FP2: 'PRACTICE 2', FP3: 'PRACTICE 3', Q: 'QUALIFYING', R: 'RACE' };
export const TYRE_COLORS = { S: '#e8002d', M: '#ffd60a', H: '#f2f2f2', I: '#2ecc71', W: '#2f8fff' };

// ---------- websocket with auto-reconnect ----------
export function connectWS({ onState, onError, onStatus }) {
  let ws = null;
  let retry = 0;
  let closed = false;

  const send = (action) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: 'action', action }));
      return true;
    }
    return false;
  };

  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => { retry = 0; onStatus && onStatus('online'); };
    ws.onclose = () => {
      onStatus && onStatus('offline');
      if (closed) return;
      retry += 1;
      const delay = Math.min(8000, 500 * 2 ** Math.min(retry, 4));
      setTimeout(open, delay);
    };
    ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'state') onState && onState(msg.state, msg.serverTime);
      else if (msg.t === 'error') onError && onError(msg.message);
    };
  };
  open();

  return {
    send,
    close: () => { closed = true; try { ws.close(); } catch { /* noop */ } },
  };
}

// ---------- championship math ----------
export function computeStandings(championship) {
  const table = new Map();
  const ensure = (key, seed) => {
    if (!table.has(key)) {
      table.set(key, {
        key, name: seed?.name || key, team: seed?.team || '', color: seed?.color || '#888',
        short: seed?.short || key.slice(0, 3).toUpperCase(), number: seed?.number ?? 0,
        points: 0, wins: 0, races: 0, bestFinish: 99, lastPoints: 0,
      });
    }
    return table.get(key);
  };
  for (const r of championship.races || []) {
    for (const res of r.results || []) {
      const key = `${res.name}`;
      const row = ensure(key, res);
      row.points += res.points || 0;
      row.races += 1;
      row.lastPoints = res.points || 0;
      if (res.position === 1 && res.status !== 'dnf') row.wins += 1;
      if (res.position < row.bestFinish) row.bestFinish = res.position;
      row.name = res.name; row.team = res.team; row.color = res.color; row.short = res.short || row.short; row.number = res.number ?? row.number;
    }
  }
  // include roster drivers with zero points so the table is complete
  for (const r of championship.roster || []) ensure(`${r.name}`, r);
  const rows = [...table.values()];
  rows.sort((a, b) => (b.points - a.points) || (b.wins - a.wins) || (a.bestFinish - b.bestFinish) || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.position = i + 1; });
  return rows;
}

// ---------- exporters (host side) ----------
export function buildResultsText(state) {
  const { race, championship } = state;
  const lines = [];
  const weather = race.weather || {};
  const wLabel = { dry: 'Dry', cloudy: 'Cloudy', rain: 'Rain', storm: 'Storm' }[weather.condition] || weather.condition || '—';
  lines.push(`🏁 ${race.raceName} — ${SESSION_LABEL[race.sessionType] || race.sessionType}`);
  lines.push(`Track: ${race.trackName} · Laps: ${race.totalLaps} · Weather: ${wLabel}, Air ${weather.air}°C / Track ${weather.track}°C`);
  lines.push('');
  const ordered = [...race.drivers].sort((a, b) => a.pos - b.pos);
  for (const d of ordered) {
    const gap = d.pos === 1 ? 'WINNER' : d.status === 'dnf' ? 'DNF' : `+${Number(d.gap ?? 0).toFixed(3)}`;
    lines.push(`P${d.pos}  ${String(d.number).padStart(2, ' ')} ${d.name} (${d.team}) — ${gap}${d.tyre ? ` · ${d.tyre}${d.tyreAge}` : ''}`);
  }
  if (race.fastestLap) {
    const fl = race.drivers.find((d) => d.id === race.fastestLap.driverId);
    if (fl) lines.push('', `🟣 Fastest lap: ${fl.name} — ${fmtLap(race.fastestLap.timeMs)} (lap ${race.fastestLap.lap ?? '?'})`);
  }
  if (championship?.races?.length) {
    lines.push('', `Championship: ${championship.name} — ${championship.races.length + 0} rounds archived`);
  }
  return lines.join('\n');
}

export function buildRecapMarkdown(state) {
  const { race, championship } = state;
  const w = race.weather || {};
  const wLabel = { dry: 'Dry', cloudy: 'Cloudy', rain: 'Rain', storm: 'Storm' }[w.condition] || '—';
  const ordered = [...race.drivers].sort((a, b) => a.pos - b.pos);
  const incidents = (race.feed || []).filter((f) => ['incident', 'penalty', 'flag', 'fastest'].includes(f.type));
  const out = [];
  out.push(`# ${race.raceName}`);
  out.push('');
  out.push(`- **Track:** ${race.trackName}`);
  out.push(`- **Session:** ${SESSION_LABEL[race.sessionType] || race.sessionType} · ${race.totalLaps} laps`);
  out.push(`- **Weather:** ${wLabel} · Air ${w.air}°C · Track ${w.track}°C · Wind ${w.wind} · Humidity ${w.humidity}%`);
  out.push('');
  out.push('## Result');
  out.push('');
  out.push('| P | # | Driver | Team | Gap | Tyre |');
  out.push('|---|---|--------|------|-----|------|');
  for (const d of ordered) {
    const gap = d.pos === 1 ? 'WINNER' : d.status === 'dnf' ? 'DNF' : `+${Number(d.gap ?? 0).toFixed(3)}`;
    out.push(`| ${d.pos} | ${d.number} | ${d.name}${d.isPlayer ? ' 🎮' : ''} | ${d.team} | ${gap} | ${d.tyre}${d.tyreAge} |`);
  }
  out.push('');
  if (race.fastestLap) {
    const fl = race.drivers.find((d) => d.id === race.fastestLap.driverId);
    if (fl) out.push(`**🟣 Fastest lap:** ${fl.name} — ${fmtLap(race.fastestLap.timeMs)} (lap ${race.fastestLap.lap ?? '?'})`);
    out.push('');
  }
  if (incidents.length) {
    out.push('## Key moments');
    out.push('');
    for (const f of incidents) out.push(`- L${f.lap} · ${f.text}`);
    out.push('');
  }
  const standings = computeStandings(championship);
  out.push('## Championship');
  out.push('');
  out.push(`### ${championship.name} · Season ${championship.season}`);
  out.push('');
  out.push('| P | Driver | Team | PTS | Wins |');
  out.push('|---|--------|------|-----|------|');
  for (const s of standings) out.push(`| ${s.position} | ${s.name} | ${s.team} | ${s.points} | ${s.wins} |`);
  out.push('');
  out.push(`*Generated by RWTRP Broadcast · ${new Date().toISOString().slice(0, 10)}*`);
  return out.join('\n');
}

export function downloadFile(name, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* noop */ }
    ta.remove(); return ok;
  }
}

// ---------- audio blips (WebAudio, no assets) ----------
let audioCtx = null;
export function ensureAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch { return null; }
}
export function blip(freq = 880, dur = 0.09, type = 'square', when = 0, gain = 0.05) {
  const ctx = ensureAudio(); if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(ctx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
export const radioBlip = () => { blip(1240, 0.06, 'square', 0, 0.045); blip(880, 0.07, 'square', 0.075, 0.04); };
export const flagBlip = () => { blip(520, 0.16, 'sawtooth', 0, 0.05); };
export const cheerBlip = () => { [523, 659, 784, 1046].forEach((f, i) => blip(f, 0.16, 'triangle', i * 0.11, 0.06)); };
