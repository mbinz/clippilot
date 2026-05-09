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
  ingested_at: string;
  analysis_status: AnalysisStatus;
  analysis_error: string | null;
  location: string | null;
  manual_tags: string | null;
  people: string | null;
  ai_scenes: string | null;
  ai_summary: string | null;
  ai_quality_stability: number | null;
  ai_quality_focus: number | null;
  ai_quality_exposure: number | null;
  ai_quality_composition: number | null;
  ai_quality_audio: number | null;
  ai_quality_overall: number | null;
  ai_quality_issues: string | null;
  ai_editorial_emotional: number | null;
  ai_editorial_storytelling: number | null;
  ai_editorial_uniqueness: number | null;
  ai_editorial_suggested_use: string | null;
  ai_visual_keywords: string | null;
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
}

export interface ClipAnalysis {
  ai_scenes: string;
  ai_summary: string;
  ai_quality_stability: number;
  ai_quality_focus: number;
  ai_quality_exposure: number;
  ai_quality_composition: number;
  ai_quality_audio: number;
  ai_quality_overall: number;
  ai_quality_issues: string;
  ai_editorial_emotional: number;
  ai_editorial_storytelling: number;
  ai_editorial_uniqueness: number;
  ai_editorial_suggested_use: string;
  ai_visual_keywords: string;
}

export interface SearchFilters {
  project_id?: number;
  min_quality?: number;
  suggested_use?: string;
  location?: string;
  sort?: 'quality' | 'date' | 'emotional' | 'duration';
  limit?: number;
}
