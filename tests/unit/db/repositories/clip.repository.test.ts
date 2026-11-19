import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../../src/db/repositories/clip.repository.js';
import { ProjectRepository } from '../../../../src/db/repositories/project.repository.js';
import type { InsertClip } from '../../../../src/types/clip.js';

function makeClip(overrides: Partial<InsertClip> = {}): InsertClip {
  return {
    project_id: null,
    file_path: '/videos/test.mp4',
    proxy_path: '/proxies/abc123.mp4',
    file_hash: 'abc123def456',
    file_size: 1000000,
    duration_sec: 30.5,
    resolution: '1920x1080',
    fps: 30,
    nb_frames: 915,
    has_video: 1,
    has_audio: 1,
    codec: 'h264',
    recorded_at: '2025-06-15T10:00:00Z',
    start_timecode: null,
    location: null,
    manual_tags: null,
    people: null,
    ...overrides,
  };
}

describe('ClipRepository', () => {
  let db: Database.Database;
  let repo: ClipRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    repo = new ClipRepository(db);
  });

  it('inserts and retrieves a clip', () => {
    const clip = repo.insert(makeClip());
    expect(clip.id).toBe(1);
    expect(clip.file_path).toBe('/videos/test.mp4');
    expect(clip.analysis_status).toBe('pending');
  });

  it('finds by hash', () => {
    repo.insert(makeClip({ file_hash: 'hash1' }));
    const found = repo.findByHash('hash1');
    expect(found).not.toBeNull();
    expect(found!.file_hash).toBe('hash1');
  });

  it('returns null for unknown hash', () => {
    expect(repo.findByHash('nonexistent')).toBeNull();
  });

  it('finds by id', () => {
    const clip = repo.insert(makeClip());
    const found = repo.findById(clip.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(clip.id);
  });

  it('enforces unique hash constraint', () => {
    repo.insert(makeClip({ file_hash: 'unique1' }));
    expect(() => repo.insert(makeClip({ file_hash: 'unique1' }))).toThrow();
  });

  it('finds pending clips', () => {
    repo.insert(makeClip({ file_hash: 'h1' }));
    repo.insert(makeClip({ file_hash: 'h2' }));
    const pending = repo.findPending();
    expect(pending).toHaveLength(2);
  });

  it('updates analysis data', () => {
    const clip = repo.insert(makeClip());
    repo.updateAnalysis(clip.id, {
      ai_scenes: '[]',
      ai_summary: 'Test summary',
      ai_quality_stability: 4,
      ai_quality_focus: 5,
      ai_quality_exposure: 4,
      ai_quality_composition: 3,
      ai_quality_audio: 2,
      ai_quality_overall: 3.6,
      ai_quality_issues: '["wind noise"]',
      ai_editorial_emotional: 4,
      ai_editorial_storytelling: 3,
      ai_editorial_uniqueness: 2,
      ai_editorial_suggested_use: 'B-Roll',
      ai_visual_keywords: '["beach","sand"]',
    });

    const updated = repo.findById(clip.id)!;
    expect(updated.analysis_status).toBe('done');
    expect(updated.ai_summary).toBe('Test summary');
    expect(updated.ai_quality_overall).toBe(3.6);
  });

  it('updates analysis error', () => {
    const clip = repo.insert(makeClip());
    repo.updateAnalysisError(clip.id, 'API timeout');
    const updated = repo.findById(clip.id)!;
    expect(updated.analysis_status).toBe('error');
    expect(updated.analysis_error).toBe('API timeout');
  });

  it('finds by multiple ids', () => {
    const c1 = repo.insert(makeClip({ file_hash: 'h1' }));
    repo.insert(makeClip({ file_hash: 'h2' }));
    const c3 = repo.insert(makeClip({ file_hash: 'h3' }));

    const found = repo.findByIds([c1.id, c3.id]);
    expect(found).toHaveLength(2);
  });

  it('returns empty for findByIds with empty array', () => {
    expect(repo.findByIds([])).toEqual([]);
  });

  it('gets stats', () => {
    repo.insert(makeClip({ file_hash: 'h1' }));
    repo.insert(makeClip({ file_hash: 'h2' }));
    const stats = repo.getStats();
    expect(stats.total).toBe(2);
    expect(stats.pending).toBe(2);
    expect(stats.analyzed).toBe(0);
  });

  it('supports FTS search after analysis update', () => {
    const clip = repo.insert(makeClip({ location: 'Mallorca' }));
    repo.updateAnalysis(clip.id, {
      ai_scenes: '[]',
      ai_summary: 'Kinder spielen am Strand',
      ai_quality_stability: 4,
      ai_quality_focus: 5,
      ai_quality_exposure: 4,
      ai_quality_composition: 3,
      ai_quality_audio: 2,
      ai_quality_overall: 3.6,
      ai_quality_issues: '[]',
      ai_editorial_emotional: 4,
      ai_editorial_storytelling: 3,
      ai_editorial_uniqueness: 2,
      ai_editorial_suggested_use: 'B-Roll',
      ai_visual_keywords: '["Strand","Kinder"]',
    });

    const results = repo.search('Strand');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(clip.id);
  });

  it('FTS search returns empty for non-matching query', () => {
    const clip = repo.insert(makeClip());
    repo.updateAnalysis(clip.id, {
      ai_scenes: '[]',
      ai_summary: 'Beach scene',
      ai_quality_stability: 4,
      ai_quality_focus: 5,
      ai_quality_exposure: 4,
      ai_quality_composition: 3,
      ai_quality_audio: 2,
      ai_quality_overall: 3.6,
      ai_quality_issues: '[]',
      ai_editorial_emotional: 4,
      ai_editorial_storytelling: 3,
      ai_editorial_uniqueness: 2,
      ai_editorial_suggested_use: 'B-Roll',
      ai_visual_keywords: '["beach"]',
    });

    const results = repo.search('mountains');
    expect(results).toHaveLength(0);
  });

  it('findByPathAndSize hits on same path and size, misses on different size', () => {
    repo.insert(makeClip({ file_path: '/videos/a.mp4', file_size: 1234, file_hash: 'ha' }));
    expect(repo.findByPathAndSize('/videos/a.mp4', 1234)?.file_hash).toBe('ha');
    expect(repo.findByPathAndSize('/videos/a.mp4', 1235)).toBeNull();
    expect(repo.findByPathAndSize('/videos/b.mp4', 1234)).toBeNull();
  });

  it('findPending returns analyzing clips too', () => {
    const c = repo.insert(makeClip({ file_hash: 'hx' }));
    repo.updateAnalysisStatus(c.id, 'analyzing');
    const done = repo.insert(makeClip({ file_hash: 'hy', file_path: '/videos/y.mp4' }));
    repo.updateAnalysisStatus(done.id, 'done');
    expect(repo.findPending().map((x) => x.id)).toEqual([c.id]);
  });

  it('resetErrors flips only error clips of the given project and clears analysis_error', () => {
    const projects = new ProjectRepository(db);
    const p1 = projects.findOrCreate('p1');
    const p2 = projects.findOrCreate('p2');
    const a = repo.insert(makeClip({ file_hash: 'ra', project_id: p1.id }));
    const b = repo.insert(makeClip({ file_hash: 'rb', project_id: p2.id }));
    const c = repo.insert(makeClip({ file_hash: 'rc', project_id: p1.id }));
    repo.updateAnalysisError(a.id, 'boom');
    repo.updateAnalysisError(b.id, 'boom');
    repo.updateAnalysisStatus(c.id, 'done');

    expect(repo.resetErrors(p1.id)).toBe(1);
    expect(repo.findById(a.id)!.analysis_status).toBe('pending');
    expect(repo.findById(a.id)!.analysis_error).toBeNull();
    expect(repo.findById(b.id)!.analysis_status).toBe('error');
    expect(repo.findById(c.id)!.analysis_status).toBe('done');

    expect(repo.resetErrors()).toBe(1);
    expect(repo.findById(b.id)!.analysis_status).toBe('pending');
  });
});
