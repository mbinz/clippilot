/** Drag payload type of a panel (moments use plain `text/plain` = moment id). */
export const PANEL_MIME = 'application/x-clippilot-panel';

/** What is being dragged, from `DataTransfer.types` (readable during dragover; the data itself is not). */
export function dragKind(types: readonly string[]): 'panel' | 'moment' | null {
  if (types.includes(PANEL_MIME)) return 'panel';
  if (types.includes('text/plain')) return 'moment';
  return null;
}

/**
 * Position to send to `POST /panels/:id/move` when `draggedId` is dropped on insert slot `slotIndex`
 * (slot i = before panel i; slot n = after the last). Null = no-op (the panel's own neighbouring slots).
 * A panel from another scene (not in `panelIds`) lands exactly at the slot index.
 */
export function moveTarget(panelIds: readonly number[], draggedId: number, slotIndex: number): number | null {
  const from = panelIds.indexOf(draggedId);
  if (from < 0) return slotIndex;
  if (slotIndex === from || slotIndex === from + 1) return null;
  return slotIndex > from ? slotIndex - 1 : slotIndex;
}
