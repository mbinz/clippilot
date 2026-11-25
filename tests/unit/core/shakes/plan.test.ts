import { describe, it, expect } from 'vitest';
import { planShakeFix } from '../../../../src/core/shakes/plan.js';

const k = (start_sec: number, end_sec: number) => ({ start_sec, end_sec });
const range = { start: 2, end: 12 };

describe('planShakeFix (pure)', () => {
  it('no shake overlapping the range -> clean', () => {
    expect(planShakeFix(range, [], [])).toEqual({ kind: 'clean' });
    expect(planShakeFix(range, [k(0.5, 1.5), k(13, 14)], [])).toEqual({ kind: 'clean' });
  });

  it('a shake at the start -> trim to the part after it (shake bounds +- 1 frame)', () => {
    expect(planShakeFix(range, [k(1.5, 3), ], [], { fps: 25 })).toEqual({ kind: 'trim', parts: [{ start: 3.04, end: 12 }] });
  });

  it('a shake at the end -> trim to the part before it', () => {
    expect(planShakeFix(range, [k(10, 13)], [], { fps: 25 })).toEqual({ kind: 'trim', parts: [{ start: 2, end: 9.96 }] });
  });

  it('a shake in the middle -> split into two parts', () => {
    expect(planShakeFix(range, [k(6, 6.5)], [], { fps: 25 })).toEqual({
      kind: 'split', parts: [{ start: 2, end: 5.96 }, { start: 6.54, end: 12 }],
    });
  });

  it('two shakes -> three parts; parts under 1 s are dropped', () => {
    expect(planShakeFix(range, [k(4, 4.2), k(8, 8.2)], [], { fps: 25 })).toMatchObject({
      kind: 'split', parts: [{ start: 2, end: 3.96 }, { start: 4.24, end: 7.96 }, { start: 8.24, end: 12 }],
    });
    // the part between the shakes is only 0.5 s: dropped
    expect(planShakeFix(range, [k(4, 4.2), k(4.7, 5), k(8, 8.2)], [], { fps: 25 })).toEqual({
      kind: 'split', parts: [{ start: 2, end: 3.96 }, { start: 5.04, end: 7.96 }, { start: 8.24, end: 12 }],
    });
  });

  it('kiss-like case: 7.0-10.0 with a shake at 8.02-8.14 -> trim to 8.18-10.0 (1.82 s is enough)', () => {
    expect(planShakeFix({ start: 7, end: 10 }, [k(8.02, 8.14)], [], { fps: 25 })).toEqual({ kind: 'trim', parts: [{ start: 8.18, end: 10 }] });
  });

  it('only a part of 1 s or more counts, even a single short one; none -> kept (no clean range)', () => {
    expect(planShakeFix({ start: 2, end: 6 }, [k(3.5, 6)], [], { fps: 25 })).toEqual({ kind: 'trim', parts: [{ start: 2, end: 3.46 }] });
    expect(planShakeFix({ start: 2, end: 5 }, [k(2.2, 4.5)], [])).toEqual({ kind: 'kept', reason: 'no_clean_range' });
    // two 1.2 s parts = 2.4 s total is fine, two 0.9 s parts are dropped
    expect(planShakeFix({ start: 2, end: 6 }, [k(2.9, 5.1)], [], { fps: 25 })).toEqual({ kind: 'kept', reason: 'no_clean_range' });
  });

  it('parts of 1 s or more with a total of 2 s or more split, even when no single part has 2 s', () => {
    expect(planShakeFix({ start: 0, end: 5 }, [k(1.5, 3.5)], [], { fps: 25 })).toEqual({
      kind: 'split', parts: [{ start: 0, end: 1.46 }, { start: 3.54, end: 5 }],
    });
  });

  it('low and high confidence shakes both count (the planner only sees spans)', () => {
    const shakes = [{ ...k(6, 6.5), confidence: 'low' as const }, { ...k(9, 9.2), confidence: 'high' as const }];
    expect(planShakeFix(range, shakes, [], { fps: 25 }).kind).toBe('split');
  });

  it('a plan that newly cuts a sentence -> kept (speech)', () => {
    // the sentence 5.5-8 runs through the shake and the part boundaries 5.96 / 6.54 are inside it
    expect(planShakeFix(range, [k(6, 6.5)], [{ start: 5.5, end: 8 }], { fps: 25 })).toEqual({ kind: 'kept', reason: 'speech' });
  });

  it('a boundary that already cut the sentence does not block the fix; a sentence outside is fine', () => {
    // the original start 2 is inside the sentence 1-3 already; the new boundaries 6.54 / 5.96 are in silence
    expect(planShakeFix(range, [k(6, 6.5)], [{ start: 1, end: 3 }], { fps: 25 }).kind).toBe('split');
    // the dropped part 5-5.5 contained a whole sentence: dropping is not cutting it
    expect(planShakeFix(range, [k(4, 4.2), k(4.7, 5)], [{ start: 4.3, end: 4.6 }], { fps: 25 }).kind).toBe('split');
  });

  it('defaults to 25 fps', () => {
    expect(planShakeFix(range, [k(1.5, 3)], [])).toEqual({ kind: 'trim', parts: [{ start: 3.04, end: 12 }] });
  });
});
