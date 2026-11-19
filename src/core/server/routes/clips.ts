import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { ClipRepository } from '../../../db/repositories/clip.repository.js';
import { ThumbnailRepository } from '../../../db/repositories/thumbnail.repository.js';
import { HighlightRepository } from '../../../db/repositories/highlight.repository.js';
import { highlightsToJson } from '../../../cli/json.js';
import { isTier } from '../../tiers.js';
import type { Clip } from '../../../types/clip.js';
import { advancedSearch } from '../../search/advanced.js';
import path from 'node:path';

export function createClipRoutes(db: Database.Database): Hono {
  const app = new Hono();
  const clipRepo = new ClipRepository(db);
  const thumbnailRepo = new ThumbnailRepository(db);

  const highlightRepo = new HighlightRepository(db);

  /** Parse JSON columns and attach the clip's moments (tier / shot / role / issues). */
  function serializeClip(clip: Clip) {
    return {
      ...clip,
      ai_scenes: clip.ai_scenes ? JSON.parse(clip.ai_scenes) : null,
      ai_visual_keywords: clip.ai_visual_keywords ? JSON.parse(clip.ai_visual_keywords) : null,
      manual_tags: clip.manual_tags ? JSON.parse(clip.manual_tags) : null,
      people: clip.people ? JSON.parse(clip.people) : null,
      highlights: highlightsToJson(highlightRepo.findByClip(clip.id)),
    };
  }

  // GET /clips - List/search clips with filters and pagination
  app.get('/', (c) => {
    const q = c.req.query('q') || undefined;
    const project_id = c.req.query('project_id') ? Number(c.req.query('project_id')) : undefined;
    const location = c.req.query('location') || undefined;
    const date_from = c.req.query('date_from') || undefined;
    const date_to = c.req.query('date_to') || undefined;
    const minTierRaw = c.req.query('min_tier');
    const min_tier = isTier(minTierRaw) ? minTierRaw : undefined;
    const mood = c.req.query('mood') || undefined;
    const tags = c.req.query('tags') ? c.req.query('tags')!.split(',') : undefined;
    const people = c.req.query('people') ? c.req.query('people')!.split(',') : undefined;
    const sort = c.req.query('sort') as 'date' | 'duration' | undefined;
    const sort_dir = c.req.query('sort_dir') as 'asc' | 'desc' | undefined;
    const page = c.req.query('page') ? Number(c.req.query('page')) : undefined;
    const per_page = c.req.query('per_page') ? Number(c.req.query('per_page')) : undefined;

    const result = advancedSearch(db, {
      q, project_id, location, date_from, date_to,
      min_tier, mood,
      tags, people, sort, sort_dir, page, per_page,
    });

    const items = result.items.map(serializeClip);

    return c.json({
      data: items,
      meta: {
        total: result.total,
        page: result.page,
        per_page: result.per_page,
        total_pages: result.total_pages,
      },
    });
  });

  // GET /clips/:id - Get single clip with all data
  app.get('/:id', (c) => {
    const id = Number(c.req.param('id'));
    const clip = clipRepo.findById(id);
    if (!clip) {
      return c.json({ error: 'Clip not found' }, 404);
    }

    return c.json({ data: serializeClip(clip) });
  });

  // GET /clips/:id/thumbnails - Get thumbnails for a clip
  app.get('/:id/thumbnails', (c) => {
    const id = Number(c.req.param('id'));
    const clip = clipRepo.findById(id);
    if (!clip) {
      return c.json({ error: 'Clip not found' }, 404);
    }

    const thumbnails = thumbnailRepo.findByClip(id);
    const data = thumbnails.map((t) => ({
      id: t.id,
      clip_id: t.clip_id,
      timestamp_sec: t.timestamp_sec,
      url: `/media/thumbnails/${path.basename(t.file_path)}`,
    }));

    return c.json({ data });
  });

  // PATCH /clips/:id - Update editable metadata
  app.patch('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const clip = clipRepo.findById(id);
    if (!clip) {
      return c.json({ error: 'Clip not found' }, 404);
    }

    const body = await c.req.json<{
      location?: string | null;
      manual_tags?: string[] | null;
      people?: string[] | null;
    }>();

    const newTags = body.manual_tags !== undefined
      ? (body.manual_tags ? JSON.stringify(body.manual_tags) : null)
      : clip.manual_tags;
    const newLocation = body.location !== undefined ? body.location : clip.location;
    const newPeople = body.people !== undefined
      ? (body.people ? JSON.stringify(body.people) : null)
      : clip.people;

    clipRepo.updateTags(id, newTags, newLocation, newPeople);

    const updated = clipRepo.findById(id)!;
    return c.json({ data: serializeClip(updated) });
  });

  return app;
}
