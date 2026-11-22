// Pure board logic (no React, no DOM): tested from the root vitest in tests/unit/web/board-logic.test.ts.
import type { BoardMoment, BoardPanel, BoardScene } from './types';

export interface PanelRange {
  clipId: number;
  a: number;
  b: number;
  speed: number;
}

/** What a panel plays: its own range when filled, the first candidate's range (at its suggested speed) otherwise. */
export function panelRange(p: BoardPanel): PanelRange | null {
  if (p.state === 'filled' && p.clip_id !== null && p.start_sec !== null && p.end_sec !== null) {
    return { clipId: p.clip_id, a: p.start_sec, b: p.end_sec, speed: p.speed };
  }
  if (p.state === 'candidates' && p.candidates.length > 0) {
    const m = p.candidates[0];
    return { clipId: m.clip_id, a: m.start_sec, b: m.end_sec, speed: m.suggested_speed || 1 };
  }
  return null;
}

/** Length on the timeline in seconds (range / speed); gaps are 0. */
export function panelLength(p: BoardPanel): number {
  const r = panelRange(p);
  return r ? (r.b - r.a) / r.speed : 0;
}

export const sceneLength = (s: BoardScene): number => s.panels.reduce((t, p) => t + panelLength(p), 0);
export const cutLength = (scenes: BoardScene[]): number => scenes.reduce((t, s) => t + sceneLength(s), 0);

/** The header turns amber when the cut runs more than 10 % over the brief's target. */
export const isOverTarget = (total: number, target: number): boolean => target > 0 && total > target * 1.1;

/** Whether footage at `fps` has enough frames for `speed` (mirrors speedAllowed on the server). */
export function speedOk(fps: number | null | undefined, speed: number): boolean {
  if (speed === 1) return true;
  if (speed === 0.5) return !!fps && fps >= 48;
  if (speed === 0.25) return !!fps && fps >= 90;
  return false;
}

/** A moment's suggested speed, or 1 when the clip's frame rate cannot support it. */
export const firstSpeed = (suggested: number, fps: number | null | undefined): number =>
  speedOk(fps, suggested) ? suggested : 1;

export interface ChooseItem {
  sceneIndex: number;
  sceneId: number;
  panelId: number;
  panelNo: number;
}

/** Panels still showing candidates, in cut order. */
export function toChoose(scenes: BoardScene[]): ChooseItem[] {
  const out: ChooseItem[] = [];
  scenes.forEach((s, sceneIndex) => s.panels.forEach((p, i) => {
    if (p.state === 'candidates') out.push({ sceneIndex, sceneId: s.id, panelId: p.id, panelNo: i + 1 });
  }));
  return out;
}

/** Moments in the cut: green ("mine") when the panel was confirmed by the user, violet ("ai") when proposed. */
export function usageOf(scenes: BoardScene[]): Record<number, 'mine' | 'ai'> {
  const u: Record<number, 'mine' | 'ai'> = {};
  for (const s of scenes) for (const p of s.panels) {
    if (p.state === 'filled' && p.moment_id !== null) u[p.moment_id] = p.source === 'user' ? 'mine' : 'ai';
  }
  return u;
}

export const ROLES = ['establishing', 'action', 'reaction', 'detail', 'transition'] as const;
const TIER_RANK: Record<string, number> = { hero: 0, solid: 1, filler: 2 };

export interface RoleGroup {
  role: string;
  main: BoardMoment[];
  filler: BoardMoment[];
  total: number;
}

export interface PoolGroups {
  roles: RoleGroup[];
  /** Rejected moments and moments of hidden clips (behind the "rejected / hidden" link). */
  hidden: BoardMoment[];
}

export const isMomentHidden = (m: BoardMoment): boolean => m.status === 'rejected' || Boolean(m.clip?.hidden);

/** Pool layout: moments by role (hero first, then solid; filler separate), event-scoped or all. */
export function groupMoments(
  moments: BoardMoment[],
  opts: { scope: 'event' | 'all'; eventId: number | null },
): PoolGroups {
  const scoped = moments.filter((m) => opts.scope === 'all' || opts.eventId === null || m.event_id === opts.eventId);
  const visible = scoped.filter((m) => !isMomentHidden(m));
  const hidden = scoped.filter(isMomentHidden);
  const present = new Set(visible.map((m) => m.role ?? 'other'));
  const order = [...ROLES.filter((r) => present.has(r)), ...[...present].filter((r) => !(ROLES as readonly string[]).includes(r))];
  const roles = order.map<RoleGroup>((role) => {
    const ms = visible
      .filter((m) => (m.role ?? 'other') === role)
      .sort((x, y) => (TIER_RANK[x.tier] ?? 1) - (TIER_RANK[y.tier] ?? 1) || x.clip_id - y.clip_id);
    return { role, main: ms.filter((m) => m.tier !== 'filler'), filler: ms.filter((m) => m.tier === 'filler'), total: ms.length };
  });
  return { roles, hidden };
}

/** m:ss */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** One decimal, e.g. "3.1 s". */
export const fmtSec = (sec: number): string => `${sec.toFixed(1)} s`;
