// Demo world for RWTRP Broadcast — a championship in progress + race on lap 18.
// Everything here is fictional; the host can factory-reset from the UI at any time.
import { randomUUID } from 'crypto';

export const uid = () => randomUUID().slice(0, 8);

// deterministic PRNG for stable demo generation
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const NAMED_TRACKS = [
  { seed: 7,  name: 'RWTRP International Circuit' },
  { seed: 3,  name: 'Neon City Street Circuit' },
  { seed: 11, name: 'Harbour Park Street Circuit' },
  { seed: 5,  name: 'Alpine Ridge' },
  { seed: 13, name: 'Sahra Desert Raceway' },
  { seed: 21, name: 'Kaido Bay Speedway' },
  { seed: 17, name: 'Volkov Park Autodrome' },
  { seed: 29, name: 'Monolith Grand Prix Circuit' },
];

export const DRIVERS = [
  { number: 27, short: 'VOL', name: 'Daniil Volkov',  team: 'Apex Velocity',   color: '#ff8000', isPlayer: true  },
  { number: 5,  short: 'AST', name: 'Rune Astrup',    team: 'Nordwind GP',     color: '#00d2be', isPlayer: true  },
  { number: 88, short: 'SOR', name: 'Kim Sørensen',   team: 'Scuderia Komet',  color: '#e8002d', isPlayer: true  },
  { number: 16, short: 'MRE', name: 'Marcel Moreau',  team: 'Scuderia Komet',  color: '#e8002d', isPlayer: false },
  { number: 63, short: 'LIN', name: 'Georg Lindqvist',team: 'Nordwind GP',     color: '#00d2be', isPlayer: false },
  { number: 11, short: 'HRR', name: 'Max Herrera',    team: 'Falcon Ridge',    color: '#2293d1', isPlayer: false },
  { number: 44, short: 'OKF', name: 'Lew Okafor',     team: 'Falcon Ridge',    color: '#2293d1', isPlayer: false },
  { number: 31, short: 'PET', name: 'Estin Petrov',   team: 'Kessler Motorsport', color: '#c9ccd1', isPlayer: false },
  { number: 55, short: 'RIC', name: 'Carlo Ricci',    team: 'Kessler Motorsport', color: '#c9ccd1', isPlayer: false },
  { number: 23, short: 'BND', name: 'Niko Brandt',    team: 'Titan Arrow',     color: '#a259ff', isPlayer: false },
  { number: 10, short: 'TNK', name: 'Yuki Tanaka',    team: 'Titan Arrow',     color: '#a259ff', isPlayer: false },
  { number: 77, short: 'BRN', name: 'Oliver Brennan', team: 'Hitech GP',       color: '#ffd12f', isPlayer: false },
];

const TYRE_CYCLE = ['S', 'M', 'H', 'I', 'W'];
export const tyreCycle = (c) => TYRE_CYCLE[(TYRE_CYCLE.indexOf(c) + 1) % TYRE_CYCLE.length] || 'M';

function buildRaceDrivers() {
  // classified order for lap 18 (Tanaka retired)
  const gaps = {
    '27': null,      // leader
    '88': 4.214,
    '5': 6.771,
    '16': 9.002,
    '63': 12.580,
    '11': 15.347,
    '55': 18.921,
    '44': 24.466,
    '31': 31.055,
    '23': 48.190,
    '77': 92.436,
  };
  const info = {
    '27': { tyre: 'M', age: 11, lastLap: 86812, bestLap: 85994, pits: 1, drs: true,  status: 'racing' },
    '88': { tyre: 'M', age: 10, lastLap: 86117, bestLap: 85318, pits: 1, drs: true,  status: 'racing' },
    '5':  { tyre: 'M', age: 12, lastLap: 86490, bestLap: 86231, pits: 1, drs: true,  status: 'racing' },
    '16': { tyre: 'H', age: 9,  lastLap: 86901, bestLap: 86120, pits: 1, drs: true,  status: 'racing' },
    '63': { tyre: 'M', age: 1,  lastLap: 88120, bestLap: 86298, pits: 2, drs: true,  status: 'racing' },
    '11': { tyre: 'H', age: 14, lastLap: 87312, bestLap: 86771, pits: 1, drs: true,  status: 'racing' },
    '55': { tyre: 'H', age: 17, lastLap: 87880, bestLap: 87092, pits: 1, drs: false, status: 'racing' },
    '44': { tyre: 'M', age: 8,  lastLap: 88411, bestLap: 87440, pits: 1, drs: false, status: 'racing' },
    '31': { tyre: 'H', age: 13, lastLap: 89102, bestLap: 88113, pits: 2, drs: false, status: 'racing' },
    '23': { tyre: 'H', age: 16, lastLap: 91230, bestLap: 89812, pits: 1, drs: false, status: 'racing' },
    '10': { tyre: 'S', age: 6,  lastLap: null,  bestLap: 87901, pits: 0, drs: false, status: 'dnf'    },
    '77': { tyre: 'H', age: 18, lastLap: 92401, bestLap: 90544, pits: 1, drs: false, status: 'racing' },
  };
  const order = ['27', '88', '5', '16', '63', '11', '55', '44', '31', '23', '77', '10'];

  let pos = 1;
  return order.map((num) => {
    const d = DRIVERS.find((x) => String(x.number) === num);
    const m = info[num];
    const p = m.status === 'dnf' ? 12 : pos++;
    return {
      id: uid(),
      number: d.number,
      short: d.short,
      name: d.name,
      team: d.team,
      color: d.color,
      isPlayer: d.isPlayer,
      pos: p,
      gap: m.status === 'dnf' ? null : gaps[num],
      intervalNote: null,
      tyre: m.tyre,
      tyreAge: m.age,
      lastLap: m.lastLap,
      bestLap: m.bestLap,
      pits: m.pits,
      drs: m.drs,
      status: m.status,
    };
  });
}

function buildSnapshots(finalDrivers) {
  const rand = mulberry32(20261123);
  const order = finalDrivers.map((d) => d.id);
  const snapshots = [];
  // start from a shuffled grid, converge toward the real order
  let current = [...order].sort(() => rand() - 0.5);
  // make sure player 27 starts up front and 10 goes backwards — drama!
  const id27 = finalDrivers.find((d) => d.number === 27).id;
  current = [id27, ...current.filter((x) => x !== id27)];
  const laps = 17;
  for (let lap = 1; lap <= laps; lap++) {
    // local shuffle noise that shrinks as the race converges
    const noise = Math.max(0.06, 0.34 * (1 - lap / laps));
    for (let k = current.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      if (rand() < noise) [current[k], current[j]] = [current[j], current[k]];
    }
    // blend progressively toward real order as laps run down
    if (lap > laps * 0.55) {
      const t = (lap - laps * 0.55) / (laps * 0.45); // 0..1
      const anchor = order.slice(0, Math.max(2, Math.floor(order.length * t)));
      current = [...anchor, ...current.filter((id) => !anchor.includes(id))];
    }
    snapshots.push({ lap, order: [...current] });
  }
  snapshots.push({ lap: 18, order: [...order] });
  return snapshots;
}

export function buildDefaultState() {
  const drivers = buildRaceDrivers();
  const snapshots = buildSnapshots(drivers);
  const flDriver = drivers.find((d) => d.number === 88);

  return {
    version: 1,
    championship: {
      name: 'RWTRP Championship',
      season: 2026,
      pointsSystem: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
      fastestLapPoint: true,
      roster: DRIVERS.map((d) => ({ id: uid(), ...d })),
      races: [
        {
          id: uid(), round: 1, name: 'Harbour Park Street Circuit', trackName: 'Harbour Park Street Circuit',
          sessionType: 'R', date: '2026-10-04',
          results: [
            { number: 16, name: 'Marcel Moreau', team: 'Scuderia Komet', color: '#e8002d', short: 'MRE', position: 1, status: 'racing', points: 25 },
            { number: 27, name: 'Daniil Volkov', team: 'Apex Velocity', color: '#ff8000', short: 'VOL', position: 2, status: 'racing', points: 18 },
            { number: 88, name: 'Kim Sørensen', team: 'Scuderia Komet', color: '#e8002d', short: 'SOR', position: 3, status: 'racing', points: 15 },
            { number: 63, name: 'Georg Lindqvist', team: 'Nordwind GP', color: '#00d2be', short: 'LIN', position: 4, status: 'racing', points: 12 },
            { number: 5, name: 'Rune Astrup', team: 'Nordwind GP', color: '#00d2be', short: 'AST', position: 5, status: 'racing', points: 10 },
            { number: 11, name: 'Max Herrera', team: 'Falcon Ridge', color: '#2293d1', short: 'HRR', position: 6, status: 'racing', points: 8 },
            { number: 55, name: 'Carlo Ricci', team: 'Kessler Motorsport', color: '#c9ccd1', short: 'RIC', position: 7, status: 'racing', points: 6 },
            { number: 44, name: 'Lew Okafor', team: 'Falcon Ridge', color: '#2293d1', short: 'OKF', position: 8, status: 'racing', points: 4 },
            { number: 31, name: 'Estin Petrov', team: 'Kessler Motorsport', color: '#c9ccd1', short: 'PET', position: 9, status: 'racing', points: 2 },
            { number: 23, name: 'Niko Brandt', team: 'Titan Arrow', color: '#a259ff', short: 'BND', position: 10, status: 'racing', points: 1 },
            { number: 77, name: 'Oliver Brennan', team: 'Hitech GP', color: '#ffd12f', short: 'BRN', position: 11, status: 'racing', points: 0 },
            { number: 10, name: 'Yuki Tanaka', team: 'Titan Arrow', color: '#a259ff', short: 'TNK', position: 12, status: 'dnf', points: 0 },
          ],
          fastestLap: { name: 'Daniil Volkov', timeMs: 78312 },
        },
        {
          id: uid(), round: 2, name: 'Alpine Ridge', trackName: 'Alpine Ridge',
          sessionType: 'R', date: '2026-11-01',
          results: [
            { number: 88, name: 'Kim Sørensen', team: 'Scuderia Komet', color: '#e8002d', short: 'SOR', position: 1, status: 'racing', points: 26 },
            { number: 27, name: 'Daniil Volkov', team: 'Apex Velocity', color: '#ff8000', short: 'VOL', position: 2, status: 'racing', points: 18 },
            { number: 5, name: 'Rune Astrup', team: 'Nordwind GP', color: '#00d2be', short: 'AST', position: 3, status: 'racing', points: 15 },
            { number: 16, name: 'Marcel Moreau', team: 'Scuderia Komet', color: '#e8002d', short: 'MRE', position: 4, status: 'racing', points: 12 },
            { number: 44, name: 'Lew Okafor', team: 'Falcon Ridge', color: '#2293d1', short: 'OKF', position: 5, status: 'racing', points: 10 },
            { number: 11, name: 'Max Herrera', team: 'Falcon Ridge', color: '#2293d1', short: 'HRR', position: 6, status: 'racing', points: 8 },
            { number: 77, name: 'Oliver Brennan', team: 'Hitech GP', color: '#ffd12f', short: 'BRN', position: 7, status: 'racing', points: 6 },
            { number: 63, name: 'Georg Lindqvist', team: 'Nordwind GP', color: '#00d2be', short: 'LIN', position: 8, status: 'racing', points: 4 },
            { number: 55, name: 'Carlo Ricci', team: 'Kessler Motorsport', color: '#c9ccd1', short: 'RIC', position: 9, status: 'racing', points: 2 },
            { number: 31, name: 'Estin Petrov', team: 'Kessler Motorsport', color: '#c9ccd1', short: 'PET', position: 10, status: 'racing', points: 1 },
            { number: 23, name: 'Niko Brandt', team: 'Titan Arrow', color: '#a259ff', short: 'BND', position: 11, status: 'racing', points: 0 },
            { number: 10, name: 'Yuki Tanaka', team: 'Titan Arrow', color: '#a259ff', short: 'TNK', position: 12, status: 'racing', points: 0 },
          ],
          fastestLap: { name: 'Kim Sørensen', timeMs: 76208 },
        },
      ],
    },
    race: {
      raceName: 'RWTRP Grand Prix — Round 3',
      round: 3,
      trackName: 'Volkov Park Autodrome',
      trackSeed: 17,
      sessionType: 'R',
      status: 'live',
      currentLap: 18,
      totalLaps: 45,
      clockSec: 32 * 60 + 11,
      clockAt: Date.now(),
      flag: 'green',
      flagSetAt: Date.now(),
      sectorFlags: [null, null, null],
      weather: { condition: 'dry', air: 27, track: 43, wind: 'SW · 9 km/h', humidity: 34 },
      scene: 'race',
      drsEnabled: true,
      drivers,
      fastestLap: { driverId: flDriver.id, timeMs: 85318, lap: 12 },
      spotter: null,
      radio: null,
      feed: [
        { id: uid(), lap: 2,  at: Date.now() - 1000 * 60 * 29, type: 'fastest', text: 'FASTEST LAP — #88 Sørensen · 1:25.318' },
        { id: uid(), lap: 3,  at: Date.now() - 1000 * 60 * 27, type: 'note',    text: 'Cars running to plan. Clean air for the leaders.' },
        { id: uid(), lap: 11, at: Date.now() - 1000 * 60 * 19, type: 'incident',text: 'Light contact Turn 4 — TNK vs BND. No damage, no investigation.' },
        { id: uid(), lap: 13, at: Date.now() - 1000 * 60 * 13, type: 'pit',     text: 'PIT — #10 Tanaka retired: rear wing damage. Car stopped at Turn 9.' },
        { id: uid(), lap: 14, at: Date.now() - 1000 * 60 * 10, type: 'radio',   text: 'SOR (Komet): “Box box, box box.”' },
        { id: uid(), lap: 16, at: Date.now() - 1000 * 60 * 6,  type: 'pit',     text: 'PIT — #63 Lindqvist · stop 2.9s · hard tyres' },
        { id: uid(), lap: 17, at: Date.now() - 1000 * 60 * 3,  type: 'flag',    text: 'YELLOW SECTOR 2 — debris near the apex. Double-waved.' },
        { id: uid(), lap: 18, at: Date.now() - 1000 * 62,      type: 'spotter', text: 'VOL: “Car alongside — Sørensen on the right.”' },
        { id: uid(), lap: 18, at: Date.now() - 1000 * 40,      type: 'flag',    text: 'GREEN FLAG — sector clear. Racing resumes.' },
      ],
      lapSnapshots: snapshots,
    },
  };
}

export function blankRaceState() {
  const state = buildDefaultState();
  state.championship.races = [];
  state.race = {
    raceName: 'RWTRP Grand Prix',
    round: 1,
    trackName: 'RWTRP International Circuit',
    trackSeed: 7,
    sessionType: 'R',
    status: 'pre',
    currentLap: 1,
    totalLaps: 45,
    clockSec: 0,
    clockAt: Date.now(),
    flag: null,
    flagSetAt: null,
    sectorFlags: [null, null, null],
    weather: { condition: 'dry', air: 25, track: 38, wind: '—', humidity: 40 },
    scene: 'race',
    drsEnabled: true,
    drivers: DRIVERS.map((d) => ({
      id: uid(), number: d.number, short: d.short, name: d.name, team: d.team, color: d.color,
      isPlayer: d.isPlayer, pos: 0, gap: null, intervalNote: null,
      tyre: 'M', tyreAge: 0, lastLap: null, bestLap: null, pits: 0, drs: false, status: 'racing',
    })),
    fastestLap: null,
    spotter: null,
    radio: null,
    feed: [{ id: uid(), lap: 0, at: Date.now(), type: 'note', text: 'Session created. Waiting for the lights to go out.' }],
    lapSnapshots: [],
  };
  // restore pos + grid order
  state.race.drivers.forEach((d, i) => { d.pos = i + 1; });
  return state;
}
