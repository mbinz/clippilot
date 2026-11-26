import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api';
import type { BoardMoment, CutTree, HistoryState } from './types';
import { cutParam, resolveCut, searchWithCut } from './cuts';
import { shouldRefetch, updateLabel, type Head } from './refresh';

const POLL_MS = 2000;

const NO_HISTORY: HistoryState = { can_undo: false, can_redo: false, undo_label: null, redo_label: null };

export interface Toast {
  text: string;
  /** Offer an "Undo" button (after an edit). */
  undo: boolean;
  /** Bumps on every toast so identical texts restart the timer. */
  n: number;
  /** Stay visible longer (long messages such as an export path). */
  sticky?: boolean;
}

/**
 * Board state for a project's "Main" cut: tree + moment pool + undo history.
 * No optimistic updates: every action calls the API, then refetches the tree (and moments when they can change).
 */
export function useBoard(projectId: number | undefined) {
  const [cutId, setCutId] = useState<number | null>(null);
  const [cuts, setCuts] = useState<api.CutSummary[]>([]);
  /** The cut asked for in the URL (`?cut=<id>`); null = Main. Resolved against the project's cuts on load. */
  const [wantedCut, setWantedCut] = useState<number | null>(() => cutParam(window.location.search));
  const [tree, setTree] = useState<CutTree | null>(null);
  const [moments, setMoments] = useState<BoardMoment[]>([]);
  const [history, setHistory] = useState<HistoryState>(NO_HISTORY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastN = useRef(0);
  /** Last head seen from the server (baseline for live refresh), the head after this tab's last own action, and busy flags. */
  const headRef = useRef<Head | null>(null);
  const ownRef = useRef<Head | null>(null);
  const busy = useRef(0);

  const say = useCallback((text: string, undo = false, sticky = false) => {
    setToast({ text, undo, sticky, n: ++toastN.current });
  }, []);

  const reload = useCallback(async (id: number, pid: number) => {
    const [t, ms, h] = await Promise.all([api.fetchTree(id), api.fetchMoments(pid), api.fetchHead(id)]);
    setTree(t);
    setMoments(ms);
    headRef.current = h;
    setHistory({ can_undo: h.can_undo, can_redo: h.can_redo, undo_label: h.undo_label, redo_label: h.redo_label });
  }, []);

  // Live refresh: poll the cut's head every 2 s while the tab is visible; an outside change (CLI / Claude) refetches.
  useEffect(() => {
    if (cutId === null || projectId === undefined) return;
    let stopped = false;
    let polling = false;
    const poll = async () => {
      if (stopped || polling || document.hidden || busy.current > 0) return;
      polling = true;
      try {
        const next = await api.fetchHead(cutId);
        if (stopped || busy.current > 0) return;
        const prev = headRef.current;
        if (shouldRefetch(prev, next, ownRef.current)) {
          await reload(cutId, projectId);
          say(`Updated: ${updateLabel(prev, next)}`);
        } else {
          headRef.current = next;
        }
      } catch {
        // transient (server restarting, cut deleted): try again on the next tick
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(() => void poll(), POLL_MS);
    const onVisible = () => { if (!document.hidden) void poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [cutId, projectId, reload, say]);

  /** Run one of this tab's own actions: polls pause meanwhile, and the head it ends on is remembered as "ours". */
  const own = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    busy.current++;
    try {
      return await fn();
    } finally {
      ownRef.current = headRef.current;
      busy.current--;
    }
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
        const chosen = resolveCut(cuts, wantedCut);
        const all = chosen ? cuts : [...cuts, await api.createCut(projectId, 'Main')];
        const cut = chosen ?? all[all.length - 1]!;
        if (cancelled) return;
        setCuts(all);
        setCutId(cut.id);
        await reload(cut.id, projectId);
        if (!cancelled) setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, wantedCut, reload]);

  /** Show another cut of this project; the choice goes into the URL so a reload keeps it. */
  const selectCut = useCallback((id: number) => {
    const mainId = cuts.find((c) => c.name === 'Main')?.id ?? null;
    try {
      window.history.replaceState(null, '', `${window.location.pathname}${searchWithCut(window.location.search, id, mainId)}${window.location.hash}`);
    } catch { /* URL is a convenience only */ }
    setWantedCut(id === mainId ? null : id);
  }, [cuts]);

  /** Run a mutation; on success adopt its history state, refetch, and (optionally) toast the label. */
  const act = useCallback(async <T extends { history?: HistoryState }>(label: string | null, fn: () => Promise<T>): Promise<T | null> => {
    if (cutId === null || projectId === undefined) return null;
    try {
      const res = await own(async () => {
        const r = await fn();
        await reload(cutId, projectId);
        return r;
      });
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
  }, [cutId, projectId, reload, say, own]);

  /** Seen is board state, not an edit: optimistic local update, no refetch, not undoable. */
  const momentsRef = useRef(moments);
  momentsRef.current = moments;
  const setSeen = useCallback((id: number, seen: boolean) => {
    const cur = momentsRef.current.find((m) => m.id === id);
    if (!cur || cur.seen === seen) return;
    setMoments((ms) => ms.map((m) => (m.id === id ? { ...m, seen } : m)));
    api.markSeen(id, seen).catch(() => {});
  }, []);

  /**
   * A new moment's look fingerprint is computed in the background after the request (it changes no undo head), so the
   * pool's similar ids / look groups are fetched again a few times shortly afterwards.
   */
  const laterTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => laterTimers.current.forEach(clearTimeout), [projectId]);
  const refreshMomentsLater = useCallback((pid: number) => {
    for (const ms of [4000, 12000, 40000]) {
      laterTimers.current.push(setTimeout(() => {
        if (busy.current > 0) return;
        api.fetchMoments(pid).then(setMoments).catch(() => {});
      }, ms));
    }
  }, []);

  const undo = useCallback(async () => {
    if (cutId === null || projectId === undefined) return;
    try {
      const r = await own(async () => {
        const res = await api.undoCut(cutId);
        await reload(cutId, projectId);
        return res;
      });
      setHistory(r.history);
      say(`Undone: ${r.label}`);
    } catch (err) {
      say(err instanceof Error ? err.message : String(err));
    }
  }, [cutId, projectId, reload, say, own]);

  const redo = useCallback(async () => {
    if (cutId === null || projectId === undefined) return;
    try {
      const r = await own(async () => {
        const res = await api.redoCut(cutId);
        await reload(cutId, projectId);
        return res;
      });
      setHistory(r.history);
      say(`Redone: ${r.label}`);
    } catch (err) {
      say(err instanceof Error ? err.message : String(err));
    }
  }, [cutId, projectId, reload, say, own]);

  return {
    cutId, cuts, selectCut, tree, moments, history, loading, error, toast, say,
    dismissToast: () => setToast(null),
    undo, redo, act, setSeen,
    actions: {
      addScene: (name: string, position?: number, eventId?: number | null) =>
        act(`Add scene "${name}"`, () => api.addScene(cutId!, name, position, eventId)),
      renameScene: (id: number, name: string) => act(`Rename scene to "${name}"`, () => api.renameScene(id, name)),
      moveScene: (id: number, position: number) => act('Move scene', () => api.moveScene(id, position)),
      deleteScene: (id: number, name: string) => act(`Delete scene "${name}"`, () => api.deleteScene(id)),
      addPanel: (sceneId: number, input: { intent?: string; moment_id?: number; position?: number }, label = 'Add panel') =>
        act(label, () => api.addPanel(sceneId, input)),
      patchPanel: (id: number, patch: { intent?: string }, label: string) =>
        act(label, () => api.patchPanel(id, patch)),
      patchMoment: (id: number, patch: api.MomentPatch, label: string) =>
        act(label, () => api.patchMoment(id, cutId!, patch)),
      createMoment: async (clipId: number, startSec: number, endSec: number) => {
        const r = await act('New moment', () => api.createMoment(clipId, cutId!, startSec, endSec));
        if (r && projectId !== undefined) refreshMomentsLater(projectId);
        return r;
      },
      movePanel: (id: number, sceneId: number, position: number) => act('Move panel', () => api.movePanel(id, sceneId, position)),
      placeMoment: (panelId: number, momentId: number, label: string) => act(label, () => api.placeMoment(panelId, momentId)),
      pickCandidate: (panelId: number, momentId: number) => act('Choose candidate', () => api.pickCandidate(panelId, momentId)),
      deletePanel: (id: number, no: number) => act(`Delete panel ${no}`, () => api.deletePanel(id)),
      rejectMoment: (id: number, reason: string) => act(`\u{1F44E} ${reason}`, () => api.rejectMoment(id, cutId!, reason)),
      unrejectMoment: (id: number) => act('Undo \u{1F44E}', () => api.unrejectMoment(id, cutId!)),
      hideClip: (id: number, name: string) => act(`Hide clip ${name}`, () => api.hideClip(id, cutId!)),
      unhideClip: (id: number, name: string) => act(`Unhide clip ${name}`, () => api.unhideClip(id, cutId!)),
      saveBrief: (brief: Parameters<typeof api.saveBrief>[1], state: 'proposed' | 'confirmed') =>
        act(state === 'confirmed' ? 'Confirm brief' : 'Save brief', () => api.saveBrief(cutId!, brief, state)),
    },
  };
}
