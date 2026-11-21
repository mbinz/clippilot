import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/db/migrations/runner.js';

describe('migration 015 - events', () => {
  it('creates events and clips.event_id', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const cols = db.prepare('PRAGMA table_info(events)').all() as { name: string; notnull: number }[];
    expect(cols.map((c) => c.name)).toEqual(
      ['id', 'project_id', 'name', 'source', 'folder_path', 'sort_order', 'created_at']);
    const clipCol = (db.prepare('PRAGMA table_info(clips)').all() as { name: string; notnull: number }[])
      .find((c) => c.name === 'event_id');
    expect(clipCol).toBeDefined();
    expect(clipCol!.notnull).toBe(0);
    const idx = db.prepare('PRAGMA index_list(clips)').all() as { name: string }[];
    expect(idx.some((i) => i.name === 'idx_clips_event')).toBe(true);
  });

  it('rejects an unknown source', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare("INSERT INTO projects (name) VALUES ('p')").run();
    expect(() => db.prepare("INSERT INTO events (project_id, name, source) VALUES (1, 'x', 'bogus')").run()).toThrow();
  });
});
