import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/db/migrations/runner.js';
import { migration022 } from '../../../src/db/migrations/022_jitter.js';

/** Runs migrations up to 021 by applying the runner and then undoing 022 is not possible; build it by hand instead. */
function dbAt021() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  // Take the schema back to the 021 state.
  db.exec(`
    ALTER TABLE highlights RENAME COLUMN jitter_score TO shake_score;
    ALTER TABLE highlights RENAME COLUMN jitter_max_px TO shake_max_px;
    DELETE FROM _migrations WHERE version = 22;
  `);
  db.prepare("INSERT INTO projects (name) VALUES ('p')").run();
  db.prepare("INSERT INTO clips (project_id, file_path, file_hash, file_size, duration_sec) VALUES (1, '/a.mp4', 'h', 1, 30)").run();
  return db;
}

const insert = (db: Database.Database, issues: string | null, score: number | null = null, maxPx: number | null = null) =>
  db.prepare('INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier, issues, shake_score, shake_max_px) VALUES (1, 0, 2, ?, ?, ?, ?, ?)')
    .run('m', 'solid', issues, score, maxPx).lastInsertRowid as number;

describe('migration 022 - shake becomes jitter', () => {
  it('renames the score columns and keeps their values', () => {
    const db = dbAt021();
    const id = insert(db, '[]', 0.31, 4.5);
    const nullId = insert(db, '[]');
    migration022(db);
    const row = db.prepare('SELECT jitter_score, jitter_max_px FROM highlights WHERE id = ?').get(id);
    expect(row).toEqual({ jitter_score: 0.31, jitter_max_px: 4.5 });
    expect(db.prepare('SELECT jitter_score FROM highlights WHERE id = ?').get(nullId)).toEqual({ jitter_score: null });
    const cols = (db.prepare('PRAGMA table_info(highlights)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).not.toContain('shake_score');
    expect(cols).not.toContain('shake_max_px');
  });

  it('removes "shake" from every issues array, keeping the others in order', () => {
    const db = dbAt021();
    const a = insert(db, '["shake","blur"]');
    const b = insert(db, '["blur","shake","obstructed"]');
    const c = insert(db, '["overexposed"]');
    const d = insert(db, '["shake"]');
    migration022(db);
    const issues = (id: number) => (db.prepare('SELECT issues FROM highlights WHERE id = ?').get(id) as { issues: string }).issues;
    expect(JSON.parse(issues(a))).toEqual(['blur']);
    expect(JSON.parse(issues(b))).toEqual(['blur', 'obstructed']);
    expect(JSON.parse(issues(c))).toEqual(['overexposed']);
    expect(JSON.parse(issues(d))).toEqual([]);
  });

  it('does not crash on empty, NULL or broken issues JSON and leaves them alone', () => {
    const db = dbAt021();
    const empty = insert(db, '');
    const broken = insert(db, 'not json {');
    const notArray = insert(db, '{"a":1}');
    migration022(db);
    const issues = (id: number) => (db.prepare('SELECT issues FROM highlights WHERE id = ?').get(id) as { issues: string | null }).issues;
    expect(issues(empty)).toBe('');
    expect(issues(broken)).toBe('not json {');
    expect(issues(notArray)).toBe('{"a":1}');
  });

  it('is registered in the runner as version 22', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect((db.prepare('SELECT name FROM _migrations WHERE version = 22').get() as any).name).toBe('jitter');
  });
});
