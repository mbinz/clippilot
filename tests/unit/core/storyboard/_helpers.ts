import Database from 'better-sqlite3';
import { runMigrations } from '../../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../../src/db/repositories/clip.repository.js';
import { ProjectRepository } from '../../../../src/db/repositories/project.repository.js';
import { HighlightRepository, type InsertHighlight } from '../../../../src/db/repositories/highlight.repository.js';
import { StoryboardService } from '../../../../src/core/storyboard/service.js';

export function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const clips = new ClipRepository(db);
  const highlights = new HighlightRepository(db);
  const projectId = new ProjectRepository(db).findOrCreate('p').id;
  let n = 0;
  const addClip = (opts: { fps?: number; duration?: number; projectId?: number } = {}) =>
    clips.insert({
      project_id: opts.projectId ?? projectId, file_path: `/v/c${++n}.mp4`, proxy_path: null, file_hash: `h${n}`,
      file_size: 1, duration_sec: opts.duration ?? 30, resolution: '1920x1080', fps: opts.fps ?? 25,
      nb_frames: null, has_video: 1, has_audio: 1, codec: null, recorded_at: null, start_timecode: null,
      location: null, manual_tags: null, people: null,
    });
  /** Adds moments to a clip (replacing none: appends via a combined replace) and returns their ids. */
  const addMoments = (clipId: number, items: Partial<InsertHighlight>[]) => {
    const existing = highlights.findByClip(clipId).map((h) => ({
      start_sec: h.start_sec, end_sec: h.end_sec, description: h.description, tier: h.tier,
      suggested_speed: h.suggested_speed,
    }));
    highlights.replaceForClip(clipId, [
      ...existing,
      ...items.map((i, k) => ({ start_sec: 1 + k * 5, end_sec: 5 + k * 5, description: 'm', tier: 'solid' as const, ...i })),
    ]);
    return highlights.findByClip(clipId).slice(existing.length).map((h) => h.id);
  };
  return { db, svc: new StoryboardService(db), projectId, addClip, addMoments };
}
