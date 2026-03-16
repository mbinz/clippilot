export interface Story {
  id: number;
  project_id: number;
  name: string;
  description: string | null;
  target_duration_sec: number | null;
  created_at: string;
  updated_at: string;
}

export interface StorySegment {
  id: number;
  story_id: number;
  clip_id: number;
  position: number;
  start_sec: number;
  end_sec: number | null;
  segment_role: string | null;
  notes: string | null;
  created_at: string;
}

export interface StoryWithSegments extends Story {
  segments: (StorySegment & {
    file_path: string;
    proxy_path: string | null;
    duration_sec: number;
    resolution: string | null;
    fps: number | null;
    ai_summary: string | null;
  })[];
}
