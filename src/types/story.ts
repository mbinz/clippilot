export interface Story {
  id: number;
  project_id: number;
  name: string;
  description: string | null;
  target_duration_sec: number | null;
  brief: string | null;
  brief_state: BriefState;
  created_at: string;
  updated_at: string;
}

// Storyboard vocabulary: Cut = stories, Scene = scenes, Panel = story_segments.
export type BriefState = 'none' | 'proposed' | 'confirmed';
export type PanelState = 'filled' | 'candidates' | 'gap';
export type PanelSource = 'ai' | 'user';
export type Cut = Story;

export interface Scene {
  id: number;
  story_id: number;
  position: number;
  name: string;
  event_id: number | null;
  notes: string | null;
  created_at: string;
}

export interface Panel {
  id: number;
  story_id: number;
  scene_id: number;
  position: number;
  intent: string;
  state: PanelState;
  source: PanelSource;
  clip_id: number | null;
  moment_id: number | null;
  start_sec: number | null;
  end_sec: number | null;
  speed: number;
  notes: string | null;
  created_at: string;
}
