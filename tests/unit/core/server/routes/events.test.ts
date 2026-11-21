import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../../../src/db/repositories/clip.repository.js';
import { ProjectRepository } from '../../../../../src/db/repositories/project.repository.js';
import { ThumbnailRepository } from '../../../../../src/db/repositories/thumbnail.repository.js';
import { createEventRoutes } from '../../../../../src/core/server/routes/events.js';
import { assignEvents } from '../../../../../src/core/events/index.js';

describe('Event API routes', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createEventRoutes>;
  let projectId: number;
  let n = 0;

  const add = (file: string, at: string, thumbs = 1) => {
    const clip = new ClipRepository(db).insert({
      project_id: projectId, file_path: file, proxy_path: null, file_hash: `h${++n}`, file_size: 1,
      duration_sec: 10, resolution: null, fps: 30, nb_frames: null, has_video: 1, has_audio: 1, codec: null,
      recorded_at: at, start_timecode: null, location: null, manual_tags: null, people: null,
    });
    for (let i = 0; i < thumbs; i++) {
      new ThumbnailRepository(db).insert({ clip_id: clip.id, file_path: `/t/c${clip.id}_${i}.jpg`, timestamp_sec: i });
    }
    return clip;
  };
  const json = async (res: Response) => (await res.json()) as any;
  const send = (method: string, url: string, body?: unknown) =>
    app.request(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    app = createEventRoutes(db);
    projectId = new ProjectRepository(db).findOrCreate('p').id;
    n = 0;
  });

  it('GET project events: list with one thumbnail per clip, earliest first, max 8', async () => {
    for (let i = 0; i < 10; i++) add(`/v/Town/${i}.mp4`, `2025-05-27T08:${String(i).padStart(2, '0')}:00Z`, 2);
    add('/v/Beach/x.mp4', '2025-05-27T12:00:00Z', 0);
    assignEvents(db, projectId);
    const res = await send('GET', `/projects/${projectId}/events`);
    expect(res.status).toBe(200);
    const { data } = await json(res);
    expect(data.map((e: any) => [e.name, e.clip_count])).toEqual([['Town', 10], ['Beach', 1]]);
    expect(data[0].thumbnails).toHaveLength(8);
    expect(data[0].thumbnails[0]).toBe('/media/thumbnails/c1_0.jpg');
    expect(data[0].thumbnails[1]).toBe('/media/thumbnails/c2_0.jpg');
    expect(data[1].thumbnails).toEqual([]);
  });

  it('PATCH renames; 404 for unknown; 400 for empty name', async () => {
    add('/v/A/a.mp4', '2025-05-27T08:00:00Z');
    assignEvents(db, projectId);
    const [{ id }] = (await json(await send('GET', `/projects/${projectId}/events`))).data;
    const ok = await send('PATCH', `/events/${id}`, { name: ' Morning ' });
    expect(ok.status).toBe(200);
    expect((await json(ok)).data).toMatchObject({ id, name: 'Morning' });
    expect((await send('PATCH', '/events/999', { name: 'x' })).status).toBe(404);
    expect((await send('PATCH', `/events/${id}`, { name: '  ' })).status).toBe(400);
  });

  it('POST merge moves clips into the event', async () => {
    add('/v/A/a.mp4', '2025-05-27T08:00:00Z');
    add('/v/B/b.mp4', '2025-05-27T12:00:00Z');
    assignEvents(db, projectId);
    const list = (await json(await send('GET', `/projects/${projectId}/events`))).data;
    const res = await send('POST', `/events/${list[0].id}/merge`, { other_ids: [list[1].id] });
    expect(res.status).toBe(200);
    expect((await json(res)).data).toMatchObject({ id: list[0].id, clip_count: 2 });
    expect((await json(await send('GET', `/projects/${projectId}/events`))).data).toHaveLength(1);
    expect((await send('POST', `/events/${list[0].id}/merge`, { other_ids: [12345] })).status).toBe(400);
  });

  it('POST split returns both events; bad clip is 400', async () => {
    add('/v/A/a.mp4', '2025-05-27T08:00:00Z');
    const b = add('/v/A/b.mp4', '2025-05-27T08:10:00Z');
    add('/v/B/c.mp4', '2025-05-27T12:00:00Z');
    assignEvents(db, projectId);
    const [first] = (await json(await send('GET', `/projects/${projectId}/events`))).data;
    const res = await send('POST', `/events/${first.id}/split`, { at_clip_id: b.id });
    expect(res.status).toBe(200);
    const { data } = await json(res);
    expect(data.map((e: any) => [e.name, e.clip_count])).toEqual([['A', 1], ['A (2)', 1]]);
    expect((await send('POST', `/events/${first.id}/split`, { at_clip_id: 9999 })).status).toBe(400);
  });

  it('unknown project -> 404', async () => {
    expect((await send('GET', '/projects/999/events')).status).toBe(404);
  });
});
