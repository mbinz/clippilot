import type Database from 'better-sqlite3';
import type { Story } from '../../types/story.js';

/** Cut rows only. Scenes, panels and export reads go through `StoryboardService`. */
export class StoryRepository {
  private stmtInsertStory: Database.Statement;
  private stmtFindStory: Database.Statement;
  private stmtListByProject: Database.Statement;

  constructor(db: Database.Database) {
    this.stmtInsertStory = db.prepare(`
      INSERT INTO stories (project_id, name, description, target_duration_sec)
      VALUES (?, ?, ?, ?)
    `);
    this.stmtFindStory = db.prepare('SELECT * FROM stories WHERE id = ?');
    this.stmtListByProject = db.prepare(
      'SELECT * FROM stories WHERE project_id = ? ORDER BY created_at DESC',
    );
  }

  createStory(projectId: number, name: string, description?: string, targetDuration?: number): Story {
    const result = this.stmtInsertStory.run(projectId, name, description ?? null, targetDuration ?? null);
    return this.stmtFindStory.get(result.lastInsertRowid) as Story;
  }

  listByProject(projectId: number): Story[] {
    return this.stmtListByProject.all(projectId) as Story[];
  }
}
