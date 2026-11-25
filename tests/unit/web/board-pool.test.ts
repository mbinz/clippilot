import { describe, it, expect } from 'vitest';
import {
  effectiveTier, isHero, recTime, poolOrder, alternatives, otherInEvent, slotFor, usage, fades, loopStep, seekState, loopSeekTarget,
  type PoolMoment, type PoolTree,
} from '../../../web/src/board/pool.js';

const T0 = 1_700_000_000;
const mo = (id: number, o: Partial<PoolMoment> & { rec?: number; ev?: number; hidden?: boolean } = {}): PoolMoment => {
  const { rec, ev, hidden, ...rest } = o;
  return {
    id, clip_id: id, start_sec: 0, end_sec: 4, tier: 'solid', user_tier: null, role: 'action', shot: 'wide',
    status: 'proposed', seen: false,
    clip: { event_id: ev ?? 1, recorded_at: new Date((T0 + (rec ?? id * 100)) * 1000).toISOString(), hidden: hidden ?? false },
    ...rest,
  };
};
const ids = (gs: PoolMoment[][]) => gs.map((g) => g.map((m) => m.id));

describe('tier / key / time', () => {
  it.each([
    ['solid', null, 'solid', false], ['solid', undefined, 'solid', false],
    ['solid', 'hero', 'hero', true], ['hero', 'filler', 'filler', false], ['hero', null, 'hero', true],
  ] as const)('tier %s user %s -> %s hero=%s', (tier, user_tier, eff, hero) => {
    const m = mo(1, { tier, user_tier });
    expect(effectiveTier(m)).toBe(eff);
    expect(isHero(m)).toBe(hero);
  });
  it('recTime = recorded_at epoch s + start_sec; unparsable -> 0 + start', () => {
    expect(recTime(mo(1, { rec: 0, start_sec: 5 }))).toBe(T0 + 5);
    const bad = mo(1, { start_sec: 2 }); bad.clip.recorded_at = null;
    expect(recTime(bad)).toBe(2);
  });
});

describe('poolOrder (look groups, SM-8)', () => {
  it('groups by look_group ordered by earliest time; a group with any star sits in the star section; out bucket', () => {
    const ms = [
      mo(1, { rec: 10, look_group: 1 }),
      mo(2, { rec: 20 }),
      mo(3, { rec: 30, look_group: 1 }),
      mo(4, { rec: 5, look_group: 9, user_tier: 'hero' }),
      mo(5, { rec: 6, look_group: 1, tier: 'hero', user_tier: 'filler' }),
      mo(6, { rec: 1, look_group: 1, status: 'rejected' }),
      mo(7, { rec: 2, hidden: true }),
      mo(8, { rec: 40, look_group: 9 }),
      mo(10, { rec: 1, user_tier: 'hero' }),
    ];
    const r = poolOrder(ms);
    // 8 is not starred but belongs to the starred group 9: it sits behind the star, not in the rest section
    expect(ids(r.heroes)).toEqual([[10], [4, 8]]);
    expect(ids(r.rest)).toEqual([[5, 1, 3], [2]]);
    expect(r.out.map((m) => m.id).sort()).toEqual([6, 7]);
  });
  it('starred takes first inside a group, then recording time; group order uses the earliest visible member', () => {
    const ms = [
      mo(1, { rec: 50, look_group: 1 }), mo(2, { rec: 60, look_group: 1, user_tier: 'hero' }), mo(3, { rec: 10, look_group: 1 }),
      mo(4, { rec: 20, look_group: 4, user_tier: 'hero' }), mo(5, { rec: 5, look_group: 4 }),
    ];
    // group 4 starts at 5, group 1 at 10
    expect(ids(poolOrder(ms).heroes)).toEqual([[4, 5], [2, 3, 1]]);
    expect(poolOrder(ms).rest).toEqual([]);
  });
  it('moments with no look_group (or null) stand alone, never grouped by role/shot', () => {
    const r = poolOrder([mo(1, { rec: 1 }), mo(2, { rec: 2, look_group: null }), mo(3, { rec: 3, look_group: undefined })]);
    expect(ids(r.rest)).toEqual([[1], [2], [3]]);
  });
  it('is deterministic: input order does not matter, equal times fall back to id', () => {
    const ms = [
      mo(1, { rec: 10, look_group: 1 }), mo(2, { rec: 10, look_group: 1 }), mo(3, { rec: 10 }), mo(4, { rec: 10 }),
      mo(5, { rec: 3, look_group: 1, user_tier: 'hero' }),
    ];
    const a = poolOrder(ms), b = poolOrder([...ms].reverse());
    expect(ids(a.heroes)).toEqual(ids(b.heroes));
    expect(ids(a.rest)).toEqual(ids(b.rest));
    expect(ids(a.heroes)).toEqual([[5, 1, 2]]);
    expect(ids(a.rest)).toEqual([[3], [4]]);
  });
  it('empty', () => expect(poolOrder([])).toEqual({ heroes: [], rest: [], out: [] }));
});

describe('alternatives (similar_ids, SM2)', () => {
  it('follows similar_ids in order; out moments and unknown ids are dropped; no similar_ids -> none', () => {
    const ms = [
      mo(1, { rec: 10, similar_ids: [7, 3, 5, 6, 99, 2] }), mo(2, { rec: 5 }), mo(3, { rec: 1, user_tier: 'hero' }),
      mo(5, { rec: 3, status: 'rejected' }), mo(6, { rec: 4, hidden: true }), mo(7, { rec: 20 }), mo(8, { rec: 2 }),
    ];
    expect(alternatives(ms[0], ms).map((m) => m.id)).toEqual([7, 3, 2]);
    expect(alternatives(ms[1], ms)).toEqual([]);
  });
  it('role/shot labels and stars play no part', () => {
    const ms = [mo(1, { similar_ids: [2] }), mo(2, { role: 'other', shot: 'close' }), mo(3, { tier: 'hero' })];
    expect(alternatives(ms[0], ms).map((m) => m.id)).toEqual([2]);
  });
});

describe('otherInEvent', () => {
  it('same event, not self, not out, not similar; by recording time', () => {
    const ms = [
      mo(1, { rec: 10, similar_ids: [2] }), mo(2, { rec: 5 }), mo(3, { rec: 30 }), mo(4, { rec: 20, tier: 'hero' }),
      mo(5, { rec: 1, ev: 2 }), mo(6, { rec: 2, status: 'rejected' }),
    ];
    expect(otherInEvent(ms[0], ms).map((m) => m.id)).toEqual([4, 3]);
  });
});

describe('slotFor / usage', () => {
  // 2,4 share look group 7 with 1; 3 and 5 share group 8 (moment 3 sits in a candidates panel); 9 is alone
  const ms = [mo(1, { look_group: 7 }), mo(2, { look_group: 7 }), mo(3, { look_group: 8 }), mo(4, { look_group: 7 }), mo(5, { look_group: 8 }), mo(6)];
  const tree: PoolTree = {
    scenes: [
      { id: 10, panels: [
        { id: 100, state: 'filled', source: 'ai', moment_id: 1, candidates: [] },
        { id: 101, state: 'gap', source: 'ai', moment_id: null, candidates: [] },
      ] },
      { id: 11, panels: [
        { id: 110, state: 'candidates', source: 'ai', moment_id: null, candidates: [{ id: 3 }] },
        { id: 111, state: 'filled', source: 'user', moment_id: 2, candidates: [] },
        { id: 112, state: 'filled', source: 'ai', moment_id: 1, candidates: [] },
      ] },
    ],
  };
  it('own filled panel wins', () => expect(slotFor(ms[1], tree, ms, 10)).toBe(111));
  it('same look group: prefers current scene, else first anywhere', () => {
    expect(slotFor(ms[3], tree, ms, 11)).toBe(111);
    expect(slotFor(ms[3], tree, ms, 10)).toBe(100);
    expect(slotFor(ms[3], tree, ms)).toBe(100);
  });
  it('candidates panel counts via its first candidate', () => {
    expect(slotFor(ms[4], tree, ms, 10)).toBe(110);
  });
  it('null when nothing in its group is in the cut; without a look group only its own panel counts', () => {
    expect(slotFor(mo(9, { look_group: 99 }), tree, ms)).toBeNull();
    // same role/shot/event as everything, but no group: never matches by label
    expect(slotFor(ms[5]!, tree, ms)).toBeNull();
    expect(slotFor(mo(1), tree, ms)).toBe(100);
  });
  it('usage: first occurrence only, 1-based panelNo, scene index', () => {
    expect(usage(tree)).toEqual({
      1: { panelId: 100, sceneIndex: 0, panelNo: 1, source: 'ai' },
      2: { panelId: 111, sceneIndex: 1, panelNo: 2, source: 'user' },
    });
  });
});

describe('fades', () => {
  const base = { inStory: false, seen: false, hovered: false, selected: false };
  it.each([
    [{}, true],
    [{ seen: true }, false],
    [{ inStory: true }, false],
    [{ hovered: true }, false],
    [{ selected: true }, false],
  ] as const)('%j -> %s', (o, want) => expect(fades(mo(1), { ...base, ...o })).toBe(want));
});

describe('loop / play-on', () => {
  it.each([
    [2, 1, 5, false, 2, false],
    [5, 1, 5, false, 1, false],
    [6, 1, 5, false, 1, false],
    [0.6, 1, 5, false, 1, false],
    [0.8, 1, 5, false, 0.8, false],
    [7, 1, 5, true, 7, true],
    [0, 1, 5, true, 0, true],
  ])('loopStep t=%s [%s,%s] free=%s', (t, a, b, free, wantT, wantFree) => {
    expect(loopStep(t, a, b, free)).toEqual({ t: wantT, free: wantFree });
  });
  it.each([
    [3, false], [1, false], [0.96, false], [0.9, true], [5.04, false], [5.1, true], [20, true],
  ])('seekState t=%s -> free=%s', (t, free) => expect(seekState(t, 1, 5)).toBe(free));

  // Safari bug 2026-11-23: currentTime advances between two reads, so "seek unless unchanged" seeked on every
  // timeupdate. The player must only seek when a jump is due: null = leave the video alone.
  it.each([
    [2, false, null], [4.99, false, null], [5, false, 1], [6, false, 1], [0.6, false, 1], [0.8, false, null],
    [7, true, null], [0, true, null],
  ])('loopSeekTarget t=%s free=%s -> %s', (t, free, want) => expect(loopSeekTarget(t, 1, 5, free)).toBe(want));
});
