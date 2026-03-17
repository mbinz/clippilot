import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../src/db/migrations/runner.js';
import { SimilarityRepository } from '../../../../src/db/repositories/similarity.repository.js';

describe('SimilarityRepository', () => {
  let db: Database.Database;
  let repo: SimilarityRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    repo = new SimilarityRepository(db);

    // Seed some clips for foreign key references
    db.prepare("INSERT INTO clips (file_path, file_hash, file_size, duration_sec) VALUES (?, ?, ?, ?)").run('/v/a.mp4', 'h1', 1000, 30);
    db.prepare("INSERT INTO clips (file_path, file_hash, file_size, duration_sec) VALUES (?, ?, ?, ?)").run('/v/b.mp4', 'h2', 1000, 30);
    db.prepare("INSERT INTO clips (file_path, file_hash, file_size, duration_sec) VALUES (?, ?, ?, ?)").run('/v/c.mp4', 'h3', 1000, 30);
  });

  it('inserts a group and members', () => {
    const groupId = repo.insertGroup(null, 'Test reason');
    repo.insertMembers(groupId, [
      { clip_id: 1, is_best: true, score: 4.5 },
      { clip_id: 2, is_best: false, score: 3.0 },
    ]);

    const result = repo.getGroupWithMembers(groupId);
    expect(result).not.toBeNull();
    expect(result!.group.reason).toBe('Test reason');
    expect(result!.members).toHaveLength(2);
    expect(result!.members[0].similarity_score).toBe(4.5);
  });

  it('returns null for non-existent group', () => {
    expect(repo.getGroupWithMembers(999)).toBeNull();
  });

  it('lists groups', () => {
    repo.insertGroup(null, 'Reason 1');
    repo.insertGroup(null, 'Reason 2');

    const groups = repo.getGroups();
    expect(groups).toHaveLength(2);
  });

  it('lists groups filtered by project', () => {
    db.prepare("INSERT INTO projects (name) VALUES (?)").run('Test Project');
    repo.insertGroup(1, 'Project reason');
    repo.insertGroup(null, 'No project');

    expect(repo.getGroups(1)).toHaveLength(1);
    expect(repo.getGroups()).toHaveLength(2);
  });

  it('marks best clip in group', () => {
    const groupId = repo.insertGroup(null, 'Test');
    repo.insertMembers(groupId, [
      { clip_id: 1, is_best: true, score: 4.0 },
      { clip_id: 2, is_best: false, score: 3.0 },
    ]);

    // Switch best to clip 2
    repo.markBest(groupId, 2);

    const result = repo.getGroupWithMembers(groupId)!;
    const clip1 = result.members.find((m) => m.clip_id === 1)!;
    const clip2 = result.members.find((m) => m.clip_id === 2)!;
    expect(clip1.is_best).toBe(0);
    expect(clip2.is_best).toBe(1);
  });

  it('finds groups by clip', () => {
    const g1 = repo.insertGroup(null, 'Group 1');
    repo.insertMembers(g1, [
      { clip_id: 1, is_best: true, score: 4.0 },
      { clip_id: 2, is_best: false, score: 3.0 },
    ]);

    const g2 = repo.insertGroup(null, 'Group 2');
    repo.insertMembers(g2, [
      { clip_id: 2, is_best: true, score: 3.5 },
      { clip_id: 3, is_best: false, score: 2.0 },
    ]);

    const groups = repo.findGroupsByClip(2);
    expect(groups).toHaveLength(2);

    const groupsForClip3 = repo.findGroupsByClip(3);
    expect(groupsForClip3).toHaveLength(1);
  });

  it('clears all groups', () => {
    const g1 = repo.insertGroup(null, 'Group 1');
    repo.insertMembers(g1, [{ clip_id: 1, is_best: true, score: 4.0 }]);

    repo.clearGroups();

    expect(repo.getGroups()).toHaveLength(0);
    // Members should be cascade-deleted
    const members = db.prepare('SELECT COUNT(*) as count FROM clip_similarity_members').get() as any;
    expect(members.count).toBe(0);
  });

  it('clears groups by project', () => {
    db.prepare("INSERT INTO projects (name) VALUES (?)").run('Project A');
    repo.insertGroup(1, 'Project group');
    repo.insertGroup(null, 'No project');

    repo.clearGroups(1);

    expect(repo.getGroups()).toHaveLength(1);
    expect(repo.getGroups()[0].reason).toBe('No project');
  });
});
