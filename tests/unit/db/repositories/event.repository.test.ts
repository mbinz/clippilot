import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../../src/db/repositories/clip.repository.js';
import { ProjectRepository } from '../../../../src/db/repositories/project.repository.js';
import { EventRepository } from '../../../../src/db/repositories/event.repository.js';
import type { InsertClip } from '../../../../src/types/clip.js';

function makeClip(overrides: Partial<InsertClip> = {}): InsertClip {
  return {
    project_id: null, file_path: '/v/a.mp4', proxy_path: null, file_hash: 'h', file_size: 1,
    duration_sec: 10, resolution: '1920x1080', fps: 30, nb_frames: 300, has_video: 1, has_audio: 1,
    codec: 'h264', recorded_at: null, start_timecode: null, location: null, manual_tags: null, people: null,
    ...overrides,
  };
}

describe('EventRepository', () => {
  let db: Database.Database;
  let events: EventRepository;
  let clips: ClipRepository;
  let projectId: number;
  let n = 0;
  const addClip = (recorded_at: string | null, file = `f${++n}.mp4`) =>
    clips.insert(makeClip({ project_id: projectId, file_path: `/v/${file}`, file_hash: `h${n}-${file}`, recorded_at }));

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    events = new EventRepository(db);
    clips = new ClipRepository(db);
    projectId = new ProjectRepository(db).findOrCreate('p').id;
    n = 0;
  });

  it('create + listByProject with clip_count, start/end, sorted by sort_order', () => {
    const b = events.create({ project_id: projectId, name: 'B', source: 'folder', folder_path: '/v/B', sort_order: 1 });
    const a = events.create({ project_id: projectId, name: 'A', source: 'time', folder_path: null, sort_order: 0 });
    const c1 = addClip('2025-05-27T08:00:00Z');
    const c2 = addClip('2025-05-27T09:00:00Z');
    events.assignClips(a.id, [c1.id, c2.id]);
    const list = events.listByProject(projectId);
    expect(list.map((e) => e.name)).toEqual(['A', 'B']);
    expect(list[0]).toMatchObject({ clip_count: 2, start: '2025-05-27T08:00:00Z', end: '2025-05-27T09:00:00Z' });
    expect(list[1]).toMatchObject({ id: b.id, clip_count: 0, start: null, end: null });
  });

  it('rename', () => {
    const e = events.create({ project_id: projectId, name: 'A', source: 'time', folder_path: null });
    events.rename(e.id, 'Beach day');
    expect(events.findById(e.id)!.name).toBe('Beach day');
  });

  it('merge moves clips into the target and deletes the others', () => {
    const t = events.create({ project_id: projectId, name: 'T', source: 'time', folder_path: null });
    const o1 = events.create({ project_id: projectId, name: 'O1', source: 'time', folder_path: null });
    const o2 = events.create({ project_id: projectId, name: 'O2', source: 'time', folder_path: null });
    const c1 = addClip('2025-05-27T08:00:00Z');
    const c2 = addClip('2025-05-27T12:00:00Z');
    const c3 = addClip('2025-05-27T15:00:00Z');
    events.assignClips(t.id, [c1.id]);
    events.assignClips(o1.id, [c2.id]);
    events.assignClips(o2.id, [c3.id]);
    events.merge(t.id, [o1.id, o2.id]);
    expect(events.findById(o1.id)).toBeNull();
    expect(events.findById(o2.id)).toBeNull();
    expect(events.clipsOf(t.id).map((c) => c.id)).toEqual([c1.id, c2.id, c3.id]);
  });

  it('split is boundary-inclusive: the chosen clip and later ones move to "<name> (2)"', () => {
    const e = events.create({ project_id: projectId, name: 'Day', source: 'folder', folder_path: '/v' });
    const c1 = addClip('2025-05-27T08:00:00Z');
    const c2 = addClip('2025-05-27T09:00:00Z');
    const c3 = addClip('2025-05-27T10:00:00Z');
    events.assignClips(e.id, [c1.id, c2.id, c3.id]);
    const created = events.split(e.id, c2.id);
    expect(created.name).toBe('Day (2)');
    expect(created.source).toBe('folder');
    expect(created.folder_path).toBeNull();
    expect(events.clipsOf(e.id).map((c) => c.id)).toEqual([c1.id]);
    expect(events.clipsOf(created.id).map((c) => c.id)).toEqual([c2.id, c3.id]);
    expect(events.listByProject(projectId).map((x) => x.id)).toEqual([e.id, created.id]);
  });

  it('split rejects a clip outside the event and the first clip', () => {
    const e = events.create({ project_id: projectId, name: 'Day', source: 'time', folder_path: null });
    const c1 = addClip('2025-05-27T08:00:00Z');
    const c2 = addClip('2025-05-27T09:00:00Z');
    events.assignClips(e.id, [c1.id]);
    expect(() => events.split(e.id, c2.id)).toThrow(/not in event/);
    expect(() => events.split(e.id, c1.id)).toThrow(/first clip/);
  });

  it('resort orders by earliest recorded_at, undated last', () => {
    const late = events.create({ project_id: projectId, name: 'late', source: 'time', folder_path: null, sort_order: 0 });
    const none = events.create({ project_id: projectId, name: 'none', source: 'time', folder_path: null, sort_order: 1 });
    const early = events.create({ project_id: projectId, name: 'early', source: 'time', folder_path: null, sort_order: 2 });
    events.assignClips(late.id, [addClip('2025-05-27T15:00:00Z').id]);
    events.assignClips(none.id, [addClip(null).id]);
    events.assignClips(early.id, [addClip('2025-05-27T07:00:00Z').id]);
    events.resort(projectId);
    expect(events.listByProject(projectId).map((e) => e.name)).toEqual(['early', 'late', 'none']);
  });

  it('deleting an event nulls clips.event_id', () => {
    const e = events.create({ project_id: projectId, name: 'x', source: 'time', folder_path: null });
    const c = addClip(null);
    events.assignClips(e.id, [c.id]);
    events.deleteByProject(projectId);
    expect(clips.findById(c.id)!.event_id).toBeNull();
  });
});
