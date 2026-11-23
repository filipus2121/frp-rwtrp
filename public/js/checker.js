// RWTRP Broadcast — CHECKER (player view)
// Renders the full broadcast: timing tower, 2D track map, feed, overlays, scenes.

import { $, $$, esc, connectWS, fmtLap, fmtGap, fmtClock, SESSION_LABEL, TYRE_COLORS, computeStandings, radioBlip, flagBlip, cheerBlip, ensureAudio } from './core.js';
import { generateTrack, drawTrack, carDistance } from './track.js';

let state = null;
let lastState = null;
let soundOn = true;
let activeTab = 'feed';
let trackCache = { seed: null, track: null };
let leaderDist = 0;          // animated leader distance along track
let lastLapSeen = null;
let lastFlagSeen = null;
let lastSpotterId = null;
let lastRadioId = null;
let overlayTimer = null;
const rowEls = new Map();    // driverId -> row element (FLIP)
const prevPos = new Map();   // driverId -> pos

const FLAG_META = {
  green: { label: 'GREEN FLAG', cls: 'flag-green', ico: '#2ecc71' },
  yellow: { label: 'YELLOW FLAG', cls: 'flag-yellow', ico: '#ffd60a' },
  red: { label: 'RED FLAG', cls: 'flag-red', ico: '#e10600' },
  sc: { label: 'SAFETY CAR', cls: 'flag-sc', ico: '#ff9e00' },
  vsc: { label: 'VIRTUAL SC', cls: 'flag-sc', ico: '#ff9e00' },
  blue: { label: 'BLUE FLAG', cls: 'flag-blue', ico: '#3ea6ff' },
  chequered: { label: 'CHEQUERED FLAG', cls: 'flag-chequered', ico: 'repeating-conic-gradient(#f2f4f8 0% 25%, #14161a 0% 50%) 0 0 / 8px 8px' },
};

const WEATHER_LABEL = { dry: 'DRY', cloudy: 'CLOUDY', rain: 'RAIN', storm: 'STORM' };
const FEED_TAG = { flag: 'FLAG', radio: 'RADIO', spotter: 'SPOTTER', incident: 'INCIDENT', pit: 'PIT', note: 'NOTE', fastest: 'FASTEST', weather: 'WEATHER', penalty: 'PENALTY', strategy: 'STRATEGY', system: 'INFO' };

// ---------- sound toggle (also unlocks AudioContext on first gesture) ----------
const soundBtn = document.createElement('button');
soundBtn.className = 'btn btn-sm';
soundBtn.style.cssText = 'position:fixed;right:14px;bottom:58px;z-index:60;';
soundBtn.textContent = '🔊 SOUND ON';
soundBtn.title = 'Toggle broadcast sounds (M)';
soundBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  soundBtn.textContent = soundOn ? '🔊 SOUND ON' : '🔇 MUTED';
  if (soundOn) ensureAudio();
});
document.body.appendChild(soundBtn);
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'm' && !e.target.matches('input,textarea,select')) soundBtn.click();
});
document.addEventListener('pointerdown', () => { if (soundOn) ensureAudio(); }, { once: true });

// ---------- connection ----------
connectWS({
  onState: (s) => { lastState = state; state = s; renderAll(); },
  onError: (msg) => console.warn('[ws]', msg),
  onStatus: (st) => $('#connBanner').classList.toggle('show', st === 'offline'),
});

// ---------- clock tick ----------
setInterval(() => {
  if (!state) return;
  const r = state.race;
  let sec = r.clockSec;
  if (r.status === 'live' && r.clockAt) sec += (Date.now() - r.clockAt) / 1000;
  $('#sessionClock').textContent = fmtClock(sec);
}, 250);

// ---------- main render ----------
function renderAll() {
  if (!state) return;
  const r = state.race;
  renderTopbar(r);
  renderTower(r);
  renderFeed(r);
  renderTicker(r);
  renderOverlays(r);
  renderScenes(r);
  renderSectorChips(r);
  $('#hudTrack').textContent = `${r.trackName} · seed ${r.trackSeed}`;
  $('#hudDrs').textContent = `DRS: ${r.drsEnabled ? 'ENABLED' : 'DISABLED'}`;
  // audio triggers
  if (r.flag !== lastFlagSeen) {
    if (lastFlagSeen !== null && soundOn) { if (r.flag === 'chequered') cheerBlip(); else flagBlip(); }
    lastFlagSeen = r.flag;
  }
  if (r.spotter && r.spotter.id !== lastSpotterId) { lastSpotterId = r.spotter.id; if (soundOn) radioBlip(); }
  if (r.radio && r.radio.id !== lastRadioId) { lastRadioId = r.radio.id; if (soundOn) radioBlip(); }
}

function renderTopbar(r) {
  $('#raceName').textContent = r.raceName || 'RWTRP Race';
  $('#raceTrack').textContent = r.trackName || '';
  $('#raceSession').textContent = SESSION_LABEL[r.sessionType] || r.sessionType || '';
  const w = r.weather || {};
  $('#raceWeather').textContent = `${WEATHER_LABEL[w.condition] || w.condition || ''} · ${w.air ?? '–'}°C / ${w.track ?? '–'}°C`;
  $('#lapCounter').innerHTML = `${r.currentLap}<small>/${r.totalLaps}</small>`;
  const fl = r.fastestLap;
  if (fl) {
    const d = r.drivers.find((x) => x.id === fl.driverId);
    $('#fastestLap').textContent = d ? `${fmtLap(fl.timeMs)} ${d.short}` : fmtLap(fl.timeMs);
  } else $('#fastestLap').textContent = '—';
  const live = $('#liveBadge');
  const isLive = r.status === 'live';
  live.classList.toggle('off', !isLive);
  $('#liveText').textContent = r.status === 'live' ? 'LIVE' : r.status === 'finished' ? 'FINISHED' : 'STANDBY';
  const banner = $('#flagBanner');
  const meta = FLAG_META[r.flag];
  banner.className = 'flag-banner ' + (meta ? meta.cls : 'flag-none');
  $('#flagText').textContent = meta ? meta.label : 'NO FLAG';
  $('#flagIco').style.background = meta ? meta.ico : '#2a303e';
  const leader = [...r.drivers].sort((a, b) => a.pos - b.pos)[0];
  if (leader) $('#legendLeader').textContent = `${leader.short} · #${leader.number}`;
}

// ---------- timing tower with FLIP reorder animation ----------
function renderTower(r) {
  const tower = $('#tower');
  const ordered = [...r.drivers].sort((a, b) => a.pos - b.pos);
  const seen = new Set();

  // capture old tops for FLIP
  const oldTops = new Map();
  for (const [id, el] of rowEls) oldTops.set(id, el.offsetTop);

  for (const d of ordered) {
    seen.add(d.id);
    let el = rowEls.get(d.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'trow';
      el.dataset.id = d.id;
      rowEls.set(d.id, el);
    }
    el.className = 'trow' + (d.pos === 1 ? ' leader' : '') + (d.status === 'dnf' ? ' dnf' : '') + (d.status === 'pit' ? ' pit' : '');
    const prev = prevPos.get(d.id);
    const moved = prev != null && prev !== d.pos;
    if (moved) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200); }
    prevPos.set(d.id, d.pos);

    const interval = d.pos === 1 ? 'LEADER' : d.status === 'dnf' ? 'DNF' : d.status === 'pit' ? 'PIT' : fmtGap(d.gap);
    const tyreColor = TYRE_COLORS[d.tyre] || '#888';
    el.innerHTML = `
      <span class="team-bar" style="background:${esc(d.color)}"></span>
      <span class="pos">${d.pos}</span>
      <span class="driver">
        <span class="dnum">#${d.number}</span>
        <span>
          <span class="dshort">${esc(d.short)}${d.isPlayer ? ' <span class="player-mark">🎮</span>' : ''}</span>
          <span class="dteam">${esc(d.team)}</span>
        </span>
      </span>
      <span class="gap">${d.pos === 1 ? '—' : d.status === 'dnf' ? '—' : fmtGap(d.gap)}</span>
      <span class="interval">${interval}</span>
      <span class="tyre"><span class="tyre-dot" style="border-color:${tyreColor};background:${tyreColor}33" title="Tyre ${d.tyre}"></span><span class="tyre-age">${d.tyre}${d.tyreAge ? '·' + d.tyreAge : ''}</span></span>
      ${d.drs && r.drsEnabled ? '<span class="drs">DRS</span>' : ''}
      ${d.status === 'pit' ? '<span class="status-tag pit">PIT</span>' : ''}
      ${d.status === 'dnf' ? '<span class="status-tag dnf">DNF</span>' : ''}
    `;
    tower.appendChild(el);
  }
  // remove stale rows
  for (const [id, el] of [...rowEls]) {
    if (!seen.has(id)) { el.remove(); rowEls.delete(id); prevPos.delete(id); }
  }
  // FLIP: animate from old top to new top
  for (const d of ordered) {
    const el = rowEls.get(d.id);
    const oldTop = oldTops.get(d.id);
    if (oldTop == null) continue;
    const dy = oldTop - el.offsetTop;
    if (dy !== 0) {
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
      el.offsetHeight; // reflow
      el.style.transition = 'transform 0.55s cubic-bezier(0.25, 0.9, 0.3, 1)';
      el.style.transform = '';
      setTimeout(() => { el.style.transition = ''; }, 600);
    }
  }
}

// ---------- feed ----------
function feedItemHTML(f) {
  return `<div class="feed-item t-${esc(f.type)}">
    <span class="feed-lap">L${f.lap}</span>
    <span class="feed-tag">${FEED_TAG[f.type] || 'NOTE'}</span>
    <span class="feed-text">${esc(f.text)}</span>
  </div>`;
}

function renderFeed(r) {
  const feedBody = $('#feedBody');
  const radioBody = $('#radioBody');
  const feed = [...(r.feed || [])].reverse();
  feedBody.innerHTML = feed.length ? feed.map(feedItemHTML).join('') : '<div class="big-empty">NO EVENTS YET</div>';
  const radios = feed.filter((f) => f.type === 'radio' || f.type === 'spotter');
  radioBody.innerHTML = radios.length ? radios.map(feedItemHTML).join('') : '<div class="big-empty">NO RADIO TRAFFIC</div>';
}

$$('.panel-tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    activeTab = btn.dataset.tab;
    $$('.panel-tabs button').forEach((b) => b.classList.toggle('active', b === btn));
    $('#feedBody').classList.toggle('hidden', activeTab !== 'feed');
    $('#radioBody').classList.toggle('hidden', activeTab !== 'radio');
  });
});

// ---------- ticker ----------
function renderTicker(r) {
  const items = [...(r.feed || [])].slice(-8).reverse();
  const html = items.map((f) => `<b>L${f.lap}</b> ${esc(f.text)}<span class="tick-sep">◆</span>`).join('');
  const doubled = html + html;
  const el = $('#tickerInner');
  if (el.dataset.html !== doubled) { el.innerHTML = doubled || 'RWTRP BROADCAST — RACE WEEKEND TEXT ROLE PLAY'; el.dataset.html = doubled; }
}

// ---------- lower-third overlays ----------
function renderOverlays(r) {
  const lt = $('#lowerThird');
  const active = r.radio || r.spotter;
  if (!active) { if (lt.innerHTML) lt.innerHTML = ''; return; }
  const isRadio = !!r.radio;
  const msg = isRadio ? r.radio : r.spotter;
  const d = msg.driverId ? r.drivers.find((x) => x.id === msg.driverId) : null;
  const key = `${isRadio ? 'r' : 's'}:${msg.id}`;
  if (lt.dataset.key === key) return;
  lt.dataset.key = key;
  lt.innerHTML = `<div class="lt-card ${isRadio ? 'radio' : 'spotter'}">
    <div class="lt-head">
      <span class="lt-kind">${isRadio ? '◉ TEAM RADIO' : '◉ SPOTTER'}</span>
      ${d ? `<span class="lt-driver">#${d.number} ${esc(d.short)}</span><span class="lt-team">${esc(d.team)}</span>` : '<span class="lt-driver">RACE CONTROL</span>'}
      <span class="lt-time">LAP ${r.currentLap}</span>
    </div>
    <div class="lt-text">“${esc(msg.text)}”</div>
  </div>`;
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => { lt.innerHTML = ''; lt.dataset.key = ''; }, 9000);
}

// ---------- sector chips ----------
function renderSectorChips(r) {
  const wrap = $('#sectorChips');
  const html = (r.sectorFlags || []).map((v, i) => {
    const cls = v === 'double' ? 'dy' : v === 'yellow' ? 'y' : '';
    const mark = v === 'double' ? '⚠' : v === 'yellow' ? '●' : '○';
    return `<span class="sector-chip ${cls}">S${i + 1} ${mark}</span>`;
  }).join('');
  if (wrap.dataset.html !== html) { wrap.innerHTML = html; wrap.dataset.html = html; }
}

// ---------- scenes ----------
function renderScenes(r) {
  const scene = r.scene || 'race';
  const show = (id, on) => $(id).classList.toggle('hidden', !on);
  show('#sceneResults', scene === 'results');
  show('#sceneStandings', scene === 'standings');
  show('#sceneAnalysis', scene === 'analysis');
  show('#sceneFeed', scene === 'feed');
  if (scene === 'results') renderResultsScene(r);
  if (scene === 'standings') renderStandingsScene(r);
  if (scene === 'analysis') renderAnalysisScene(r);
  if (scene === 'feed') renderFeedScene(r);
}

function pointsFor(r, d) {
  if (d.status === 'dnf') return 0;
  const pts = state.championship.pointsSystem || [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
  let p = pts[d.pos - 1] ?? 0;
  if (state.championship.fastestLapPoint && r.fastestLap && r.fastestLap.driverId === d.id && d.pos <= 10) p += 1;
  return p;
}

function renderResultsScene(r) {
  const ordered = [...r.drivers].sort((a, b) => a.pos - b.pos);
  const w = r.weather || {};
  $('#sceneResults').innerHTML = `
    <div class="scene-title">FINAL <span>CLASSIFICATION</span></div>
    <div class="scene-sub">${esc(r.raceName)} · ${esc(r.trackName)} · ${SESSION_LABEL[r.sessionType] || r.sessionType} · ${r.totalLaps} LAPS · ${WEATHER_LABEL[w.condition] || ''} ${w.air ?? ''}°C</div>
    <table class="scene-table">
      <thead><tr><th>POS</th><th>#</th><th>DRIVER</th><th>TEAM</th><th class="num">GAP</th><th class="num">TYRE</th><th class="num">PITS</th><th class="num">BEST</th><th class="num">PTS</th></tr></thead>
      <tbody>
      ${ordered.map((d) => `<tr class="${d.pos === 1 ? 'winner' : ''} ${d.status === 'dnf' ? 'dnf' : ''}">
        <td class="poscell">${d.pos}</td><td class="mono">#${d.number}</td>
        <td><b>${esc(d.name)}</b>${d.isPlayer ? ' 🎮' : ''}</td>
        <td class="dim">${esc(d.team)}</td>
        <td class="num">${d.pos === 1 ? 'WINNER' : d.status === 'dnf' ? 'DNF' : fmtGap(d.gap)}</td>
        <td class="num">${d.tyre}${d.tyreAge ? ' ·' + d.tyreAge : ''}</td>
        <td class="num">${d.pits || 0}</td>
        <td class="num">${d.bestLap ? fmtLap(d.bestLap) : '—'}</td>
        <td class="num">${pointsFor(r, d)}</td>
      </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderStandingsScene(r) {
  const rows = computeStandings(state.championship);
  $('#sceneStandings').innerHTML = `
    <div class="scene-title">CHAMPIONSHIP <span>STANDINGS</span></div>
    <div class="scene-sub">${esc(state.championship.name)} · SEASON ${esc(state.championship.season)} · ${state.championship.races.length} ROUNDS COMPLETED</div>
    <table class="scene-table">
      <thead><tr><th>POS</th><th>DRIVER</th><th>TEAM</th><th class="num">PTS</th><th class="num">WINS</th><th class="num">RACES</th><th class="num">BEST</th><th class="num">LAST</th></tr></thead>
      <tbody>
      ${rows.map((s) => `<tr class="${s.position === 1 ? 'winner' : ''}">
        <td class="poscell">${s.position}</td>
        <td><span class="team-bar" style="display:inline-block;width:4px;height:12px;border-radius:2px;background:${esc(s.color)};margin-right:8px;vertical-align:-1px"></span><b>${esc(s.name)}</b></td>
        <td class="dim">${esc(s.team)}</td>
        <td class="num"><b>${s.points}</b></td>
        <td class="num">${s.wins}</td>
        <td class="num">${s.races}</td>
        <td class="num">${s.bestFinish === 99 ? '—' : 'P' + s.bestFinish}</td>
        <td class="num">${s.lastPoints}</td>
      </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderAnalysisScene(r) {
  const snaps = r.lapSnapshots || [];
  const wrap = $('#sceneAnalysis');
  if (!snaps.length) {
    wrap.innerHTML = `<div class="scene-title">POSITION <span>CHART</span></div><div class="big-empty">NO LAP DATA YET — ADVANCE LAPS FROM THE HOST CONSOLE</div>`;
    return;
  }
  const W = 1100, H = 420, padL = 46, padR = 130, padT = 18, padB = 34;
  const maxLap = Math.max(...snaps.map((s) => s.lap), r.currentLap);
  const maxPos = Math.max(r.drivers.length, 1);
  const X = (lap) => padL + ((lap - 1) / Math.max(1, maxLap - 1)) * (W - padL - padR);
  const Y = (pos) => padT + ((pos - 1) / Math.max(1, maxPos - 1)) * (H - padT - padB);
  const byId = new Map(r.drivers.map((d) => [d.id, d]));
  const series = new Map();
  for (const s of snaps) {
    s.order.forEach((id, idx) => {
      if (!series.has(id)) series.set(id, []);
      series.get(id).push({ lap: s.lap, pos: idx + 1 });
    });
  }
  // current positions as final point
  for (const d of r.drivers) {
    if (!series.has(d.id)) series.set(d.id, []);
    series.get(d.id).push({ lap: r.currentLap, pos: d.pos });
  }
  let grid = '';
  for (let p = 1; p <= maxPos; p++) {
    grid += `<line x1="${padL}" y1="${Y(p)}" x2="${W - padR}" y2="${Y(p)}" stroke="rgba(255,255,255,0.07)"/><text x="${padL - 10}" y="${Y(p) + 4}" fill="#5b6474" font-size="11" text-anchor="end" font-family="JetBrains Mono">P${p}</text>`;
  }
  let lines = '';
  let legend = '';
  for (const [id, pts] of series) {
    const d = byId.get(id);
    if (!d || pts.length < 1) continue;
    const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.lap).toFixed(1)},${Y(p.pos).toFixed(1)}`).join(' ');
    lines += `<path d="${path}" fill="none" stroke="${esc(d.color)}" stroke-width="2.4" stroke-linejoin="round" opacity="0.92"/>`;
    const last = pts[pts.length - 1];
    lines += `<circle cx="${X(last.lap)}" cy="${Y(last.pos)}" r="4" fill="${esc(d.color)}"/>`;
    legend += `<span><i style="background:${esc(d.color)}"></i>#${d.number} ${esc(d.short)}</span>`;
  }
  wrap.innerHTML = `
    <div class="scene-title">POSITION <span>CHART</span></div>
    <div class="scene-sub">${esc(r.raceName)} · LAP-BY-LAP RUNNING ORDER</div>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${grid}${lines}</svg>
      <div class="chart-legend">${legend}</div>
    </div>`;
}

function renderFeedScene(r) {
  const feed = [...(r.feed || [])].reverse();
  $('#sceneFeed').innerHTML = `
    <div class="scene-title">RACE <span>FEED</span></div>
    <div class="scene-sub">${feed.length} EVENTS · ${esc(r.raceName)}</div>
    <div style="margin-top:18px;columns:2;column-gap:28px">
      ${feed.map(feedItemHTML).join('') || '<div class="big-empty">NO EVENTS YET</div>'}
    </div>`;
}

// ---------- track map ----------
const canvas = $('#trackCanvas');
const ctx = canvas.getContext('2d');
let lastTs = 0;

function resizeCanvas() {
  const wrap = canvas.parentElement;
  const rect = wrap.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeCanvas);

function drawLoop(ts) {
  requestAnimationFrame(drawLoop);
  const dt = Math.min(0.1, (ts - lastTs) / 1000 || 0.016);
  lastTs = ts;
  if (!state) return;
  const r = state.race;
  const wrap = canvas.parentElement;
  const rect = wrap.getBoundingClientRect();
  const W = rect.width, H = rect.height;
  if (W < 10 || H < 10) return;

  if (trackCache.seed !== r.trackSeed || !trackCache.track) {
    trackCache = { seed: r.trackSeed, track: generateTrack(r.trackSeed) };
    leaderDist = 0;
  }
  const track = trackCache.track;
  const leader = [...r.drivers].sort((a, b) => a.pos - b.pos)[0];
  const lapTimeSec = leader && leader.bestLap ? leader.bestLap / 1000 : 90;
  const speed = track.length / Math.max(20, lapTimeSec);
  if (r.status === 'live') leaderDist = (leaderDist + speed * dt) % track.length;
  if (lastLapSeen !== r.currentLap) { lastLapSeen = r.currentLap; /* keep continuous motion */ }

  ctx.clearRect(0, 0, W, H);
  // subtle vignette grid
  ctx.fillStyle = 'rgba(255,255,255,0.015)';
  for (let x = 0; x < W; x += 44) ctx.fillRect(x, 0, 1, H);
  for (let y = 0; y < H; y += 44) ctx.fillRect(0, y, W, 1);

  const tf = drawTrack(ctx, track, W, H, { sectorFlags: r.sectorFlags, padding: 54 });

  // cars
  const ordered = [...r.drivers].sort((a, b) => a.pos - b.pos);
  for (const d of ordered) {
    const dist = carDistance(track, leaderDist, d.gap, lapTimeSec);
    const p = track.pointAt(dist);
    const px = tf.tx(p.x), py = tf.ty(p.y);
    const ang = p.ang;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(1.5, 2.5, 11, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    // body
    const grad = ctx.createLinearGradient(-11, 0, 11, 0);
    grad.addColorStop(0, d.color);
    grad.addColorStop(1, shade(d.color, -35));
    ctx.fillStyle = d.status === 'dnf' ? '#3a3f47' : grad;
    roundRect(ctx, -11, -5, 22, 10, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // cockpit
    ctx.fillStyle = 'rgba(10,12,16,0.85)';
    roundRect(ctx, -3, -3.2, 7, 6.4, 2.5);
    ctx.fill();
    // rear wing accent
    ctx.fillStyle = d.color;
    ctx.fillRect(-12, -5.5, 3, 11);
    // DRS flap
    if (d.drs && r.drsEnabled) {
      ctx.fillStyle = '#ffd60a';
      ctx.fillRect(-13.5, -5.5, 1.6, 11);
    }
    ctx.restore();

    // number label
    ctx.save();
    ctx.translate(px, py - 15);
    ctx.font = '800 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    const label = `#${d.number}`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(8,10,14,0.82)';
    roundRect(ctx, -tw / 2 - 4, -8, tw + 8, 14, 4);
    ctx.fill();
    ctx.fillStyle = d.pos === 1 ? '#ffd60a' : '#f2f4f8';
    ctx.fillText(label, 0, 2.5);
    ctx.restore();

    if (d.status === 'pit') {
      ctx.save();
      ctx.translate(px + 14, py + 10);
      ctx.font = '800 9px "JetBrains Mono"';
      ctx.fillStyle = '#ff9e00';
      ctx.fillText('PIT', 0, 0);
      ctx.restore();
    }
    if (d.status === 'dnf') {
      ctx.save();
      ctx.translate(px + 14, py + 10);
      ctx.font = '800 10px "JetBrains Mono"';
      ctx.fillStyle = '#ff6f6a';
      ctx.fillText('✕', 0, 0);
      ctx.restore();
    }
  }
}
requestAnimationFrame(drawLoop);

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt, g = ((n >> 8) & 0xff) + amt, b = (n & 0xff) + amt;
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return `rgb(${r},${g},${b})`;
}

// initial sizing after fonts/layout settle
setTimeout(resizeCanvas, 60);
