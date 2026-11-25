export interface Shift { dx: number; dy: number }

/**
 * Global frame-to-frame shift by SAD block matching on the centre 60 % of the frame.
 * Result convention: cur(x + dx, y + dy) ≈ prev(x, y), i.e. content moved by (dx, dy). Integer px, within ±radius.
 */
export function globalShift(prev: Uint8Array, cur: Uint8Array, w: number, h: number, radius = 8): Shift {
  const x0 = Math.floor(w * 0.2), x1 = Math.ceil(w * 0.8);
  const y0 = Math.floor(h * 0.2), y1 = Math.ceil(h * 0.8);
  const sad = (dx: number, dy: number): number => {
    let s = 0;
    for (let y = y0; y < y1; y++) {
      const pr = y * w, cr = (y + dy) * w + dx;
      for (let x = x0; x < x1; x++) s += Math.abs(prev[pr + x] - cur[cr + x]);
    }
    return s;
  };
  let best = { dx: 0, dy: 0 };
  let bestSad = sad(0, 0);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (y0 + dy < 0 || y1 + dy > h || x0 + dx < 0 || x1 + dx > w) continue;
      const s = sad(dx, dy);
      if (s < bestSad) { bestSad = s; best = { dx, dy }; }
    }
  }
  return best;
}

/**
 * Jitter of the camera path: RMS of (path − centred moving average, window 0.5 s), in % of frame width.
 * The window shrinks symmetrically at the ends so a constant-velocity pan scores 0. maxPx = largest residual (px).
 */
export function jitterScore(shifts: Shift[], fps: number, frameWidth: number): { score: number; maxPx: number } {
  const n = shifts.length;
  if (n === 0) return { score: 0, maxPx: 0 };
  const px: number[] = [], py: number[] = [];
  let ax = 0, ay = 0;
  for (const s of shifts) { ax += s.dx; ay += s.dy; px.push(ax); py.push(ay); }
  const half = Math.max(1, Math.round(fps * 0.5 / 2));
  let sumSq = 0, maxPx = 0;
  for (let i = 0; i < n; i++) {
    const hw = Math.min(half, i, n - 1 - i);
    let mx = 0, my = 0;
    for (let j = i - hw; j <= i + hw; j++) { mx += px[j]; my += py[j]; }
    mx /= 2 * hw + 1; my /= 2 * hw + 1;
    const r2 = (px[i] - mx) ** 2 + (py[i] - my) ** 2;
    sumSq += r2;
    maxPx = Math.max(maxPx, Math.sqrt(r2));
  }
  return { score: (Math.sqrt(sumSq / n) / frameWidth) * 100, maxPx };
}

/** Moving-average path (window 0.5 s, shrinking symmetrically at the ends) of the accumulated shifts. */
function smoothedPath(shifts: Shift[], fps: number): { raw: { x: number; y: number }[]; avg: { x: number; y: number }[] } {
  const n = shifts.length;
  const raw: { x: number; y: number }[] = [];
  let ax = 0, ay = 0;
  for (const s of shifts) { ax += s.dx; ay += s.dy; raw.push({ x: ax, y: ay }); }
  const half = Math.max(1, Math.round(fps * 0.5 / 2));
  const avg = raw.map((_, i) => {
    const hw = Math.min(half, i, n - 1 - i);
    let mx = 0, my = 0;
    for (let j = i - hw; j <= i + hw; j++) { mx += raw[j].x; my += raw[j].y; }
    return { x: mx / (2 * hw + 1), y: my / (2 * hw + 1) };
  });
  return { raw, avg };
}

/** Smooth pan/tilt speed: mean |velocity| of the moving-average path, in % of frame width per second. */
export function cameraMotion(shifts: Shift[], fps: number, frameWidth: number): number {
  if (shifts.length < 2) return 0;
  const { avg } = smoothedPath(shifts, fps);
  let sum = 0;
  for (let i = 1; i < avg.length; i++) sum += Math.hypot(avg[i].x - avg[i - 1].x, avg[i].y - avg[i - 1].y);
  return ((sum / (avg.length - 1)) * fps / frameWidth) * 100;
}

/**
 * Mean absolute luma difference (0-1) between consecutive frames after compensating the global shift
 * (`shifts[i]` aligns frame i to frame i+1), over the overlap of both. People, waves, action.
 */
export function frameChange(frames: Uint8Array[], w: number, h: number, shifts: Shift[]): number {
  let total = 0, count = 0;
  for (let i = 0; i + 1 < frames.length; i++) {
    const { dx, dy } = shifts[i] ?? { dx: 0, dy: 0 };
    const prev = frames[i], cur = frames[i + 1];
    const x0 = Math.max(0, -dx), x1 = Math.min(w, w - dx);
    const y0 = Math.max(0, -dy), y1 = Math.min(h, h - dy);
    let s = 0;
    for (let y = y0; y < y1; y++) {
      const pr = y * w, cr = (y + dy) * w + dx;
      for (let x = x0; x < x1; x++) s += Math.abs(prev[pr + x] - cur[cr + x]);
    }
    const n = Math.max(0, (x1 - x0) * (y1 - y0));
    if (n > 0) { total += s / n / 255; count++; }
  }
  return count === 0 ? 0 : total / count;
}

export type JitterBand = 'locked' | 'stabilize' | 'shaky';

export interface JitterBandConfig { jitter_locked_max: number; jitter_shaky_min: number }

export function jitterBand(score: number, cfg: JitterBandConfig): JitterBand {
  if (score < cfg.jitter_locked_max) return 'locked';
  if (score >= cfg.jitter_shaky_min) return 'shaky';
  return 'stabilize';
}

export interface MotionMeasure { score: number; maxPx: number; camera: number; change: number }

/** All four measures from one decoded range. */
export function measureFrames(set: { w: number; h: number; frames: Uint8Array[] }, fps: number): MotionMeasure {
  const { w, h, frames } = set;
  const shifts: Shift[] = [];
  for (let i = 1; i < frames.length; i++) shifts.push(globalShift(frames[i - 1], frames[i], w, h));
  const { score, maxPx } = jitterScore(shifts, fps, w);
  return { score, maxPx, camera: cameraMotion(shifts, fps, w), change: frameChange(frames, w, h, shifts) };
}
