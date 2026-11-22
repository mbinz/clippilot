import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api';
import type { BoardMoment, CutTree, HistoryState } from './types';

const NO_HISTORY: HistoryState = { can_undo: false, can_redo: false, undo_label: null, redo_label: null };

export interface Toast {
  text: string;
  /** Offer an "Undo" button (after an edit). */
  undo: boolean;
  /** Bumps on every toast so identical texts restart the timer. */
  n: number;
}

/**
 * Board state for a project's "Main" cut: tree + moment pool + undo history.
 * No optimistic updates: every action calls the API, then refetches the tree (and moments when they can change).
 */
export function useBoard(projectId: number | undefined) {
  const [cutId, setCutId] = useState<number | null>(null);
  const [tree, setTree] = useState<CutTree | null>(null);
  const [moments, setMoments] = useState<BoardMoment[]>([]);
  const [history, setHistory] = useState<HistoryState>(NO_HISTORY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastN = useRef(0);

  const say = useCallback((text: string, undo = false) => {
    setToast({ text, undo, n: ++toastN.current });
  }, []);

  const reload = useCallback(async (id: number, pid: number) => {
    const [t, ms, h] = await Promise.all([api.fetchTree(id), api.fetchMoments(pid), api.fetchHistory(id)]);
    setTree(t);
    setMoments(ms);
    setHistory({
      can_undo: h.some((o) => !o.undone),
      can_redo: h.some((o) => o.undone),
      undo_label: h.find((o) => !o.undone)?.label ?? null,
      redo_label: [...h].reverse().find((o) => o.undone)?.label ?? null,
    });
  }, []);

  // Resolve (or create) the project's "Main" cut, then load everything.
  useEffect(() => {
    setCutId(null);
    setTree(null);
    setMoments([]);
    setHistory(NO_HISTORY);
    if (projectId === undefined) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const cuts = await api.fetchCuts(projectId);
        const main = cuts.find((c) => c.name === 'Main') ?? (await api.createCut(projectId, 'Main'));
        if (cancelled) return;
        setCutId(main.id);
        await reload(main.id, projectId);
        if (!cancelled) setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, reload]);

  /** Run a mutation; on success adopt its history state, refetch, and (optionally) toast the label. */
  const act = useCallback(async <T extends { history?: HistoryState }>(label: string | null, fn: () => Promise<T>): Promise<T | null> => {
    if (cutId === null || projectId === undefined) return null;
    try {
      const res = await fn();
      await reload(cutId, projectId);
      if (res.history) setHistory(res.history);
      setError(null);
      if (label) say(label, true);
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      say(msg);
      return null;
    }
  }, [cutId, projectId, reload, say]);

  const undo = useCallback(async () => {
    if (cutId === null || projectId === undefined) return;
    try {
      const r = await api.undoCut(cutId);
      await reload(cutId, projectId);
      setHistory(r.history);
      say(`Undone: ${r.label}`);
    } catch (err) {
      say(err instanceof Error ? err.message : String(err));
    }
  }, [cutId, projectId, reload, say]);

  const redo = useCallback(async () => {
    if (cutId === null || projectId === undefined) return;
    try {
      const r = await api.redoCut(cutId);
      await reload(cutId, projectId);
      setHistory(r.history);
      say(`Redone: ${r.label}`);
    } catch (err) {
      say(err instanceof Error ? err.message : String(err));
    }
  }, [cutId, projectId, reload, say]);

  return {
    cutId, tree, moments, history, loading, error, toast, say,
    dismissToast: () => setToast(null),
    undo, redo, act,
    actions: {
      addScene: (name: string, position?: number) => act(`Add scene "${name}"`, () => api.addScene(cutId!, name, position)),
      renameScene: (id: number, name: string) => act(`Rename scene to "${name}"`, () => api.renameScene(id, name)),
      moveScene: (id: number, position: number) => act('Move scene', () => api.moveScene(id, position)),
      deleteScene: (id: number, name: string) => act(`Delete scene "${name}"`, () => api.deleteScene(id)),
      addPanel: (sceneId: number, input: { intent?: string; moment_id?: number; position?: number }, label = 'Add panel') =>
        act(label, () => api.addPanel(sceneId, input)),
      patchPanel: (id: number, patch: { intent?: string; start_sec?: number; end_sec?: number; speed?: number }, label: string) =>
        act(label, () => api.patchPanel(id, patch)),
      movePanel: (id: number, sceneId: number, position: number) => act('Move panel', () => api.movePanel(id, sceneId, position)),
      placeMoment: (panelId: number, momentId: number, label: string) => act(label, () => api.placeMoment(panelId, momentId)),
      pickCandidate: (panelId: number, momentId: number) => act('Choose candidate', () => api.pickCandidate(panelId, momentId)),
      deletePanel: (id: number, no: number) => act(`Delete panel ${no}`, () => api.deletePanel(id)),
      rejectMoment: (id: number, reason: string) => act(`\u{1F44E} ${reason}`, () => api.rejectMoment(id, cutId!, reason)),
      hideClip: (id: number, name: string) => act(`Hide clip ${name}`, () => api.hideClip(id, cutId!)),
      unhideClip: (id: number, name: string) => act(`Unhide clip ${name}`, () => api.unhideClip(id, cutId!)),
      saveBrief: (brief: Parameters<typeof api.saveBrief>[1], state: 'proposed' | 'confirmed') =>
        act(state === 'confirmed' ? 'Confirm brief' : 'Save brief', () => api.saveBrief(cutId!, brief, state)),
    },
  };
}
