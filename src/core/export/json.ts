import type { ExportSegment, ExportOptions } from '../../types/export.js';

export function exportJson(segments: ExportSegment[], options: ExportOptions): string {
  return JSON.stringify({
    title: options.title,
    fps: options.fps,
    segments: segments.map((seg) => ({
      position: seg.position,
      clip_id: seg.clip_id,
      file_path: seg.file_path,
      file_name: seg.file_name,
      start_sec: seg.start_sec,
      end_sec: seg.end_sec,
      duration_sec: seg.end_sec - seg.start_sec,
      fps: seg.fps,
      resolution: seg.resolution,
      quality: seg.ai_quality_overall,
      role: seg.segment_role,
      summary: seg.ai_summary,
      notes: seg.notes,
    })),
    total_duration_sec: segments.reduce((sum, s) => sum + (s.end_sec - s.start_sec), 0),
  }, null, 2);
}
