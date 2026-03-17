import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../../../src/db/repositories/clip.repository.js';
import { createSimilarityRoutes } from '../../../../../src/core/server/routes/similarity.js';

function seedAnalyzedClip(
  db: Database.Database,
  hash: string,
  opts: { location?: string; recorded_at?: string; keywords?: string; quality?: number } = {},
) {
  const repo = new ClipRepository(db);
  const clip = repo.insert({
    project_id: null,
    file_path: `/videos/${hash}.mp4`,
    proxy_path: null,
    file_hash: hash,
    file_size: 1000,
    duration_sec: 30,
    resolution: '1920x1080',
    fps: 30,
    codec: 'h264',
    recorded_at: opts.recorded_at ?? null,
    location: opts.location ?? null,
    manual_tags: null,
    people: null,
  });

  repo.updateAnalysis(clip.id, {
    ai_scenes: '[]',
    ai_summary: `Summary ${hash}`,
    ai_quality_stability: 4,
    ai_quality_focus: 4,
    ai_quality_exposure: 4,
    ai_quality_composition: 3,
    ai_quality_audio: 3,
    ai_quality_overall: opts.quality ?? 3.6,
    ai_quality_issues: '[]',
    ai_editorial_emotional: 4,
    ai_editorial_storytelling: 3,
    ai_editorial_uniqueness: 2,
    ai_editorial_suggested_use: 'B-Roll',
    ai_visual_keywords: opts.keywords ?? '[]',
  });

  return clip;
}

describe('Similarity API Routes', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createSimilarityRoutes>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    app = createSimilarityRoutes(db);
  });

  describe('POST /compute', () => {
    it('computes similarity clusters', async () => {
      seedAnalyzedClip(db, 'h1', {
        location: 'Beach',
        recorded_at: '2025-06-15T10:00:00Z',
        quality: 4.0,
      });
      seedAnalyzedClip(db, 'h2', {
        location: 'Beach',
        recorded_at: '2025-06-15T10:05:00Z',
        quality: 3.0,
      });

      const res = await app.request('/compute', { method: 'POST' });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.clusters_found).toBe(1);
    });

    it('returns 0 clusters for unrelated clips', async () => {
      seedAnalyzedClip(db, 'h1', { location: 'Beach' });
      seedAnalyzedClip(db, 'h2', { location: 'Mountain' });

      const res = await app.request('/compute', { method: 'POST' });
      const body = await res.json();
      expect(body.data.clusters_found).toBe(0);
    });
  });

  describe('GET /clusters', () => {
    it('returns computed clusters', async () => {
      seedAnalyzedClip(db, 'h1', {
        location: 'Beach',
        recorded_at: '2025-06-15T10:00:00Z',
      });
      seedAnalyzedClip(db, 'h2', {
        location: 'Beach',
        recorded_at: '2025-06-15T10:03:00Z',
      });

      // Compute first
      await app.request('/compute', { method: 'POST' });

      const res = await app.request('/clusters');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].members).toHaveLength(2);
    });

    it('returns empty when no clusters computed', async () => {
      const res = await app.request('/clusters');
      const body = await res.json();
      expect(body.data).toEqual([]);
    });
  });

  describe('PATCH /clusters/:id/best', () => {
    it('marks a different clip as best', async () => {
      seedAnalyzedClip(db, 'h1', {
        location: 'Beach',
        recorded_at: '2025-06-15T10:00:00Z',
        quality: 4.0,
      });
      seedAnalyzedClip(db, 'h2', {
        location: 'Beach',
        recorded_at: '2025-06-15T10:03:00Z',
        quality: 3.0,
      });

      await app.request('/compute', { method: 'POST' });

      // Get cluster id
      const clustersRes = await app.request('/clusters');
      const clusters = (await clustersRes.json()).data;
      const clusterId = clusters[0].id;

      // Mark clip 2 as best
      const res = await app.request(`/clusters/${clusterId}/best`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip_id: 2 }),
      });
      expect(res.status).toBe(200);

      // Verify
      const verifyRes = await app.request(`/clusters/${clusterId}`);
      const verifyBody = await verifyRes.json();
      const clip2Member = verifyBody.data.members.find((m: any) => m.clip_id === 2);
      expect(clip2Member.is_best).toBe(1);
    });

    it('returns 404 for non-existent cluster', async () => {
      const res = await app.request('/clusters/999/best', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip_id: 1 }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /by-clip/:clipId', () => {
    it('returns clusters containing a clip', async () => {
      seedAnalyzedClip(db, 'h1', {
        location: 'Beach',
        recorded_at: '2025-06-15T10:00:00Z',
      });
      seedAnalyzedClip(db, 'h2', {
        location: 'Beach',
        recorded_at: '2025-06-15T10:03:00Z',
      });

      await app.request('/compute', { method: 'POST' });

      const res = await app.request('/by-clip/1');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveLength(1);
    });

    it('returns empty for clip not in any cluster', async () => {
      seedAnalyzedClip(db, 'h1', { location: 'Beach' });

      const res = await app.request('/by-clip/1');
      const body = await res.json();
      expect(body.data).toEqual([]);
    });
  });
});
