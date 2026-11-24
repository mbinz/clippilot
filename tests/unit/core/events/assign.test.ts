import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../../src/db/repositories/clip.repository.js';
import { ProjectRepository } from '../../../../src/db/repositories/project.repository.js';
import { EventRepository } from '../../../../src/db/repositories/event.repository.js';
import { assignEvents } from '../../../../src/core/events/index.js';
import type { InsertClip } from '../../../../src/types/clip.js';

beforeAll(() => {
  process.env.TZ = 'Europe/Lisbon';
});

describe('assignEvents', () => {
  let db: Database.Database;
  let clips: ClipRepository;
  let events: EventRepository;
  let projectId: number;
  let n = 0;
  const add = (file: string, recorded_at: string | null) => {
    const c: InsertClip = {
      project_id: projectId, file_path: file, proxy_path: null, file_hash: `h${++n}`, file_size: 1,
      duration_sec: 10, resolution: null, fps: 30, nb_frames: null, has_video: 1, has_audio: 1, codec: null,
      recorded_at, start_timecode: null, location: null, manual_tags: null, people: null,
    };
    return clips.insert(c);
  };

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    clips = new ClipRepository(db);
    events = new EventRepository(db);
    projectId = new ProjectRepository(db).findOrCreate('p').id;
    n = 0;
  });

  it('first run derives and persists events for all clips, in order', () => {
    const a = add('/v/B/b.mp4', '2025-05-27T10:00:00Z');
    const b = add('/v/A/a.mp4', '2025-05-27T08:00:00Z');
    assignEvents(db, projectId);
    const list = events.listByProject(projectId);
    expect(list.map((e) => e.name)).toEqual(['A', 'B']);
    expect(clips.findById(a.id)!.event_id).toBe(list[1].id);
    expect(clips.findById(b.id)!.event_id).toBe(list[0].id);
  });

  it('incremental: new clip in an existing folder joins it; renamed event keeps its name', () => {
    add('/v/A/a.mp4', '2025-05-27T08:00:00Z');
    add('/v/B/b.mp4', '2025-05-27T10:00:00Z');
    assignEvents(db, projectId);
    const [ea] = events.listByProject(projectId);
    events.rename(ea.id, 'Morning walk');
    const fresh = add('/v/A/a2.mp4', '2025-05-27T09:00:00Z');
    assignEvents(db, projectId);
    expect(clips.findById(fresh.id)!.event_id).toBe(ea.id);
    expect(events.findById(ea.id)!.name).toBe('Morning walk');
    expect(events.listByProject(projectId)).toHaveLength(2);
  });

  it('incremental: a clip in a new folder becomes a new folder event', () => {
    add('/v/A/a.mp4', '2025-05-27T08:00:00Z');
    add('/v/B/b.mp4', '2025-05-27T10:00:00Z');
    assignEvents(db, projectId);
    const c = add('/v/C/c.mp4', '2025-05-28T10:00:00Z');
    assignEvents(db, projectId);
    const list = events.listByProject(projectId);
    expect(list.map((e) => e.name)).toEqual(['A', 'B', 'C']);
    expect(clips.findById(c.id)!.event_id).toBe(list[2].id);
  });

  it('incremental: a loose file next to folder events joins the nearest by time', () => {
    add('/v/A/a.mp4', '2025-05-27T08:00:00Z');
    add('/v/B/b.mp4', '2025-05-27T12:00:00Z');
    assignEvents(db, projectId);
    const loose = add('/v/loose.mp4', '2025-05-27T11:30:00Z');
    assignEvents(db, projectId);
    const b = events.listByProject(projectId).find((e) => e.name === 'B')!;
    expect(clips.findById(loose.id)!.event_id).toBe(b.id);
  });

  it('incremental: user merges survive; nothing reassigned', () => {
    add('/v/A/a.mp4', '2025-05-27T08:00:00Z');
    add('/v/B/b.mp4', '2025-05-27T10:00:00Z');
    assignEvents(db, projectId);
    const [ea, eb] = events.listByProject(projectId);
    events.merge(ea.id, [eb.id]);
    assignEvents(db, projectId);
    expect(events.listByProject(projectId)).toHaveLength(1);
  });

  it('flat project: new clip in the same folder gets a time event, not a folder event', () => {
    add('/v/a.mp4', '2025-05-27T08:00:00Z');
    assignEvents(db, projectId);
    const c = add('/v/b.mp4', '2025-05-27T14:00:00Z');
    assignEvents(db, projectId);
    const list = events.listByProject(projectId);
    expect(list).toHaveLength(2);
    expect(list.every((e) => e.source === 'time')).toBe(true);
    expect(clips.findById(c.id)!.event_id).toBe(list[1].id);
  });

  it('does not touch other projects', () => {
    add('/v/A/a.mp4', '2025-05-27T08:00:00Z');
    const other = new ProjectRepository(db).findOrCreate('q').id;
    assignEvents(db, other);
    expect(events.listByProject(projectId)).toHaveLength(0);
  });

  it('names time events in the given time zone', () => {
    add('/v/a.mp4', '2025-05-27T23:30:00Z');
    assignEvents(db, projectId, { timeZone: 'Asia/Tokyo' });
    expect(events.listByProject(projectId)[0].name).toBe('Wed 28 May, 08:30');
  });
});
