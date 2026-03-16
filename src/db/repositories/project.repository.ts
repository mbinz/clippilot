import type Database from 'better-sqlite3';
import type { Project } from '../../types/project.js';

export class ProjectRepository {
  private stmtInsert: Database.Statement;
  private stmtFindByName: Database.Statement;
  private stmtFindById: Database.Statement;
  private stmtList: Database.Statement;

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare('INSERT INTO projects (name) VALUES (?)');
    this.stmtFindByName = db.prepare('SELECT * FROM projects WHERE name = ?');
    this.stmtFindById = db.prepare('SELECT * FROM projects WHERE id = ?');
    this.stmtList = db.prepare('SELECT * FROM projects ORDER BY created_at DESC');
  }

  findOrCreate(name: string): Project {
    const existing = this.stmtFindByName.get(name) as Project | undefined;
    if (existing) return existing;

    const result = this.stmtInsert.run(name);
    return {
      id: result.lastInsertRowid as number,
      name,
      created_at: new Date().toISOString(),
    };
  }

  findById(id: number): Project | null {
    return (this.stmtFindById.get(id) as Project) ?? null;
  }

  list(): Project[] {
    return this.stmtList.all() as Project[];
  }
}
