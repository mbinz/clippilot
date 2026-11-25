import { describe, it, expect } from 'vitest';
import { score, similarTo, lookGroups, LOOK_THRESHOLD, TIME_BOOST, TIME_BOOST_WINDOW_SEC, type LookMoment } from '../../../../src/core/look/similar.js';

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

describe('lookGroups (average linkage per event, SM-7)', () => {
  // all at the same recording time: boost is the same constant for every pair
  const same = (id: number, a: number | null, o: Partial<LookMoment> = {}) => lm(id, a, { rec_sec: 0, ...o });
  it('no chaining: A~B and B~C but A!~C keep A and C apart', () => {
    // cosines (plus boost 0.05): A-B 0.9, B-C 0.9, A-C ~0.62 -> avg-link merge B with its nearest, the other stays out
    const step = ang(0.85);
    const ms = [same(1, 0), same(2, step), same(3, 2 * step)];
    const g = lookGroups(ms);
    expect(g.get(1)).toBe(g.get(2));          // closest pair (ties by id) merges
    expect(g.get(3)).toBeNull();               // C: avg(A-C, B-C) < threshold -> alone
    expect(g.get(1)).not.toBeNull();
  });
  it('groups members above the line, singletons and fingerprintless moments are null, never across events or out', () => {
    const ms = [same(1, 0), same(2, ang(0.97)), same(3, 1.4), same(4, null), same(5, 0, { event_id: 2 }), same(6, 0, { out: true })];
    const g = lookGroups(ms);
    expect(g.get(1)).toBe(g.get(2));
    expect(g.get(1)).not.toBeNull();
    expect(g.get(3)).toBeNull();
    expect(g.get(4)).toBeNull();
    expect(g.get(5)).toBeNull();
    expect(g.get(6)).toBeNull();
  });
  it('group id is the smallest member id and the result does not depend on input order', () => {
    const ms = [same(7, 0), same(3, ang(0.97)), same(5, ang(0.96)), same(9, 2)];
    const a = lookGroups(ms), b = lookGroups([...ms].reverse());
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
    expect(a.get(7)).toBe(3);
    expect(a.get(5)).toBe(3);
    expect(a.get(9)).toBeNull();
  });
});

describe('similarTo with groups (SM-7)', () => {
  it('group members are always in the list, even below the line, ordered by score', () => {
    const same = (id: number, a: number) => lm(id, a, { rec_sec: 0 });
    // 1-2 and 2-3 above the line, 1-3 (0.75) below; average linkage puts all three together
    const step = ang(0.922);
    const ms = [same(1, 0), same(2, step), same(3, 2 * step)];
    const g = lookGroups(ms);
    expect(g.get(1)).toBe(g.get(3));
    expect(similarTo(ms[0]!, ms).similar).toEqual([2]);
    expect(similarTo(ms[0]!, ms, g)).toEqual({ similar: [2, 3], other: [] });
  });
});
