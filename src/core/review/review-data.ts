import path from 'node:path';
import type { Clip } from '../../types/clip.js';
import type { HighlightRecord } from '../../db/repositories/highlight.repository.js';
import { pathToFileUri } from '../../utils/fs.js';
import { parseScenes, splitTags } from '../summary.js';

export interface ReviewHighlight {
  highlight_id: number;
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
}

export interface ReviewClip {
  clip_id: number;
  file_name: string;
  file_path: string;
  scene_hint: string | null;
  duration_sec: number;
  fps: number | null;
  proxy_url: string | null;
  ai_summary: string | null;
  places: string[];
  moments: string[];
  highlights: ReviewHighlight[];
}

export interface ReviewData {
  project: string;
  generated_at: string;
  clips: ReviewClip[];
}

function uniqueLowercased(raws: unknown[]): string[] {
  const out = new Set<string>();
  for (const raw of raws) for (const tag of splitTags(raw)) out.add(tag.toLowerCase());
  return [...out];
}

function parseIssues(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.map(String);
  } catch {
    // broken JSON: no issues
  }
  return [];
}

/** Analyzed clips (also those without highlights), sorted by scene_hint then file name. */
export function buildReviewData(
  clips: Clip[],
  highlights: HighlightRecord[],
  meta: { project: string; generated_at: string },
  clipIds?: number[],
): ReviewData {
  const only = clipIds ? new Set(clipIds) : null;
  const byClip = new Map<number, HighlightRecord[]>();
  for (const h of highlights) {
    const list = byClip.get(h.clip_id) ?? [];
    list.push(h);
    byClip.set(h.clip_id, list);
  }

  const reviewClips = clips
    .filter((c) => c.analysis_status === 'done' && (!only || only.has(c.id)))
    .map((c): ReviewClip => {
      const scenes = parseScenes(c.ai_scenes);
      return {
        clip_id: c.id,
        file_name: path.basename(c.file_path),
        file_path: c.file_path,
        scene_hint: c.scene_hint,
        duration_sec: c.duration_sec,
        fps: c.fps,
        proxy_url: c.proxy_path ? pathToFileUri(c.proxy_path) : null,
        ai_summary: c.ai_summary,
        places: uniqueLowercased(scenes.map((s) => s.setting)),
        moments: uniqueLowercased(scenes.map((s) => s.activity)),
        highlights: (byClip.get(c.id) ?? [])
          .slice()
          .sort((a, b) => a.start_sec - b.start_sec || a.id - b.id)
          .map((h) => ({
            highlight_id: h.id,
            start_sec: h.start_sec,
            end_sec: h.end_sec,
            description: h.description,
            tier: h.tier,
            shot: h.shot,
            role: h.role,
            issues: parseIssues(h.issues),
            slowmo: h.slowmo,
            slowmo_reason: h.slowmo_reason,
            suggested_speed: h.suggested_speed,
            audio_keep: Boolean(h.audio_keep),
            audio_type: h.audio_type,
          })),
      };
    });

  reviewClips.sort((a, b) => {
    if (a.scene_hint !== b.scene_hint) {
      if (a.scene_hint === null) return 1;
      if (b.scene_hint === null) return -1;
      return a.scene_hint.localeCompare(b.scene_hint);
    }
    return a.file_name.localeCompare(b.file_name);
  });

  return { project: meta.project, generated_at: meta.generated_at, clips: reviewClips };
}
