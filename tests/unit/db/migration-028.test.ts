import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/db/migrations/runner.js';

describe('migration 028 - look fingerprints', () => {
  it('adds highlights.look_vec/look_model/look_start_sec/look_end_sec, all NULL by default', () => {
    const d = new Database(':memory:');
    d.pragma('foreign_keys = ON');
    runMigrations(d);
    d.prepare("INSERT INTO projects (name) VALUES ('p')").run();
    d.prepare("INSERT INTO clips (project_id, file_path, file_hash, file_size, duration_sec) VALUES (1, '/a.mp4', 'h', 1, 30)").run();
    d.prepare("INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier) VALUES (1, 1, 9, 'a', 'solid')").run();
    d.prepare("INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier, look_vec, look_model, look_start_sec, look_end_sec) VALUES (1, 10, 15, 'b', 'solid', ?, 'm', 10, 15)").run(Buffer.from(new Float32Array([1, 0]).buffer));
    expect(d.prepare('SELECT look_vec AS v, look_model AS m, look_start_sec AS s, look_end_sec AS e FROM highlights ORDER BY id').all())
      .toEqual([{ v: null, m: null, s: null, e: null }, { v: Buffer.from(new Float32Array([1, 0]).buffer), m: 'm', s: 10, e: 15 }]);
  });
});
