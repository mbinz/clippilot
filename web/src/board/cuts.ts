/** Which cut the board shows: pure helpers (the URL param `?cut=<id>` and resolution against the project's cuts). */

export interface CutRef {
  id: number;
  project_id: number;
  name: string;
}

export const MAIN_CUT = 'Main';

/** `?cut=7` -> 7; anything missing, non-numeric or <= 0 -> null. */
export function cutParam(search: string): number | null {
  const raw = new URLSearchParams(search).get('cut');
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 ? n : null;
}

/** The param's cut if it belongs to the project, else "Main", else null (the caller creates "Main"). */
export function resolveCut<C extends CutRef>(cuts: C[], param: number | null): C | null {
  return (param !== null ? cuts.find((c) => c.id === param) : undefined)
    ?? cuts.find((c) => c.name === MAIN_CUT)
    ?? null;
}

/** New query string with `cut` set to `id`, or removed when `id` is Main's id. Other params are kept. */
export function searchWithCut(search: string, id: number, mainId: number | null): string {
  const p = new URLSearchParams(search);
  if (id === mainId) p.delete('cut');
  else p.set('cut', String(id));
  const s = p.toString();
  return s ? `?${s}` : '';
}
