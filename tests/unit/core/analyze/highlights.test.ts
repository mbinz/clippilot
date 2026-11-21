import { describe, it, expect } from 'vitest';
import { normalizeHighlights, suggestedSpeed } from '../../../../src/core/analyze/highlights.js';

const h = (start_sec: number, end_sec: number, tier: 'hero' | 'solid' | 'filler' = 'solid') => ({
  start_sec,
  end_sec,
  description: 'd',
  tier,
  shot: 'medium' as const,
  role: 'action' as const,
  issues: [] as ('shake' | 'blur')[],
});

describe('normalizeHighlights', () => {
  it('clamps end past the clip duration', () => {
    const out = normalizeHighlights([h(1, 9)], 4.3);
    expect(out).toHaveLength(1);
    expect(out[0].start_sec).toBe(1);
    expect(out[0].end_sec).toBe(4.3);
  });

  it('clamps negative start to 0', () => {
    const out = normalizeHighlights([h(-2, 5)], 13.0);
    expect(out[0].start_sec).toBe(0);
    expect(out[0].end_sec).toBe(5);
  });

  it('drops zero-length and too-short entries', () => {
    const out = normalizeHighlights([h(4, 4), h(5, 5.3), h(12.8, 20), h(1, 2)], 13.0);
    expect(out.map((x) => [x.start_sec, x.end_sec])).toEqual([[0, 3]]);
  });

  it('drops entries entirely beyond the duration', () => {
    expect(normalizeHighlights([h(14, 18)], 13.0)).toEqual([]);
  });

  it('sorts by start_sec', () => {
    const out = normalizeHighlights([h(8, 11, 'hero'), h(1, 4, 'filler'), h(4.5, 7.5, 'solid')], 13.0);
    expect(out.map((x) => x.start_sec)).toEqual([1, 4.5, 8]);
  });

  it('rounds to 0.01 s', () => {
    const out = normalizeHighlights([h(1.234, 4.456)], 13.0);
    expect(out[0].start_sec).toBe(1.23);
    expect(out[0].end_sec).toBe(4.46);
  });
});

describe('normalizeHighlights minimum length', () => {
  const table: [number, [number, number], [number, number] | null][] = [
    [13, [1, 2], [0, 3]],
    [13, [5, 6], [4, 7]],
    [13, [12, 12.9], [10, 13]],
    [13, [4, 8], [4, 8]],
    [2.4, [0.5, 1.5], [0, 2.4]],
    [13, [5, 5.3], null],
  ];
  for (const [duration, [s, e], want] of table) {
    it(`duration ${duration}: [${s}, ${e}] -> ${want ? `[${want}]` : 'dropped'}`, () => {
      const out = normalizeHighlights([h(s, e)], duration).map((x) => [x.start_sec, x.end_sec]);
      expect(out).toEqual(want ? [want] : []);
    });
  }
});

describe('suggestedSpeed', () => {
  const table: [any, number | null, number][] = [
    ['none', 25, 1], ['none', 50, 1], ['none', 100, 1],
    ['light', 25, 1], ['light', 47.9, 1], ['light', 50, 0.5], ['light', 100, 0.5],
    ['strong', 25, 1], ['strong', 50, 0.5], ['strong', 60, 0.5], ['strong', 89.9, 0.5], ['strong', 90, 0.25], ['strong', 100, 0.25],
    ['strong', null, 1],
  ];
  for (const [slowmo, fps, want] of table) {
    it(`${slowmo} @ ${fps} fps -> ${want}`, () => {
      expect(suggestedSpeed(slowmo, fps)).toBe(want);
    });
  }
});

describe('normalizeHighlights speed', () => {
  it('adds suggested_speed from slowmo and fps', () => {
    const out = normalizeHighlights([{ ...h(1, 3), slowmo: 'strong' as const, slowmo_reason: 'splash' }], 13, 100);
    expect(out[0].suggested_speed).toBe(0.25);
    expect(out[0].slowmo).toBe('strong');
    expect(out[0].slowmo_reason).toBe('splash');
  });

  it('talking (slowmo none) stays 1 even at 100 fps', () => {
    const out = normalizeHighlights([{ ...h(1, 3), slowmo: 'none' as const, slowmo_reason: '' }], 13, 100);
    expect(out[0].suggested_speed).toBe(1);
  });

  it('defaults to speed 1 without fps or slowmo', () => {
    expect(normalizeHighlights([h(1, 3)], 13)[0].suggested_speed).toBe(1);
  });
});

describe('normalizeHighlights tags', () => {
  it('carries tier, shot, role and issues through', () => {
    const out = normalizeHighlights([{ ...h(1, 3, 'hero'), shot: 'close' as const, role: 'reaction' as const, issues: ['shake', 'blur'] }], 13);
    expect(out[0]).toMatchObject({ tier: 'hero', shot: 'close', role: 'reaction', issues: ['shake', 'blur'] });
    expect((out[0] as Record<string, unknown>).quality).toBeUndefined();
  });
});
