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
    expect(tableNames).toContain('clip_similarity_groups');
    expect(tableNames).toContain('clip_similarity_members');
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
    expect(migrations).toHaveLength(21);
    expect(migrations[0].version).toBe(1);
    expect(migrations[1].version).toBe(2);
    expect(migrations[2].version).toBe(3);
    expect(migrations[5].version).toBe(6);
    expect(migrations[6].version).toBe(7);
    expect(migrations[7].version).toBe(8);
    expect(migrations[8].version).toBe(9);
    expect(migrations[9].version).toBe(10);
    expect(migrations[10].version).toBe(11);
    expect(migrations[13].version).toBe(14);
    expect(migrations[14].version).toBe(15);
    expect(migrations[15].version).toBe(16);
    expect(migrations[16].version).toBe(17);
    expect(migrations[17].version).toBe(18);
    expect(migrations[18].version).toBe(19);
    expect(migrations[19].version).toBe(20);
    expect(migrations[20].version).toBe(21);
    expect(migrations[11].version).toBe(12);
    expect(migrations[12].version).toBe(13);
  });

  it('is idempotent — second run does nothing', () => {
    runMigrations(db);
    runMigrations(db); // should not throw

    const migrations = db.prepare('SELECT * FROM _migrations').all();
    expect(migrations).toHaveLength(21);
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

  it('adds scene_hint column to clips', () => {
    runMigrations(db);
    const cols = db.prepare("PRAGMA table_info(clips)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain('scene_hint');
  });
});
