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

describe('normalizeHighlights audio', () => {
  it('passes audio_keep and audio_type through, defaulting to false / noise', () => {
    const out = normalizeHighlights([{ ...h(1, 4), audio_keep: true, audio_type: 'ambient' as const }, h(6, 9)], 13);
    expect(out[0]).toMatchObject({ audio_keep: true, audio_type: 'ambient' });
    expect(out[1]).toMatchObject({ audio_keep: false, audio_type: 'noise' });
  });
});

describe('normalizeHighlights maximum length (MAX_MOMENT_SEC = 8)', () => {
  it('shortens a longer moment to 8 s centred', () => {
    const out = normalizeHighlights([h(2, 14)], 30);
    expect([out[0].start_sec, out[0].end_sec]).toEqual([4, 12]);
  });

  it('keeps exactly 8 s untouched', () => {
    const out = normalizeHighlights([h(2, 10)], 30);
    expect([out[0].start_sec, out[0].end_sec]).toEqual([2, 10]);
  });

  it('clamps to the clip first, then centres (end past duration)', () => {
    const out = normalizeHighlights([h(0, 40)], 20);
    expect([out[0].start_sec, out[0].end_sec]).toEqual([6, 14]);
    const tail = normalizeHighlights([h(10, 40)], 20);
    expect([tail[0].start_sec, tail[0].end_sec]).toEqual([11, 19]);
  });

  it('clamps negative start before centring', () => {
    const out = normalizeHighlights([h(-5, 12)], 30);
    expect([out[0].start_sec, out[0].end_sec]).toEqual([2, 10]);
  });
});

describe('normalizeHighlights overlap rule (shift later start to earlier end)', () => {
  it('shifts the later moment to start where the earlier one ends', () => {
    const out = normalizeHighlights([h(1, 6), h(4, 11)], 30);
    expect(out.map((x) => [x.start_sec, x.end_sec])).toEqual([[1, 6], [6, 11]]);
  });

  it('drops the later moment when less than 3 s remain', () => {
    const out = normalizeHighlights([h(1, 8), h(3, 10)], 30);
    expect(out.map((x) => [x.start_sec, x.end_sec])).toEqual([[1, 8]]);
  });

  it('drops a moment fully inside an earlier one', () => {
    const out = normalizeHighlights([h(0, 8), h(2, 5)], 30);
    expect(out.map((x) => [x.start_sec, x.end_sec])).toEqual([[0, 8]]);
  });

  it('keeps touching moments as they are', () => {
    const out = normalizeHighlights([h(0, 4), h(4, 8)], 30);
    expect(out.map((x) => [x.start_sec, x.end_sec])).toEqual([[0, 4], [4, 8]]);
  });

  it('applies the rule after widening and sorting, against the previous kept moment', () => {
    // 4-5 widens to 3-6; 5.9-6.2 widens to 4.55-7.55 -> shifted to 6-7.55 (1.55 s) -> dropped
    const out = normalizeHighlights([h(5.9, 6.2), h(0, 3), h(4, 5)], 30);
    expect(out.map((x) => [x.start_sec, x.end_sec])).toEqual([[0, 3], [3, 6]]);
  });
});

describe('normalizeHighlights missing description', () => {
  it('outputs "" when the description is missing', () => {
    const { description: _d, ...noDesc } = h(1, 5);
    const out = normalizeHighlights([noDesc as unknown as ReturnType<typeof h>], 30);
    expect(out[0].description).toBe('');
  });
});
