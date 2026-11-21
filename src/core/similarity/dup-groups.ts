import { UnionFind } from './union-find.js';
import { dhash, hamming } from './dhash.js';
import type { ClipRepository } from '../../db/repositories/clip.repository.js';
import type { HighlightRepository } from '../../db/repositories/highlight.repository.js';
import type { ThumbnailRepository } from '../../db/repositories/thumbnail.repository.js';

export interface DupMoment {
  id: number;
  clip_id: number;
  start_sec: number;
  end_sec: number;
  /** Clip start (wall clock); moment times are offsets from it. */
  recorded_at: string | null;
  hash: bigint | null;
}

const MIN_OVERLAP_MS = 1000;
const MAX_HAMMING = 6;

function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Group moments of different clips that likely show the same thing: wall-clock overlap >= 1 s,
 * or similar thumbnails (dHash Hamming <= 6) on the same local day. Returns moment id -> group
 * number (1..n by lowest moment id); singletons are absent.
 */
export function assignDupGroups(moments: DupMoment[]): Map<number, number> {
  const prepared = moments.map((m) => {
    const base = m.recorded_at ? new Date(m.recorded_at).getTime() : NaN;
    const ok = Number.isFinite(base);
    return {
      m,
      from: ok ? base + m.start_sec * 1000 : NaN,
      to: ok ? base + m.end_sec * 1000 : NaN,
      day: ok ? localDay(base) : null,
    };
  });

  const uf = new UnionFind();
  for (const p of prepared) uf.makeSet(p.m.id);

  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const a = prepared[i];
      const b = prepared[j];
      if (a.m.clip_id === b.m.clip_id || a.day === null || b.day === null) continue;
      const overlap = Math.min(a.to, b.to) - Math.max(a.from, b.from);
      const similar =
        a.m.hash !== null && b.m.hash !== null && a.day === b.day && hamming(a.m.hash, b.m.hash) <= MAX_HAMMING;
      if (overlap >= MIN_OVERLAP_MS || similar) uf.union(a.m.id, b.m.id);
    }
  }

  const clusters = [...uf.clusters().values()]
    .filter((ids) => ids.length > 1)
    .map((ids) => Math.min(...ids))
    .sort((x, y) => x - y);
  const numberByMin = new Map(clusters.map((min, i) => [min, i + 1]));

  const result = new Map<number, number>();
  for (const ids of uf.clusters().values()) {
    if (ids.length < 2) continue;
    const n = numberByMin.get(Math.min(...ids))!;
    for (const id of ids) result.set(id, n);
  }
  return result;
}

/** Recompute and persist duplicate groups for a project from its moments and clip thumbnails. */
export async function recomputeDupGroups(
  projectId: number,
  repos: { clips: ClipRepository; highlights: HighlightRepository; thumbnails: ThumbnailRepository },
  hashFn: (path: string) => Promise<bigint> = dhash,
): Promise<void> {
  const clipById = new Map(repos.clips.listByProject(projectId).map((c) => [c.id, c]));
  const thumbsByClip = new Map<number, ReturnType<ThumbnailRepository['findByClip']>>();

  const moments: DupMoment[] = [];
  for (const h of repos.highlights.listByProject(projectId)) {
    const clip = clipById.get(h.clip_id);
    if (!clip) continue;
    let thumbs = thumbsByClip.get(h.clip_id);
    if (!thumbs) {
      thumbs = repos.thumbnails.findByClip(h.clip_id);
      thumbsByClip.set(h.clip_id, thumbs);
    }
    const mid = (h.start_sec + h.end_sec) / 2;
    let nearest: (typeof thumbs)[number] | null = null;
    for (const t of thumbs) {
      if (!nearest || Math.abs(t.timestamp_sec - mid) < Math.abs(nearest.timestamp_sec - mid)) nearest = t;
    }
    let hash: bigint | null = null;
    if (nearest) {
      try {
        hash = await hashFn(nearest.file_path);
      } catch {
        hash = null;
      }
    }
    moments.push({
      id: h.id, clip_id: h.clip_id, start_sec: h.start_sec, end_sec: h.end_sec,
      recorded_at: clip.recorded_at, hash,
    });
  }

  repos.highlights.setDupGroups(projectId, assignDupGroups(moments));
}
