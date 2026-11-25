import { describe, it, expect } from 'vitest';
import {
  measurePair, downsample2, checkFrameCount, shakeResidual, detectShakes, momentMotion, shakesForMoment, PATCH_COUNT,
  type RawCurve,
} from '../../../../src/core/motion/curve.js';
import { jitterScore, cameraMotion, type Shift } from '../../../../src/core/motion/motion.js';

// ---------- synthetic frames: a textured field viewed through a moving window ----------
const W = 320, H = 180;
function field(): (x: number, y: number) => number {
  const cell = 1, cw = 640, ch = 400; // per-pixel noise (blocky cells would make step-2 sampling ambiguous)
  const vals = new Uint8Array(cw * ch);
  let s = 12345;
  for (let i = 0; i < vals.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; vals[i] = (s >> 16) & 255; }
  return (x, y) => vals[(Math.floor((y + 1000) / cell) % ch) * cw + (Math.floor((x + 1000) / cell) % cw)];
}
function frame(f: (x: number, y: number) => number, ox: number, oy: number): Uint8Array {
  const a = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = f(x + ox, y + oy);
  return a;
}

describe('measurePair', () => {
  const f = field();
  it('finds a shift up to 16 px with the centre window and all 8 border patches (S1 sign convention)', () => {
    // cur(x + dx, y + dy) = prev(x, y): the window moved by (-dx, -dy)
    const prev = frame(f, 0, 0), cur = frame(f, -12, 8);
    const m = measurePair(prev, cur, downsample2(prev, W, H), downsample2(cur, W, H), W, H);
    expect([m.dx, m.dy]).toEqual([12, -8]);
    expect(m.patches).toHaveLength(PATCH_COUNT);
    for (const p of m.patches) expect(p).toEqual([12, -8]);
    for (const t of m.texture) expect(t).toBeGreaterThan(4);
  });
  it('finds small odd shifts too', () => {
    const prev = frame(f, 0, 0), cur = frame(f, -3, 1);
    const m = measurePair(prev, cur, downsample2(prev, W, H), downsample2(cur, W, H), W, H);
    expect([m.dx, m.dy]).toEqual([3, -1]);
  });
  it('identical frames: zero shift, zero change; flat frames: texture 0', () => {
    const a = frame(f, 3, 3);
    const m = measurePair(a, a, downsample2(a, W, H), downsample2(a, W, H), W, H);
    expect([m.dx, m.dy]).toEqual([0, 0]);
    expect(m.change).toBe(0);
    const flat = new Uint8Array(W * H).fill(90);
    const mf = measurePair(flat, flat, downsample2(flat, W, H), downsample2(flat, W, H), W, H);
    expect(mf.texture.every((t) => t === 0)).toBe(true);
  });
  it('change is measured after compensating the centre shift', () => {
    const prev = frame(f, 0, 0), cur = frame(f, -5, 2);
    const m = measurePair(prev, cur, downsample2(prev, W, H), downsample2(cur, W, H), W, H);
    expect(m.change).toBeLessThan(0.001);
  });
});

// ---------- synthetic curves ----------
const FPS = 25;
interface Opts { n?: number; fps?: number; patch?: (j: number, i: number) => [number, number]; texture?: number }
/** RawCurve from per-pair centre shifts; border patches follow the centre unless `patch` says otherwise. */
function raw(shifts: Shift[], o: Opts = {}): RawCurve {
  const n = shifts.length;
  const dx = new Int8Array(n), dy = new Int8Array(n);
  const pdx = new Int8Array(n * PATCH_COUNT), pdy = new Int8Array(n * PATCH_COUNT);
  const tex = new Float32Array(n * PATCH_COUNT).fill(o.texture ?? 20);
  shifts.forEach((s, i) => {
    dx[i] = s.dx; dy[i] = s.dy;
    for (let j = 0; j < PATCH_COUNT; j++) {
      const [px, py] = o.patch ? o.patch(j, i) : [s.dx, s.dy];
      pdx[i * PATCH_COUNT + j] = px; pdy[i * PATCH_COUNT + j] = py;
    }
  });
  return { fps: o.fps ?? FPS, width: 320, srcWidth: 1920, dx, dy, change: new Float32Array(n), patchDx: pdx, patchDy: pdy, texture: tex };
}
const zeros = (n: number): Shift[] => Array.from({ length: n }, () => ({ dx: 0, dy: 0 }));
/** A jolt: `len` frames of +amp then `len` frames of -amp at frame `at` (the camera jumps and comes back). */
function jolt(s: Shift[], at: number, amp: number, len = 3): void {
  for (let k = 0; k < len; k++) { s[at + k] = { dx: amp, dy: 0 }; s[at + len + k] = { dx: -amp, dy: 0 }; }
}

describe('shakeResidual', () => {
  it('static camera: 0; constant pan: 0', () => {
    expect(Math.max(...shakeResidual(zeros(100), FPS, 320))).toBe(0);
    const pan = Array.from({ length: 100 }, () => ({ dx: 2, dy: 1 }));
    expect(Math.max(...shakeResidual(pan, FPS, 320))).toBeLessThan(1e-9);
  });
  it('a single jolt peaks at the jolt, in % of frame width per second', () => {
    const s = zeros(100);
    jolt(s, 50, 8);
    const r = shakeResidual(s, FPS, 320);
    const peak = Math.max(...r);
    expect(peak).toBeGreaterThan(50 * 0.8); // 8 px/frame = 62.5 %/s
    expect(r.indexOf(peak)).toBeGreaterThanOrEqual(49);
    expect(r.indexOf(peak)).toBeLessThanOrEqual(55);
    expect(r[10]).toBe(0);
  });
});

describe('detectShakes', () => {
  it('finds a jolt: window, peak, threshold floor 12 %/s, clean clip has median 0', () => {
    const s = zeros(200);
    jolt(s, 100, 6);
    const d = detectShakes(raw(s));
    expect(d.continuous).toBe(false);
    expect(d.medianResidual).toBe(0);
    expect(d.shakes).toHaveLength(1);
    const k = d.shakes[0];
    expect(k.start_sec).toBeGreaterThan(3.8);
    expect(k.end_sec).toBeLessThan(4.8);
    expect(k.peak_sec).toBeGreaterThanOrEqual(k.start_sec);
    expect(k.peak_sec).toBeLessThanOrEqual(k.end_sec);
    expect(k.peak).toBeGreaterThan(12);
  });
  it('a wobble below the floor is no shake', () => {
    const s = zeros(200);
    s[100] = { dx: 1, dy: 0 }; s[101] = { dx: -1, dy: 0 };
    expect(detectShakes(raw(s)).shakes).toHaveLength(0);
  });
  it('threshold scales with the clip: 3 x the median residual', () => {
    // continuous 2 px wobble every frame -> median ~ 10 %/s -> hi = 30; a small jolt (peak ~ 20) is below, a big one is not
    const base = (): Shift[] => Array.from({ length: 300 }, (_, i) => ({ dx: i % 2 ? 1 : -1, dy: 0 }));
    const d0 = detectShakes(raw(base()));
    expect(d0.medianResidual).toBeGreaterThan(1);
    expect(d0.medianResidual).toBeLessThanOrEqual(8);
    const big = base(); jolt(big, 150, 14, 3);
    const d1 = detectShakes(raw(big));
    expect(d1.shakes.length).toBeGreaterThan(0);
    for (const k of d1.shakes) expect(k.peak).toBeGreaterThan(Math.max(3 * d1.medianResidual, 12));
  });
  it('the segment grows while the residual stays above half the threshold', () => {
    const tight = zeros(200); tight[100] = { dx: 8, dy: 0 }; tight[101] = { dx: -8, dy: 0 };
    const wide = zeros(200); jolt(wide, 100, 6, 5);
    const a = detectShakes(raw(tight)).shakes[0];
    const b = detectShakes(raw(wide)).shakes[0];
    expect(b.end_sec - b.start_sec).toBeGreaterThan(a.end_sec - a.start_sec);
  });
  it('two jolts closer than 0.25 s merge, further apart stay separate', () => {
    const near = zeros(300); jolt(near, 100, 6); jolt(near, 109, 6);
    expect(detectShakes(raw(near)).shakes).toHaveLength(1);
    const far = zeros(300); jolt(far, 100, 6); jolt(far, 200, 6);
    expect(detectShakes(raw(far)).shakes).toHaveLength(2);
  });
  it('a stretch longer than 2 s is not a shake', () => {
    const s = zeros(300);
    for (let i = 100; i < 200; i += 2) { jolt(s, i, 6, 1); }
    expect(detectShakes(raw(s)).shakes).toHaveLength(0);
  });
  it('a continuously shaky clip (median residual > 8 %/s) gets no search', () => {
    const s = Array.from({ length: 300 }, (_, i) => ({ dx: i % 2 ? 6 : -6, dy: 0 }));
    jolt(s, 150, 14);
    const d = detectShakes(raw(s));
    expect(d.medianResidual).toBeGreaterThan(8);
    expect(d.continuous).toBe(true);
    expect(d.shakes).toEqual([]);
  });

  describe('subject-motion filter (patch disagreement)', () => {
    const joltClip = (amp = 6) => { const s = zeros(200); jolt(s, 100, amp); return s; };
    // patches disagree: every patch moves its own way (a subject, not the camera) in the window
    const chaos = (j: number, i: number): [number, number] =>
      i >= 95 && i <= 115 ? [((j * 7 + i) % 11) - 5, ((j * 3 + i) % 9) - 4] : [0, 0];
    it('agreeing patches: kept, disagreement ~ 0', () => {
      const k = detectShakes(raw(joltClip())).shakes[0];
      expect(k.disagreement).toBeLessThan(0.1);
    });
    it('disagreeing patches: dropped', () => {
      expect(detectShakes(raw(joltClip(), { patch: chaos })).shakes).toHaveLength(0);
    });
    it('a peak >= 60 %/s is kept although the patches disagree', () => {
      const s = joltClip(16);
      const k = detectShakes(raw(s, { patch: chaos })).shakes;
      expect(k).toHaveLength(1);
      expect(k[0].peak).toBeGreaterThanOrEqual(60);
      expect(k[0].confidence).toBe('high');
    });
    it('low-texture patches are ignored (at least 3 textured, else all patches count)', () => {
      // 5 textured patches agree, 3 flat ones are garbage -> still kept
      const garbage = (j: number, i: number): [number, number] => (j >= 5 && i >= 95 && i <= 115 ? [7, -6] : [0, 0]);
      const s = joltClip();
      const c = raw(s, { patch: (j, i) => (j >= 5 ? garbage(j, i) : [s[i].dx, s[i].dy]) });
      for (let i = 0; i < s.length; i++) for (let j = 5; j < PATCH_COUNT; j++) c.texture[i * PATCH_COUNT + j] = 1;
      expect(detectShakes(c).shakes).toHaveLength(1);
      // fewer than 3 textured: all patches vote, the garbage counts and the shake is dropped
      for (let i = 0; i < s.length; i++) for (let j = 2; j < 5; j++) c.texture[i * PATCH_COUNT + j] = 1;
      expect(detectShakes(c).shakes.length).toBeLessThanOrEqual(1);
    });
  });

  describe('jump distance [D-1]', () => {
    it('is the largest distance of the camera path from its 0.5 s moving average inside the shake', () => {
      const s = zeros(200);
      for (let k = 0; k < 3; k++) s[100 + k] = { dx: 6, dy: 0 }; // path jumps to +18 px and stays 3 frames...
      for (let k = 0; k < 3; k++) s[103 + k] = { dx: -6, dy: 0 }; // ...then back
      const k = detectShakes(raw(s)).shakes[0];
      expect(k.jump_pct).toBeGreaterThan((10 / 320) * 100);
      expect(k.jump_pct).toBeLessThanOrEqual((18 / 320) * 100 + 1e-9);
      expect(k.jump_px).toBeCloseTo((k.jump_pct * 1920) / 100, 0);
    });
  });

  describe('confidence [D-2]', () => {
    const jc = (amp: number) => { const s = zeros(300); jolt(s, 150, amp); return s; };
    it('clean clip, agreeing patches: high', () => {
      expect(detectShakes(raw(jc(6))).shakes[0]).toMatchObject({ confidence: 'high', moving_scene: false });
    });
    it('moving scene (median residual >= 4 %/s): low, unless the peak is >= 60', () => {
      const wob = (amp: number): Shift[] => {
        const s = Array.from({ length: 300 }, (_, i) => ({ dx: i % 2 ? 2 : -2, dy: 0 }));
        for (let k = 0; k < 3; k++) { s[150 + k] = { dx: amp, dy: 0 }; s[153 + k] = { dx: -amp, dy: 0 }; }
        return s;
      };
      const d = detectShakes(raw(wob(7)));
      expect(d.medianResidual).toBeGreaterThanOrEqual(4);
      expect(d.shakes[0]).toMatchObject({ moving_scene: true, confidence: 'low' });
      const strong = detectShakes(raw(wob(16))).shakes[0];
      expect(strong.peak).toBeGreaterThanOrEqual(60);
      expect(strong.confidence).toBe('high');
    });
    it('disagreement 0.3 - 0.5: low', () => {
      const s = jc(6);
      // half of the patches only follow half of the movement -> disagreement ~ 1/3
      const d = detectShakes(raw(s, { patch: (j, i) => (j >= 4 ? [s[i].dx / 2, s[i].dy] as [number, number] : [s[i].dx, s[i].dy]) }));
      expect(d.shakes).toHaveLength(1);
      expect(d.shakes[0].disagreement).toBeGreaterThanOrEqual(0.3);
      expect(d.shakes[0].disagreement).toBeLessThan(0.5);
      expect(d.shakes[0].confidence).toBe('low');
    });
  });
});

describe('shakesForMoment (reads: overlap + slow-motion rule of [D-2])', () => {
  const shakes = [
    { start_sec: 4, end_sec: 4.6, peak_sec: 4.3, peak: 30, jump_pct: 3, jump_px: 58, disagreement: 0.1, moving_scene: false, confidence: 'high' as const },
    { start_sec: 9, end_sec: 9.4, peak_sec: 9.2, peak: 90, jump_pct: 6, jump_px: 115, disagreement: 0.1, moving_scene: false, confidence: 'high' as const },
  ];
  const median = 0; // threshold 12
  it('returns only shakes overlapping the range, in the output shape', () => {
    expect(shakesForMoment(shakes, median, 2, 5, 1)).toEqual([
      { start: 4, end: 4.6, peak_at: 4.3, strength: 30, jump_pct: 3, jump_px: 58, confidence: 'high', moving_scene: false },
    ]);
    expect(shakesForMoment(shakes, median, 5, 8, 1)).toEqual([]);
  });
  it('a border-case shake (peak < 1.5 x threshold) in a slowed-down moment is low; a clear one stays high', () => {
    const border = [{ ...shakes[0], peak: 15 }];
    expect(shakesForMoment(border, median, 2, 5, 0.5)[0].confidence).toBe('low');
    expect(shakesForMoment(border, median, 2, 5, 1)[0].confidence).toBe('high');
    expect(shakesForMoment(shakes, median, 8, 10, 0.5)[0].confidence).toBe('high');
  });
});

describe('momentMotion (derived from the stored centre shifts, no decode)', () => {
  const shifts: Shift[] = Array.from({ length: 200 }, (_, i) => ({ dx: Math.round(3 * Math.sin(i * 1.7)), dy: Math.round(2 * Math.cos(i * 0.9)) }));
  const c = raw(shifts);
  c.change.set(Array.from({ length: 200 }, (_, i) => (i < 100 ? 0.01 : 0.05)));
  it('jitter score and max px equal S1 jitterScore on the same shifts; camera motion equals S1', () => {
    // range 2.0 .. 6.0 s = frames 50..150 -> pairs 50..148 (99 pairs, as a decode of that range gives 100 frames)
    const m = momentMotion(c, 2, 6);
    const slice = shifts.slice(50, 149);
    const want = jitterScore(slice, FPS, 320);
    expect(m.jitter.score).toBeCloseTo(want.score, 9);
    expect(m.jitter.maxPx).toBeCloseTo(want.maxPx, 9);
    expect(m.camera).toBeCloseTo(cameraMotion(slice, FPS, 320), 9);
  });
  it('frame change is the mean over the range; ranges outside the clip are clamped; empty range is 0', () => {
    expect(momentMotion(c, 0, 4).change).toBeCloseTo(0.01, 6);
    expect(momentMotion(c, 4, 8).change).toBeCloseTo(0.05, 3);
    expect(momentMotion(c, 7.9, 40).jitter.score).toBeGreaterThanOrEqual(0);
    expect(momentMotion(c, 50, 60)).toEqual({ jitter: { score: 0, maxPx: 0 }, camera: 0, change: 0 });
  });
});

describe('checkFrameCount', () => {
  it('accepts +-1 and unknown counts, throws on a mismatch', () => {
    expect(() => checkFrameCount(100, 100)).not.toThrow();
    expect(() => checkFrameCount(99, 100)).not.toThrow();
    expect(() => checkFrameCount(10, null)).not.toThrow();
    expect(() => checkFrameCount(90, 100)).toThrow(/frame count mismatch: decoded 90, file has 100/);
  });
});
