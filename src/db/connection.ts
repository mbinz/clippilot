import Database from 'better-sqlite3';
import { ensureDir } from '../utils/fs.js';
import path from 'node:path';

let db: Database.Database | null = null;

export function getDb(dbPath: string): Database.Database {
  if (db) return db;

  ensureDir(path.dirname(dbPath));

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  return db;
}

export function createDb(dbPath: string | ':memory:'): Database.Database {
  if (dbPath !== ':memory:') {
    ensureDir(path.dirname(dbPath));
  }

  const database = new Database(dbPath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');

  return database;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
