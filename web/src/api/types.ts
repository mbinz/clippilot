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
  ingested_at: string;
  analysis_status: 'pending' | 'analyzing' | 'done' | 'error';
  analysis_error: string | null;
  location: string | null;
  manual_tags: string[] | null;
  people: string[] | null;
  ai_scenes: Scene[] | null;
  ai_summary: string | null;
  ai_quality_stability: number | null;
  ai_quality_focus: number | null;
  ai_quality_exposure: number | null;
  ai_quality_composition: number | null;
  ai_quality_audio: number | null;
  ai_quality_overall: number | null;
  ai_quality_issues: string[] | null;
  ai_editorial_emotional: number | null;
  ai_editorial_storytelling: number | null;
  ai_editorial_uniqueness: number | null;
  ai_editorial_suggested_use: string | null;
  ai_visual_keywords: string[] | null;
}

export interface Scene {
  start_sec: number;
  end_sec: number;
  description_de: string;
  description_en: string;
  subjects: string[];
  setting: string;
  activity: string;
  mood: string;
  visual_keywords: string[];
}

export interface Project {
  id: number;
  name: string;
  created_at: string;
}

export interface Thumbnail {
  id: number;
  clip_id: number;
  timestamp_sec: number;
  url: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
  };
}

export interface ApiResponse<T> {
  data: T;
}

export interface Facets {
  locations: string[];
  suggested_uses: string[];
  tags: string[];
  people: string[];
  moods: string[];
}

export interface SimilarityCluster {
  id: number;
  project_id: number | null;
  reason: string;
  computed_at: string;
  members: SimilarityMember[];
}

export interface SimilarityMember {
  id: number;
  group_id: number;
  clip_id: number;
  is_best: number;
  similarity_score: number;
}

export interface ClipSearchParams {
  q?: string;
  project_id?: number;
  location?: string;
  date_from?: string;
  date_to?: string;
  min_quality?: number;
  max_quality?: number;
  tags?: string[];
  people?: string[];
  suggested_use?: string;
  mood?: string;
  sort?: 'quality' | 'date' | 'emotional' | 'duration';
  sort_dir?: 'asc' | 'desc';
  page?: number;
  per_page?: number;
}
