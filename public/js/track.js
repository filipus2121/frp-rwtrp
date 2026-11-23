// Procedural circuit generator — seeded closed Catmull-Rom spline with an
// arc-length table so we can place cars, kerbs, corners and sectors precisely.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateTrack(seed = 7) {
  const rand = mulberry32(seed * 1013904223 + 7);
  const n = 11 + Math.floor(rand() * 4); // 11–14 control points
  const cx = 0, cy = 0;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const r = 0.60 + rand() * 0.42;
    pts.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r * 0.86 });
  }
  // closed Catmull-Rom → sampled polyline
  const samples = [];
  const SAMPLES_PER_SEG = 34;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let j = 0; j < SAMPLES_PER_SEG; j++) {
      const t = j / SAMPLES_PER_SEG;
      const t2 = t * t, t3 = t2 * t;
      samples.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  // arc-length table
  const cum = [0];
  for (let i = 1; i <= samples.length; i++) {
    const a = samples[i - 1], b = samples[i % samples.length];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const length = cum[cum.length - 1];
  const pointAt = (dist) => {
    let d = ((dist % length) + length) % length;
    // binary search
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < d) lo = mid + 1; else hi = mid;
    }
    const i = Math.max(1, lo);
    const a = samples[(i - 1) % samples.length], b = samples[i % samples.length];
    const segLen = cum[i] - cum[i - 1] || 1;
    const t = (d - cum[i - 1]) / segLen;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    return { x, y, ang };
  };
  // bounding box for fit
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of samples) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return { seed, samples, cum, length, pointAt, bbox: { minX, maxX, minY, maxY }, controlPoints: n };
}

// fit track into canvas box with padding, returns transform helpers
export function trackTransform(track, width, height, padding = 46) {
  const { minX, maxX, minY, maxY } = track.bbox;
  const tw = maxX - minX, th = maxY - minY;
  const scale = Math.min((width - padding * 2) / tw, (height - padding * 2) / th);
  const ofx = (width - tw * scale) / 2 - minX * scale;
  const ofy = (height - th * scale) / 2 - minY * scale;
  return {
    scale, ox: ofx, oy: ofy,
    tx: (x) => x * scale + ofx,
    ty: (y) => y * scale + ofy,
  };
}

// Draw the full circuit into a 2d context fitted to (width, height)
export function drawTrack(ctx, track, width, height, opts = {}) {
  const tf = trackTransform(track, width, height, opts.padding ?? 40);
  const pts = track.samples.map((p) => [tf.tx(p.x), tf.ty(p.y)]);

  const pathFrom = (arr, close = true) => {
    ctx.beginPath();
    ctx.moveTo(arr[0][0], arr[0][1]);
    for (let i = 1; i < arr.length; i++) ctx.lineTo(arr[i][0], arr[i][1]);
    if (close) ctx.closePath();
  };

  // ambient glow under the circuit
  ctx.save();
  ctx.shadowColor = 'rgba(255, 209, 47, 0.16)';
  ctx.shadowBlur = 34;
  pathFrom(pts);
  ctx.strokeStyle = 'rgba(255,214,10,0.10)';
  ctx.lineWidth = 30;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();

  // white edge (kerb outline)
  pathFrom(pts);
  ctx.strokeStyle = '#dfe3e8';
  ctx.lineWidth = 27;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // asphalt body
  pathFrom(pts);
  ctx.strokeStyle = '#33373f';
  ctx.lineWidth = 20;
  ctx.stroke();

  // inner subtle line
  pathFrom(pts);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 12]);
  ctx.stroke();
  ctx.setLineDash([]);

  // sector flag overlays — repaint the affected third of the lap in a flag colour
  const sectors = opts.sectorFlags || [null, null, null];
  const total = track.length;
  for (let s = 0; s < 3; s++) {
    const v = sectors[s];
    if (!v) continue;
    const startD = (s / 3) * total, endD = ((s + 1) / 3) * total;
    const seg = [];
    const step = total / pts.length;
    for (let i = 0; i < pts.length; i++) {
      const d = i * step;
      if (d >= startD && d <= endD) seg.push(pts[i]);
    }
    if (seg.length > 1) {
      pathFrom(seg, false);
      ctx.strokeStyle = v === 'double' ? 'rgba(255,214,10,0.85)' : 'rgba(255,214,10,0.45)';
      ctx.lineWidth = 20;
      ctx.globalAlpha = v === 'double' ? 0.85 : 0.55;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // start / finish line — perpendicular checkers at distance 0
  const sf = track.pointAt(0);
  const nx = Math.cos(sf.ang + Math.PI / 2), ny = Math.sin(sf.ang + Math.PI / 2);
  const sx = tf.tx(sf.x), sy = tf.ty(sf.y);
  const half = 13;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(Math.atan2(ny, nx) + Math.PI / 2);
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      ctx.fillStyle = (row + col) % 2 ? '#111' : '#f5f5f5';
      ctx.fillRect(-8, -half + row * 13 + col * 0, 4, 6.5);
      ctx.fillRect(-8 + 4, -half + row * 13 + 6.5, 4, 6.5);
    }
  }
  ctx.restore();

  // sector boundary ticks + labels
  ctx.font = '700 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labelFor = ['S1', 'S2', 'S3'];
  for (let s = 0; s < 3; s++) {
    const d = (s / 3) * total;
    const p = track.pointAt(d);
    const px = tf.tx(p.x), py = tf.ty(p.y);
    const lx = px + Math.cos(p.ang + Math.PI / 2) * 34;
    const ly = py + Math.sin(p.ang + Math.PI / 2) * 34;
    ctx.fillStyle = 'rgba(10,12,16,0.75)';
    ctx.beginPath(); ctx.arc(lx, ly, 11, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#ffd60a';
    ctx.fillText(labelFor[s], lx, ly + 0.5);
  }

  return tf;
}

// position of car with gap-to-leader (seconds) along the track
export function carDistance(track, leaderD, gapSec, lapTimeSec = 90) {
  if (gapSec == null) return leaderD;
  const fraction = Math.min(0.35, (gapSec / lapTimeSec) * 1.15); // exaggerated for readability
  return leaderD - fraction * track.length;
}
