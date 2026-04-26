export type ExportFormat = 'csv' | 'json' | 'edl' | 'fcpxml';

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
  resolution: string | null;
  ai_summary: string | null;
  ai_quality_overall: number | null;
  segment_role: string | null;
  notes: string | null;
}

export interface ExportOptions {
  title: string;
  fps: number;
  format: ExportFormat;
  output?: string;
}
