import type { Tier } from '../core/tiers.js';

export interface Clip {
  id: number;
  project_id: number | null;
  file_path: string;
  proxy_path: string | null;
  file_hash: string;
  file_size: number;
  duration_sec: number;
  resolution: string | null;
  fps: number | null;
  codec: string | null;
  recorded_at: string | null;
  start_timecode: string | null;
  nb_frames: number | null;
  has_video: number;
  has_audio: number;
  scene_hint: string | null;
  ingested_at: string;
  analysis_status: AnalysisStatus;
  analysis_error: string | null;
  location: string | null;
  manual_tags: string | null;
  people: string | null;
  ai_scenes: string | null;
  ai_summary: string | null;
  ai_visual_keywords: string | null;
  analysis_profile_version: number | null;
  event_id: number | null;
  hidden: number;
  /** Spoken words (whisper); mirrored from `transcripts` for the clip search. */
  transcript_text: string | null;
}

export type AnalysisStatus = 'pending' | 'analyzing' | 'done' | 'error';

export interface ClipMetadata {
  duration_sec: number;
  resolution: string;
  fps: number;
  nb_frames: number;
  codec: string;
  recorded_at: string | null;
  start_timecode: string | null;
  file_size: number;
  has_video: boolean;
  has_audio: boolean;
}

export interface InsertClip {
  project_id: number | null;
  file_path: string;
  proxy_path: string | null;
  file_hash: string;
  file_size: number;
  duration_sec: number;
  resolution: string | null;
  fps: number | null;
  nb_frames: number | null;
  has_video: number;
  has_audio: number;
  codec: string | null;
  recorded_at: string | null;
  start_timecode: string | null;
  location: string | null;
  manual_tags: string | null;
  people: string | null;
  scene_hint?: string | null;
}

export interface ClipAnalysis {
  ai_scenes: string;
  ai_summary: string;
  ai_visual_keywords: string;
  analysis_profile_version?: number | null;
}

export interface SearchFilters {
  project_id?: number;
  min_tier?: Tier;
  location?: string;
  sort?: 'date' | 'duration';
  limit?: number;
}
