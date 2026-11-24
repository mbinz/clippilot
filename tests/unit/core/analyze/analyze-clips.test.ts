import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../../src/db/repositories/clip.repository.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';
import { analyzeClips } from '../../../../src/core/analyze/index.js';
import { TranscriptRepository } from '../../../../src/db/repositories/transcript.repository.js';
import { DEFAULT_CONFIG } from '../../../../src/core/config/defaults.js';
import type { ClipAnalysisResponse } from '../../../../src/core/analyze/schema.js';

function response(highlights: ClipAnalysisResponse['highlights']): ClipAnalysisResponse {
  return {
    scenes: [
      {
        start_sec: 0,
        end_sec: 4,
        description_en: 'Beach',
        subjects: [],
        setting: 'Strand',
        activity: 'Gehen',
        mood: 'ruhig',
        visual_keywords: ['Strand'],
      },
    ],
    clip_summary: 'Strand',
    highlights,
  };
}

describe('analyzeClips with highlights', () => {
  let db: Database.Database;
  let clipRepo: ClipRepository;
  let hlRepo: HighlightRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    clipRepo = new ClipRepository(db);
    hlRepo = new HighlightRepository(db);
  });

  function insertClipInput() {
    return {
      project_id: null, file_path: '/v/a.mp4', proxy_path: null, file_hash: 'h1', file_size: 10,
      duration_sec: 4.3, resolution: null, fps: null, nb_frames: null, has_video: 1, has_audio: 1,
      codec: null, recorded_at: null, start_timecode: null, location: null, manual_tags: null, people: null,
    };
  }
  function insertClip() { return clipRepo.insert(insertClipInput()); }

  it('stores normalized highlights, sets status done, and replaces on re-run', async () => {
    const clip = insertClip();

    const first = { analyzeVideo: async () => response([{ start_sec: 3.5, end_sec: 9, description: 'Wave', tier: 'hero', shot: 'wide', role: 'action', issues: ['shake'] }]) };
    const r1 = await analyzeClips([clip], DEFAULT_CONFIG, clipRepo, () => {}, hlRepo, first);
    expect(r1).toEqual({ success: 1, errors: 0 });
    expect(clipRepo.findById(clip.id)!.analysis_status).toBe('done');
    const stored = hlRepo.findByClip(clip.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ start_sec: 2.3, end_sec: 4.3, description: 'Wave', tier: 'hero', shot: 'wide', role: 'action' });
    expect(JSON.parse(stored[0].issues)).toEqual(['shake']);

    const second = { analyzeVideo: async () => response([{ start_sec: 0.5, end_sec: 2, description: 'Gull', tier: 'filler', shot: 'close', role: 'detail' }]) };
    await analyzeClips([clip], DEFAULT_CONFIG, clipRepo, () => {}, hlRepo, second);
    const after = hlRepo.findByClip(clip.id);
    expect(after.map((h) => h.description)).toEqual(['Gull']);
  });
  it('re-analysis (force) keeps a confirmed moment and drops proposed ones', async () => {
    const clip = insertClip();
    const first = { analyzeVideo: async () => response([
      { start_sec: 0.5, end_sec: 2, description: 'Keep', tier: 'hero', shot: 'wide', role: 'action' },
      { start_sec: 2.5, end_sec: 4, description: 'Drop', tier: 'filler', shot: 'close', role: 'detail' },
    ]) };
    await analyzeClips([clip], DEFAULT_CONFIG, clipRepo, () => {}, hlRepo, first);
    const keep = hlRepo.findByClip(clip.id).find((h) => h.description === 'Keep')!;
    db.prepare("UPDATE highlights SET status = 'confirmed' WHERE id = ?").run(keep.id);

    clipRepo.resetAnalysis(undefined, [clip.id]);
    const second = { analyzeVideo: async () => response([{ start_sec: 2.5, end_sec: 4.3, description: 'Fresh', tier: 'solid', shot: 'wide', role: 'action' }]) };
    await analyzeClips([clipRepo.findById(clip.id)!], DEFAULT_CONFIG, clipRepo, () => {}, hlRepo, second);

    expect(hlRepo.findByClip(clip.id).map((h) => [h.description, h.status]).sort()).toEqual([
      ['Fresh', 'proposed'], ['Keep', 'confirmed'],
    ]);
    expect(hlRepo.findByClip(clip.id).find((h) => h.description === 'Keep')!.id).toBe(keep.id);
  });
  it('uses an existing transcript: moments are snapped to whole sentences, no 8 s cap', async () => {
    const clip = clipRepo.insert({ ...insertClipInput(), duration_sec: 60 });
    new TranscriptRepository(db).save(clip.id, 'm', {
      language: 'de', words: [], segments: [{ start: 1, end: 20, text: 'Eine lange Erklärung.' }],
    });
    const client = { analyzeVideo: async () => response([{ start_sec: 5, end_sec: 9, description: 'Rede', tier: 'hero', shot: 'medium', role: 'action' }]) };
    await analyzeClips([clip], DEFAULT_CONFIG, clipRepo, () => {}, hlRepo, client, new TranscriptRepository(db));
    expect(hlRepo.findByClip(clip.id).map((h) => [h.start_sec, h.end_sec])).toEqual([[1, 20]]);
  });
  it('leaves analysis_profile_version NULL (taste profiles are gone)', async () => {
    const a = insertClip();
    await analyzeClips([a], DEFAULT_CONFIG, clipRepo, () => {}, hlRepo, { analyzeVideo: async () => response([]) });
    expect((clipRepo.findById(a.id) as any).analysis_profile_version).toBeNull();
  });
});
