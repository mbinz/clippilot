// Pure logic of the panel view (BE2): candidate row, row end, swap, panel navigation. No React, no DOM.
// Tested in tests/unit/web/board-panelview.test.ts.
import {
  alternatives, isHero, isOut, panelMomentId, recTime, usage,
  type PoolMoment, type PoolPanel,
} from './pool';

export interface PVTree {
  scenes: { id: number; event_id?: number | null; panels: PoolPanel[] }[];
}

export type CandidateGroup = 'ai' | 'similar' | 'event';

export interface Candidate {
  id: number;
  group: CandidateGroup;
  /** Set when the moment is used in another panel ("in panel N"). */
  inPanel: { panelId: number; sceneIndex: number; panelNo: number } | null;
}

/** Recording time the panel's spot stands for: its own moment, else the neighbours' midpoint, else the scene's first time. */
function spotTime(panel: PoolPanel, scene: PVTree['scenes'][number], byId: Map<number, PoolMoment>, moments: PoolMoment[]): number {
  const timeOf = (p: PoolPanel | undefined): number | null => {
    const id = p ? panelMomentId(p) : null;
    const m = id == null ? undefined : byId.get(id);
    return m ? recTime(m) : null;
  };
  const own = timeOf(panel);
  if (own !== null) return own;
  const i = scene.panels.findIndex((p) => p.id === panel.id);
  const prev = i > 0 ? timeOf(scene.panels[i - 1]) : null;
  const next = i >= 0 ? timeOf(scene.panels[i + 1]) : null;
  if (prev !== null && next !== null) return (prev + next) / 2;
  if (prev !== null || next !== null) return (prev ?? next)!;
  const times = scene.panels.map(timeOf).filter((t): t is number => t !== null);
  if (times.length) return Math.min(...times);
  const inEvent = moments.filter((m) => !isOut(m) && m.clip.event_id === scene.event_id).map(recTime);
  return inEvent.length ? Math.min(...inEvent) : 0;
}

/**
 * Candidates for the right-hand player, in order: the panel's AI candidates, similar moments of the panel's moment
 * (nearest first), then unused moments of the scene's event (★ first, then by distance in recording time to the spot).
 * No duplicates, never the panel's own moment (the left side), never rejected moments / hidden clips.
 */
export function candidateRow(panel: PoolPanel, tree: PVTree, moments: PoolMoment[]): Candidate[] {
  const byId = new Map(moments.map((m) => [m.id, m]));
  const used = usage(tree);
  const scene = tree.scenes.find((s) => s.panels.some((p) => p.id === panel.id));
  const ownId = panelMomentId(panel);
  const own = ownId == null ? null : byId.get(ownId) ?? null;

  const seen = new Set<number>(ownId == null ? [] : [ownId]);
  const row: Candidate[] = [];
  const add = (m: PoolMoment | undefined, group: CandidateGroup): void => {
    if (!m || seen.has(m.id) || isOut(m)) return;
    seen.add(m.id);
    const u = used[m.id];
    row.push({ id: m.id, group, inPanel: u ? { panelId: u.panelId, sceneIndex: u.sceneIndex, panelNo: u.panelNo } : null });
  };

  if (panel.state === 'candidates') for (const c of panel.candidates) add(byId.get(c.id), 'ai');
  if (own) for (const m of alternatives(own, moments)) add(m, 'similar');

  const eventId = scene?.event_id ?? own?.clip.event_id ?? null;
  if (scene && eventId !== null) {
    const spot = spotTime(panel, scene, byId, moments);
    const pool = moments
      .filter((m) => m.clip.event_id === eventId && !used[m.id])
      .sort((a, b) =>
        Number(isHero(b)) - Number(isHero(a)) || Math.abs(recTime(a) - spot) - Math.abs(recTime(b) - spot) || a.id - b.id);
    for (const m of pool) add(m, 'event');
  }
  return row;
}

/** Index of the last panel of the row `panelIndex` sits in (the panel view goes right after it); the last row may be short. */
export function rowEnd(panelIndex: number, perRow: number, count: number): number {
  const n = Math.max(1, perRow);
  return Math.min((Math.floor(panelIndex / n) + 1) * n, count) - 1;
}

/** Right-hand candidate after "use this": the moment that was in the panel (swap back = one more use), else the first of the new row. */
export function afterUse(prevMomentId: number | null, row: readonly { id: number }[]): number | null {
  return prevMomentId ?? row[0]?.id ?? null;
}

/** The next / previous panel in cut order (crossing scenes), or null at the ends. */
export function nextPanel(tree: PVTree, panelId: number, dir: 1 | -1): number | null {
  const all = tree.scenes.flatMap((s) => s.panels.map((p) => p.id));
  const i = all.indexOf(panelId);
  if (i < 0) return null;
  return all[i + dir] ?? null;
}
