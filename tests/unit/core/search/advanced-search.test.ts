import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../../src/db/repositories/clip.repository.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';
import { ProjectRepository } from '../../../../src/db/repositories/project.repository.js';
import { advancedSearch } from '../../../../src/core/search/advanced.js';

let hlRepo: HighlightRepository;

function seedClip(
  repo: ClipRepository,
  hash: string,
  overrides: {
    summary?: string;
    keywords?: string;
    location?: string;
    recorded_at?: string;
    tier?: 'hero' | 'solid' | 'filler';
    tags?: string;
    people?: string;
    scenes?: string;
    project_id?: number;
  } = {},
) {
  const clip = repo.insert({
    project_id: overrides.project_id ?? null,
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
    recorded_at: overrides.recorded_at ?? null,
    start_timecode: null,
    location: overrides.location ?? null,
    manual_tags: overrides.tags ?? null,
    people: overrides.people ?? null,
  });

  repo.updateAnalysis(clip.id, {
    ai_scenes: overrides.scenes ?? '[]',
    ai_summary: overrides.summary ?? 'Test clip',
    ai_visual_keywords: overrides.keywords ?? '[]',
  });

  if (overrides.tier) {
    hlRepo.replaceForClip(clip.id, [{ start_sec: 0, end_sec: 2, description: 'x', tier: overrides.tier }]);
  }

  return clip;
}

describe('advancedSearch', () => {
  let db: Database.Database;
  let clipRepo: ClipRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    clipRepo = new ClipRepository(db);
    hlRepo = new HighlightRepository(db);

    seedClip(clipRepo, 'h1', {
      summary: 'Kinder spielen am Strand',
      keywords: '["Strand","Kinder","Sand"]',
      location: 'Mallorca',
      recorded_at: '2025-06-15T10:00:00Z',
      tier: 'hero',
      tags: '["urlaub","strand"]',
      people: '["Anna","Max"]',
      scenes: '[{"setting":"Beach","activity":"Playing","mood":"happy"}]',
    });

    seedClip(clipRepo, 'h2', {
      summary: 'Sonnenuntergang am Meer',
      keywords: '["Sonnenuntergang","Meer"]',
      location: 'Mallorca',
      recorded_at: '2025-06-15T18:00:00Z',
      tier: 'solid',
      tags: '["urlaub","abend"]',
      scenes: '[{"setting":"Beach","activity":"Watching","mood":"calm"}]',
    });

    seedClip(clipRepo, 'h3', {
      summary: 'Wanderung in den Bergen',
      keywords: '["Berg","Wanderung","Wald"]',
      location: 'Alpen',
      recorded_at: '2025-07-01T14:00:00Z',
      tier: 'filler',
      tags: '["wanderung"]',
      people: '["Max"]',
      scenes: '[{"setting":"Mountain","activity":"Hiking","mood":"exciting"}]',
    });
  });

  it('returns all clips without filters', () => {
    const result = advancedSearch(db, {});
    expect(result.items).toHaveLength(3);
    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
  });

  it('searches by full-text query', () => {
    const result = advancedSearch(db, { q: 'Strand' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].file_hash).toBe('h1');
  });

  it('filters by location', () => {
    const result = advancedSearch(db, { location: 'Mallorca' });
    expect(result.items).toHaveLength(2);
  });

  it('filters by min_tier: clip has a moment at or above the tier', () => {
    expect(advancedSearch(db, { min_tier: 'hero' }).items.map((c) => c.file_hash)).toEqual(['h1']);
    expect(advancedSearch(db, { min_tier: 'solid' }).items.map((c) => c.file_hash).sort()).toEqual(['h1', 'h2']);
    expect(advancedSearch(db, { min_tier: 'filler' }).items).toHaveLength(3);
  });

  it('min_tier excludes clips without moments', () => {
    seedClip(clipRepo, 'h9', { summary: 'no moments' });
    expect(advancedSearch(db, { min_tier: 'filler' }).items.map((c) => c.file_hash)).not.toContain('h9');
    expect(advancedSearch(db, {}).items).toHaveLength(4);
  });

  it('filters by date range', () => {
    const result = advancedSearch(db, {
      date_from: '2025-06-15T00:00:00Z',
      date_to: '2025-06-15T23:59:59Z',
    });
    expect(result.items).toHaveLength(2);
  });

  it('filters by tags via json_each', () => {
    const result = advancedSearch(db, { tags: ['strand'] });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].file_hash).toBe('h1');
  });

  it('filters by people via json_each', () => {
    const result = advancedSearch(db, { people: ['Max'] });
    expect(result.items).toHaveLength(2);
  });

  it('filters by mood from ai_scenes', () => {
    const result = advancedSearch(db, { mood: 'happy' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].file_hash).toBe('h1');
  });

  it('paginates results', () => {
    const page1 = advancedSearch(db, { per_page: 2, page: 1 });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(3);
    expect(page1.total_pages).toBe(2);

    const page2 = advancedSearch(db, { per_page: 2, page: 2 });
    expect(page2.items).toHaveLength(1);
  });

  it('sorts by date ascending', () => {
    const result = advancedSearch(db, { sort: 'date', sort_dir: 'asc' });
    expect(result.items[0].file_hash).toBe('h1');
    expect(result.items[2].file_hash).toBe('h3');
  });

  it('combines multiple filters', () => {
    const result = advancedSearch(db, {
      location: 'Mallorca',
      min_tier: 'solid',
      tags: ['abend'],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].file_hash).toBe('h2');
  });

  it('returns empty for non-matching filters', () => {
    const result = advancedSearch(db, { location: 'Nowhere' });
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('filters by project_id', () => {
    const projectRepo = new ProjectRepository(db);
    const project = projectRepo.findOrCreate('Test Project');

    seedClip(clipRepo, 'h4', { project_id: project.id, summary: 'Project clip' });

    const result = advancedSearch(db, { project_id: project.id });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].file_hash).toBe('h4');
  });
});
