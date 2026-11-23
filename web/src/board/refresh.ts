// Pure decide-logic for the board's live refresh (M8) and the selection sync.

/** `GET /cuts/:id/head`: cheap change marker of a cut's undo history. */
export interface Head {
  /** Latest operation id (undone ones included); null when the cut has no operations. */
  op_id: number | null;
  can_undo: boolean;
  can_redo: boolean;
  undo_label: string | null;
  redo_label: string | null;
}

const same = (a: Head, b: Head): boolean =>
  a.op_id === b.op_id && a.can_undo === b.can_undo && a.can_redo === b.can_redo
  && a.undo_label === b.undo_label && a.redo_label === b.redo_label;

/**
 * Refetch when the head changed and the change did not come from this tab.
 * `prev` is the last head this tab has seen (null before the first one); `own` is the head observed right after this
 * tab's own last action (its edit, undo or redo): reaching exactly that head is our own doing.
 */
export function shouldRefetch(prev: Head | null, next: Head, own: Head | null): boolean {
  if (prev === null) return false;
  if (same(prev, next)) return false;
  if (own !== null && same(own, next)) return false;
  return true;
}

/** Toast text for an outside change: the new operation's label, or "Undo <label>" / "Redo <label>". */
export function updateLabel(prev: Head | null, next: Head): string {
  if (prev === null || next.op_id !== prev.op_id) return next.undo_label ?? 'board';
  if (next.can_redo && next.redo_label && next.redo_label !== prev.redo_label) return `Undo ${next.redo_label}`;
  if (next.undo_label) return `Redo ${next.undo_label}`;
  return 'board';
}

export interface SelectionBody {
  cut_id: number;
  scene_id: number;
  panel_id: number | null;
  moment_id: number | null;
  drawer: 'panel' | 'moment' | null;
  preview_moment_id: number | null;
}

/** Stable key: the board only PUTs the selection when this changes. */
export const selectionKey = (s: SelectionBody): string =>
  [s.cut_id, s.scene_id, s.panel_id, s.moment_id, s.drawer, s.preview_moment_id].join('|');
