import { describe, it, expect } from 'vitest';
import {
  effectiveTier, isHero, recTime, poolOrder, alternatives, otherInEvent, slotFor, usage, fades, loopStep, seekState, loopSeekTarget,
  poolMark, poolSort, onlyNew, ghostSlot, placementScene, type PoolMark, type PoolPanel,
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

describe('poolOrder (look groups, SM-8 revised: star section = stars only)', () => {
  it('groups by look_group ordered by earliest time; only starred moments sit in the star section; out bucket', () => {
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
    // 8 is not starred: it goes down to the rest section even though its group has a star
    expect(ids(r.heroes)).toEqual([[10, 4]]);
    expect(ids(r.rest)).toEqual([[5, 1, 3], [2], [8]]);
    expect(r.out.map((m) => m.id).sort()).toEqual([6, 7]);
  });
  it('stars sit in one row by recording time (no look groups); unstarred members group below; order by earliest member', () => {
    const ms = [
      mo(1, { rec: 50, look_group: 1 }), mo(2, { rec: 60, look_group: 1, user_tier: 'hero' }), mo(3, { rec: 10, look_group: 1 }),
      mo(4, { rec: 20, look_group: 4, user_tier: 'hero' }), mo(5, { rec: 5, look_group: 4 }),
    ];
    const r = poolOrder([...ms, mo(6, { rec: 70, look_group: 1, user_tier: 'hero' })]);
    // stars: group 4 = [4] (rec 20), group 1 = [2, 6] (rec 60); rest: group 4 = [5] (rec 5), group 1 = [3, 1] (rec 10)
    expect(ids(r.heroes)).toEqual([[4, 2, 6]]);
    expect(ids(r.rest)).toEqual([[5], [3, 1]]);
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
    expect(ids(a.heroes)).toEqual([[5]]);
    expect(ids(a.rest)).toEqual([[1, 2], [3], [4]]);
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

describe('BE3: poolMark / poolSort / onlyNew', () => {
  const filledP = (id: number, moment_id: number): PoolPanel => ({ id, state: 'filled', source: 'user', moment_id, candidates: [] });
  const ms = [mo(1, { look_group: 7 }), mo(2, { look_group: 7 }), mo(3), mo(4, { look_group: 8 })];
  const tree: PoolTree = {
    scenes: [
      { id: 10, panels: [filledP(100, 3)] },
      { id: 11, panels: [filledP(110, 4), filledP(111, 1)] },
    ],
  };
  it('similar: a moment of its look group is already in a panel -> panel id and 1-based number in its scene', () => {
    expect(poolMark(ms[1], tree, ms)).toEqual({ kind: 'similar', panelNo: 2, panelId: 111 });
  });
  it('prefers the viewed scene when several scenes hold a look sibling', () => {
    const t: PoolTree = { scenes: [{ id: 10, panels: [filledP(100, 1)] }, { id: 11, panels: [filledP(110, 4), filledP(111, 1)] }] };
    expect(poolMark(ms[1], t, ms, 11)).toEqual({ kind: 'similar', panelNo: 2, panelId: 111 });
    expect(poolMark(ms[1], t, ms, 10)).toEqual({ kind: 'similar', panelNo: 1, panelId: 100 });
  });
  it('new: no look group, or no sibling in the cut', () => {
    expect(poolMark(mo(9), tree, ms)).toEqual({ kind: 'new' });
    expect(poolMark(mo(9, { look_group: 99 }), tree, ms)).toEqual({ kind: 'new' });
  });

  const marks = (m: PoolMoment): PoolMark => (m.look_group === 7 ? { kind: 'similar', panelNo: 1, panelId: 1 } : { kind: 'new' });
  it('poolSort: ★ new, ★ similar, new, similar; each by recording time; empty sections dropped', () => {
    const all = [
      mo(1, { rec: 10, look_group: 7 }), mo(2, { rec: 5, look_group: 7, user_tier: 'hero' }), mo(3, { rec: 30 }),
      mo(4, { rec: 20 }), mo(5, { rec: 40, user_tier: 'hero' }), mo(6, { rec: 1, user_tier: 'hero' }), mo(7, { rec: 2, look_group: 7 }),
    ];
    const r = poolSort(all, marks);
    expect(r.map((s) => s.key)).toEqual(['star-new', 'star-similar', 'new', 'similar']);
    expect(r.map((s) => s.moments.map((m) => m.id))).toEqual([[6, 5], [2], [4, 3], [7, 1]]);
    expect(poolSort([mo(3), mo(4)], marks).map((s) => s.key)).toEqual(['new']);
    expect(poolSort([], marks)).toEqual([]);
  });
  it('onlyNew drops similar moments', () => {
    expect(onlyNew([mo(1, { look_group: 7 }), mo(3)], marks).map((m) => m.id)).toEqual([3]);
  });
});

describe('BE3: ghostSlot', () => {
  const sc = (...pm: (number | null)[]) => ({
    panels: pm.map((id, i) => (id === null
      ? { id: i, state: 'gap', source: 'ai', moment_id: null, candidates: [] } as PoolPanel
      : { id: i, state: 'filled', source: 'ai', moment_id: id, candidates: [] } as PoolPanel)),
  });
  const ms = [mo(1, { rec: 100 }), mo(2, { rec: 200 }), mo(3, { rec: 300 })];
  it('before the first, between, after the last', () => {
    const s = sc(1, 2, 3);
    expect(ghostSlot(mo(9, { rec: 50 }), s, ms)).toBe(0);
    expect(ghostSlot(mo(9, { rec: 150 }), s, ms)).toBe(1);
    expect(ghostSlot(mo(9, { rec: 250 }), s, ms)).toBe(2);
    expect(ghostSlot(mo(9, { rec: 999 }), s, ms)).toBe(3);
  });
  it('panels without a time (gap, unknown moment) are skipped for the comparison', () => {
    const s = sc(1, null, 2, null);
    expect(ghostSlot(mo(9, { rec: 150 }), s, ms)).toBe(1);
    expect(ghostSlot(mo(9, { rec: 250 }), s, ms)).toBe(3);
    expect(ghostSlot(mo(9, { rec: 50 }), s, ms)).toBe(0);
  });
  it('a CHOOSE panel counts with its first candidate', () => {
    const s = { panels: [{ id: 1, state: 'candidates', source: 'ai', moment_id: null, candidates: [{ id: 2 }] } as PoolPanel] };
    expect(ghostSlot(mo(9, { rec: 150 }), s, ms)).toBe(0);
    expect(ghostSlot(mo(9, { rec: 250 }), s, ms)).toBe(1);
  });
  it('no timed panel at all -> at the end', () => {
    expect(ghostSlot(mo(9), sc(), ms)).toBe(0);
    expect(ghostSlot(mo(9), sc(null, null), ms)).toBe(2);
  });
});

describe('BE3: placementScene', () => {
  const p = (id: number, moment_id: number): PoolPanel => ({ id, state: 'filled', source: 'ai', moment_id, candidates: [] });
  const ms = [mo(1, { rec: 100 }), mo(2, { rec: 200 }), mo(3, { rec: 1000 }), mo(4, { rec: 1100 }), mo(5, { rec: 50, ev: 2 })];
  const tree = {
    scenes: [
      { id: 10, event_id: 1, panels: [p(100, 1), p(101, 2)] },
      { id: 11, event_id: 1, panels: [p(110, 3), p(111, 4)] },
      { id: 12, event_id: 2, panels: [p(120, 5)] },
      { id: 13, event_id: 3, panels: [] },
    ],
  };
  it('the viewed scene when it is for the moment\'s event', () => {
    expect(placementScene(mo(9, { rec: 1050 }), tree, ms, 10)).toBe(10);
  });
  it('else the scene of the event whose recording times contain / are nearest to the moment', () => {
    expect(placementScene(mo(9, { rec: 1050 }), tree, ms, 12)).toBe(11);
    expect(placementScene(mo(9, { rec: 150 }), tree, ms, 12)).toBe(10);
    expect(placementScene(mo(9, { rec: 400 }), tree, ms, 12)).toBe(10); // nearer to scene 10's end (200) than 11's start (1000)
    expect(placementScene(mo(9, { rec: 900 }), tree, ms, 12)).toBe(11);
  });
  it('a scene of the event without any timed panel still takes it', () => {
    expect(placementScene(mo(9, { ev: 3 }), tree, ms, 10)).toBe(13);
  });
  it('null when no scene is for the moment\'s event (offer a new scene)', () => {
    expect(placementScene(mo(9, { ev: 7 }), tree, ms, 10)).toBeNull();
  });
  it('a moment without an event goes to the viewed scene', () => {
    const m = mo(9); m.clip.event_id = null;
    expect(placementScene(m, tree, ms, 12)).toBe(12);
  });
});
