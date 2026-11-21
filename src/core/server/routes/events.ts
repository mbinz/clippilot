import path from 'node:path';
import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { ProjectRepository } from '../../../db/repositories/project.repository.js';
import { EventRepository, type EventSummary } from '../../../db/repositories/event.repository.js';
import { ThumbnailRepository } from '../../../db/repositories/thumbnail.repository.js';
import { eventJson } from '../../events/index.js';

const MAX_THUMBNAILS = 8;

/** Mounted at /api: exposes /projects/:id/events and /events/:id/... */
export function createEventRoutes(db: Database.Database): Hono {
  const app = new Hono();
  const projects = new ProjectRepository(db);
  const events = new EventRepository(db);
  const thumbs = new ThumbnailRepository(db);

  const summaryOf = (id: number): EventSummary =>
    events.listByProject(events.findById(id)!.project_id).find((e) => e.id === id)!;

  const withThumbnails = (e: EventSummary) => {
    const urls: string[] = [];
    for (const clip of events.clipsOf(e.id)) {
      if (urls.length >= MAX_THUMBNAILS) break;
      const [first] = thumbs.findByClip(clip.id);
      if (first) urls.push(`/media/thumbnails/${path.basename(first.file_path)}`);
    }
    return { ...eventJson(e), thumbnails: urls };
  };

  app.get('/projects/:id/events', (c) => {
    const id = Number(c.req.param('id'));
    if (!projects.findById(id)) return c.json({ error: 'Project not found' }, 404);
    return c.json({ data: events.listByProject(id).map(withThumbnails) });
  });

  app.get('/events/:id/clips', (c) => {
    const id = Number(c.req.param('id'));
    if (!events.findById(id)) return c.json({ error: 'Event not found' }, 404);
    const data = events.clipsOf(id).map((clip) => {
      const [first] = thumbs.findByClip(clip.id);
      return {
        id: clip.id,
        file_name: path.basename(clip.file_path),
        recorded_at: clip.recorded_at,
        duration_sec: clip.duration_sec,
        thumbnail: first ? `/media/thumbnails/${path.basename(first.file_path)}` : null,
      };
    });
    return c.json({ data });
  });

  app.patch('/events/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!events.findById(id)) return c.json({ error: 'Event not found' }, 404);
    const body = await c.req.json<{ name?: unknown }>().catch(() => ({} as { name?: unknown }));
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ error: 'name is required' }, 400);
    events.rename(id, name);
    return c.json({ data: eventJson(summaryOf(id)) });
  });

  app.post('/events/:id/merge', async (c) => {
    const id = Number(c.req.param('id'));
    if (!events.findById(id)) return c.json({ error: 'Event not found' }, 404);
    const body = await c.req.json<{ other_ids?: unknown }>().catch(() => ({} as { other_ids?: unknown }));
    const others = Array.isArray(body.other_ids) ? body.other_ids.map(Number) : [];
    if (others.length === 0 || others.some((n) => !Number.isInteger(n))) {
      return c.json({ error: 'other_ids must be a non-empty array of event ids' }, 400);
    }
    try {
      events.merge(id, others);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
    return c.json({ data: eventJson(summaryOf(id)) });
  });

  app.post('/events/:id/split', async (c) => {
    const id = Number(c.req.param('id'));
    if (!events.findById(id)) return c.json({ error: 'Event not found' }, 404);
    const body = await c.req.json<{ at_clip_id?: unknown }>().catch(() => ({} as { at_clip_id?: unknown }));
    const clipId = Number(body.at_clip_id);
    if (!Number.isInteger(clipId)) return c.json({ error: 'at_clip_id is required' }, 400);
    try {
      const created = events.split(id, clipId);
      return c.json({ data: [eventJson(summaryOf(id)), eventJson(summaryOf(created.id))] });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  return app;
}
