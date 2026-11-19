import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../../../src/db/repositories/clip.repository.js';
import { HighlightRepository } from '../../../../../src/db/repositories/highlight.repository.js';
import { createSimilarityRoutes } from '../../../../../src/core/server/routes/similarity.js';

function seedAnalyzedClip(
  db: Database.Database,
  hash: string,
  opts: { location?: string; recorded_at?: string; keywords?: string; tier?: 'hero' | 'solid' | 'filler' } = {},
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
    nb_frames: null,
    has_video: 1,
    has_audio: 1,
    codec: 'h264',
    recorded_at: opts.recorded_at ?? null,
    start_timecode: null,
    location: opts.location ?? null,
    manual_tags: null,
    people: null,
  });

  repo.updateAnalysis(clip.id, {
    ai_scenes: '[]',
    ai_summary: `Summary ${hash}`,
    ai_visual_keywords: opts.keywords ?? '[]',
  });

  if (opts.tier) {
    new HighlightRepository(db).replaceForClip(clip.id, [{ start_sec: 0, end_sec: 2, description: 'x', tier: opts.tier }]);
  }

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
        tier: 'hero',
      });
      seedAnalyzedClip(db, 'h2', {
        location: 'Beach',
        recorded_at: '2025-06-15T10:05:00Z',
        tier: 'filler',
      });

      const res = await app.request('/compute', { method: 'POST' });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.clusters_found).toBe(1);
    });

    it('orders members by best moment tier and stores the tier rank as score', async () => {
      seedAnalyzedClip(db, 'h1', { location: 'Beach', recorded_at: '2025-06-15T10:00:00Z', tier: 'filler' });
      seedAnalyzedClip(db, 'h2', { location: 'Beach', recorded_at: '2025-06-15T10:05:00Z', tier: 'hero' });
      await app.request('/compute', { method: 'POST' });
      const body = await (await app.request('/clusters')).json();
      const members = body.data[0].members;
      expect(members.map((m: any) => [m.clip_id, m.is_best, m.similarity_score])).toEqual([[2, 1, 3], [1, 0, 1]]);
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
        tier: 'hero',
      });
      seedAnalyzedClip(db, 'h2', {
        location: 'Beach',
        recorded_at: '2025-06-15T10:03:00Z',
        tier: 'filler',
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
