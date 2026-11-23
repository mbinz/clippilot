// Pure decision logic for the two drawers and the pool of Board v3 (no React, no DOM).
// Tested in tests/unit/web/board-drawer.test.ts; ported from mockups/scene-board-v3.html.
import {
  alternatives, isHero, isOut, poolOrder, recTime, slotFor, usage,
  type PoolMoment, type PoolPanel, type UsageEntry,
} from './pool';

export const MIN_TRIM_SEC = 0.5;

export interface DrawerTree {
  scenes: { id: number; name: string; panels: PoolPanel[] }[];
}

/* ---------- panel drawer ---------- */

export type Decision =
  | { kind: 'out'; rejected: boolean }
  | { kind: 'use'; hasCurrent: boolean }
  | { kind: 'default' }
  | { kind: 'picked'; mine: boolean }
  | { kind: 'empty' };

/** Which decision box the panel drawer shows. `shown` = the previewed moment (the current one when not previewing). */
export function decisionFor(i: {
  state: 'filled' | 'candidates' | 'gap';
  source: string;
  current: PoolMoment | null;
  shown: PoolMoment | null;
}): Decision {
  const { current, shown } = i;
  if (shown && isOut(shown)) return { kind: 'out', rejected: shown.status === 'rejected' };
  const isCur = !!current && !!shown && current.id === shown.id;
  if (shown && !isCur) return { kind: 'use', hasCurrent: !!current };
  if (isCur && i.state === 'candidates') return { kind: 'default' };
  if (isCur) return { kind: 'picked', mine: i.source === 'user' };
  return { kind: 'empty' };
}

/**
 * Options grid: the moment in the story first, then similar shots (stars first); a candidate panel lists its candidates
 * first; an empty panel with nothing shown lists the scene's event (stars first, then time).
 */
export function optionList<T extends PoolMoment>(o: {
  current: T | null;
  shown: T | null;
  candidateIds: number[];
  moments: T[];
  eventId: number | null;
}): T[] {
  const base = o.current ?? o.shown;
  let opts: T[] = base
    ? [base, ...(alternatives(base, o.moments) as T[])]
    : o.moments
        .filter((x) => !isOut(x) && (o.eventId === null || x.clip.event_id === o.eventId))
        .sort((a, b) => Number(isHero(b)) - Number(isHero(a)) || recTime(a) - recTime(b));
  if (o.candidateIds.length) {
    const byId = new Map(o.moments.map((m) => [m.id, m]));
    const cands = o.candidateIds.map((id) => byId.get(id)).filter((m): m is T => !!m);
    opts = [...cands, ...opts.filter((x) => !o.candidateIds.includes(x.id))];
  }
  if (o.shown && !opts.some((x) => x.id === o.shown!.id)) opts.unshift(o.shown);
  return opts;
}

/* ---------- moment drawer ---------- */

export interface PanelPosition {
  sceneId: number;
  sceneIndex: number;
  sceneName: string;
  panelNo: number;
}

export function panelPosition(tree: DrawerTree, panelId: number): PanelPosition | null {
  for (let sceneIndex = 0; sceneIndex < tree.scenes.length; sceneIndex++) {
    const s = tree.scenes[sceneIndex];
    const i = s.panels.findIndex((p) => p.id === panelId);
    if (i >= 0) return { sceneId: s.id, sceneIndex, sceneName: s.name, panelNo: i + 1 };
  }
  return null;
}

export type StoryLink =
  | { kind: 'none' }
  | { kind: 'in'; panelId: number; panelNo: number; sceneName: string }
  | { kind: 'compare'; panelId: number; panelNo: number }
  | { kind: 'add' };

/** The one link from the moment drawer into the story. */
export function storyLink(m: PoolMoment, tree: DrawerTree, moments: PoolMoment[], currentSceneId?: number): StoryLink {
  if (isOut(m)) return { kind: 'none' };
  const used = usage(tree)[m.id];
  if (used) {
    const pos = panelPosition(tree, used.panelId)!;
    return { kind: 'in', panelId: used.panelId, panelNo: pos.panelNo, sceneName: pos.sceneName };
  }
  const slot = slotFor(m, tree, moments, currentSceneId);
  const pos = slot === null ? null : panelPosition(tree, slot);
  return pos && slot !== null ? { kind: 'compare', panelId: slot, panelNo: pos.panelNo } : { kind: 'add' };
}

type TierLike = { tier: string; user_tier?: string | null };

/** What the star button sends: hero, or back to the AI tier (null), or solid when the AI itself starred it. */
export function starTarget(m: TierLike & { ai_tier: string }): 'hero' | 'solid' | null {
  if (isHero(m as Pick<PoolMoment, 'tier' | 'user_tier'>)) return m.ai_tier === 'hero' ? 'solid' : null;
  return m.ai_tier === 'hero' ? null : 'hero';
}

export const starLabel = (m: TierLike): string =>
  `${m.tier === 'hero' || m.user_tier === 'hero' ? '★ Starred' : '☆ Star'}${m.user_tier ? ' · yours' : ''}`;

/* ---------- timeline / player labels ---------- */

const f1 = (s: number): string => `${s.toFixed(1)} s`;
export const fmtClock = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function rangeLabel(
  m: { start_sec: number; end_sec: number; ai_start_sec: number; ai_end_sec: number; speed: number },
  editable: boolean,
): string {
  const changed = Math.abs(m.start_sec - m.ai_start_sec) > 0.05 || Math.abs(m.end_sec - m.ai_end_sec) > 0.05;
  const slowed = m.speed !== 1 ? ` → ${f1((m.end_sec - m.start_sec) / m.speed)} at ${Math.round(m.speed * 100)} %` : '';
  return `${f1(m.start_sec)} – ${f1(m.end_sec)}${slowed}${changed ? ' · changed by you' : ''}${editable ? ' · drag the edges' : ''}`;
}

export const playLabel = (t: number, duration: number, free: boolean): string =>
  `${fmtClock(t)} / ${fmtClock(duration)} · ${free ? 'playing on' : 'looping'}`;

export const isValidTrim = (a: number, b: number): boolean => b - a >= MIN_TRIM_SEC - 1e-9;

/* ---------- pool ---------- */

/** Bold in-story frame of a tile: green + check = yours, violet = AI's pick; "scene·panel" when in another scene. */
export function storyMark(u: UsageEntry | undefined, currentSceneIndex: number): { tone: 'mine' | 'ai'; badge: string } | null {
  if (!u) return null;
  const mine = u.source === 'user';
  const where = u.sceneIndex === currentSceneIndex ? `${u.panelNo}` : `${u.sceneIndex + 1}·${u.panelNo}`;
  return { tone: mine ? 'mine' : 'ai', badge: `${mine ? '✓ ' : ''}${where}` };
}

/** Pool layout for the scene: scope filter (this event / all), then ★ groups, other groups and the rejected/hidden bucket. */
export function poolView<T extends PoolMoment>(
  moments: T[],
  scope: 'event' | 'all',
  eventId: number | null,
): { heroes: T[][]; rest: T[][]; out: T[] } {
  const scoped = moments.filter((m) => scope === 'all' || eventId === null || m.clip.event_id === eventId);
  return poolOrder(scoped) as { heroes: T[][]; rest: T[][]; out: T[] };
}
