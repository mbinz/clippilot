import { describe, it, expect } from 'vitest';
import { stripTimes } from '../../../../src/core/critic/strips.js';

const ts = (...a: Parameters<typeof stripTimes>) => stripTimes(...a).map((f) => f.t);

describe('stripTimes', () => {
  it('takes a frame every 0.5 s plus the exact last frame (end minus one frame)', () => {
    expect(ts(0, 2, 25)).toEqual([0, 0.5, 1, 1.5, 1.96]);
  });

  it('works on source times, not from zero', () => {
    expect(ts(10, 11.2, 25)).toEqual([10, 10.5, 11.16]);
  });

  it('drops a regular frame that is within a quarter second of the last one', () => {
    expect(ts(0, 2.1, 25)).toEqual([0, 0.5, 1, 1.5, 2.06]);
    expect(ts(0, 2.4, 25)).toEqual([0, 0.5, 1, 1.5, 2, 2.36]);
  });

  it('a very short range gives its first and last frame', () => {
    expect(ts(5, 5.2, 25)).toEqual([5, 5.16]);
  });

  it('a range shorter than a frame gives just the start', () => {
    expect(ts(5, 5.02, 25)).toEqual([5]);
  });

  it('caps at 12 frames: even samples including the first, and always the last', () => {
    const t = ts(0, 30, 25);
    expect(t).toHaveLength(12);
    expect(t[0]).toBe(0);
    expect(t[11]).toBe(29.96);
    expect(t.slice(1)).toEqual([...t.slice(1)].sort((a, b) => a - b));
    expect(new Set(t).size).toBe(12);
    const gaps = t.slice(1, 11).map((x, i) => x - t[i]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1.6);
  });

  it('labels with the time; the last one says so', () => {
    const f = stripTimes(0, 1, 25);
    expect(f.map((x) => x.label)).toEqual(['0.00s', '0.50s', '0.96s end']);
  });

  it('falls back to 25 fps without a frame rate', () => {
    expect(ts(0, 1, null)).toEqual([0, 0.5, 0.96]);
  });
});
