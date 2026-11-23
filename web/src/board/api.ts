import type { BoardMoment, Brief, CutTree, HistoryState } from './types';

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
export const fetchHistory = (cutId: number) =>
  call<{ id: number; label: string; undone: boolean; created_at: string }[]>('GET', `/cuts/${cutId}/history`);

/** All moments of the project including rejected and hidden ones; the board filters them client-side. */
export const fetchMoments = (projectId: number) =>
  call<BoardMoment[]>('GET', `/projects/${projectId}/moments?include_rejected=1&include_hidden=1`);

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
/** The moment is the edit: in/out and speed are set on the moment (every panel using it follows). */
export const patchMoment = (momentId: number, cutId: number, patch: { start_sec?: number; end_sec?: number; speed?: number }) =>
  call<Mutation>('PATCH', `/moments/${momentId}`, { cut_id: cutId, ...patch });
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
