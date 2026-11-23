/** Shapes the board gets from the cut / moments routes (see src/core/server/routes/cuts.ts). */

export type Tier = 'hero' | 'solid' | 'filler';
export type PanelState = 'filled' | 'candidates' | 'gap';

export interface HistoryState {
  can_undo: boolean;
  can_redo: boolean;
  undo_label: string | null;
  redo_label: string | null;
}

export interface ClipInfo {
  id: number;
  file_name: string;
  duration_sec: number;
  fps: number | null;
  proxy_url: string | null;
  hidden: boolean;
  recorded_at: string | null;
  event_id: number | null;
}

/** A moment as listed for the pool (GET /projects/:id/moments). */
export interface BoardMoment {
  id: number;
  clip_id: number;
  event_id: number | null;
  start_sec: number;
  end_sec: number;
  /** The moment's playback speed (the edit). */
  speed: number;
  /** The analysis' original in/out. */
  ai_start_sec: number;
  ai_end_sec: number;
  /** Effective tier (`user_tier ?? ai_tier`). */
  tier: Tier | string;
  ai_tier: Tier | string;
  user_tier: Tier | null;
  seen: boolean;
  shot: string | null;
  role: string | null;
  issues: string[];
  slowmo: string;
  suggested_speed: number;
  audio_keep: boolean;
  audio_type: string;
  status: string;
  description: string;
  thumbnail: string | null;
  clip: ClipInfo | null;
}

/** A candidate moment inside a cut tree (raw highlight row plus media). */
export interface TreeMoment {
  id: number;
  clip_id: number;
  start_sec: number;
  end_sec: number;
  description: string;
  tier: string;
  suggested_speed: number;
  /** The moment's playback speed (the edit). */
  speed: number;
  thumbnail: string | null;
  proxy_url: string | null;
  clip: ClipInfo | null;
}

export interface PanelClip {
  id: number;
  file_path: string;
  duration_sec: number;
  fps: number | null;
  hidden: number;
  thumbnail: string | null;
  proxy_url: string | null;
}

export interface BoardPanel {
  id: number;
  scene_id: number;
  position: number;
  intent: string;
  state: PanelState;
  source: 'ai' | 'user';
  clip_id: number | null;
  moment_id: number | null;
  start_sec: number | null;
  end_sec: number | null;
  speed: number;
  clip: PanelClip | null;
  moment: { id: number; description: string; tier: string; suggested_speed: number } | null;
  candidates: TreeMoment[];
}

export interface BoardScene {
  id: number;
  position: number;
  name: string;
  event_id: number | null;
  event: { id: number; name: string } | null;
  panels: BoardPanel[];
}

export interface Brief {
  target_sec: number;
  audience: string;
  mood: string;
  must_have: { moment_id?: number; text: string }[];
  ending: string;
  notes?: string;
}

export interface CutTree {
  cut: { id: number; project_id: number; name: string };
  brief: Brief | null;
  brief_state: 'none' | 'proposed' | 'confirmed';
  scenes: BoardScene[];
  totals: { panels: number; filled: number; candidates: number; gaps: number; duration_sec: number };
}

/** A moment whose clip is known (every moment the server lists has one). */
export type PM = BoardMoment & { clip: ClipInfo };
