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

  it('round-trips audio_keep (boolean <-> 0/1) and audio_type, defaulting to 0 / noise', () => {
    const clip = clips.insert(makeClip());
    repo.replaceForClip(clip.id, [
      { ...item(1, 4, 'laugh', 'hero'), audio_keep: true, audio_type: 'speech' },
      item(5, 8, 'plain'),
    ]);
    const [a, b] = repo.findByClip(clip.id);
    expect(a).toMatchObject({ audio_keep: 1, audio_type: 'speech' });
    expect(b).toMatchObject({ audio_keep: 0, audio_type: 'noise' });
  });

  it('setDupGroups writes groups, clears the project first, and leaves other projects alone', () => {
    const projects = new ProjectRepository(db);
    const p1 = projects.findOrCreate('one');
    const p2 = projects.findOrCreate('two');
    const c1 = clips.insert(makeClip({ project_id: p1.id }));
    const c2 = clips.insert(makeClip({ project_id: p2.id, file_hash: 'hash-b', file_path: '/videos/b.mp4' }));
    repo.replaceForClip(c1.id, [item(1, 2, 'a'), item(3, 4, 'b')]);
    repo.replaceForClip(c2.id, [item(1, 2, 'c')]);
    const [a, b] = repo.findByClip(c1.id);
    const [c] = repo.findByClip(c2.id);
    expect(a.dup_group).toBeNull();

    repo.setDupGroups(p2.id, new Map([[c.id, 1]]));
    repo.setDupGroups(p1.id, new Map([[a.id, 1], [b.id, 1]]));
    expect(repo.findByClip(c1.id).map((h) => h.dup_group)).toEqual([1, 1]);

    repo.setDupGroups(p1.id, new Map([[b.id, 2]]));
    expect(repo.findByClip(c1.id).map((h) => h.dup_group)).toEqual([null, 2]);
    expect(repo.findByClip(c2.id)[0].dup_group).toBe(1);
  });
});

describe('HighlightRepository.replaceForClip keeps decisions', () => {
  it('keeps confirmed, rejected and panel/candidate-referenced moments; drops the rest; adds new ones', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const pid = new ProjectRepository(db).findOrCreate('p').id;
    const clip = new ClipRepository(db).insert(makeClip({ project_id: pid }));
    const repo = new HighlightRepository(db);
    repo.replaceForClip(clip.id, [
      item(1, 2, 'confirmed'), item(3, 4, 'rejected'), item(5, 6, 'in panel'), item(7, 8, 'candidate'), item(9, 10, 'plain'),
    ]);
    const id = (d: string) => repo.findByClip(clip.id).find((h) => h.description === d)!.id;
    db.prepare("UPDATE highlights SET status = 'confirmed' WHERE id = ?").run(id('confirmed'));
    db.prepare("UPDATE highlights SET status = 'rejected' WHERE id = ?").run(id('rejected'));
    const cut = db.prepare("INSERT INTO stories (project_id, name) VALUES (?, 'Main')").run(pid).lastInsertRowid;
    const scene = db.prepare("INSERT INTO scenes (story_id, position, name) VALUES (?, 0, 's')").run(cut).lastInsertRowid;
    const panel = db.prepare(`INSERT INTO story_segments (story_id, scene_id, position, state, clip_id, moment_id, start_sec, end_sec)
      VALUES (?, ?, 0, 'filled', ?, ?, 5, 6)`).run(cut, scene, clip.id, id('in panel')).lastInsertRowid;
    const cand = db.prepare("INSERT INTO story_segments (story_id, scene_id, position, state) VALUES (?, ?, 1, 'candidates')").run(cut, scene).lastInsertRowid;
    db.prepare('INSERT INTO panel_candidates (panel_id, moment_id, position) VALUES (?, ?, 0)').run(cand, id('candidate'));
    const keptIds = [id('confirmed'), id('rejected'), id('in panel'), id('candidate')];

    repo.replaceForClip(clip.id, [item(20, 22, 'new one'), item(1, 2, 'confirmed again')]);

    const after = repo.findByClip(clip.id);
    expect(after.map((h) => h.description).sort()).toEqual(
      ['candidate', 'confirmed', 'confirmed again', 'in panel', 'new one', 'rejected'],
    );
    expect(after.filter((h) => keptIds.includes(h.id))).toHaveLength(4);
    expect(after.find((h) => h.description === 'new one')!.status).toBe('proposed');
    expect(db.prepare('SELECT moment_id FROM story_segments WHERE id = ?').get(panel)).toEqual({ moment_id: id('in panel') });
    expect(db.prepare('SELECT moment_id FROM panel_candidates WHERE panel_id = ?').all(cand)).toEqual([{ moment_id: id('candidate') }]);
  });
});
