import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/db/migrations/runner.js';

describe('migration 030: highlights.created_by', () => {
  it('adds the column (null for analysed moments, CHECK user|ai)', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    db.prepare("INSERT INTO projects (name) VALUES ('p')").run();
    db.prepare("INSERT INTO clips (project_id, file_path, file_hash, file_size, duration_sec) VALUES (1, '/a.mp4', 'h', 1, 10)").run();
    db.prepare("INSERT INTO highlights (clip_id, start_sec, end_sec, description) VALUES (1, 1, 2, 'x')").run();
    expect(db.prepare('SELECT created_by FROM highlights').get()).toEqual({ created_by: null });
    db.prepare("UPDATE highlights SET created_by = 'user'").run();
    expect(() => db.prepare("UPDATE highlights SET created_by = 'robot'").run()).toThrow(/CHECK/);
  });
});
