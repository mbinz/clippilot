import { describe, it, expect } from 'vitest';
import { score, similarTo, LOOK_THRESHOLD, TIME_BOOST, TIME_BOOST_WINDOW_SEC, type LookMoment } from '../../../../src/core/look/similar.js';

/** Unit vector at `angle` radians in the first two dimensions: cosine between two = cos(angle difference). */
const vec = (angle: number): Float32Array => new Float32Array([Math.cos(angle), Math.sin(angle), 0]);
const lm = (id: number, angle: number | null, o: Partial<LookMoment> = {}): LookMoment => ({
  id, event_id: 1, rec_sec: 100_000 + id * 10_000, out: false, vec: angle === null ? null : vec(angle), ...o,
});
// angle giving a cosine of c
const ang = (c: number): number => Math.acos(c);

describe('score', () => {
  it('is the cosine plus a boost that fades over the time window', () => {
    const a = lm(1, 0, { rec_sec: 0 });
    const same = lm(2, 0, { rec_sec: 0 });
    expect(score(a, same)).toBeCloseTo(1 + TIME_BOOST, 5);
    const half = lm(3, 0, { rec_sec: TIME_BOOST_WINDOW_SEC / 2 });
    expect(score(a, half)).toBeCloseTo(1 + TIME_BOOST / 2, 5);
    const far = lm(4, 0, { rec_sec: TIME_BOOST_WINDOW_SEC * 3 });
    expect(score(a, far)).toBeCloseTo(1, 5);
  });
  it('without a boost it is the plain cosine', () => {
    expect(score(lm(1, 0), lm(2, ang(0.6)))).toBeCloseTo(0.6, 5);
  });
});

describe('similarTo', () => {
  const subject = lm(1, 0, { rec_sec: 0 });
  it('ranks nearest first and splits at the threshold', () => {
    const hi = LOOK_THRESHOLD + 0.1, lo = LOOK_THRESHOLD - 0.2;
    const ms = [subject, lm(2, ang(Math.min(hi, 0.95))), lm(3, ang(0.99)), lm(4, ang(lo)), lm(5, ang(lo - 0.05))];
    const r = similarTo(subject, ms);
    expect(r.similar).toEqual([3, 2]);
    expect(r.other).toEqual([4, 5]);
  });
  it('a near-identical take beats a closer-in-time different shot (no star/label influence)', () => {
    const ms = [subject, lm(2, ang(0.97), { rec_sec: 5000 }), lm(3, ang(0.9), { rec_sec: 10 })];
    expect(similarTo(subject, ms).similar).toEqual([2, 3]);
  });
  it('never crosses events', () => {
    const ms = [subject, lm(2, 0, { event_id: 2 }), lm(3, 0)];
    const r = similarTo(subject, ms);
    expect([...r.similar, ...r.other]).toEqual([3]);
  });
  it('excludes out (rejected / hidden) moments and itself', () => {
    const ms = [subject, lm(2, 0, { out: true }), lm(3, 0)];
    const r = similarTo(subject, ms);
    expect([...r.similar, ...r.other]).toEqual([3]);
  });
  it('a moment without a fingerprint has nothing similar; others without one are skipped', () => {
    const none = lm(1, null);
    expect(similarTo(none, [none, lm(2, 0)])).toEqual({ similar: [], other: [] });
    const r = similarTo(subject, [subject, lm(2, null), lm(3, 0)]);
    expect([...r.similar, ...r.other]).toEqual([3]);
  });
});
