import { describe, it, expect } from 'vitest';
import { candidateRow, rowEnd, afterUse, nextPanel, type PVTree } from '../../../web/src/board/panelview.js';
import type { PoolMoment, PoolPanel } from '../../../web/src/board/pool.js';

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
const filled = (id: number, moment_id: number): PoolPanel => ({ id, state: 'filled', source: 'user', moment_id, candidates: [] });
const choose = (id: number, cands: number[]): PoolPanel => ({ id, state: 'candidates', source: 'ai', moment_id: null, candidates: cands.map((c) => ({ id: c })) });
const gap = (id: number): PoolPanel => ({ id, state: 'gap', source: 'ai', moment_id: null, candidates: [] });
const tree = (...scenes: PoolPanel[][]): PVTree => ({ scenes: scenes.map((panels, i) => ({ id: 100 + i, event_id: 1, panels })) });
const idsOf = (r: { id: number }[]) => r.map((c) => c.id);

describe('candidateRow', () => {
  it('orders: AI candidates, then similar (nearest first), then unused event moments (stars first, then by time distance)', () => {
    // panel 1 = CHOOSE with candidates 20, 21 (left = 20); similar of 20 = [30, 31]; event moments 40 (far), 41 (near), 42 (star, far)
    const ms = [
      mo(20, { rec: 1000, similar_ids: [30, 31] }), mo(21, { rec: 1010 }), mo(30, { rec: 5000 }), mo(31, { rec: 6000 }),
      mo(40, { rec: 9000 }), mo(41, { rec: 1100 }), mo(42, { rec: 8000, user_tier: 'hero' }),
    ];
    const r = candidateRow(choose(1, [20, 21]), tree([choose(1, [20, 21])]), ms);
    // 30 and 31 are also "event" moments but must not repeat
    expect(idsOf(r)).toEqual([21, 30, 31, 42, 41, 40]);
    expect(r.map((c) => c.group)).toEqual(['ai', 'similar', 'similar', 'event', 'event', 'event']);
  });

  it('CHOOSE panel: left is the first candidate, so the row starts with the others and never repeats it', () => {
    const ms = [mo(20), mo(21), mo(22)];
    const p = choose(1, [20, 21, 22]);
    expect(idsOf(candidateRow(p, tree([p]), ms)).slice(0, 2)).toEqual([21, 22]);
  });

  it('excludes the panel own moment, rejected moments and hidden clips', () => {
    const ms = [
      mo(1, { rec: 100, similar_ids: [2, 3, 4, 5] }), mo(2, { status: 'rejected' }), mo(3, { hidden: true }), mo(4), mo(5, { similar_ids: [1] }),
    ];
    const p = filled(1, 1);
    expect(idsOf(candidateRow(p, tree([p]), ms))).toEqual([4, 5]);
  });

  it('moments used in other panels stay out of the event group but appear (marked) in AI / similar groups', () => {
    const ms = [mo(1, { rec: 100, similar_ids: [2] }), mo(2, { rec: 200 }), mo(3, { rec: 300 }), mo(4, { rec: 400 })];
    const p1 = filled(1, 1);
    const p2 = filled(2, 2); // 2 is similar to 1 and used in panel 2
    const p3 = filled(3, 3); // 3 is an event moment used elsewhere -> not offered
    const r = candidateRow(p1, tree([p1, p2, p3]), ms);
    expect(idsOf(r)).toEqual([2, 4]);
    expect(r[0].inPanel).toEqual({ panelId: 2, sceneIndex: 0, panelNo: 2 });
    expect(r[1].inPanel).toBeNull();
  });

  it('a CHOOSE candidate used in another panel is offered with its mark', () => {
    const ms = [mo(20), mo(21)];
    const p1 = choose(1, [20, 21]);
    const p2 = filled(2, 21);
    const r = candidateRow(p1, tree([p1, p2]), ms);
    expect(idsOf(r)).toEqual([21]);
    expect(r[0].inPanel?.panelNo).toBe(2);
  });

  it('only the scene event is considered for the event group', () => {
    const ms = [mo(1, { rec: 100 }), mo(2, { ev: 2 }), mo(3, { ev: 1 })];
    const p = filled(1, 1);
    expect(idsOf(candidateRow(p, tree([p]), ms))).toEqual([3]);
  });

  it('event group is sorted by distance to the panel moment recording time (both directions)', () => {
    const ms = [mo(1, { rec: 1000 }), mo(2, { rec: 1500 }), mo(3, { rec: 900 }), mo(4, { rec: 200 })];
    const p = filled(1, 1);
    expect(idsOf(candidateRow(p, tree([p]), ms))).toEqual([3, 2, 4]);
  });

  it('empty panel: spot = midpoint of the neighbours times', () => {
    // neighbours at 1000 and 2000 -> spot 1500
    const ms = [mo(1, { rec: 1000 }), mo(2, { rec: 2000 }), mo(3, { rec: 1450 }), mo(4, { rec: 1100 }), mo(5, { rec: 3000 })];
    const t = tree([filled(10, 1), gap(11), filled(12, 2)]);
    expect(idsOf(candidateRow(t.scenes[0].panels[1], t, ms))).toEqual([3, 4, 5]);
  });

  it('empty panel with one neighbour uses that neighbour time; with none uses the earliest time of the scene event', () => {
    const ms = [mo(1, { rec: 1000 }), mo(3, { rec: 3000 }), mo(4, { rec: 1200 }), mo(5, { rec: 500 })];
    const one = tree([filled(10, 1), gap(11)]);
    expect(idsOf(candidateRow(one.scenes[0].panels[1], one, ms))).toEqual([4, 5, 3]);
    const none = tree([gap(11)]);
    expect(idsOf(candidateRow(none.scenes[0].panels[0], none, ms))).toEqual([5, 1, 4, 3]);
  });

  it('stars first inside the event group even when farther away', () => {
    const ms = [mo(1, { rec: 1000 }), mo(2, { rec: 1010 }), mo(3, { rec: 5000, tier: 'hero' })];
    const p = filled(1, 1);
    expect(idsOf(candidateRow(p, tree([p]), ms))).toEqual([3, 2]);
  });

  it('unknown candidate ids are skipped', () => {
    const p = choose(1, [20, 99, 21]);
    expect(idsOf(candidateRow(p, tree([p]), [mo(20), mo(21)]))).toEqual([21]);
  });
});

describe('rowEnd (index of the last panel of the row, where the view is inserted)', () => {
  it('full rows', () => {
    expect(rowEnd(0, 4, 10)).toBe(3);
    expect(rowEnd(3, 4, 10)).toBe(3);
    expect(rowEnd(4, 4, 10)).toBe(7);
  });
  it('last row is shorter', () => {
    expect(rowEnd(8, 4, 10)).toBe(9);
    expect(rowEnd(9, 4, 10)).toBe(9);
  });
  it('degenerate perRow behaves like 1 per row', () => {
    expect(rowEnd(2, 0, 5)).toBe(2);
  });
});

describe('afterUse', () => {
  const row = [{ id: 7 }, { id: 8 }];
  it('the previous moment becomes the right-hand candidate (swap back is one more use)', () => {
    expect(afterUse(5, row)).toBe(5);
  });
  it('no previous moment (empty panel): first candidate of the new row, or null', () => {
    expect(afterUse(null, row)).toBe(7);
    expect(afterUse(null, [])).toBeNull();
  });
});

describe('nextPanel (cut order, across scenes)', () => {
  const t = tree([filled(1, 1), filled(2, 2)], [], [filled(3, 3)]);
  it('next / previous inside a scene', () => {
    expect(nextPanel(t, 1, 1)).toBe(2);
    expect(nextPanel(t, 2, -1)).toBe(1);
  });
  it('crosses scenes (skipping empty ones)', () => {
    expect(nextPanel(t, 2, 1)).toBe(3);
    expect(nextPanel(t, 3, -1)).toBe(2);
  });
  it('null at the ends and for unknown panels', () => {
    expect(nextPanel(t, 3, 1)).toBeNull();
    expect(nextPanel(t, 1, -1)).toBeNull();
    expect(nextPanel(t, 99, 1)).toBeNull();
  });
});
