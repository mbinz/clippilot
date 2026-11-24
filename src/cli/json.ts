import type { Clip } from '../types/clip.js';
import type { HighlightRepository } from '../db/repositories/highlight.repository.js';
import type { ThumbnailRepository } from '../db/repositories/thumbnail.repository.js';

export type ClipJson = Omit<
  Clip,
  | 'manual_tags'
  | 'people'
  | 'ai_scenes'
  | 'ai_visual_keywords'
  | 'transcript_text'
> & {
  manual_tags: unknown;
  people: unknown;
  ai_scenes: unknown;
  ai_visual_keywords: unknown;
  thumbnails?: string[];
  highlights?: HighlightJson[];
  /** First 200 characters of the spoken words (only where asked for). */
  transcript_excerpt?: string;
};

export interface HighlightJson {
  id: number;
  start_sec: number;
  end_sec: number;
  description: string;
  tier: string;
  shot: string | null;
  role: string | null;
  issues: string[];
  slowmo: string;
  slowmo_reason: string;
  suggested_speed: number;
  audio_keep: boolean;
  audio_type: string;
  dup_group: number | null;
}

/** DB records carry `issues` as a JSON string; the CLI emits a real array. */
export function highlightsToJson(
  items: Array<Omit<HighlightJson, 'issues' | 'audio_keep' | 'dup_group'> & { issues: string | string[]; audio_keep: boolean | number; dup_group?: number | null }>,
): HighlightJson[] {
  return items.map(({ id, start_sec, end_sec, description, tier, shot, role, issues, slowmo, slowmo_reason, suggested_speed, audio_keep, audio_type, dup_group }) => ({
    id, start_sec, end_sec, description, tier, shot, role,
    issues: typeof issues === 'string' ? (parseJson(issues) as string[] | null) ?? [] : issues,
    slowmo, slowmo_reason, suggested_speed,
    audio_keep: Boolean(audio_keep), audio_type, dup_group: dup_group ?? null,
  }));
}

export function clipToJson(
  clip: Clip,
  thumbnails?: string[],
  highlights?: HighlightJson[],
  opts: { excerpt?: boolean } = {},
): ClipJson {
  const { transcript_text, ...rest } = clip;
  const out: ClipJson = {
    ...rest,
    manual_tags: parseJson(clip.manual_tags),
    people: parseJson(clip.people),
    ai_scenes: parseJson(clip.ai_scenes),
    ai_visual_keywords: parseJson(clip.ai_visual_keywords),
  };
  if (thumbnails) out.thumbnails = thumbnails;
  if (highlights) out.highlights = highlights;
  if (opts.excerpt && transcript_text) out.transcript_excerpt = transcript_text.slice(0, 200);
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
