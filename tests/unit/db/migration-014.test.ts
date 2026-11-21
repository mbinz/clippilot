import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/db/migrations/runner.js';

describe('migration 014 - dup groups', () => {
  it('adds a nullable dup_group column with an index', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const cols = db.prepare('PRAGMA table_info(highlights)').all() as { name: string; notnull: number }[];
    const col = cols.find((c) => c.name === 'dup_group');
    expect(col).toBeDefined();
    expect(col!.notnull).toBe(0);
    const idx = db.prepare('PRAGMA index_list(highlights)').all() as { name: string }[];
    expect(idx.some((i) => i.name === 'idx_highlights_dup_group')).toBe(true);
  });
});
