import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/db/migrations/runner.js';

describe('migrations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
  });

  it('creates all tables on first run', () => {
    runMigrations(db);

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('projects');
    expect(tableNames).toContain('clips');
    expect(tableNames).toContain('thumbnails');
    expect(tableNames).toContain('stories');
    expect(tableNames).toContain('story_segments');
    expect(tableNames).toContain('_migrations');
  });

  it('creates FTS5 virtual table', () => {
    runMigrations(db);

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='clips_fts'",
    ).all();
    expect(tables).toHaveLength(1);
  });

  it('records applied migrations', () => {
    runMigrations(db);

    const migrations = db.prepare('SELECT * FROM _migrations ORDER BY version').all() as any[];
    expect(migrations).toHaveLength(2);
    expect(migrations[0].version).toBe(1);
    expect(migrations[1].version).toBe(2);
  });

  it('is idempotent — second run does nothing', () => {
    runMigrations(db);
    runMigrations(db); // should not throw

    const migrations = db.prepare('SELECT * FROM _migrations').all();
    expect(migrations).toHaveLength(2);
  });

  it('creates indexes', () => {
    runMigrations(db);

    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'",
    ).all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain('idx_clips_hash');
    expect(indexNames).toContain('idx_clips_project');
    expect(indexNames).toContain('idx_clips_status');
  });
});
