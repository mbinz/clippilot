import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/db/migrations/runner.js';

describe('migration 027 - jolt_at_key_action', () => {
  it('adds highlights.jolt_at_key_action INTEGER DEFAULT 0', () => {
    const d = new Database(':memory:');
    d.pragma('foreign_keys = ON');
    runMigrations(d);
    d.prepare("INSERT INTO projects (name) VALUES ('p')").run();
    d.prepare("INSERT INTO clips (project_id, file_path, file_hash, file_size, duration_sec) VALUES (1, '/a.mp4', 'h', 1, 30)").run();
    d.prepare("INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier) VALUES (1, 1, 9, 'a', 'solid')").run();
    d.prepare("INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier, jolt_at_key_action) VALUES (1, 10, 15, 'b', 'solid', 1)").run();
    expect(d.prepare('SELECT jolt_at_key_action AS j FROM highlights ORDER BY id').all()).toEqual([{ j: 0 }, { j: 1 }]);
  });
});
