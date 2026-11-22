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
  /** Adds moments to a clip (keeping existing ones) and returns their ids. */
  const addMoments = (clipId: number, items: Partial<InsertHighlight>[]) => {
    const existing = highlights.findByClip(clipId).length;
    const ins = db.prepare(`INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier, suggested_speed)
      VALUES (?, ?, ?, ?, ?, ?)`);
    return items.map((i, k) => {
      const m = { start_sec: 1 + (existing + k) * 5, end_sec: 5 + (existing + k) * 5, description: 'm', tier: 'solid', suggested_speed: 1, ...i };
      return Number(ins.run(clipId, m.start_sec, m.end_sec, m.description, m.tier, m.suggested_speed).lastInsertRowid);
    });
  };
  return { db, svc: new StoryboardService(db), projectId, addClip, addMoments };
}
