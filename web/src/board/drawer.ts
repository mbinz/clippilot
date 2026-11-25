// Pure decision logic for the two drawers and the pool of Board v3 (no React, no DOM).
// Tested in tests/unit/web/board-drawer.test.ts; ported from mockups/scene-board-v3.html.
import {
  alternatives, isHero, isOut, otherInEvent, poolOrder, recTime, slotFor, usage,
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
 * Options grid: the moment in the story first, then similar shots (by look, nearest first); a candidate panel lists its candidates
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

/** Collapsed "other moments in this event" of the panel drawer: event moments not among the options, by time. */
export function otherOptions<T extends PoolMoment>(o: { options: T[]; base: T | null; moments: T[] }): T[] {
  if (!o.base) return [];
  const have = new Set(o.options.map((x) => x.id));
  return (otherInEvent(o.base, o.moments) as T[]).filter((x) => !have.has(x.id));
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

/* ---------- transcript ("Spoken" block) ---------- */

export interface SpokenSegment { start: number; end: number; text: string }
export interface TranscriptPart { text: string; start: number; inMoment: boolean }

/** The clip's segments as running text parts; those overlapping [start, end] are in the moment. `cut` = a segment crosses a boundary. */
export function transcriptView(
  segments: SpokenSegment[], start: number, end: number,
): { parts: TranscriptPart[]; cut: null | 'start' | 'end' | 'both' } {
  const parts = segments.map((s) => ({ text: s.text, start: s.start, inMoment: s.end > start && s.start < end }));
  const atStart = segments.some((s) => s.start < start && s.end > start);
  const atEnd = segments.some((s) => s.start < end && s.end > end);
  return { parts, cut: atStart && atEnd ? 'both' : atStart ? 'start' : atEnd ? 'end' : null };
}

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
  inCut: ReadonlySet<number> = new Set(),
): { heroes: T[][]; rest: T[][]; out: T[]; inStory: number } {
  const scoped = moments.filter((m) => scope === 'all' || eventId === null || m.clip.event_id === eventId);
  // The pool lists what is still unused: moments in any panel of the cut leave it (the drawers still show them).
  const unused = scoped.filter((m) => !inCut.has(m.id));
  const order = poolOrder(unused) as { heroes: T[][]; rest: T[][]; out: T[] };
  return { ...order, inStory: scoped.length - unused.length };
}

/* ---------- shakes (single jolts measured on the clip) ---------- */

export interface ShakeInfo {
  start: number;
  end: number;
  peak_at: number;
  /** Peak shake speed, % of frame width per second. */
  strength: number;
  jump_pct: number;
  jump_px: number;
  confidence: 'high' | 'low';
  moving_scene: boolean;
}

export interface ShakeMark { left: number; width: number; low: boolean; at: number }

/** Ticks on the clip timeline (in % of the clip) for the shakes overlapping the visible range `range`. */
export function shakeMarks(
  shakes: ShakeInfo[] | null | undefined,
  range: { a: number; b: number },
  duration: number,
): ShakeMark[] {
  if (!shakes || duration <= 0) return [];
  return shakes
    .filter((k) => k.start < range.b && k.end > range.a)
    .map((k) => ({
      left: (k.start / duration) * 100,
      width: Math.max(((k.end - k.start) / duration) * 100, 0.3),
      low: k.confidence === 'low',
      at: k.peak_at,
    }));
}

const clock1 = (sec: number): string => {
  const m = Math.floor(sec / 60);
  return `${m}:${(sec - m * 60).toFixed(1).padStart(4, '0')}`;
};

/** One quiet line per shake: "Shake 0:04.2 · jump 3 % (58 px) · low confidence — moving scene". */
export function shakeLine(k: ShakeInfo): string {
  const pct = k.jump_pct >= 1 ? String(Math.round(k.jump_pct)) : k.jump_pct.toFixed(1);
  const low = k.confidence === 'low' ? ` · low confidence${k.moving_scene ? ' — moving scene' : ''}` : '';
  return `Shake ${clock1(k.peak_at)} · jump ${pct} % (${Math.round(k.jump_px)} px)${low}`;
}

/** The jitter band line of the drawer's motion block, or null when the moment is not measured. */
export function jitterLine(j: { score: number; band: string } | null | undefined): string | null {
  return j ? `Jitter ${j.band} · ${j.score.toFixed(2)} %` : null;
}

/** Shake fit result of a moment as the drawer prints it ("Shake kept - note" / "Shake trimmed out"); null when clean or not checked. */
export function shakeFitLine(m: { shake_status?: string | null; shake_note?: string | null }): string | null {
  if (m.shake_status === 'fixed') return 'Shake trimmed out';
  if (m.shake_status === 'kept') return m.shake_note ? `Shake kept \u2014 ${m.shake_note}` : 'Shake kept';
  return null;
}

/**
 * Tooltip of the small neutral icon on a tile, or null when there is none: the moment's jitter band is `shaky`, it
 * contains a high-confidence shake, or the shake fit kept a shake in it (details live in the drawer).
 */
export function shakeHint(m: {
  jitter?: { score: number; band: string } | null; shakes?: ShakeInfo[] | null; shake_status?: string | null; shake_note?: string | null;
}): string | null {
  const shaky = m.jitter?.band === 'shaky';
  const high = (m.shakes ?? []).filter((k) => k.confidence === 'high');
  const kept = m.shake_status === 'kept';
  if (!shaky && high.length === 0 && !kept) return null;
  const lines = [shaky ? jitterLine(m.jitter) : null, ...high.map(shakeLine), kept ? shakeFitLine(m) : null].filter((l): l is string => l !== null);
  return `${shaky ? 'Shaky' : 'Shake'} \u00b7 ${lines.join(' \u00b7 ')}`;
}
