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
      INSERT INTO story_segments (story_id, clip_id, position, start_sec, end_sec, segment_role, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtFindStory = db.prepare('SELECT * FROM stories WHERE id = ?');

    this.stmtFindSegments = db.prepare(`
      SELECT ss.*, c.file_path, c.proxy_path, c.duration_sec, c.resolution, c.fps, c.ai_summary, c.start_timecode
      FROM story_segments ss
      JOIN clips c ON c.id = ss.clip_id
      WHERE ss.story_id = ?
      ORDER BY ss.position ASC
    `);

    this.stmtListByProject = db.prepare(
      'SELECT * FROM stories WHERE project_id = ? ORDER BY created_at DESC',
    );

    this.stmtDeleteSegments = db.prepare('DELETE FROM story_segments WHERE story_id = ?');
  }

  createStory(projectId: number, name: string, description?: string, targetDuration?: number): Story {
    const result = this.stmtInsertStory.run(projectId, name, description ?? null, targetDuration ?? null);
    return this.stmtFindStory.get(result.lastInsertRowid) as Story;
  }

  addSegment(storyId: number, clipId: number, position: number, startSec: number, endSec: number | null, role?: string, notes?: string): StorySegment {
    const result = this.stmtInsertSegment.run(storyId, clipId, position, startSec, endSec, role ?? null, notes ?? null);
    return {
      id: result.lastInsertRowid as number,
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
        this.stmtInsertSegment.run(storyId, seg.clipId, seg.position, seg.startSec, seg.endSec, seg.role ?? null, seg.notes ?? null);
      }
    });
    replaceAll();
  }
}
