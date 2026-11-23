# RWTRP Broadcast

**Race Weekend Text Role Play** — live broadcast console for a racing text-roleplay league.
Your LLM narrates the race lap by lap, players write strategies — and this app shows it all
like a real F1/iRacing broadcast: timing tower, flags, spotter, track map, championship.

No physics simulation — this is the **show**, not the sim.

## Quick start

```bash
npm install
npm start          # or: npm run dev (auto-restart)
```

Then open:

| Window | URL | Who |
|---|---|---|
| **Host** (race director) | http://localhost:3000/host | The person running the LLM chat |
| **Checker** (players) | http://localhost:3000/checker | Everyone else |

The landing page (`/`) shows a **QR code + LAN URL** — friends on the same Wi-Fi open it on
their own devices and see the broadcast sync live. The server binds `0.0.0.0`, port `3000`
(override with `PORT=4000 npm start`).

## How a race night works

1. **Host** opens `/host`. Set the session (race name, round, track, laps, DRS), press **Go live**.
2. As the LLM narrates each lap, the director updates the show:
   - **Running order** — move drivers up/down, adjust gaps (±0.1s), cycle tyres, set lap times, pit in/out, retire, toggle DRS, edit any driver.
   - **Flags** — green / yellow / red / safety car / VSC / blue / chequered, plus per-sector yellow & double-yellow.
   - **Spotter / Radio** — type a message (or tap a quick phrase like *"Car alongside!"*) and it pops up as a broadcast lower-third on every checker, with a radio blip.
   - **Feed notes** — incidents, penalties, strategy calls go into the race feed and the ticker.
   - **Weather** — condition, air/track temps, wind, humidity.
   - **Next lap** — advances the lap counter, snapshots the running order for the position chart, ages tyres.
3. **Checker** (players) see everything in F1-broadcast style: animated timing tower, a 2D track
   map with moving cars (procedurally generated from the track seed — same seed = same circuit),
   sector flag overlays, race feed, ticker, and scene overlays:
   - **Results** — final classification with points,
   - **Standings** — championship table,
   - **Chart** — lap-by-lap position chart,
   - **Feed** — full event log.
4. At the end: **Apply current result to championship** archives the race; **Export** copies a
   results text (paste into your LLM chat / Discord) or downloads a Markdown race recap.

## Features

- **Timing tower** with animated reordering, gaps/intervals, tyre compound + age, DRS, pit/DNF markers, player (🎮) highlight
- **2D track map** — seeded procedural circuits, 8 named track presets, cars positioned by gap, sector boundaries, start/finish line
- **Flag system** — full set + per-sector flags, chequered flag auto-switches checker to results
- **Spotter & team radio** lower-thirds with WebAudio blips (mute with the 🔊 button or `M`)
- **Championship** — roster, points system (25-18-15-…-1), optional fastest-lap point, multi-race archive, standings
- **Sessions** — FP1/FP2/FP3/Q/R types, pre/live/finished states, session clock
- **Persistence** — state auto-saves to `data/state.json`; delete it to regenerate the demo world
- **Demo world** — factory Round 3 state (Volkov Park Autodrome, 12 drivers, 2 archived rounds) so you can explore instantly; reset anytime from the host console

## Tech

Node 18+ · Express · WebSocket (`ws`) · vanilla ES modules (no build step) ·
Titillium Web + JetBrains Mono via `@fontsource`. State is a single JSON document broadcast
to all clients on every mutation.

## Project layout

```
server/
  index.js    Express + WS server, actions, persistence, QR/LAN API
  demo.js     factory demo world + blank-race generator
public/
  index.html  landing with QR
  host.html   race director console
  checker.html broadcast player view
  js/core.js  WS client, formatting, championship math, exporters, audio
  js/track.js seeded circuit generator + canvas rendering
  js/host.js  director logic
  js/checker.js broadcast rendering
  css/        F1-broadcast dark theme
data/
  state.json  persisted race state (git-ignored)
```
