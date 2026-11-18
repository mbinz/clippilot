import { describe, it, expect } from 'vitest';
import { normalizeHighlights } from '../../../../src/core/analyze/highlights.js';

const h = (start_sec: number, end_sec: number, quality = 5) => ({
  start_sec,
  end_sec,
  description: 'd',
  quality,
});

describe('normalizeHighlights', () => {
  it('clamps end past the clip duration', () => {
    const out = normalizeHighlights([h(3.5, 9)], 4.3);
    expect(out).toHaveLength(1);
    expect(out[0].start_sec).toBe(3.5);
    expect(out[0].end_sec).toBe(4.3);
  });

  it('clamps negative start to 0', () => {
    const out = normalizeHighlights([h(-2, 5)], 13.0);
    expect(out[0].start_sec).toBe(0);
    expect(out[0].end_sec).toBe(5);
  });

  it('drops zero-length and too-short entries', () => {
    const out = normalizeHighlights([h(4, 4), h(5, 5.3), h(12.8, 20), h(1, 2)], 13.0);
    expect(out.map((x) => [x.start_sec, x.end_sec])).toEqual([[1, 2]]);
  });

  it('drops entries entirely beyond the duration', () => {
    expect(normalizeHighlights([h(14, 18)], 13.0)).toEqual([]);
  });

  it('sorts by start_sec', () => {
    const out = normalizeHighlights([h(8, 10, 1), h(1, 3, 2), h(4, 6, 3)], 13.0);
    expect(out.map((x) => x.start_sec)).toEqual([1, 4, 8]);
  });

  it('rounds to 0.01 s', () => {
    const out = normalizeHighlights([h(1.234, 3.456)], 13.0);
    expect(out[0].start_sec).toBe(1.23);
    expect(out[0].end_sec).toBe(3.46);
  });
});
