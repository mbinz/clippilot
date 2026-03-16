import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../src/db/migrations/runner.js';
import { ProjectRepository } from '../../../../src/db/repositories/project.repository.js';

describe('ProjectRepository', () => {
  let db: Database.Database;
  let repo: ProjectRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    repo = new ProjectRepository(db);
  });

  it('creates a new project', () => {
    const project = repo.findOrCreate('Mallorca 2025');
    expect(project.id).toBe(1);
    expect(project.name).toBe('Mallorca 2025');
  });

  it('returns existing project on duplicate name', () => {
    const p1 = repo.findOrCreate('Mallorca 2025');
    const p2 = repo.findOrCreate('Mallorca 2025');
    expect(p1.id).toBe(p2.id);
  });

  it('creates different projects for different names', () => {
    const p1 = repo.findOrCreate('Project A');
    const p2 = repo.findOrCreate('Project B');
    expect(p1.id).not.toBe(p2.id);
  });

  it('finds by id', () => {
    const created = repo.findOrCreate('Test');
    const found = repo.findById(created.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Test');
  });

  it('returns null for unknown id', () => {
    expect(repo.findById(999)).toBeNull();
  });

  it('lists all projects', () => {
    repo.findOrCreate('A');
    repo.findOrCreate('B');
    const list = repo.list();
    expect(list).toHaveLength(2);
  });
});
