import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../src/db/migrations/runner.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';
import { ClipRepository } from '../../../../src/db/repositories/clip.repository.js';
import { searchClips } from '../../../../src/core/search/engine.js';

function seedClip(repo: ClipRepository, hash: string, summary: string, keywords: string, location: string | null = null) {
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
    recorded_at: null,
    start_timecode: null,
    location,
    manual_tags: null,
    people: null,
  });

  repo.updateAnalysis(clip.id, {
    ai_scenes: '[]',
    ai_summary: summary,
    ai_visual_keywords: keywords,
  });

  return clip;
}

describe('searchClips', () => {
  let db: Database.Database;
  let repo: ClipRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    repo = new ClipRepository(db);

    seedClip(repo, 'h1', 'Kinder spielen am Strand mit Sand', '["Strand","Kinder","Sand"]', 'Mallorca');
    seedClip(repo, 'h2', 'Sonnenuntergang über dem Meer', '["Sonnenuntergang","Meer","Abend"]', 'Mallorca');
    seedClip(repo, 'h3', 'Wanderung durch den Bergwald', '["Wanderung","Berg","Wald"]', 'Alpen');
  });

  it('finds clips matching a keyword', () => {
    const results = searchClips(repo, 'Strand');
    expect(results).toHaveLength(1);
    expect(results[0].file_hash).toBe('h1');
  });

  it('finds clips matching keywords in visual_keywords', () => {
    const results = searchClips(repo, 'Sonnenuntergang');
    expect(results).toHaveLength(1);
    expect(results[0].file_hash).toBe('h2');
  });

  it('returns empty for non-matching query', () => {
    const results = searchClips(repo, 'Schnee');
    expect(results).toHaveLength(0);
  });

  it('handles special characters safely', () => {
    const results = searchClips(repo, 'Strand (test) [brackets]');
    // Should not throw, may or may not find results
    expect(Array.isArray(results)).toBe(true);
  });

  it('respects limit filter', () => {
    const results = searchClips(repo, 'Mallorca', { limit: 1 });
    expect(results).toHaveLength(1);
  });

  it('filters by min_tier: needs a moment at or above the tier', () => {
    const hl = new HighlightRepository(db);
    const strand = repo.search('Strand')[0];
    expect(searchClips(repo, 'Strand', { min_tier: 'filler' })).toHaveLength(0);
    hl.replaceForClip(strand.id, [{ start_sec: 0, end_sec: 2, description: 'x', tier: 'solid' }]);
    expect(searchClips(repo, 'Strand', { min_tier: 'filler' })).toHaveLength(1);
    expect(searchClips(repo, 'Strand', { min_tier: 'solid' })).toHaveLength(1);
    expect(searchClips(repo, 'Strand', { min_tier: 'hero' })).toHaveLength(0);
  });
});
