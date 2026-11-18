import type { Clip } from '../types/clip.js';
import type { HighlightRepository } from '../db/repositories/highlight.repository.js';
import type { ThumbnailRepository } from '../db/repositories/thumbnail.repository.js';

export type ClipJson = Omit<
  Clip,
  | 'manual_tags'
  | 'people'
  | 'ai_scenes'
  | 'ai_quality_issues'
  | 'ai_visual_keywords'
> & {
  manual_tags: unknown;
  people: unknown;
  ai_scenes: unknown;
  ai_quality_issues: unknown;
  ai_visual_keywords: unknown;
  thumbnails?: string[];
  highlights?: HighlightJson[];
};

export interface HighlightJson {
  id: number;
  start_sec: number;
  end_sec: number;
  description: string;
  quality: number;
}

export function highlightsToJson(
  items: { id: number; start_sec: number; end_sec: number; description: string; quality: number }[],
): HighlightJson[] {
  return items.map(({ id, start_sec, end_sec, description, quality }) => ({
    id, start_sec, end_sec, description, quality,
  }));
}

export function clipToJson(
  clip: Clip,
  thumbnails?: string[],
  highlights?: HighlightJson[],
): ClipJson {
  const out: ClipJson = {
    ...clip,
    manual_tags: parseJson(clip.manual_tags),
    people: parseJson(clip.people),
    ai_scenes: parseJson(clip.ai_scenes),
    ai_quality_issues: parseJson(clip.ai_quality_issues),
    ai_visual_keywords: parseJson(clip.ai_visual_keywords),
  };
  if (thumbnails) out.thumbnails = thumbnails;
  if (highlights) out.highlights = highlights;
  return out;
}

export function clipsToJson(
  clips: Clip[],
  thumbnailRepo?: ThumbnailRepository,
  highlightRepo?: HighlightRepository,
): ClipJson[] {
  return clips.map((c) =>
    clipToJson(
      c,
      thumbnailRepo
        ? thumbnailRepo.findByClip(c.id).map((t) => t.file_path)
        : undefined,
      highlightRepo ? highlightsToJson(highlightRepo.findByClip(c.id)) : undefined,
    ),
  );
}

function parseJson(value: string | null): unknown {
  if (value == null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
