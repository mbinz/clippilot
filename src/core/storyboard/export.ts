import path from 'node:path';
import type Database from 'better-sqlite3';
import type { Clip } from '../../types/clip.js';
import type { ExportSegment } from '../../types/export.js';
import { StoryboardService } from './service.js';

/**
 * Flatten a cut into export segments in scene/panel order. A panel only points at a moment, so filled panels
 * export their moment's clip/in/out/speed and candidate panels their first candidate's; gaps are skipped.
 * The first segment of each scene carries the scene name (the exporters turn it into a marker).
 */
export function cutToSegments(
  db: Database.Database,
  cutId: number,
  opts: { fallbackFps?: number | null } = {},
): { segments: ExportSegment[]; skipped_gaps: number } {
  const tree = new StoryboardService(db).getCut(cutId);
  if (!tree) throw new Error(`Cut ${cutId} not found`);
  const clipStmt = db.prepare('SELECT * FROM clips WHERE id = ?');

  const segments: ExportSegment[] = [];
  let skipped = 0;
  for (const scene of tree.scenes) {
    let first = true;
    for (const panel of scene.panels) {
      let clipId: number | null = null;
      let start = 0;
      let end = 0;
      let speed = 1;
      if (panel.state === 'filled') {
        clipId = panel.clip_id;
        start = panel.start_sec!;
        end = panel.end_sec!;
        speed = panel.speed;
      } else if (panel.state === 'candidates' && panel.candidates.length > 0) {
        const m = panel.candidates[0];
        clipId = m.clip_id;
        start = m.start_sec;
        end = m.end_sec;
        speed = m.speed;
      }
      if (clipId === null) {
        skipped++;
        continue;
      }
      const clip = clipStmt.get(clipId) as Clip;
      segments.push({
        position: segments.length + 1,
        clip_id: clip.id,
        file_path: clip.file_path,
        file_name: path.basename(clip.file_path),
        duration_sec: clip.duration_sec,
        start_sec: start,
        end_sec: end,
        start_timecode: clip.start_timecode ?? null,
        nb_frames: clip.nb_frames ?? null,
        fps: clip.fps ?? opts.fallbackFps ?? 0,
        has_video: clip.has_video !== 0,
        has_audio: clip.has_audio !== 0,
        resolution: clip.resolution,
        ai_summary: clip.ai_summary,
        segment_role: panel.intent || null,
        notes: panel.notes,
        speed,
        scene_name: first ? scene.name : null,
      });
      first = false;
    }
  }
  return { segments, skipped_gaps: skipped };
}
