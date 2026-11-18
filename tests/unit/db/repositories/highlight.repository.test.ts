import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../../src/db/repositories/clip.repository.js';
import { ProjectRepository } from '../../../../src/db/repositories/project.repository.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';
import type { InsertClip } from '../../../../src/types/clip.js';

function makeClip(overrides: Partial<InsertClip> = {}): InsertClip {
  return {
    project_id: null,
    file_path: '/videos/a.mp4',
    proxy_path: null,
    file_hash: 'hash-a',
    file_size: 1000,
    duration_sec: 30,
    resolution: '1920x1080',
    fps: 30,
    nb_frames: 900,
    has_video: 1,
    has_audio: 1,
    codec: 'h264',
    recorded_at: null,
    start_timecode: null,
    location: null,
    manual_tags: null,
    people: null,
    ...overrides,
  };
}

const item = (start_sec: number, end_sec: number, description: string, quality: number) => ({
  start_sec,
  end_sec,
  description,
  quality,
});

describe('HighlightRepository', () => {
  let db: Database.Database;
  let clips: ClipRepository;
  let repo: HighlightRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    clips = new ClipRepository(db);
    repo = new HighlightRepository(db);
  });

  it('replaceForClip twice leaves only the second set, ordered by start', () => {
    const clip = clips.insert(makeClip());
    repo.replaceForClip(clip.id, [item(1, 2, 'first', 5), item(3, 4, 'second', 6)]);
    repo.replaceForClip(clip.id, [item(10, 12, 'late', 7), item(5, 6, 'early', 9)]);

    const found = repo.findByClip(clip.id);
    expect(found.map((h) => h.description)).toEqual(['early', 'late']);
    expect(found[0]).toMatchObject({ clip_id: clip.id, start_sec: 5, end_sec: 6, quality: 9 });
  });

  it('cascades on clip delete', () => {
    const clip = clips.insert(makeClip());
    repo.replaceForClip(clip.id, [item(1, 2, 'x', 5)]);
    db.prepare('DELETE FROM clips WHERE id = ?').run(clip.id);
    expect(repo.findByClip(clip.id)).toEqual([]);
  });

  it('listByProject filters by project', () => {
    const projects = new ProjectRepository(db);
    const p1 = projects.findOrCreate('one');
    const p2 = projects.findOrCreate('two');
    const c1 = clips.insert(makeClip({ project_id: p1.id }));
    const c2 = clips.insert(makeClip({ project_id: p2.id, file_hash: 'hash-b', file_path: '/videos/b.mp4' }));
    repo.replaceForClip(c1.id, [item(1, 2, 'in one', 5)]);
    repo.replaceForClip(c2.id, [item(1, 2, 'in two', 5)]);

    const listed = repo.listByProject(p1.id);
    expect(listed.map((h) => h.description)).toEqual(['in one']);
  });

  it('rejects quality outside 1..10 at the DB level', () => {
    const clip = clips.insert(makeClip());
    expect(() => repo.replaceForClip(clip.id, [item(1, 2, 'x', 11)])).toThrow();
  });
});
