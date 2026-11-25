import { jitterScore, cameraMotion, pairChange, smoothedPath, type Shift } from './motion.js';

/**
 * Per-clip motion curve and shake detection (W1). Port of the wackler-eval prototype (measure3 / detect / evaluate):
 * per frame pair the centre shift (coarse half-res +-8 -> full-res +-1 refine = +-16 px), the shifts of 8 border
 * patches + their texture, and the frame change; shakes are found on the centre residual and judged against the
 * border patches (a subject moving in the frame makes the patches disagree; the camera moves them all alike).
 */

export const PATCH_COUNT = 8;
export const TEXTURE_MIN = 4;

type Rect = [number, number, number, number]; // fx0, fx1, fy0, fy1 (fractions of the frame)
const CENTRE: Rect = [0.2, 0.8, 0.2, 0.8];
const XS: [number, number][] = [[0.06, 0.26], [0.4, 0.6], [0.74, 0.94]];
/** 3 top, 3 bottom, left-middle, right-middle. */
const PATCHES: Rect[] = [
  ...XS.map(([a, b]) => [a, b, 0.1, 0.33] as Rect),
  ...XS.map(([a, b]) => [a, b, 0.67, 0.9] as Rect),
  [0.06, 0.26, 0.385, 0.615], [0.74, 0.94, 0.385, 0.615],
];

/** Patch centres (fraction of the frame), same order as PATCHES; the camera-model fit uses them. */
export const PATCH_CENTRES: [number, number][] = [
  [0.16, 0.215], [0.5, 0.215], [0.84, 0.215], [0.16, 0.785], [0.5, 0.785], [0.84, 0.785], [0.16, 0.5], [0.84, 0.5],
];
export const DEFAULT_ASPECT = 9 / 16;

// ---------- measuring one frame pair ----------

function sad(p: Uint8Array, c: Uint8Array, w: number, h: number, dx: number, dy: number, step: number, r: Rect, limit: number): number {
  const x0 = Math.floor(w * r[0]), x1 = Math.ceil(w * r[1]), y0 = Math.floor(h * r[2]), y1 = Math.ceil(h * r[3]);
  let s = 0;
  for (let y = y0; y < y1; y += step) {
    const pr = y * w, cr = (y + dy) * w + dx;
    for (let x = x0; x < x1; x += step) s += Math.abs(p[pr + x] - c[cr + x]);
    if (s >= limit) return s; // cannot beat the best so far (only strictly smaller wins)
  }
  return s;
}

const inside = (w: number, h: number, r: Rect, dx: number, dy: number): boolean =>
  Math.floor(h * r[2]) + dy >= 0 && Math.ceil(h * r[3]) + dy <= h && Math.floor(w * r[0]) + dx >= 0 && Math.ceil(w * r[1]) + dx <= w;

/** Half-resolution copy (2x2 mean) for the coarse search. */
export function downsample2(f: Uint8Array, w: number, h: number): Uint8Array {
  const w2 = w >> 1, h2 = h >> 1, o = new Uint8Array(w2 * h2);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      const i = 2 * y * w + 2 * x;
      o[y * w2 + x] = (f[i] + f[i + 1] + f[i + w] + f[i + w + 1]) >> 2;
    }
  }
  return o;
}

function regionShift(prev: Uint8Array, cur: Uint8Array, pS: Uint8Array, cS: Uint8Array, w: number, h: number, r: Rect): [number, number] {
  const w2 = w >> 1, h2 = h >> 1, R = 8;
  let best: [number, number] = [0, 0];
  let bs = sad(pS, cS, w2, h2, 0, 0, 1, r, Infinity);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      if ((!dx && !dy) || !inside(w2, h2, r, dx, dy)) continue;
      const s = sad(pS, cS, w2, h2, dx, dy, 1, r, bs);
      if (s < bs) { bs = s; best = [dx, dy]; }
    }
  }
  let fb: [number, number] = [best[0] * 2, best[1] * 2];
  let fs = Infinity;
  const c = [fb[0], fb[1]];
  for (let dy = c[1] - 1; dy <= c[1] + 1; dy++) {
    for (let dx = c[0] - 1; dx <= c[0] + 1; dx++) {
      if (!inside(w, h, r, dx, dy)) continue;
      const s = sad(prev, cur, w, h, dx, dy, 2, r, fs);
      if (s < fs) { fs = s; fb = [dx, dy]; }
    }
  }
  return fb;
}

/** Mean |horizontal| + |vertical| gradient in the region. Low = sky / flat water: the shift is unreliable there. */
function texture(f: Uint8Array, w: number, h: number, r: Rect): number {
  const x0 = Math.floor(w * r[0]), x1 = Math.ceil(w * r[1]) - 1, y0 = Math.floor(h * r[2]), y1 = Math.ceil(h * r[3]) - 1;
  let s = 0, n = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = y * w + x;
      s += Math.abs(f[i + 1] - f[i]) + Math.abs(f[i + w] - f[i]);
      n++;
    }
  }
  return n === 0 ? 0 : Math.round((s / n) * 10) / 10;
}

export interface PairMeasure {
  dx: number;
  dy: number;
  patches: [number, number][];
  texture: number[];
  /** Mean abs luma difference (0-1) after compensating the centre shift. */
  change: number;
}

/** Shifts (cur(x + dx, y + dy) ~ prev(x, y), integer px) of the centre and the 8 border patches between two frames. */
export function measurePair(prev: Uint8Array, cur: Uint8Array, prevS: Uint8Array, curS: Uint8Array, w: number, h: number): PairMeasure {
  const [dx, dy] = regionShift(prev, cur, prevS, curS, w, h, CENTRE);
  return {
    dx, dy,
    patches: PATCHES.map((r) => regionShift(prev, cur, prevS, curS, w, h, r)),
    texture: PATCHES.map((r) => texture(prev, w, h, r)),
    change: pairChange(prev, cur, w, h, dx, dy) ?? 0,
  };
}

// ---------- the curve ----------

/** Everything measured for one clip; entry i belongs to the pair frame i -> i+1. Patch arrays are i * 8 + patch. */
export interface RawCurve {
  fps: number;
  /** Width of the decoded frames (px) and of the source video (px). */
  width: number;
  srcWidth: number;
  /** Frame height / width (default 9/16); scales y in the camera-model fit. */
  aspect?: number;
  dx: Int8Array;
  dy: Int8Array;
  change: Float32Array;
  patchDx: Int8Array;
  patchDy: Int8Array;
  texture: Float32Array;
}

/** What is stored per clip (no patches: they are only needed while detecting). */
export type MotionCurve = Pick<RawCurve, 'fps' | 'width' | 'srcWidth' | 'dx' | 'dy' | 'change'>;

/** Measure a whole clip from a stream of gray frames (one pair at a time, nothing but the curve stays in memory). */
export async function measureCurve(
  frames: AsyncIterable<Uint8Array>,
  dims: { w: number; h: number; fps: number; srcWidth: number },
): Promise<RawCurve> {
  const { w, h } = dims;
  const dx: number[] = [], dy: number[] = [], change: number[] = [], pdx: number[] = [], pdy: number[] = [], tex: number[] = [];
  let prev: Uint8Array | null = null, prevS: Uint8Array | null = null;
  for await (const f of frames) {
    const fS = downsample2(f, w, h);
    if (prev && prevS) {
      const m = measurePair(prev, f, prevS, fS, w, h);
      dx.push(m.dx); dy.push(m.dy); change.push(m.change);
      for (let j = 0; j < PATCH_COUNT; j++) { pdx.push(m.patches[j][0]); pdy.push(m.patches[j][1]); tex.push(m.texture[j]); }
    }
    prev = f; prevS = fS;
  }
  return {
    fps: dims.fps, width: w, srcWidth: dims.srcWidth, aspect: h / w,
    dx: Int8Array.from(dx), dy: Int8Array.from(dy), change: Float32Array.from(change),
    patchDx: Int8Array.from(pdx), patchDy: Int8Array.from(pdy), texture: Float32Array.from(tex),
  };
}

/** The decoded frame count (+- 1) must match what the container says, else the clip failed (dropped frames). */
export function checkFrameCount(decoded: number, packets: number | null): void {
  if (packets && Math.abs(decoded - packets) > 1) {
    throw new Error(`frame count mismatch: decoded ${decoded}, file has ${packets}`);
  }
}

// ---------- shake residual ----------

/** Centred moving average with a window that shrinks symmetrically at the ends. */
function mavg(xs: ArrayLike<number>, half: number): number[] {
  const n = xs.length;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + xs[i];
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const hw = Math.min(half, i, n - 1 - i);
    out[i] = (pre[i + hw + 1] - pre[i - hw]) / (2 * hw + 1);
  }
  return out;
}

/** Residual vector per frame: velocity smoothed ~0.08 s minus velocity averaged 0.5 s, in % of width per second. */
function residualXY(vx: ArrayLike<number>, vy: ArrayLike<number>, fps: number): [number[], number[]] {
  const sh = Math.max(1, Math.round(fps * 0.04)), lh = Math.max(1, Math.round(fps * 0.25));
  const sx = mavg(vx, sh), sy = mavg(vy, sh), lx = mavg(vx, lh), ly = mavg(vy, lh);
  return [sx.map((a, i) => a - lx[i]), sy.map((a, i) => a - ly[i])];
}

const velocity = (d: ArrayLike<number>, fps: number, w: number, stride = 1, off = 0): number[] => {
  const k = (100 * fps) / w, n = d.length / stride;
  return Array.from({ length: n }, (_, i) => d[i * stride + off] * k);
};

/** Shake speed per frame: |short-smoothed velocity - 0.5 s camera velocity| in % of frame width per second. */
export function shakeResidual(shifts: Shift[], fps: number, w: number): number[] {
  const k = (100 * fps) / w;
  const [rx, ry] = residualXY(shifts.map((s) => s.dx * k), shifts.map((s) => s.dy * k), fps);
  return rx.map((x, i) => Math.hypot(x, ry[i]));
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---------- detection ----------

export type Confidence = 'high' | 'low';

export interface Shake {
  start_sec: number;
  end_sec: number;
  peak_sec: number;
  /** Peak residual, % of frame width per second. */
  peak: number;
  /** [D-1] largest distance of the camera path from its 0.5 s moving average inside the shake. */
  jump_pct: number;
  jump_px: number;
  /** Patch disagreement: median distance of the patch residuals from the fitted camera model (shift + zoom + rotation) / model magnitude. */
  disagreement: number;
  moving_scene: boolean;
  confidence: Confidence;
}

export const SHAKE_FLOOR = 12;
export const SHAKE_K = 3;
export const MAX_SHAKE_SEC = 2;
export const MERGE_GAP_SEC = 0.25;
export const CONTINUOUS_RESIDUAL = 8;
export const MOVING_SCENE_RESIDUAL = 4;
export const STRONG_PEAK = 60;
export const MAX_DISAGREEMENT = 0.4;
export const LOW_DISAGREEMENT = 0.3;

export const shakeThreshold = (medianResidual: number): number => Math.max(SHAKE_K * medianResidual, SHAKE_FLOOR);

export interface Detection {
  medianResidual: number;
  continuous: boolean;
  shakes: Shake[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function detectShakes(c: RawCurve): Detection {
  const n = c.dx.length, { fps, width } = c;
  const shifts: Shift[] = Array.from({ length: n }, (_, i) => ({ dx: c.dx[i], dy: c.dy[i] }));
  const r = shakeResidual(shifts, fps, width);
  const base = median(r);
  if (base > CONTINUOUS_RESIDUAL) return { medianResidual: base, continuous: true, shakes: [] };
  const hi = shakeThreshold(base), lo = hi / 2;

  const segs: [number, number][] = [];
  for (let i = 0; i < n;) {
    if (r[i] > hi) {
      let s = i; while (s > 0 && r[s - 1] > lo) s--;
      let e = i; while (e < n - 1 && r[e + 1] > lo) e++;
      segs.push([s, e]); i = e + 1;
    } else i++;
  }
  const merged: [number, number][] = [];
  for (const [s, e] of segs) {
    const last = merged[merged.length - 1];
    if (last && (s - last[1]) / fps < MERGE_GAP_SEC) last[1] = e; else merged.push([s, e]);
  }
  if (merged.length === 0) return { medianResidual: base, continuous: false, shakes: [] };

  const patch = patchDisagreement(c);
  const path = smoothedPath(shifts, fps);
  const movingScene = base >= MOVING_SCENE_RESIDUAL;
  const shakes: Shake[] = [];
  for (const [s, e] of merged) {
    const t0 = (s + 0.5) / fps, t1 = (e + 1.5) / fps;
    if (t1 - t0 > MAX_SHAKE_SEC) continue;
    let k = s;
    for (let i = s; i <= e; i++) if (r[i] > r[k]) k = i;
    const peak = r[k];
    const disagreement = patch(s, e);
    if (disagreement >= MAX_DISAGREEMENT && peak < STRONG_PEAK) continue;
    let jump = 0;
    for (let i = s; i <= e; i++) jump = Math.max(jump, Math.hypot(path.raw[i].x - path.avg[i].x, path.raw[i].y - path.avg[i].y));
    const jump_pct = (jump / width) * 100;
    const low = peak < STRONG_PEAK && (movingScene || disagreement >= LOW_DISAGREEMENT);
    shakes.push({
      start_sec: round2(t0), end_sec: round2(t1), peak_sec: round2((k + 1) / fps), peak: round2(peak),
      jump_pct: round2(jump_pct), jump_px: round2((jump_pct * c.srcWidth) / 100),
      disagreement: round2(disagreement), moving_scene: movingScene, confidence: low ? 'low' : 'high',
    });
  }
  return { medianResidual: base, continuous: false, shakes };
}

/**
 * Fit v = (tx - r*y + s*x, ty + r*x + s*y) (shift, zoom, rotation; x, y centred, y scaled by the aspect) to the
 * given patches by least squares (4x4 normal equations, Gaussian elimination). Returns the parameters, or null when
 * the system is singular.
 */
export function fitSimilarity(pts: { x: number; y: number; vx: number; vy: number }[]): [number, number, number, number] | null {
  const M = [0, 0, 0, 0].map(() => [0, 0, 0, 0, 0]); // augmented normal matrix
  const add = (row: number[], b: number): void => {
    for (let a = 0; a < 4; a++) { for (let c = 0; c < 4; c++) M[a][c] += row[a] * row[c]; M[a][4] += row[a] * b; }
  };
  for (const p of pts) {
    add([1, 0, p.x, -p.y], p.vx);
    add([0, 1, p.y, p.x], p.vy);
  }
  for (let col = 0; col < 4; col++) {
    let piv = col;
    for (let r = col + 1; r < 4; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c < 5; c++) M[r][c] -= f * M[col][c];
    }
  }
  return [M[0][4] / M[0][0], M[1][4] / M[1][1], M[2][4] / M[2][2], M[3][4] / M[3][3]];
}

/**
 * Patch disagreement over frames s..e [W2]: per frame a similarity camera model (shift + zoom + rotation) is fitted
 * to the shake residual vectors of the textured patches (>= 4, else all 8); result = sum of the median distances of
 * the patch residuals from the model / sum of the mean model magnitude over the patches. A zoom or rotation moves the
 * patches apart but is still the camera; a subject moving only some of them is not.
 */
function patchDisagreement(c: RawCurve): (s: number, e: number) => number {
  const n = c.dx.length, { fps, width } = c;
  const aspect = c.aspect ?? DEFAULT_ASPECT;
  const pos = PATCH_CENTRES.map(([fx, fy]) => ({ x: fx - 0.5, y: (fy - 0.5) * aspect }));
  const pr = Array.from({ length: PATCH_COUNT }, (_, j) =>
    residualXY(velocity(c.patchDx, fps, width, PATCH_COUNT, j), velocity(c.patchDy, fps, width, PATCH_COUNT, j), fps));
  return (s, e) => {
    let num = 0, den = 0;
    for (let i = s; i <= e; i++) {
      const all = Array.from({ length: PATCH_COUNT }, (_, j) => j);
      let idx = all.filter((j) => c.texture[i * PATCH_COUNT + j] >= TEXTURE_MIN);
      if (idx.length < 4) idx = all;
      const pts = idx.map((j) => ({ ...pos[j], vx: pr[j][0][i], vy: pr[j][1][i] }));
      const p = fitSimilarity(pts);
      if (!p) { num += median(pts.map((q) => Math.hypot(q.vx, q.vy))); den += 1e-9; continue; }
      const pred = pts.map((q) => [p[0] + p[2] * q.x - p[3] * q.y, p[1] + p[2] * q.y + p[3] * q.x]);
      num += median(pts.map((q, k) => Math.hypot(q.vx - pred[k][0], q.vy - pred[k][1])));
      den += pred.reduce((a, v) => a + Math.hypot(v[0], v[1]), 0) / pred.length;
    }
    return num / Math.max(1e-9, den);
  };
}

// ---------- reads ----------

export interface MomentMotionValues {
  jitter: { score: number; maxPx: number };
  camera: number;
  change: number;
}

/**
 * Jitter, camera motion and frame change of any range [start, end] (clip seconds) from the stored curve, no decode.
 * Frames round(start * fps) .. round(end * fps) - 1 are the range, so n frames give n - 1 pairs, as S1 decoded it.
 */
export function momentMotion(c: MotionCurve, start: number, end: number): MomentMotionValues {
  const n = c.dx.length;
  const a = Math.max(0, Math.round(start * c.fps));
  const b = Math.min(n, Math.round(end * c.fps) - 1);
  if (b - a < 1) return { jitter: { score: 0, maxPx: 0 }, camera: 0, change: 0 };
  const shifts: Shift[] = [];
  let ch = 0;
  for (let i = a; i < b; i++) { shifts.push({ dx: c.dx[i], dy: c.dy[i] }); ch += c.change[i]; }
  const j = jitterScore(shifts, c.fps, c.width);
  return { jitter: { score: j.score, maxPx: j.maxPx }, camera: cameraMotion(shifts, c.fps, c.width), change: ch / shifts.length };
}

/** A shake as the read commands and the board show it (clip time). */
export interface ShakeView {
  start: number;
  end: number;
  peak_at: number;
  strength: number;
  jump_pct: number;
  jump_px: number;
  confidence: Confidence;
  moving_scene: boolean;
}

/**
 * The shakes overlapping a moment's range. [D-2] a border-case shake (peak < 1.5 x the clip threshold) in a moment that
 * plays slowed down (speed < 1) is shown with low confidence.
 */
export function shakesForMoment(
  shakes: Pick<Shake, 'start_sec' | 'end_sec' | 'peak_sec' | 'peak' | 'jump_pct' | 'jump_px' | 'confidence' | 'moving_scene'>[],
  medianResidual: number,
  start: number,
  end: number,
  speed: number,
): ShakeView[] {
  const thr = shakeThreshold(medianResidual);
  return shakes.filter((k) => k.start_sec < end && k.end_sec > start).map((k) => ({
    start: k.start_sec, end: k.end_sec, peak_at: k.peak_sec, strength: k.peak, jump_pct: k.jump_pct, jump_px: k.jump_px,
    confidence: k.confidence === 'low' || (speed < 1 && k.peak < 1.5 * thr) ? 'low' : 'high',
    moving_scene: k.moving_scene,
  }));
}
