import type { Head, SelectionBody } from './refresh';
import type { BoardMoment, Brief, CutTree, HistoryState, Tier } from './types';

const BASE = '/api';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: body === undefined ? undefined : JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `API error ${res.status}`);
  return (json as { data: T }).data;
}

/** Every mutating route returns the changed row plus the cut's history state. */
export type Mutation<T = Record<string, unknown>> = T & { history: HistoryState };

export interface CutSummary {
  id: number;
  project_id: number;
  name: string;
}

export const fetchCuts = (projectId: number) => call<CutSummary[]>('GET', `/projects/${projectId}/cuts`);
export const createCut = (projectId: number, name: string) => call<CutSummary>('POST', `/projects/${projectId}/cuts`, { name });
export const fetchTree = (cutId: number) => call<CutTree>('GET', `/cuts/${cutId}`);
/** Cheap change marker of the cut's undo history (live refresh polls this). */
export const fetchHead = (cutId: number) => call<Head>('GET', `/cuts/${cutId}/head`);
/** What the board has selected, for `clippilot board context`. Board state: not logged, not undoable. */
export const putSelection = (s: SelectionBody) => call<unknown>('PUT', '/board/selection', s);
export const fetchHistory = (cutId: number) =>
  call<{ id: number; label: string; undone: boolean; created_at: string }[]>('GET', `/cuts/${cutId}/history`);

/** All moments of the project including rejected and hidden ones; the board filters them client-side. */
export const fetchMoments = (projectId: number) =>
  call<BoardMoment[]>('GET', `/projects/${projectId}/moments?include_rejected=1&include_hidden=1`);

/** Spoken words of a clip (whisper); `{ transcript: null }` when it has none. */
export type ClipTranscript = { transcript: null } | { language: string; segments: { start: number; end: number; text: string }[] };
export const fetchTranscript = (clipId: number) => call<ClipTranscript>('GET', `/clips/${clipId}/transcript`);

/** Board state, not an edit: not logged, not undoable. */
export const markSeen = (momentId: number, seen: boolean) =>
  call<{ id: number; seen: boolean }>('POST', `/moments/${momentId}/seen`, { seen });
/** "Show in Finder" (macOS `open -R`). */
export const revealClip = (clipId: number) => call<{ ok: true; path: string }>('POST', `/clips/${clipId}/reveal`);

export const undoCut = (cutId: number) => call<Mutation<{ label: string }>>('POST', `/cuts/${cutId}/undo`);
export const redoCut = (cutId: number) => call<Mutation<{ label: string }>>('POST', `/cuts/${cutId}/redo`);

export const addScene = (cutId: number, name: string, position?: number, eventId?: number | null) =>
  call<Mutation<{ id: number }>>('POST', `/cuts/${cutId}/scenes`, { name, position, event_id: eventId ?? undefined });
export const renameScene = (sceneId: number, name: string) => call<Mutation>('PATCH', `/scenes/${sceneId}`, { name });
export const moveScene = (sceneId: number, position: number) => call<Mutation>('POST', `/scenes/${sceneId}/move`, { position });
export const deleteScene = (sceneId: number) => call<Mutation>('DELETE', `/scenes/${sceneId}`);

export const addPanel = (sceneId: number, input: { intent?: string; moment_id?: number; position?: number }) =>
  call<Mutation<{ id: number }>>('POST', `/scenes/${sceneId}/panels`, input);
export const patchPanel = (panelId: number, patch: { intent?: string }) =>
  call<Mutation>('PATCH', `/panels/${panelId}`, patch);
export interface MomentPatch {
  start_sec?: number;
  end_sec?: number;
  speed?: number;
  /** User tier: 'hero' = star; null = back to the AI tier. */
  tier?: Tier | null;
}
/** The moment is the edit: in/out and speed are set on the moment (every panel using it follows). */
export const patchMoment = (momentId: number, cutId: number, patch: MomentPatch) =>
  call<Mutation>('PATCH', `/moments/${momentId}`, { cut_id: cutId, ...patch });
/** BE4: a new moment from a selection on a clip's timeline (yours: confirmed, tier solid). Its look fingerprint follows in the background. */
export const createMoment = (clipId: number, cutId: number, startSec: number, endSec: number) =>
  call<Mutation<{ id: number }>>('POST', `/clips/${clipId}/moments`, { cut_id: cutId, start_sec: startSec, end_sec: endSec });
export const movePanel = (panelId: number, sceneId: number, position: number) =>
  call<Mutation>('POST', `/panels/${panelId}/move`, { scene_id: sceneId, position });
export const placeMoment = (panelId: number, momentId: number) =>
  call<Mutation>('POST', `/panels/${panelId}/place`, { moment_id: momentId });
export const pickCandidate = (panelId: number, momentId: number) =>
  call<Mutation>('POST', `/panels/${panelId}/pick`, { moment_id: momentId });
export const deletePanel = (panelId: number) => call<Mutation>('DELETE', `/panels/${panelId}`);

export const rejectMoment = (momentId: number, cutId: number, reason: string) =>
  call<Mutation>('POST', `/moments/${momentId}/reject`, { cut_id: cutId, reason });
export const unrejectMoment = (momentId: number, cutId: number) =>
  call<Mutation>('POST', `/moments/${momentId}/unreject`, { cut_id: cutId });
export const hideClip = (clipId: number, cutId: number) => call<Mutation>('POST', `/clips/${clipId}/hide`, { cut_id: cutId });
export const unhideClip = (clipId: number, cutId: number) => call<Mutation>('POST', `/clips/${clipId}/unhide`, { cut_id: cutId });

export const saveBrief = (cutId: number, brief: Brief, state: 'proposed' | 'confirmed') =>
  call<Mutation>('PUT', `/cuts/${cutId}/brief`, { brief, state });

export const exportCut = (cutId: number, format: 'otio' = 'otio') =>
  call<{ path: string; format: string; fps: number; clips: number; scenes: number; skipped_gaps: number }>(
    'POST', `/cuts/${cutId}/export`, { format });
