import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../../../src/db/repositories/clip.repository.js';
import { createFacetRoutes } from '../../../../../src/core/server/routes/facets.js';

function seedClip(db: Database.Database, hash: string, opts: {
  location?: string;
  tags?: string;
  people?: string;
  scenes?: string;
  suggested_use?: string;
}) {
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
    recorded_at: null,
    location: opts.location ?? null,
    manual_tags: opts.tags ?? null,
    people: opts.people ?? null,
  });

  repo.updateAnalysis(clip.id, {
    ai_scenes: opts.scenes ?? '[]',
    ai_summary: 'Test',
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
    ai_editorial_suggested_use: opts.suggested_use ?? 'B-Roll',
    ai_visual_keywords: '[]',
  });
}

describe('Facets API Routes', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createFacetRoutes>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    app = createFacetRoutes(db);
  });

  it('returns empty facets when no clips exist', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.locations).toEqual([]);
    expect(body.data.suggested_uses).toEqual([]);
    expect(body.data.tags).toEqual([]);
    expect(body.data.people).toEqual([]);
    expect(body.data.moods).toEqual([]);
  });

  it('returns distinct locations', async () => {
    seedClip(db, 'h1', { location: 'Beach' });
    seedClip(db, 'h2', { location: 'Beach' });
    seedClip(db, 'h3', { location: 'Mountain' });

    const res = await app.request('/');
    const body = await res.json();
    expect(body.data.locations).toEqual(['Beach', 'Mountain']);
  });

  it('returns distinct suggested_uses', async () => {
    seedClip(db, 'h1', { suggested_use: 'Hero Shot' });
    seedClip(db, 'h2', { suggested_use: 'B-Roll' });

    const res = await app.request('/');
    const body = await res.json();
    expect(body.data.suggested_uses).toContain('Hero Shot');
    expect(body.data.suggested_uses).toContain('B-Roll');
  });

  it('extracts and deduplicates tags from JSON arrays', async () => {
    seedClip(db, 'h1', { tags: '["urlaub","strand"]' });
    seedClip(db, 'h2', { tags: '["urlaub","berg"]' });

    const res = await app.request('/');
    const body = await res.json();
    expect(body.data.tags).toContain('urlaub');
    expect(body.data.tags).toContain('strand');
    expect(body.data.tags).toContain('berg');
    expect(body.data.tags).toHaveLength(3);
  });

  it('extracts people from JSON arrays', async () => {
    seedClip(db, 'h1', { people: '["Anna","Max"]' });
    seedClip(db, 'h2', { people: '["Max","Lisa"]' });

    const res = await app.request('/');
    const body = await res.json();
    expect(body.data.people).toContain('Anna');
    expect(body.data.people).toContain('Max');
    expect(body.data.people).toContain('Lisa');
    expect(body.data.people).toHaveLength(3);
  });

  it('extracts moods from ai_scenes JSON', async () => {
    seedClip(db, 'h1', {
      scenes: '[{"setting":"Beach","activity":"Play","mood":"happy"}]',
    });
    seedClip(db, 'h2', {
      scenes: '[{"setting":"Park","activity":"Walk","mood":"calm"},{"setting":"Beach","activity":"Swim","mood":"happy"}]',
    });

    const res = await app.request('/');
    const body = await res.json();
    expect(body.data.moods).toContain('happy');
    expect(body.data.moods).toContain('calm');
    expect(body.data.moods).toHaveLength(2);
  });
});
