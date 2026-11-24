import { describe, it, expect } from 'vitest';
import {
  decisionFor, storyLink, optionList, starTarget, starLabel, rangeLabel, playLabel, storyMark, poolView,
  panelPosition, isValidTrim, transcriptView, type DrawerTree,
} from '../../../web/src/board/drawer.js';
import type { PoolMoment } from '../../../web/src/board/pool.js';

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

describe('decisionFor (which decision box the panel drawer shows)', () => {
  const a = mo(1), b = mo(2);
  it('previewing another moment -> use, remembering whether there is a current one', () => {
    expect(decisionFor({ state: 'filled', source: 'ai', current: a, shown: b })).toEqual({ kind: 'use', hasCurrent: true });
    expect(decisionFor({ state: 'gap', source: 'ai', current: null, shown: b })).toEqual({ kind: 'use', hasCurrent: false });
  });
  it('current moment of a filled panel -> picked (mine when the source is user)', () => {
    expect(decisionFor({ state: 'filled', source: 'user', current: a, shown: a })).toEqual({ kind: 'picked', mine: true });
    expect(decisionFor({ state: 'filled', source: 'ai', current: a, shown: a })).toEqual({ kind: 'picked', mine: false });
  });
  it("current moment of a candidate panel -> Claude's default pick", () => {
    expect(decisionFor({ state: 'candidates', source: 'ai', current: a, shown: a })).toEqual({ kind: 'default' });
  });
  it('nothing shown -> empty', () => {
    expect(decisionFor({ state: 'gap', source: 'ai', current: null, shown: null })).toEqual({ kind: 'empty' });
  });
  it('a rejected or hidden moment cannot be used', () => {
    expect(decisionFor({ state: 'filled', source: 'ai', current: a, shown: mo(3, { status: 'rejected' }) })).toEqual({ kind: 'out', rejected: true });
    expect(decisionFor({ state: 'filled', source: 'ai', current: a, shown: mo(3, { hidden: true }) })).toEqual({ kind: 'out', rejected: false });
  });
});

const tree: DrawerTree = {
  scenes: [
    { id: 10, name: 'Arrival', panels: [
      { id: 100, state: 'filled', source: 'user', moment_id: 1, candidates: [] },
      { id: 101, state: 'candidates', source: 'ai', moment_id: null, candidates: [{ id: 2 }, { id: 3 }] },
      { id: 102, state: 'gap', source: 'ai', moment_id: null, candidates: [] },
    ] },
    { id: 11, name: 'Beach', panels: [
      { id: 110, state: 'filled', source: 'ai', moment_id: 5, candidates: [] },
    ] },
  ],
};

describe('panelPosition', () => {
  it('finds scene index and 1-based panel number', () => {
    expect(panelPosition(tree, 101)).toEqual({ sceneId: 10, sceneIndex: 0, sceneName: 'Arrival', panelNo: 2 });
    expect(panelPosition(tree, 110)).toEqual({ sceneId: 11, sceneIndex: 1, sceneName: 'Beach', panelNo: 1 });
    expect(panelPosition(tree, 999)).toBeNull();
  });
});

describe('storyLink (the one link from the moment drawer into the story)', () => {
  const ms = [mo(1), mo(2, { shot: 'close' }), mo(3, { shot: 'close' }), mo(4, { role: 'portrait' }), mo(5, { role: 'portrait' }), mo(6, { role: 'other' })];
  it('a moment in the story -> in, with its panel and scene', () => {
    expect(storyLink(ms[0], tree, ms, 10)).toEqual({ kind: 'in', panelId: 100, panelNo: 1, sceneName: 'Arrival' });
  });
  it('a similar shot in the story -> compare in that panel (candidates count)', () => {
    expect(storyLink(ms[2], tree, ms, 10)).toEqual({ kind: 'compare', panelId: 101, panelNo: 2 });
    expect(storyLink(ms[3], tree, ms, 10)).toEqual({ kind: 'compare', panelId: 110, panelNo: 1 });
  });
  it('nothing similar -> add to scene', () => {
    expect(storyLink(ms[5], tree, ms, 10)).toEqual({ kind: 'add' });
  });
  it('rejected / hidden -> none', () => {
    expect(storyLink(mo(9, { status: 'rejected' }), tree, ms, 10)).toEqual({ kind: 'none' });
    expect(storyLink(mo(9, { hidden: true }), tree, ms, 10)).toEqual({ kind: 'none' });
  });
});

describe('optionList (options grid of the panel drawer)', () => {
  const m1 = mo(1, { rec: 10 }), m2 = mo(2, { rec: 5 }), m3 = mo(3, { rec: 1, user_tier: 'hero' });
  const other = mo(4, { rec: 2, role: 'x' }), rej = mo(5, { rec: 3, status: 'rejected' });
  const all = [m1, m2, m3, other, rej];
  it('the current moment first, then alternatives (stars first)', () => {
    expect(optionList({ current: m1, shown: m1, candidateIds: [], moments: all, eventId: 1 }).map((m) => m.id)).toEqual([1, 3, 2]);
  });
  it('candidate panel: candidates first (in order), then the rest', () => {
    const r = optionList({ current: m2, shown: m2, candidateIds: [2, 1], moments: all, eventId: 1 });
    expect(r.map((m) => m.id)).toEqual([2, 1, 3]);
  });
  it('an empty panel previewing a moment: options are that moment and its alternatives', () => {
    expect(optionList({ current: null, shown: m1, candidateIds: [], moments: all, eventId: 1 }).map((m) => m.id)).toEqual([1, 3, 2]);
  });
  it('an empty panel with nothing shown: the scene event, stars first then time, no out moments', () => {
    const r = optionList({ current: null, shown: null, candidateIds: [], moments: [...all, mo(6, { ev: 2 })], eventId: 1 });
    expect(r.map((m) => m.id)).toEqual([3, 4, 2, 1]);
  });
  it('a shown moment that is not among the options (e.g. opened from elsewhere) is put first', () => {
    const far = mo(7, { role: 'zzz' });
    expect(optionList({ current: m1, shown: far, candidateIds: [], moments: [...all, far], eventId: 1 })[0].id).toBe(7);
  });
});

describe('star', () => {
  it('starring an unstarred moment sets hero', () => {
    expect(starTarget({ tier: 'solid', ai_tier: 'solid' })).toBe('hero');
    expect(starTarget({ tier: 'filler', ai_tier: 'filler', user_tier: null })).toBe('hero');
  });
  it('unstar: back to the AI tier, or solid when the AI itself starred it', () => {
    expect(starTarget({ tier: 'hero', ai_tier: 'solid', user_tier: 'hero' })).toBeNull();
    expect(starTarget({ tier: 'hero', ai_tier: 'hero', user_tier: null })).toBe('solid');
  });
  it('re-starring an AI star that you removed clears your override', () => {
    expect(starTarget({ tier: 'solid', ai_tier: 'hero', user_tier: 'solid' })).toBeNull();
  });
  it('button label shows "yours" only when user_tier is set', () => {
    expect(starLabel({ tier: 'hero', user_tier: null })).toBe('★ Starred');
    expect(starLabel({ tier: 'hero', user_tier: 'hero' })).toBe('★ Starred · yours');
    expect(starLabel({ tier: 'solid', user_tier: null })).toBe('☆ Star');
  });
});

describe('rangeLabel', () => {
  const base = { start_sec: 1, end_sec: 4.5, ai_start_sec: 1, ai_end_sec: 4.5, speed: 1 };
  it('plain range', () => expect(rangeLabel(base, false)).toBe('1.0 s – 4.5 s'));
  it('speed shows the timeline length', () => {
    expect(rangeLabel({ ...base, speed: 0.5 }, false)).toBe('1.0 s – 4.5 s → 7.0 s at 50 %');
  });
  it('changed by you when in/out differ from the AI range; edit hint when editable', () => {
    expect(rangeLabel({ ...base, start_sec: 2 }, true)).toBe('2.0 s – 4.5 s · changed by you · drag the edges');
  });
});

describe('playLabel', () => {
  it('shows looping or playing on', () => {
    expect(playLabel(65, 120, false)).toBe('1:05 / 2:00 · looping');
    expect(playLabel(5, 120, true)).toBe('0:05 / 2:00 · playing on');
  });
});

describe('storyMark (bold in-story frame on a tile)', () => {
  it('yours = green with a check, AI = violet; scene·panel when in another scene', () => {
    expect(storyMark({ panelId: 1, sceneIndex: 0, panelNo: 3, source: 'user' }, 0)).toEqual({ tone: 'mine', badge: '✓ 3' });
    expect(storyMark({ panelId: 1, sceneIndex: 2, panelNo: 3, source: 'ai' }, 0)).toEqual({ tone: 'ai', badge: '3·3' });
    expect(storyMark({ panelId: 1, sceneIndex: 2, panelNo: 1, source: 'user' }, 0)).toEqual({ tone: 'mine', badge: '✓ 3·1' });
    expect(storyMark(undefined, 0)).toBeNull();
  });
});

describe('poolView', () => {
  const ms = [mo(1, { ev: 1 }), mo(2, { ev: 2 }), mo(3, { ev: 1, tier: 'hero' }), mo(4, { ev: 1, status: 'rejected' })];
  it('event scope filters, all scope does not', () => {
    const e = poolView(ms, 'event', 1);
    expect(e.heroes.flat().map((m) => m.id)).toEqual([3]);
    expect(e.rest.flat().map((m) => m.id)).toEqual([1]);
    expect(e.out.map((m) => m.id)).toEqual([4]);
    expect(poolView(ms, 'all', 1).rest.flat().map((m) => m.id).sort()).toEqual([1, 2]);
  });
  it('no event on the scene -> everything', () => {
    expect(poolView(ms, 'event', null).rest.flat()).toHaveLength(2);
  });
  it('moments used in the cut leave the pool (heroes and rest); counted as inStory', () => {
    const v = poolView(ms, 'all', 1, new Set([2, 3]));
    expect(v.heroes.flat()).toHaveLength(0);
    expect(v.rest.flat().map((m) => m.id)).toEqual([1]);
    expect(v.out.map((m) => m.id)).toEqual([4]);
    expect(v.inStory).toBe(2);
  });
});

describe('isValidTrim', () => {
  it('needs at least 0.5 s', () => {
    expect(isValidTrim(1, 1.5)).toBe(true);
    expect(isValidTrim(1, 1.4)).toBe(false);
  });
});

describe('transcriptView (the "Spoken" block of the moment drawer)', () => {
  const segs = [
    { start: 1, end: 3, text: 'Eins.' },
    { start: 5, end: 8, text: 'Zwei.' },
    { start: 10, end: 12, text: 'Drei.' },
  ];
  it('marks the segments overlapping the moment; no cut when the boundaries fall in silence', () => {
    expect(transcriptView(segs, 4, 9)).toEqual({
      parts: [
        { text: 'Eins.', start: 1, inMoment: false },
        { text: 'Zwei.', start: 5, inMoment: true },
        { text: 'Drei.', start: 10, inMoment: false },
      ],
      cut: null,
    });
  });
  it('a segment crossing the start / end / both boundaries is a cut', () => {
    expect(transcriptView(segs, 6, 9.5).cut).toBe('start');
    expect(transcriptView(segs, 4, 6).cut).toBe('end');
    expect(transcriptView(segs, 6, 7).cut).toBe('both');
  });
  it('a moment without speech: nothing in the moment, no cut', () => {
    const v = transcriptView(segs, 13, 20);
    expect(v.parts.every((p) => !p.inMoment)).toBe(true);
    expect(v.cut).toBeNull();
  });
  it('empty segments -> no parts', () => {
    expect(transcriptView([], 0, 5)).toEqual({ parts: [], cut: null });
  });
});
