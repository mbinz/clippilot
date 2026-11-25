import { describe, it, expect } from 'vitest';
import {
  effectiveTier, isHero, similarKey, recTime, poolOrder, alternatives, otherInEvent, slotFor, usage, fades, loopStep, seekState, loopSeekTarget,
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
  it('similarKey = event + role + shot', () => {
    expect(similarKey(mo(1, { ev: 3, role: 'establishing', shot: 'wide' }))).toBe('3|establishing|wide');
    expect(similarKey(mo(1, { shot: null }))).toBe('1|action|null');
  });
  it('recTime = recorded_at epoch s + start_sec; unparsable -> 0 + start', () => {
    expect(recTime(mo(1, { rec: 0, start_sec: 5 }))).toBe(T0 + 5);
    const bad = mo(1, { start_sec: 2 }); bad.clip.recorded_at = null;
    expect(recTime(bad)).toBe(2);
  });
});

describe('poolOrder', () => {
  it('groups by similarKey ordered by earliest time; stars and rest separate; out bucket', () => {
    const ms = [
      mo(1, { rec: 10, role: 'action' }),
      mo(2, { rec: 20, role: 'portrait' }),
      mo(3, { rec: 30, role: 'action' }),
      mo(4, { rec: 5, role: 'action', user_tier: 'hero' }),
      mo(5, { rec: 6, tier: 'hero', user_tier: 'filler' }),
      mo(6, { rec: 1, role: 'portrait', status: 'rejected' }),
      mo(7, { rec: 2, hidden: true }),
      mo(8, { rec: 40, role: 'portrait', tier: 'hero' }),
    ];
    const r = poolOrder(ms);
    expect(ids(r.heroes)).toEqual([[4], [8]]);
    expect(ids(r.rest)).toEqual([[5, 1, 3], [2]]);
    expect(r.out.map((m) => m.id).sort()).toEqual([6, 7]);
  });
  it('group order uses earliest time over ALL visible moments, not just the section', () => {
    const ms = [
      mo(1, { rec: 50, role: 'a' }), mo(2, { rec: 60, role: 'b' }),
      mo(3, { rec: 1, role: 'b', user_tier: 'hero' }),
      mo(4, { rec: 2, role: 'a', user_tier: 'hero' }),
    ];
    const r = poolOrder(ms);
    expect(ids(r.heroes)).toEqual([[3], [4]]);
    expect(ids(r.rest)).toEqual([[2], [1]]);
  });
  it('separate events are separate groups', () => {
    const r = poolOrder([mo(1, { rec: 1, ev: 1 }), mo(2, { rec: 2, ev: 2 }), mo(3, { rec: 3, ev: 1 })]);
    expect(ids(r.rest)).toEqual([[1, 3], [2]]);
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
  const ms = [mo(1), mo(2), mo(3, { role: 'x' }), mo(4), mo(5, { role: 'x' })];
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
  it('similar moment: prefers current scene, else first anywhere', () => {
    expect(slotFor(ms[3], tree, ms, 11)).toBe(111);
    expect(slotFor(ms[3], tree, ms, 10)).toBe(100);
    expect(slotFor(ms[3], tree, ms)).toBe(100);
  });
  it('candidates panel counts via its first candidate', () => {
    expect(slotFor(ms[4], tree, ms, 10)).toBe(110);
  });
  it('null when nothing similar', () => expect(slotFor(mo(9, { role: 'zzz' }), tree, ms)).toBeNull());
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
