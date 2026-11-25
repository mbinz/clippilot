import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/db/migrations/runner.js';

/** A database at schema version 28: fully migrated, then migration 029 taken back. */
function preDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  db.exec('ALTER TABLE operations DROP COLUMN actor');
  db.prepare('DELETE FROM _migrations WHERE version = 29').run();
  db.prepare("INSERT INTO projects (name) VALUES ('p')").run();
  db.prepare("INSERT INTO stories (project_id, name) VALUES (1, 'Main')").run();
  return db;
}

describe('migration 029: operations.actor', () => {
  it('adds the column (default user, CHECK ai|user) and backfills from the label', () => {
    const db = preDb();
    const ins = db.prepare('INSERT INTO operations (story_id, label, "before", "after") VALUES (1, ?, \'{}\', \'{}\')');
    const labels = ['Apply draft (42 panels)', 'Shake fix (1 moment)', 'Shake fix (7 moments)', 'Trim moment', 'Speed 100 %',
      'Delete panel 4', 'Set brief', '★', 'Rename cut to "Main"'];
    for (const l of labels) ins.run(l);
    runMigrations(db);
    const rows = db.prepare('SELECT label, actor FROM operations ORDER BY id').all() as { label: string; actor: string }[];
    expect(rows.map((r) => r.actor)).toEqual(['ai', 'ai', 'ai', 'user', 'user', 'user', 'user', 'user', 'user']);
    // new rows default to user; other values are rejected
    db.prepare('INSERT INTO operations (story_id, label, "before", "after") VALUES (1, \'x\', \'{}\', \'{}\')').run();
    expect((db.prepare('SELECT actor FROM operations ORDER BY id DESC LIMIT 1').get() as { actor: string }).actor).toBe('user');
    expect(() => db.prepare("UPDATE operations SET actor = 'robot'").run()).toThrow(/CHECK/);
  });
});
