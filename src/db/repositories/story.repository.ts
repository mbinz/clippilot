import type Database from 'better-sqlite3';
import type { Story, StorySegment, StoryWithSegments } from '../../types/story.js';

export class StoryRepository {
  private stmtInsertStory: Database.Statement;
  private stmtInsertSegment: Database.Statement;
  private stmtFindStory: Database.Statement;
  private stmtFindSegments: Database.Statement;
  private stmtListByProject: Database.Statement;
  private stmtDeleteSegments: Database.Statement;

  constructor(private db: Database.Database) {
    this.stmtInsertStory = db.prepare(`
      INSERT INTO stories (project_id, name, description, target_duration_sec)
      VALUES (?, ?, ?, ?)
    `);

    this.stmtInsertSegment = db.prepare(`
      INSERT INTO story_segments (story_id, scene_id, clip_id, position, start_sec, end_sec, intent, notes, state, source)
      VALUES (?, ?, ?, ?, ?, COALESCE(?, (SELECT duration_sec FROM clips WHERE id = ?)), ?, ?, 'filled', 'user')
    `);

    this.stmtFindStory = db.prepare('SELECT * FROM stories WHERE id = ?');

    this.stmtFindSegments = db.prepare(`
      SELECT ss.id, ss.story_id, ss.clip_id, ss.position, ss.start_sec, ss.end_sec,
             ss.intent AS segment_role, ss.notes, ss.created_at, c.file_path, c.proxy_path, c.duration_sec, c.resolution, c.fps,
             c.nb_frames, c.has_video, c.has_audio, c.ai_summary, c.start_timecode
      FROM story_segments ss
      JOIN clips c ON c.id = ss.clip_id
      JOIN scenes sc ON sc.id = ss.scene_id
      WHERE ss.story_id = ? AND ss.state = 'filled'
      ORDER BY sc.position ASC, ss.position ASC
    `);

    this.stmtListByProject = db.prepare(
      'SELECT * FROM stories WHERE project_id = ? ORDER BY created_at DESC',
    );

    this.stmtDeleteSegments = db.prepare('DELETE FROM story_segments WHERE story_id = ?');
  }

  /** Flat segment API (used by export --story) lives in one implicit scene "Main". */
  private flatScene(storyId: number): number {
    const row = this.db.prepare('SELECT id FROM scenes WHERE story_id = ? ORDER BY position LIMIT 1').get(storyId) as { id: number } | undefined;
    if (row) return row.id;
    const r = this.db.prepare("INSERT INTO scenes (story_id, position, name) VALUES (?, 0, 'Main')").run(storyId);
    return Number(r.lastInsertRowid);
  }

  private insertSegment(storyId: number, clipId: number, position: number, startSec: number, endSec: number | null, role: string | null, notes: string | null): void {
    this.stmtInsertSegment.run(storyId, this.flatScene(storyId), clipId, position, startSec, endSec, clipId, role ?? '', notes);
  }

  createStory(projectId: number, name: string, description?: string, targetDuration?: number): Story {
    const result = this.stmtInsertStory.run(projectId, name, description ?? null, targetDuration ?? null);
    return this.stmtFindStory.get(result.lastInsertRowid) as Story;
  }

  addSegment(storyId: number, clipId: number, position: number, startSec: number, endSec: number | null, role?: string, notes?: string): StorySegment {
    this.insertSegment(storyId, clipId, position, startSec, endSec, role ?? null, notes ?? null);
    const id = (this.db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
    return {
      id,
      story_id: storyId,
      clip_id: clipId,
      position,
      start_sec: startSec,
      end_sec: endSec,
      segment_role: role ?? null,
      notes: notes ?? null,
      created_at: new Date().toISOString(),
    };
  }

  getStoryWithSegments(storyId: number): StoryWithSegments | null {
    const story = this.stmtFindStory.get(storyId) as Story | undefined;
    if (!story) return null;

    const segments = this.stmtFindSegments.all(storyId) as StoryWithSegments['segments'];
    return { ...story, segments };
  }

  listByProject(projectId: number): Story[] {
    return this.stmtListByProject.all(projectId) as Story[];
  }

  replaceSegments(storyId: number, segments: { clipId: number; position: number; startSec: number; endSec: number | null; role?: string; notes?: string }[]): void {
    const replaceAll = this.db.transaction(() => {
      this.stmtDeleteSegments.run(storyId);
      for (const seg of segments) {
        this.insertSegment(storyId, seg.clipId, seg.position, seg.startSec, seg.endSec, seg.role ?? null, seg.notes ?? null);
      }
    });
    replaceAll();
  }
}
