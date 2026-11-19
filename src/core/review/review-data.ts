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
  quality: number;
}

export interface ReviewScores {
  quality: {
    stability: number | null; focus: number | null; exposure: number | null;
    composition: number | null; audio: number | null; overall: number | null;
  };
  editorial: { emotional: number | null; storytelling: number | null; uniqueness: number | null };
  quality_issues: string[];
  suggested_use: string | null;
}

export interface ReviewClip {
  clip_id: number;
  file_name: string;
  file_path: string;
  scene_hint: string | null;
  duration_sec: number;
  proxy_url: string | null;
  ai_summary: string | null;
  places: string[];
  moments: string[];
  scores: ReviewScores;
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
    // not JSON: fall through and treat as plain text
  }
  return [raw];
}

function buildScores(c: Clip): ReviewScores {
  return {
    quality: {
      stability: c.ai_quality_stability, focus: c.ai_quality_focus, exposure: c.ai_quality_exposure,
      composition: c.ai_quality_composition, audio: c.ai_quality_audio, overall: c.ai_quality_overall,
    },
    editorial: {
      emotional: c.ai_editorial_emotional, storytelling: c.ai_editorial_storytelling,
      uniqueness: c.ai_editorial_uniqueness,
    },
    quality_issues: parseIssues(c.ai_quality_issues),
    suggested_use: c.ai_editorial_suggested_use,
  };
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
        proxy_url: c.proxy_path ? pathToFileUri(c.proxy_path) : null,
        ai_summary: c.ai_summary,
        places: uniqueLowercased(scenes.map((s) => s.setting)),
        moments: uniqueLowercased(scenes.map((s) => s.activity)),
        scores: buildScores(c),
        highlights: (byClip.get(c.id) ?? [])
          .slice()
          .sort((a, b) => a.start_sec - b.start_sec || a.id - b.id)
          .map((h) => ({
            highlight_id: h.id,
            start_sec: h.start_sec,
            end_sec: h.end_sec,
            description: h.description,
            quality: h.quality,
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
