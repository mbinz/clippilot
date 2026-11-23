// Pure board logic (no React, no DOM): tested from the root vitest in tests/unit/web/board-logic.test.ts.
import type { BoardPanel, BoardScene } from './types';

export interface PanelRange {
  clipId: number;
  a: number;
  b: number;
  speed: number;
}

/** What a panel plays: the range and speed of its moment (the moment is the edit); for candidates the first one's. */
export function panelRange(p: BoardPanel): PanelRange | null {
  if (p.state === 'filled' && p.clip_id !== null && p.start_sec !== null && p.end_sec !== null) {
    return { clipId: p.clip_id, a: p.start_sec, b: p.end_sec, speed: p.speed };
  }
  if (p.state === 'candidates' && p.candidates.length > 0) {
    const m = p.candidates[0];
    return { clipId: m.clip_id, a: m.start_sec, b: m.end_sec, speed: m.speed };
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

/** m:ss */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** One decimal, e.g. "3.1 s". */
export const fmtSec = (sec: number): string => `${sec.toFixed(1)} s`;
