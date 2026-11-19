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

const item = (start_sec: number, end_sec: number, description: string, tier: 'hero' | 'solid' | 'filler' = 'solid') => ({
  start_sec,
  end_sec,
  description,
  tier,
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
    repo.replaceForClip(clip.id, [item(1, 2, 'first'), item(3, 4, 'second')]);
    repo.replaceForClip(clip.id, [item(10, 12, 'late'), item(5, 6, 'early', 'hero')]);

    const found = repo.findByClip(clip.id);
    expect(found.map((h) => h.description)).toEqual(['early', 'late']);
    expect(found[0]).toMatchObject({ clip_id: clip.id, start_sec: 5, end_sec: 6, tier: 'hero' });
  });

  it('cascades on clip delete', () => {
    const clip = clips.insert(makeClip());
    repo.replaceForClip(clip.id, [item(1, 2, 'x')]);
    db.prepare('DELETE FROM clips WHERE id = ?').run(clip.id);
    expect(repo.findByClip(clip.id)).toEqual([]);
  });

  it('listByProject filters by project', () => {
    const projects = new ProjectRepository(db);
    const p1 = projects.findOrCreate('one');
    const p2 = projects.findOrCreate('two');
    const c1 = clips.insert(makeClip({ project_id: p1.id }));
    const c2 = clips.insert(makeClip({ project_id: p2.id, file_hash: 'hash-b', file_path: '/videos/b.mp4' }));
    repo.replaceForClip(c1.id, [item(1, 2, 'in one')]);
    repo.replaceForClip(c2.id, [item(1, 2, 'in two')]);

    const listed = repo.listByProject(p1.id);
    expect(listed.map((h) => h.description)).toEqual(['in one']);
  });

  it('rejects an unknown tier at the DB level', () => {
    const clip = clips.insert(makeClip());
    expect(() => repo.replaceForClip(clip.id, [{ ...item(1, 2, 'x'), tier: 'epic' as any }])).toThrow();
  });

  it('round-trips tier, shot, role and issues; defaults shot/role to null and issues to []', () => {
    const clip = clips.insert(makeClip());
    repo.replaceForClip(clip.id, [
      { ...item(1, 2, 'tagged', 'hero'), shot: 'wide', role: 'establishing', issues: ['shake', 'blur'] },
      item(5, 6, 'plain'),
    ]);
    const [a, b] = repo.findByClip(clip.id);
    expect(a).toMatchObject({ tier: 'hero', shot: 'wide', role: 'establishing' });
    expect(JSON.parse(a.issues)).toEqual(['shake', 'blur']);
    expect(b).toMatchObject({ tier: 'solid', shot: null, role: null, issues: '[]' });
  });

  it('round-trips slowmo fields and defaults them for plain inserts', () => {
    const clip = clips.insert(makeClip());
    repo.replaceForClip(clip.id, [
      { ...item(1, 2, 'splash', 'hero'), slowmo: 'strong', slowmo_reason: 'water', suggested_speed: 0.25 },
      item(5, 6, 'plain'),
    ]);
    const [a, b] = repo.findByClip(clip.id);
    expect(a).toMatchObject({ slowmo: 'strong', slowmo_reason: 'water', suggested_speed: 0.25 });
    expect(b).toMatchObject({ slowmo: 'none', slowmo_reason: '', suggested_speed: 1 });
  });
});
