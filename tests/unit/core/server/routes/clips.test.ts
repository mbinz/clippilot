import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../../../src/db/repositories/clip.repository.js';
import { createClipRoutes } from '../../../../../src/core/server/routes/clips.js';

function seedClip(db: Database.Database, hash: string, location?: string) {
  const repo = new ClipRepository(db);
  const clip = repo.insert({
    project_id: null,
    file_path: `/videos/${hash}.mp4`,
    proxy_path: `/proxies/${hash}.mp4`,
    file_hash: hash,
    file_size: 1000,
    duration_sec: 30,
    resolution: '1920x1080',
    fps: 30,
    codec: 'h264',
    recorded_at: '2025-06-15T10:00:00Z',
    location: location ?? null,
    manual_tags: null,
    people: null,
  });

  repo.updateAnalysis(clip.id, {
    ai_scenes: '[]',
    ai_summary: `Summary for ${hash}`,
    ai_quality_stability: 4,
    ai_quality_focus: 4,
    ai_quality_exposure: 4,
    ai_quality_composition: 3,
    ai_quality_audio: 3,
    ai_quality_overall: 3.6,
    ai_quality_issues: '[]',
    ai_editorial_emotional: 4,
    ai_editorial_storytelling: 3,
    ai_editorial_uniqueness: 2,
    ai_editorial_suggested_use: 'B-Roll',
    ai_visual_keywords: '["test"]',
  });

  return clip;
}

describe('Clip API Routes', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createClipRoutes>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    app = createClipRoutes(db);
  });

  describe('GET /', () => {
    it('returns paginated clips', async () => {
      seedClip(db, 'h1');
      seedClip(db, 'h2');

      const res = await app.request('/');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveLength(2);
      expect(body.meta.total).toBe(2);
      expect(body.meta.page).toBe(1);
    });

    it('filters by location', async () => {
      seedClip(db, 'h1', 'Beach');
      seedClip(db, 'h2', 'Mountain');

      const res = await app.request('/?location=Beach');
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].file_hash).toBe('h1');
    });

    it('searches by query', async () => {
      seedClip(db, 'h1');
      seedClip(db, 'h2');

      const res = await app.request('/?q=h1');
      const body = await res.json();
      expect(body.data).toHaveLength(1);
    });

    it('parses JSON fields in response', async () => {
      seedClip(db, 'h1');

      const res = await app.request('/');
      const body = await res.json();
      expect(Array.isArray(body.data[0].ai_scenes)).toBe(true);
      expect(Array.isArray(body.data[0].ai_visual_keywords)).toBe(true);
    });

    it('returns empty for no matches', async () => {
      const res = await app.request('/?location=Nowhere');
      const body = await res.json();
      expect(body.data).toHaveLength(0);
      expect(body.meta.total).toBe(0);
    });
  });

  describe('GET /:id', () => {
    it('returns single clip', async () => {
      const clip = seedClip(db, 'h1');

      const res = await app.request(`/${clip.id}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.id).toBe(clip.id);
      expect(body.data.ai_summary).toBe('Summary for h1');
    });

    it('returns 404 for non-existent clip', async () => {
      const res = await app.request('/999');
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /:id', () => {
    it('updates clip metadata', async () => {
      const clip = seedClip(db, 'h1');

      const res = await app.request(`/${clip.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: 'Updated Location',
          manual_tags: ['tag1', 'tag2'],
          people: ['Person1'],
        }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.location).toBe('Updated Location');
      expect(body.data.manual_tags).toEqual(['tag1', 'tag2']);
      expect(body.data.people).toEqual(['Person1']);
    });

    it('returns 404 for non-existent clip', async () => {
      const res = await app.request('/999', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: 'Test' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /:id/thumbnails', () => {
    it('returns thumbnails for a clip', async () => {
      const clip = seedClip(db, 'h1');
      // Seed a thumbnail
      db.prepare('INSERT INTO thumbnails (clip_id, file_path, timestamp_sec) VALUES (?, ?, ?)')
        .run(clip.id, '/thumbnails/h1_0.jpg', 5);

      const res = await app.request(`/${clip.id}/thumbnails`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].url).toContain('h1_0.jpg');
    });

    it('returns 404 for non-existent clip', async () => {
      const res = await app.request('/999/thumbnails');
      expect(res.status).toBe(404);
    });
  });
});
