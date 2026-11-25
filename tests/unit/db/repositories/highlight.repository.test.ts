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
      { ...item(1, 2, 'tagged', 'hero'), shot: 'wide', role: 'establishing', issues: ['obstructed', 'blur'] },
      item(5, 6, 'plain'),
    ]);
    const [a, b] = repo.findByClip(clip.id);
    expect(a).toMatchObject({ tier: 'hero', shot: 'wide', role: 'establishing' });
    expect(JSON.parse(a.issues)).toEqual(['obstructed', 'blur']);
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
    const panel = db.prepare(`INSERT INTO story_segments (story_id, scene_id, position, state, clip_id, moment_id)
      VALUES (?, ?, 0, 'filled', ?, ?)`).run(cut, scene, clip.id, id('in panel')).lastInsertRowid;
    const cand = db.prepare("INSERT INTO story_segments (story_id, scene_id, position, state) VALUES (?, ?, 1, 'candidates')").run(cut, scene).lastInsertRowid;
    db.prepare('INSERT INTO panel_candidates (panel_id, moment_id, position) VALUES (?, ?, 0)').run(cand, id('candidate'));
    const keptIds = [id('confirmed'), id('rejected'), id('in panel'), id('candidate')];

    repo.replaceForClip(clip.id, [item(20, 22, 'new one'), item(11, 13, 'other new')]);

    const after = repo.findByClip(clip.id);
    expect(after.map((h) => h.description).sort()).toEqual(
      ['candidate', 'confirmed', 'in panel', 'new one', 'other new', 'rejected'],
    );
    expect(after.filter((h) => keptIds.includes(h.id))).toHaveLength(4);
    expect(after.find((h) => h.description === 'new one')!.status).toBe('proposed');
    expect(db.prepare('SELECT moment_id FROM story_segments WHERE id = ?').get(panel)).toEqual({ moment_id: id('in panel') });
    expect(db.prepare('SELECT moment_id FROM panel_candidates WHERE panel_id = ?').all(cand)).toEqual([{ moment_id: id('candidate') }]);
  });
});

describe('HighlightRepository: the moment is the edit', () => {
  let db: Database.Database;
  let repo: HighlightRepository;
  let clipId: number;
  const rows = () => db.prepare('SELECT description, start_sec, end_sec, ai_start_sec, ai_end_sec, speed, user_tier FROM highlights ORDER BY id').all();

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const pid = new ProjectRepository(db).findOrCreate('p').id;
    clipId = new ClipRepository(db).insert(makeClip({ project_id: pid, fps: 25 })).id;
    repo = new HighlightRepository(db);
  });

  it('a new moment keeps its ai range and starts at speed 1 on a 25 fps clip even when 0.5 is suggested', () => {
    repo.replaceForClip(clipId, [{ ...item(1, 4, 'slow?'), suggested_speed: 0.5 }]);
    expect(rows()).toEqual([{ description: 'slow?', start_sec: 1, end_sec: 4, ai_start_sec: 1, ai_end_sec: 4, speed: 1, user_tier: null }]);
  });

  it('a new moment on a fast clip starts at its suggested speed', () => {
    const pid = new ProjectRepository(db).findOrCreate('p').id;
    const fast = new ClipRepository(db).insert(makeClip({ project_id: pid, file_path: '/b.mp4', file_hash: 'b', fps: 50 })).id;
    repo.replaceForClip(fast, [{ ...item(1, 4, 'slow'), suggested_speed: 0.5 }]);
    expect(rows()[0]).toMatchObject({ speed: 0.5 });
  });

  it('re-analysis keeps moments whose range, speed or tier the user changed; drops untouched ones', () => {
    repo.replaceForClip(clipId, [item(1, 4, 'trimmed'), item(5, 8, 'tiered'), item(9, 12, 'plain'), item(13, 16, 'speedy')]);
    const id = (d: string) => repo.findByClip(clipId).find((h) => h.description === d)!.id;
    db.prepare('UPDATE highlights SET start_sec = 2 WHERE id = ?').run(id('trimmed'));
    db.prepare("UPDATE highlights SET user_tier = 'hero' WHERE id = ?").run(id('tiered'));
    db.prepare('UPDATE highlights SET speed = 0.5 WHERE id = ?').run(id('speedy'));
    repo.replaceForClip(clipId, [item(20, 22, 'new')]);
    expect(repo.findByClip(clipId).map((h) => h.description).sort()).toEqual(['new', 'speedy', 'tiered', 'trimmed']);
  });
});

describe('HighlightRepository.replaceForClip: no duplicates of kept moments', () => {
  let db: Database.Database;
  let repo: HighlightRepository;
  let clipId: number;
  const descs = () => repo.findByClip(clipId).map((h) => h.description).sort();

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const pid = new ProjectRepository(db).findOrCreate('p').id;
    clipId = new ClipRepository(db).insert(makeClip({ project_id: pid })).id;
    repo = new HighlightRepository(db);
  });

  const keep = (d: string, set: string) => {
    const id = repo.findByClip(clipId).find((h) => h.description === d)!.id;
    db.prepare(`UPDATE highlights SET ${set} WHERE id = ?`).run(id);
  };

  it('drops a new moment that overlaps the user-trimmed moment by >= 50 % of its own length (C0542)', () => {
    repo.replaceForClip(clipId, [item(1, 8, 'trimmed')]);
    keep('trimmed', "start_sec = 3.5, end_sec = 9.5, status = 'confirmed'");
    repo.replaceForClip(clipId, [item(1.5, 8.5, 'dup')]); // overlap 3.5-8.5 = 5 of 7 s
    expect(descs()).toEqual(['trimmed']);
  });

  it('keeps a new moment that overlaps less than 50 % of its own length', () => {
    repo.replaceForClip(clipId, [item(1, 8, 'trimmed')]);
    keep('trimmed', "status = 'confirmed'");
    repo.replaceForClip(clipId, [item(6, 12, 'partial')]); // overlap 2 of 6 s
    expect(descs()).toEqual(['partial', 'trimmed']);
  });

  it('uses the kept moment current (trimmed) range, not its ai range', () => {
    repo.replaceForClip(clipId, [item(1, 8, 'trimmed')]);
    keep('trimmed', 'start_sec = 5, end_sec = 8');
    repo.replaceForClip(clipId, [item(1, 4, 'in old range')]); // no overlap with 5-8
    expect(descs()).toEqual(['in old range', 'trimmed']);
  });

  it('drops a new moment overlapping a rejected moment', () => {
    repo.replaceForClip(clipId, [item(1, 5, 'no')]);
    keep('no', "status = 'rejected'");
    repo.replaceForClip(clipId, [item(1, 5, 'again'), item(10, 14, 'elsewhere')]);
    expect(descs()).toEqual(['elsewhere', 'no']);
  });

  it('does not count replaceable (deleted) moments; clips without kept moments are unchanged', () => {
    repo.replaceForClip(clipId, [item(1, 5, 'old')]);
    repo.replaceForClip(clipId, [item(1, 5, 'same range'), item(2, 6, 'overlapping new')]);
    expect(descs()).toEqual(['overlapping new', 'same range']);
  });
});

describe('HighlightRepository: unprotected moments (the definition shared with re-analysis)', () => {
  let db: Database.Database;
  let repo: HighlightRepository;
  let clipId: number;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const pid = new ProjectRepository(db).findOrCreate('p').id;
    clipId = new ClipRepository(db).insert(makeClip({ project_id: pid, fps: 25 })).id;
    repo = new HighlightRepository(db);
    repo.replaceForClip(clipId, [
      item(1, 3, 'plain'), item(4, 6, 'confirmed'), item(7, 9, 'rejected'), item(10, 12, 'trimmed'),
      item(13, 15, 'starred'), item(16, 18, 'in panel'), item(19, 21, 'candidate'), item(22, 24, 'sped'),
    ]);
    const id = (d: string) => repo.findByClip(clipId).find((h) => h.description === d)!.id;
    db.prepare("UPDATE highlights SET status = 'confirmed' WHERE id = ?").run(id('confirmed'));
    db.prepare("UPDATE highlights SET status = 'rejected' WHERE id = ?").run(id('rejected'));
    db.prepare('UPDATE highlights SET start_sec = 11 WHERE id = ?').run(id('trimmed'));
    db.prepare("UPDATE highlights SET user_tier = 'hero' WHERE id = ?").run(id('starred'));
    db.prepare('UPDATE highlights SET speed = 0.5 WHERE id = ?').run(id('sped'));
    const pidx = new ProjectRepository(db).findOrCreate('p').id;
    const cut = db.prepare("INSERT INTO stories (project_id, name) VALUES (?, 'Main')").run(pidx).lastInsertRowid;
    const scene = db.prepare("INSERT INTO scenes (story_id, position, name) VALUES (?, 0, 's')").run(cut).lastInsertRowid;
    db.prepare("INSERT INTO story_segments (story_id, scene_id, position, state, clip_id, moment_id) VALUES (?, ?, 0, 'filled', ?, ?)").run(cut, scene, clipId, id('in panel'));
    const cand = db.prepare("INSERT INTO story_segments (story_id, scene_id, position, state) VALUES (?, ?, 1, 'candidates')").run(cut, scene).lastInsertRowid;
    db.prepare('INSERT INTO panel_candidates (panel_id, moment_id, position) VALUES (?, ?, 0)').run(cand, id('candidate'));
  });

  it('findUnprotected returns only proposed, untouched, unreferenced moments', () => {
    expect(repo.findUnprotected(clipId).map((h) => h.description)).toEqual(['plain']);
  });

  it('replaceForClip drops exactly those', () => {
    repo.replaceForClip(clipId, []);
    expect(repo.findByClip(clipId).map((h) => h.description).sort()).toEqual(
      ['candidate', 'confirmed', 'in panel', 'rejected', 'sped', 'starred', 'trimmed']);
  });

  it('snapUnprotected sets range and ai range, so the moment stays unprotected (not "edited")', () => {
    const [m] = repo.findUnprotected(clipId);
    repo.snapUnprotected(m.id, 0.5, 4);
    expect(repo.findByClip(clipId).find((h) => h.id === m.id)).toMatchObject({ start_sec: 0.5, end_sec: 4, ai_start_sec: 0.5, ai_end_sec: 4 });
    expect(repo.findUnprotected(clipId).map((h) => h.id)).toEqual([m.id]);
  });
});
