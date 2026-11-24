import { describe, it, expect } from 'vitest';
import { globalShift, jitterScore, cameraMotion, frameChange, shakeBand, measureFrames } from '../../../../src/core/motion/motion.js';

function noise(w: number, h: number, seed = 1): Uint8Array {
  let s = seed;
  const a = new Uint8Array(w * h);
  for (let i = 0; i < a.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; a[i] = s >> 16 & 255; }
  return a;
}
/** cur(x,y) = prev(x - dx, y - dy): content moved by (dx, dy). */
function moved(prev: Uint8Array, w: number, h: number, dx: number, dy: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(w - 1, Math.max(0, x - dx)), sy = Math.min(h - 1, Math.max(0, y - dy));
    out[y * w + x] = prev[sy * w + sx];
  }
  return out;
}

describe('globalShift', () => {
  const w = 160, h = 90;
  it('recovers a known (3, -2) shift of a noise frame', () => {
    const a = noise(w, h);
    expect(globalShift(a, moved(a, w, h, 3, -2), w, h)).toEqual({ dx: 3, dy: -2 });
  });
  it('is (0,0) for identical frames and respects the radius', () => {
    const a = noise(w, h);
    expect(globalShift(a, a, w, h)).toEqual({ dx: 0, dy: 0 });
    expect(globalShift(a, moved(a, w, h, -8, 8), w, h)).toEqual({ dx: -8, dy: 8 });
  });
});

describe('jitterScore', () => {
  const fps = 25;
  it('is ~0 for a smooth constant pan', () => {
    const s = Array.from({ length: 100 }, () => ({ dx: 2, dy: 0 }));
    const r = jitterScore(s, fps, 320);
    expect(r.score).toBeLessThan(0.01);
    expect(r.maxPx).toBeLessThan(0.5);
  });
  it('is > 0 for alternating +-3 px, in percent of frame width', () => {
    const s = Array.from({ length: 100 }, (_, i) => ({ dx: i % 2 ? -3 : 3, dy: 0 }));
    const r = jitterScore(s, fps, 320);
    expect(r.score).toBeGreaterThan(0.3);
    expect(r.score).toBeLessThan(2);
    expect(r.maxPx).toBeGreaterThan(1);
    expect(jitterScore(s, fps, 640).score).toBeCloseTo(r.score / 2, 6);
  });
  it('handles empty / tiny input', () => {
    expect(jitterScore([], fps, 320)).toEqual({ score: 0, maxPx: 0 });
    expect(jitterScore([{ dx: 1, dy: 1 }], fps, 320).score).toBeGreaterThanOrEqual(0);
  });
});

describe('cameraMotion', () => {
  const fps = 25;
  it('is 0 for a static camera', () => {
    const s = Array.from({ length: 100 }, () => ({ dx: 0, dy: 0 }));
    expect(cameraMotion(s, fps, 320)).toBe(0);
  });
  it('equals the speed of a constant pan in % of width per second', () => {
    const s = Array.from({ length: 100 }, () => ({ dx: 2, dy: 0 }));
    expect(cameraMotion(s, fps, 320)).toBeCloseTo((2 * fps / 320) * 100, 4);
  });
  it('ignores high-frequency shake (moving average removes it)', () => {
    const s = Array.from({ length: 100 }, (_, i) => ({ dx: i % 2 ? -3 : 3, dy: 0 }));
    expect(cameraMotion(s, fps, 320)).toBeLessThan(5);
  });
  it('handles empty input', () => {
    expect(cameraMotion([], fps, 320)).toBe(0);
  });
});

describe('frameChange', () => {
  const w = 160, h = 90;
  it('is 0 for identical frames', () => {
    const a = noise(w, h);
    expect(frameChange([a, a, a], w, h, [{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }])).toBe(0);
  });
  it('is ~0 for a shifted copy once the global shift is compensated', () => {
    const a = noise(w, h);
    const b = moved(a, w, h, 3, -2);
    expect(frameChange([a, b], w, h, [{ dx: 3, dy: -2 }])).toBeLessThan(0.001);
  });
  it('is > 0 for changed content', () => {
    expect(frameChange([noise(w, h, 1), noise(w, h, 2)], w, h, [{ dx: 0, dy: 0 }])).toBeGreaterThan(0.1);
  });
  it('is 0 for fewer than two frames', () => {
    expect(frameChange([noise(w, h)], w, h, [])).toBe(0);
  });
});

describe('shakeBand', () => {
  const cfg = { shake_locked_max: 0.02, shake_shaky_min: 0.4 };
  it('locked below the lower bound, shaky from the upper bound, stabilize between', () => {
    expect(shakeBand(0, cfg)).toBe('locked');
    expect(shakeBand(0.0199, cfg)).toBe('locked');
    expect(shakeBand(0.02, cfg)).toBe('stabilize');
    expect(shakeBand(0.399, cfg)).toBe('stabilize');
    expect(shakeBand(0.4, cfg)).toBe('shaky');
    expect(shakeBand(3, cfg)).toBe('shaky');
  });
});

describe('measureFrames', () => {
  const w = 160, h = 90;
  it('a static scene measures zero everywhere', () => {
    const a = noise(w, h);
    const r = measureFrames({ w, h, frames: Array.from({ length: 30 }, () => a) }, 25);
    expect(r).toEqual({ score: 0, maxPx: 0, camera: 0, change: 0 });
  });
  it('a steady pan has camera motion but no jitter', () => {
    const base = noise(w + 120, h);
    const frames = Array.from({ length: 30 }, (_, i) => {
      const f = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = base[y * (w + 120) + x + 120 - 2 * i];
      return f;
    });
    const r = measureFrames({ w, h, frames }, 25);
    expect(r.score).toBeLessThan(0.05);
    expect(r.camera).toBeGreaterThan(20);
  });
  it('fewer than two frames measure zero', () => {
    expect(measureFrames({ w, h, frames: [noise(w, h)] }, 25)).toEqual({ score: 0, maxPx: 0, camera: 0, change: 0 });
  });
});
