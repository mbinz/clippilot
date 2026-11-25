// Pure pool / drawer logic for Board v3, ported from mockups/scene-board-v3.html.
// Structural input types so it works with today's board types and the fields B1/B2 add.

export type PoolTier = 'hero' | 'solid' | 'filler';

export interface PoolMoment {
  id: number;
  clip_id: number;
  start_sec: number;
  end_sec: number;
  tier: string;
  user_tier?: PoolTier | null;
  role: string | null;
  shot: string | null;
  status: string;
  seen?: boolean;
  /** Ids of similar moments by look (server-computed, nearest first); missing/empty = none (no fingerprint). */
  similar_ids?: number[];
  /** Look group id (server-computed, SM-7); missing/null = alone or no fingerprint. */
  look_group?: number | null;
  clip: { event_id: number | null; recorded_at: string | null; hidden: boolean | number };
}

export interface PoolPanel {
  id: number;
  state: 'filled' | 'candidates' | 'gap';
  source: string;
  moment_id: number | null;
  candidates: { id: number }[];
}
export interface PoolTree { scenes: { id: number; panels: PoolPanel[] }[] }

export const effectiveTier = (m: Pick<PoolMoment, 'tier' | 'user_tier'>): string => m.user_tier ?? m.tier;
export const isHero = (m: Pick<PoolMoment, 'tier' | 'user_tier'>): boolean => effectiveTier(m) === 'hero';

/** Grouping key: the look group, or the moment alone. */
const groupKey = (m: PoolMoment): string => (m.look_group == null ? `m${m.id}` : `g${m.look_group}`);

/** Recording time of a moment: clip start (epoch s) + offset into the clip. */
export const recTime = (m: PoolMoment): number =>
  (Date.parse(m.clip.recorded_at ?? '') || 0) / 1000 + m.start_sec;

export const isOut = (m: PoolMoment): boolean => m.status === 'rejected' || !!m.clip.hidden;

const byTime = (a: PoolMoment, b: PoolMoment): number => recTime(a) - recTime(b) || a.id - b.id;

/** Stars first (effective tier), then recording time. */
const starsThenTime = (a: PoolMoment, b: PoolMoment): number =>
  Number(isHero(b)) - Number(isHero(a)) || byTime(a, b);

/**
 * Pool sections (SM-8): moments grouped by look group. A group with any ★ sits in the ★ section (starred takes first,
 * then recording time), all others in the rest; groups ordered by the earliest recording time of their visible members.
 */
export function poolOrder(moments: PoolMoment[]): { heroes: PoolMoment[][]; rest: PoolMoment[][]; out: PoolMoment[] } {
  const vis = moments.filter((m) => !isOut(m));
  const out = moments.filter(isOut);
  const byGroup = new Map<string, PoolMoment[]>();
  for (const m of vis) {
    const k = groupKey(m);
    const g = byGroup.get(k);
    if (g) g.push(m); else byGroup.set(k, [m]);
  }
  const groups = [...byGroup.values()].map((g) => g.sort(starsThenTime));
  const start = (g: PoolMoment[]): number => Math.min(...g.map(recTime));
  const firstId = (g: PoolMoment[]): number => Math.min(...g.map((m) => m.id));
  groups.sort((a, b) => start(a) - start(b) || firstId(a) - firstId(b));
  return { heroes: groups.filter((g) => g.some(isHero)), rest: groups.filter((g) => !g.some(isHero)), out };
}

/** Similar moments (by look, nearest first) as the server ranked them; out moments and unknown ids are dropped. */
export function alternatives(m: PoolMoment, moments: PoolMoment[]): PoolMoment[] {
  const byId = new Map(moments.map((x) => [x.id, x]));
  return (m.similar_ids ?? [])
    .map((id) => byId.get(id))
    .filter((x): x is PoolMoment => !!x && x.id !== m.id && !isOut(x));
}

/** The rest of the moment's event (not out, not similar), by recording time. */
export function otherInEvent(m: PoolMoment, moments: PoolMoment[]): PoolMoment[] {
  const sim = new Set(m.similar_ids ?? []);
  return moments
    .filter((x) => x.id !== m.id && !isOut(x) && x.clip.event_id === m.clip.event_id && !sim.has(x.id))
    .sort(byTime);
}

/** The moment a panel shows: filled -> its moment, candidates -> first candidate. */
function panelMomentId(p: PoolPanel): number | null {
  if (p.state === 'filled') return p.moment_id;
  if (p.state === 'candidates') return p.candidates[0]?.id ?? null;
  return null;
}

/**
 * The panel a moment would compete for: the filled panel using it; else a panel whose moment is in the same look group
 * (preferring `currentSceneId`); else null.
 */
export function slotFor(m: PoolMoment, tree: PoolTree, moments: PoolMoment[], currentSceneId?: number): number | null {
  for (const s of tree.scenes) for (const p of s.panels) if (p.state === 'filled' && p.moment_id === m.id) return p.id;
  const byId = new Map(moments.map((x) => [x.id, x]));
  if (m.look_group == null) return null;
  const sib: { sceneId: number; panelId: number }[] = [];
  for (const s of tree.scenes) {
    for (const p of s.panels) {
      const id = panelMomentId(p);
      const pm = id == null ? undefined : byId.get(id);
      if (pm && pm.look_group === m.look_group) sib.push({ sceneId: s.id, panelId: p.id });
    }
  }
  return (sib.find((x) => x.sceneId === currentSceneId) ?? sib[0])?.panelId ?? null;
}

export interface UsageEntry { panelId: number; sceneIndex: number; panelNo: number; source: string }

/** moment id -> first filled panel using it (cut order). */
export function usage(tree: PoolTree): Record<number, UsageEntry> {
  const u: Record<number, UsageEntry> = {};
  tree.scenes.forEach((s, sceneIndex) => s.panels.forEach((p, i) => {
    if (p.state === 'filled' && p.moment_id != null && !u[p.moment_id]) {
      u[p.moment_id] = { panelId: p.id, sceneIndex, panelNo: i + 1, source: p.source };
    }
  }));
  return u;
}

/** Unseen tiles are greyed out (seen ones show in colour); in-story, hovered or selected tiles never are. */
export function fades(
  _m: PoolMoment,
  s: { inStory: boolean; seen: boolean; hovered: boolean; selected: boolean },
): boolean {
  return !s.seen && !s.inStory && !s.hovered && !s.selected;
}

/** Player time correction: while not `free`, loop back to `a` at/after `b` or when well before `a`. */
export function loopStep(t: number, a: number, b: number, free: boolean): { t: number; free: boolean } {
  if (!free && (t >= b || t < a - 0.3)) return { t: a, free };
  return { t, free };
}

/**
 * Where the player must jump to now, or null to leave the video alone. Read `currentTime` ONCE and pass it in:
 * Safari advances currentTime between reads, so comparing against a second read seeks on every timeupdate.
 */
export function loopSeekTarget(t: number, a: number, b: number, free: boolean): number | null {
  const s = loopStep(t, a, b, free);
  return s.t === t ? null : s.t;
}

/** After a seek: free (play on) when outside [a-0.05, b+0.05]; inside, loop again. */
export function seekState(t: number, a: number, b: number): boolean {
  return t < a - 0.05 || t > b + 0.05;
}
