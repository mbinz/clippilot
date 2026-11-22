import type { BoardMoment, BoardPanel } from '../../board/types';

/** Poster and proxy for what a panel plays (its own clip, or the first candidate). */
export function panelMedia(p: BoardPanel, byId: Map<number, BoardMoment>): { poster: string | null; src: string | null } {
  if (p.state === 'filled') {
    return { poster: (p.moment_id !== null ? byId.get(p.moment_id)?.thumbnail : null) ?? p.clip?.thumbnail ?? null, src: p.clip?.proxy_url ?? null };
  }
  if (p.state === 'candidates' && p.candidates.length) {
    const c = p.candidates[0];
    return { poster: byId.get(c.id)?.thumbnail ?? c.thumbnail, src: c.proxy_url ?? c.clip?.proxy_url ?? null };
  }
  return { poster: null, src: null };
}

export const baseName = (filePath: string): string => filePath.slice(filePath.lastIndexOf('/') + 1);
