// RWTRP Broadcast — HOST (race director console)

import { $, $$, esc, connectWS, fmtLap, parseLap, fmtGap, computeStandings, buildResultsText, buildRecapMarkdown, downloadFile, copyText, TYRE_COLORS } from './core.js';

let state = null;
let ws = null;
let focusedDriverId = null;
let networkInfo = null;

const FLAG_DEFS = [
  { v: 'green', label: 'Green', ico: '#2ecc71' },
  { v: 'yellow', label: 'Yellow', ico: '#ffd60a' },
  { v: 'red', label: 'Red', ico: '#e10600', red: true },
  { v: 'sc', label: 'Safety Car', ico: '#ff9e00', sc: true },
  { v: 'vsc', label: 'VSC', ico: '#ff9e00', sc: true },
  { v: 'blue', label: 'Blue', ico: '#3ea6ff' },
  { v: 'chequered', label: 'Chequered', ico: 'repeating-conic-gradient(#f2f4f8 0% 25%, #14161a 0% 50%) 0 0 / 8px 8px' },
  { v: null, label: 'Clear', ico: '#2a303e' },
];

const SPOTTER_PHRASES = [
  'Car alongside!', 'Clear ahead, push now', 'Gap to car ahead: holding',
  'Box this lap, box box', 'Tyres are done — manage the gap',
  'DRS enabled, use it', 'Watch the rear, it is sliding',
  'Fuel save mode, lift and coast', 'Pace is good, keep it clean',
  'Blue flags ahead — let them through', 'SC in this lap, stay close',
  'Push, push, push!', 'Bring it home, no mistakes',
];

function toast(msg) {
  const wrap = $('#toastWrap');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, 2600);
}

function send(action) {
  if (!ws.send(action)) toast('⚠ Not connected — action queued nowhere, retry in a second');
}

ws = connectWS({
  onState: (s) => { state = s; renderAll(); },
  onError: (msg) => toast('⚠ ' + msg),
  onStatus: (st) => $('#connBanner').classList.toggle('show', st === 'offline'),
});

// ---------- top bar ----------
function renderTop() {
  const r = state.race;
  $('#topSession').textContent = `${r.raceName} · ${r.sessionType}`;
  $('#topLap').textContent = `LAP ${r.currentLap}/${r.totalLaps}`;
  $('#topFlag').textContent = r.flag ? `FLAG: ${r.flag.toUpperCase()}` : 'NO FLAG';
  const live = $('#liveBadge');
  live.classList.toggle('off', r.status !== 'live');
  $('#liveText').textContent = r.status === 'live' ? 'LIVE' : r.status === 'finished' ? 'FINISHED' : 'STANDBY';
}

// ---------- left column: session ----------
function setIfIdle(el, value) {
  if (document.activeElement !== el) el.value = value ?? '';
}

function renderSessionForm() {
  const r = state.race;
  setIfIdle($('#inRaceName'), r.raceName);
  setIfIdle($('#inRound'), r.round);
  setIfIdle($('#inSessionType'), r.sessionType);
  setIfIdle($('#inTrackName'), r.trackName);
  setIfIdle($('#inTrackSeed'), r.trackSeed);
  setIfIdle($('#inTotalLaps'), r.totalLaps);
  setIfIdle($('#inDrs'), r.drsEnabled ? '1' : '0');
  setIfIdle($('#inLap'), r.currentLap);
  setIfIdle($('#inClock'), r.clockSec);
  const w = r.weather || {};
  setIfIdle($('#inWxCondition'), w.condition);
  setIfIdle($('#inWxAir'), w.air);
  setIfIdle($('#inWxTrack'), w.track);
  setIfIdle($('#inWxWind'), w.wind);
  setIfIdle($('#inWxHumidity'), w.humidity);
  $$('#sceneSeg button').forEach((b) => b.classList.toggle('active', b.dataset.scene === (r.scene || 'race')));
}

$('#btnApplyMeta').addEventListener('click', () => {
  send({ name: 'setMeta', patch: {
    raceName: $('#inRaceName').value.trim() || state.race.raceName,
    round: Number($('#inRound').value) || state.race.round,
    sessionType: $('#inSessionType').value,
    trackName: $('#inTrackName').value.trim() || state.race.trackName,
    trackSeed: Number($('#inTrackSeed').value) || state.race.trackSeed,
    totalLaps: Math.max(1, Number($('#inTotalLaps').value) || state.race.totalLaps),
    drsEnabled: $('#inDrs').value === '1',
  }});
  toast('Session settings applied');
});
$('#btnRandomTrack').addEventListener('click', async () => {
  const seed = 1 + Math.floor(Math.random() * 9999);
  let name = `Circuit ${seed}`;
  try {
    const res = await fetch('/api/network');
    const net = await res.json();
    const named = (net.namedTracks || []).find((t) => t.seed === seed);
    if (named) name = named.name;
  } catch { /* offline */ }
  send({ name: 'setMeta', patch: { trackSeed: seed, trackName: name } });
  toast(`🎲 New track: ${name} (seed ${seed})`);
});
$('#btnStatusPre').addEventListener('click', () => send({ name: 'setStatus', status: 'pre' }));
$('#btnStatusLive').addEventListener('click', () => send({ name: 'setStatus', status: 'live' }));
$('#btnStatusFinished').addEventListener('click', () => send({ name: 'setStatus', status: 'finished' }));
$('#btnSetLap').addEventListener('click', () => send({ name: 'setLap', lap: Number($('#inLap').value) }));
$('#btnNextLap').addEventListener('click', () => send({ name: 'nextLap' }));
$('#btnSetClock').addEventListener('click', () => send({ name: 'setClock', clockSec: Number($('#inClock').value) }));
$('#btnRestartRace').addEventListener('click', () => { if (confirm('Restart race from lap 1?')) send({ name: 'restartRace' }); });
$('#btnApplyWeather').addEventListener('click', () => {
  send({ name: 'setWeather', patch: {
    condition: $('#inWxCondition').value,
    air: Number($('#inWxAir').value) || 0,
    track: Number($('#inWxTrack').value) || 0,
    wind: $('#inWxWind').value.trim(),
    humidity: Number($('#inWxHumidity').value) || 0,
  }});
  toast('Weather updated');
});
$$('#sceneSeg button').forEach((b) => b.addEventListener('click', () => send({ name: 'setScene', scene: b.dataset.scene })));
$('#btnBlankRace').addEventListener('click', () => { if (confirm('Clear the session into a blank race? Championship is kept.')) send({ name: 'blankRace' }); });
$('#btnResetDemo').addEventListener('click', () => { if (confirm('Restore the factory demo world? Current state will be replaced.')) send({ name: 'resetDemo' }); });

// ---------- flags ----------
function renderFlags() {
  const r = state.race;
  const grid = $('#flagGrid');
  grid.innerHTML = FLAG_DEFS.map((f) => `
    <button class="flag-btn ${r.flag === f.v ? 'active' + (f.red ? ' red' : f.sc ? ' sc' : '') : ''}" data-flag="${f.v ?? ''}">
      <span class="flag-ico" style="background:${f.ico}"></span>${f.label}
    </button>`).join('');
  $$('#flagGrid .flag-btn').forEach((b) => b.addEventListener('click', () => {
    send({ name: 'setFlag', flag: b.dataset.flag === '' ? null : b.dataset.flag });
  }));
  const sf = $('#sectorFlags');
  sf.innerHTML = [0, 1, 2].map((i) => `
    <div>
      <div class="sector-lbl">SECTOR ${i + 1}</div>
      <div class="seg" data-sector="${i}">
        <button data-v="" class="${!r.sectorFlags[i] ? 'active' : ''}">CLR</button>
        <button data-v="yellow" class="${r.sectorFlags[i] === 'yellow' ? 'active' : ''}">Y</button>
        <button data-v="double" class="${r.sectorFlags[i] === 'double' ? 'active red' : ''}">DY</button>
      </div>
    </div>`).join('');
  $$('#sectorFlags .seg button').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.closest('.seg').dataset.sector);
    send({ name: 'setSectorFlag', index: i, value: b.dataset.v === '' ? null : b.dataset.v });
  }));
}

// ---------- driver table ----------
function renderDrivers() {
  const r = state.race;
  const table = $('#driverTable');
  $('#fieldCount').textContent = `${r.drivers.length} drivers`;
  const ordered = [...r.drivers].sort((a, b) => a.pos - b.pos);
  table.innerHTML = ordered.map((d) => `
    <div class="drow ${d.status === 'dnf' ? 'dnf' : ''} ${d.status === 'pit' ? 'pit' : ''}" data-id="${d.id}" style="border-left-color:${esc(d.color)}">
      <span class="pos">${d.pos}</span>
      <span class="num">#${d.number}</span>
      <span class="who">
        <div class="nm">${esc(d.name)} ${d.isPlayer ? '🎮' : ''}</div>
        <div class="tm">${esc(d.short)} · ${esc(d.team)}</div>
      </span>
      <span class="gapctl">
        <button class="btn btn-icon" data-act="gap-" title="Gap −0.1">−</button>
        <span class="gv">${d.pos === 1 ? 'LEADER' : fmtGap(d.gap)}</span>
        <button class="btn btn-icon" data-act="gap+" title="Gap +0.1">+</button>
      </span>
      <span class="tyrectl">
        <span class="tyre-dot" style="border-color:${TYRE_COLORS[d.tyre] || '#888'};background:${(TYRE_COLORS[d.tyre] || '#888')}33"></span>
        <button class="btn" data-act="tyre" title="Cycle tyre">${d.tyre}</button>
        <span class="tyre-age">${d.tyreAge}L</span>
      </span>
      <span class="lapt">
        <input class="input" data-laptime placeholder="${d.lastLap ? fmtLap(d.lastLap) : '1:23.456'}" />
        <button class="btn" data-act="setlap" title="Set lap time">✓</button>
      </span>
      <span class="ctl">
        <span class="move">
          <button class="btn" data-act="up" title="Move up">▲</button>
          <button class="btn" data-act="down" title="Move down">▼</button>
        </span>
        <button class="btn ${d.status === 'pit' ? 'on sc' : ''}" data-act="pit">${d.status === 'pit' ? 'EXIT' : 'PIT'}</button>
        <button class="btn ${d.status === 'dnf' ? 'on red' : ''}" data-act="dnf">${d.status === 'dnf' ? 'BACK' : 'DNF'}</button>
        <button class="btn ${d.drs ? 'on' : ''}" data-act="drs">DRS</button>
        <button class="btn" data-act="edit">✎</button>
      </span>
      <span class="edit-row" data-editrow>
        <div><label class="lbl">Number</label><input class="input" data-f="number" value="${d.number}" /></div>
        <div><label class="lbl">Code</label><input class="input" data-f="short" value="${esc(d.short)}" maxlength="3" /></div>
        <div><label class="lbl">Name</label><input class="input" data-f="name" value="${esc(d.name)}" /></div>
        <div><label class="lbl">Team</label><input class="input" data-f="team" value="${esc(d.team)}" /></div>
        <div><label class="lbl">Color</label><input class="input" data-f="color" type="color" value="${esc(d.color)}" style="padding:4px;height:38px" /></div>
        <div><label class="lbl">Tyre age</label><input class="input" data-f="tyreAge" type="number" value="${d.tyreAge}" /></div>
        <div><label class="lbl">Best lap (ms)</label><input class="input" data-f="bestLap" type="number" value="${d.bestLap ?? ''}" placeholder="—" /></div>
        <div style="display:flex;gap:8px;align-items:center">
          <label style="font-size:12px;color:var(--dim)"><input type="checkbox" data-f="isPlayer" ${d.isPlayer ? 'checked' : ''} /> 🎮 player</label>
        </div>
        <div class="btn-row">
          <button class="btn btn-sm btn-primary" data-act="save">Save</button>
          <button class="btn btn-sm btn-danger" data-act="remove">Remove driver</button>
        </div>
      </span>
    </div>`).join('');

  $$('#driverTable .drow').forEach((row) => {
    const id = row.dataset.id;
    row.addEventListener('focusin', () => { focusedDriverId = id; });
    row.addEventListener('focusout', () => { if (focusedDriverId === id) focusedDriverId = null; });
    row.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const d = state.race.drivers.find((x) => x.id === id);
      if (!d) return;
      switch (act) {
        case 'gap-': send({ name: 'setGap', id, delta: -0.1 }); break;
        case 'gap+': send({ name: 'setGap', id, delta: 0.1 }); break;
        case 'tyre': send({ name: 'cycleTyre', id }); break;
        case 'up': send({ name: 'moveDriver', id, dir: -1 }); break;
        case 'down': send({ name: 'moveDriver', id, dir: 1 }); break;
        case 'pit': send({ name: 'pitAction', id }); break;
        case 'dnf': send({ name: 'retireDriver', id }); break;
        case 'drs': send({ name: 'toggleDrs', id }); break;
        case 'edit': row.querySelector('[data-editrow]').classList.toggle('open'); break;
        case 'setlap': {
          const input = row.querySelector('[data-laptime]');
          const ms = parseLap(input.value);
          if (ms == null) { toast('⚠ Invalid lap time — use m:ss.mmm'); break; }
          send({ name: 'setLapTime', id, timeMs: ms });
          input.value = '';
          break;
        }
        case 'save': {
          const patch = {};
          row.querySelectorAll('[data-f]').forEach((inp) => {
            const f = inp.dataset.f;
            if (inp.type === 'checkbox') patch[f] = inp.checked;
            else if (f === 'number' || f === 'tyreAge') patch[f] = Number(inp.value);
            else if (f === 'bestLap') patch[f] = inp.value === '' ? null : Number(inp.value);
            else patch[f] = inp.value;
          });
          // bestLap is not in server allowlist for updateDriver — send via setLapTime trick is wrong;
          // instead include only allowed fields and handle bestLap separately:
          const best = patch.bestLap;
          delete patch.bestLap;
          send({ name: 'updateDriver', id, patch });
          if (best != null && Number.isFinite(best) && best > 0) {
            // set best by submitting it as a lap time (also updates lastLap — acceptable)
            send({ name: 'setLapTime', id, timeMs: best });
          }
          row.querySelector('[data-editrow]').classList.remove('open');
          toast('Driver updated');
          break;
        }
        case 'remove': if (confirm(`Remove #${d.number} ${d.name} from the field?`)) send({ name: 'removeDriver', id }); break;
      }
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('[data-laptime]')) {
        const btn = row.querySelector('[data-act="setlap"]');
        if (btn) btn.click();
      }
    });
  });
}

$('#btnAddDriver').addEventListener('click', () => {
  const driver = {
    number: Number($('#ndNumber').value) || undefined,
    short: $('#ndShort').value.trim() || undefined,
    name: $('#ndName').value.trim() || undefined,
    team: $('#ndTeam').value.trim() || undefined,
    color: $('#ndColor').value,
    isPlayer: $('#ndPlayer').checked,
  };
  send({ name: 'addDriver', driver });
  $('#ndNumber').value = ''; $('#ndShort').value = ''; $('#ndName').value = ''; $('#ndTeam').value = '';
  toast('Driver added');
});

// ---------- spotter / radio ----------
function renderOverlayDriverSelect() {
  const sel = $('#inOverlayDriver');
  const cur = sel.value;
  const ordered = [...state.race.drivers].sort((a, b) => a.pos - b.pos);
  sel.innerHTML = '<option value="">— Race control / all —</option>' +
    ordered.map((d) => `<option value="${d.id}">#${d.number} ${esc(d.short)} — ${esc(d.name)}</option>`).join('');
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function renderPhrases() {
  $('#spotterPhrases').innerHTML = SPOTTER_PHRASES.map((p) => `<button class="phrase" data-p="${esc(p)}">${esc(p)}</button>`).join('');
  $$('#spotterPhrases .phrase').forEach((b) => b.addEventListener('click', () => {
    $('#inOverlayText').value = b.dataset.p;
    $('#inOverlayText').focus();
  }));
}
renderPhrases();

$('#btnSpotter').addEventListener('click', () => {
  const text = $('#inOverlayText').value.trim();
  if (!text) return toast('⚠ Type a spotter message first');
  send({ name: 'spotter', driverId: $('#inOverlayDriver').value || null, text });
  $('#inOverlayText').value = '';
});
$('#btnRadio').addEventListener('click', () => {
  const text = $('#inOverlayText').value.trim();
  if (!text) return toast('⚠ Type a radio message first');
  send({ name: 'radio', driverId: $('#inOverlayDriver').value || null, text });
  $('#inOverlayText').value = '';
});
$('#btnClearOverlay').addEventListener('click', () => send({ name: 'clearOverlay', which: 'both' }));

function renderRadioLog() {
  const items = [...(state.race.feed || [])].filter((f) => f.type === 'radio' || f.type === 'spotter').slice(-6).reverse();
  $('#radioLog').innerHTML = items.map((f) => `<div class="rl-item"><b>L${f.lap} · ${f.type.toUpperCase()}</b>${esc(f.text)}</div>`).join('') || '<div class="hint">No radio traffic yet.</div>';
}

// ---------- feed composer ----------
$('#btnPushFeed').addEventListener('click', () => {
  const text = $('#inFeedText').value.trim();
  if (!text) return toast('⚠ Type a feed note first');
  send({ name: 'pushFeed', type: $('#inFeedType').value, text });
  $('#inFeedText').value = '';
});
$('#btnClearFeed').addEventListener('click', () => { if (confirm('Clear the whole race feed?')) send({ name: 'clearFeed' }); });

function renderFeedLog() {
  const items = [...(state.race.feed || [])].slice(-8).reverse();
  $('#feedLog').innerHTML = items.map((f) => `<div class="fl-item"><button class="del" data-del="${f.id}" title="Delete">✕</button><b>L${f.lap} · ${f.type.toUpperCase()}</b>${esc(f.text)}</div>`).join('') || '<div class="hint">Feed is empty.</div>';
  $$('#feedLog [data-del]').forEach((b) => b.addEventListener('click', () => send({ name: 'removeFeedItem', id: b.dataset.del })));
}

// ---------- championship ----------
function renderChampForm() {
  const c = state.championship;
  setIfIdle($('#inChampName'), c.name);
  setIfIdle($('#inChampSeason'), c.season);
  $('#inFlPoint').checked = !!c.fastestLapPoint;
}
$('#btnApplyChamp').addEventListener('click', () => {
  send({ name: 'setChampMeta', patch: {
    name: $('#inChampName').value.trim() || state.championship.name,
    season: $('#inChampSeason').value.trim() || state.championship.season,
    fastestLapPoint: $('#inFlPoint').checked,
  }});
  toast('Championship settings applied');
});
$('#btnImportRoster').addEventListener('click', () => { if (confirm('Replace the current grid with the championship roster?')) send({ name: 'importRoster' }); });
$('#btnApplyResults').addEventListener('click', () => { send({ name: 'applyRaceToChampionship' }); toast('🏆 Result applied to championship'); });
$('#btnResetChamp').addEventListener('click', () => { if (confirm('Delete ALL archived championship results?')) send({ name: 'resetChampionship' }); });

function renderStandingsMini() {
  const rows = computeStandings(state.championship).slice(0, 8);
  $('#standingsMini').innerHTML = rows.length ? `
    <table class="standings-mini">
      <thead><tr><th>P</th><th>DRIVER</th><th class="num">PTS</th><th class="num">W</th></tr></thead>
      <tbody>${rows.map((s) => `<tr class="${s.position === 1 ? 'me' : ''}"><td class="mono">${s.position}</td><td>${esc(s.name)}</td><td class="num">${s.points}</td><td class="num">${s.wins}</td></tr>`).join('')}</tbody>
    </table>` : '<div class="hint">No results yet.</div>';
}

function renderRoster() {
  const roster = state.championship.roster || [];
  $('#rosterList').innerHTML = roster.map((d) => `
    <div class="archive-item" data-id="${d.id}">
      <span class="mono dim">#${d.number}</span>
      <span class="ai-name">${esc(d.name)}</span>
      <span class="ai-meta">${esc(d.team)}</span>
      <button class="btn btn-sm btn-ghost del" data-delroster="${d.id}">✕</button>
    </div>`).join('') || '<div class="hint">Roster is empty.</div>';
  $$('#rosterList [data-delroster]').forEach((b) => b.addEventListener('click', () => send({ name: 'removeSeasonDriver', id: b.dataset.delroster })));
}
$('#btnAddRoster').addEventListener('click', () => {
  send({ name: 'addSeasonDriver', driver: {
    number: Number($('#nrNumber').value) || undefined,
    short: $('#nrShort').value.trim() || undefined,
    name: $('#nrName').value.trim() || undefined,
  }});
  $('#nrNumber').value = ''; $('#nrShort').value = ''; $('#nrName').value = '';
});

function renderArchive() {
  const races = state.championship.races || [];
  $('#archiveList').innerHTML = races.map((r) => `
    <div class="archive-item">
      <span class="ai-name">R${r.round} · ${esc(r.name)}</span>
      <span class="ai-meta">${esc(r.trackName)} · ${r.date}</span>
      <button class="btn btn-sm btn-ghost del" data-delrace="${r.id}">✕</button>
    </div>`).join('') || '<div class="hint">No archived races.</div>';
  $$('#archiveList [data-delrace]').forEach((b) => b.addEventListener('click', () => send({ name: 'removeArchiveRace', id: b.dataset.delrace })));
}

// ---------- export ----------
$('#btnCopyResults').addEventListener('click', async () => {
  const ok = await copyText(buildResultsText(state));
  toast(ok ? '📋 Results copied — paste into your LLM chat' : '⚠ Copy failed — use download instead');
});
$('#btnDlResults').addEventListener('click', () => {
  downloadFile(`rwtrp-results-${state.race.raceName.replace(/[^\w-]+/g, '_')}.txt`, buildResultsText(state));
  toast('⬇ Results downloaded');
});
$('#btnDlRecap').addEventListener('click', () => {
  downloadFile(`rwtrp-recap-${state.race.raceName.replace(/[^\w-]+/g, '_')}.md`, buildRecapMarkdown(state), 'text/markdown');
  toast('⬇ Recap downloaded');
});

// ---------- network / QR ----------
async function loadNetwork() {
  try {
    const res = await fetch('/api/network');
    networkInfo = await res.json();
    $('#netUrl').textContent = networkInfo.checkerUrl;
    $('#qrBox').innerHTML = networkInfo.qrSvg || '<div class="hint">QR unavailable</div>';
    const ips = networkInfo.ips || [];
    $('#netHint').textContent = ips.length
      ? `Friends on the same Wi-Fi open this URL. Host console: ${networkInfo.hostUrl}`
      : 'No LAN address detected — players on this machine can use localhost.';
  } catch {
    $('#netUrl').textContent = '—';
  }
}
loadNetwork();
setInterval(loadNetwork, 30000);

// ---------- master render ----------
function renderAll() {
  if (!state) return;
  renderTop();
  renderSessionForm();
  renderFlags();
  // avoid clobbering the row the director is typing in
  if (!focusedDriverId) renderDrivers();
  else {
    // still refresh everything except the focused row's inputs: simplest safe path is full re-render
    // only when the focused row no longer exists
    if (!state.race.drivers.some((d) => d.id === focusedDriverId)) renderDrivers();
  }
  renderOverlayDriverSelect();
  renderRadioLog();
  renderFeedLog();
  renderChampForm();
  renderStandingsMini();
  renderRoster();
  renderArchive();
}
