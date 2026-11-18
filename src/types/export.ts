export type ExportFormat = 'csv' | 'json' | 'edl' | 'fcpxml' | 'otio';

export interface ExportSegment {
  position: number;
  clip_id: number;
  file_path: string;
  file_name: string;
  duration_sec: number;
  start_sec: number;
  end_sec: number;
  start_timecode: string | null;
  nb_frames: number | null;
  fps: number;
  has_video: boolean;
  has_audio: boolean;
  resolution: string | null;
  ai_summary: string | null;
  ai_quality_overall: number | null;
  segment_role: string | null;
  notes: string | null;
  /** Playback speed, 1.0 = real time, 0.5 = half speed (slow motion). Default 1. */
  speed?: number;
  /** Scene this segment belongs to; FCPXML gets a marker at the first segment of each scene. */
  scene_name?: string | null;
}

export interface ExportOptions {
  title: string;
  fps: number;
  width?: number;
  height?: number;
  format: ExportFormat;
  output?: string;
}
