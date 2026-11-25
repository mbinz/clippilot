import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/db/migrations/runner.js';

describe('migration 024 - split_of and ai_speed', () => {
  it('adds nullable highlights.split_of (set null with the parent) and highlights.ai_speed', () => {
    const d = new Database(':memory:');
    d.pragma('foreign_keys = ON');
    runMigrations(d);
    d.prepare("INSERT INTO projects (name) VALUES ('p')").run();
    d.prepare("INSERT INTO clips (project_id, file_path, file_hash, file_size, duration_sec) VALUES (1, '/a.mp4', 'h', 1, 30)").run();
    d.prepare("INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier) VALUES (1, 1, 9, 'a', 'solid')").run();
    d.prepare("INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier, split_of, ai_speed) VALUES (1, 10, 15, 'b', 'solid', 1, 0.5)").run();
    expect(d.prepare('SELECT split_of, ai_speed FROM highlights ORDER BY id').all()).toEqual([
      { split_of: null, ai_speed: null }, { split_of: 1, ai_speed: 0.5 },
    ]);
    d.prepare('DELETE FROM highlights WHERE id = 1').run();
    expect(d.prepare('SELECT split_of FROM highlights WHERE id = 2').get()).toEqual({ split_of: null });
  });
});
