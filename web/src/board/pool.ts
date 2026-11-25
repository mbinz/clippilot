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

export const similarKey = (m: PoolMoment): string => `${m.clip.event_id}|${m.role}|${m.shot}`;

/** Recording time of a moment: clip start (epoch s) + offset into the clip. */
export const recTime = (m: PoolMoment): number =>
  (Date.parse(m.clip.recorded_at ?? '') || 0) / 1000 + m.start_sec;

export const isOut = (m: PoolMoment): boolean => m.status === 'rejected' || !!m.clip.hidden;

const byTime = (a: PoolMoment, b: PoolMoment): number => recTime(a) - recTime(b);

/** Stars first (effective tier), then recording time. */
const starsThenTime = (a: PoolMoment, b: PoolMoment): number =>
  Number(isHero(b)) - Number(isHero(a)) || byTime(a, b);

export function poolOrder(moments: PoolMoment[]): { heroes: PoolMoment[][]; rest: PoolMoment[][]; out: PoolMoment[] } {
  const vis = moments.filter((m) => !isOut(m));
  const out = moments.filter(isOut);
  const start = new Map<string, number>();
  for (const m of vis) {
    const k = similarKey(m);
    start.set(k, Math.min(start.get(k) ?? Infinity, recTime(m)));
  }
  const groups = (ms: PoolMoment[]): PoolMoment[][] => {
    const sorted = [...ms].sort((a, b) =>
      (start.get(similarKey(a))! - start.get(similarKey(b))!) || byTime(a, b));
    const g: PoolMoment[][] = [];
    for (const m of sorted) {
      const last = g[g.length - 1];
      if (last && similarKey(last[0]) === similarKey(m)) last.push(m); else g.push([m]);
    }
    return g;
  };
  return { heroes: groups(vis.filter(isHero)), rest: groups(vis.filter((m) => !isHero(m))), out };
}

export function alternatives(m: PoolMoment, moments: PoolMoment[]): PoolMoment[] {
  const k = similarKey(m);
  return moments.filter((x) => x.id !== m.id && !isOut(x) && similarKey(x) === k).sort(starsThenTime);
}

/** The moment a panel shows: filled -> its moment, candidates -> first candidate. */
function panelMomentId(p: PoolPanel): number | null {
  if (p.state === 'filled') return p.moment_id;
  if (p.state === 'candidates') return p.candidates[0]?.id ?? null;
  return null;
}

/**
 * The panel a moment would compete for: the filled panel using it; else a panel whose moment is similar
 * (preferring `currentSceneId`); else null.
 */
export function slotFor(m: PoolMoment, tree: PoolTree, moments: PoolMoment[], currentSceneId?: number): number | null {
  for (const s of tree.scenes) for (const p of s.panels) if (p.state === 'filled' && p.moment_id === m.id) return p.id;
  const byId = new Map(moments.map((x) => [x.id, x]));
  const k = similarKey(m);
  const sib: { sceneId: number; panelId: number }[] = [];
  for (const s of tree.scenes) {
    for (const p of s.panels) {
      const id = panelMomentId(p);
      const pm = id == null ? undefined : byId.get(id);
      if (pm && similarKey(pm) === k) sib.push({ sceneId: s.id, panelId: p.id });
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
