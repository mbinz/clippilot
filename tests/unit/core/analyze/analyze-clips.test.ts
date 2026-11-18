import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../../src/db/repositories/clip.repository.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';
import { analyzeClips } from '../../../../src/core/analyze/index.js';
import { DEFAULT_CONFIG } from '../../../../src/core/config/defaults.js';
import type { ClipAnalysisResponse } from '../../../../src/core/analyze/schema.js';

function response(highlights: ClipAnalysisResponse['highlights']): ClipAnalysisResponse {
  return {
    scenes: [
      {
        start_sec: 0,
        end_sec: 4,
        description_de: 'Strand',
        description_en: 'Beach',
        subjects: [],
        setting: 'Strand',
        activity: 'Gehen',
        mood: 'ruhig',
        visual_keywords: ['Strand'],
      },
    ],
    technical_quality: {
      stability: 4, focus: 4, exposure: 4, composition: 4, audio_quality: 3, overall_score: 4, issues: [],
    },
    editorial_value: {
      emotional_impact: 3, storytelling_potential: 3, uniqueness: 3, suggested_use: 'B-Roll',
    },
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

  function insertClip() {
    return clipRepo.insert({
      project_id: null, file_path: '/v/a.mp4', proxy_path: null, file_hash: 'h1', file_size: 10,
      duration_sec: 4.3, resolution: null, fps: null, nb_frames: null, has_video: 1, has_audio: 1,
      codec: null, recorded_at: null, start_timecode: null, location: null, manual_tags: null, people: null,
    });
  }

  it('stores normalized highlights, sets status done, and replaces on re-run', async () => {
    const clip = insertClip();

    const first = { analyzeVideo: async () => response([{ start_sec: 3.5, end_sec: 9, description: 'Wave', quality: 8 }]) };
    const r1 = await analyzeClips([clip], DEFAULT_CONFIG, clipRepo, () => {}, hlRepo, first);
    expect(r1).toEqual({ success: 1, errors: 0 });
    expect(clipRepo.findById(clip.id)!.analysis_status).toBe('done');
    const stored = hlRepo.findByClip(clip.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ start_sec: 3.5, end_sec: 4.3, description: 'Wave', quality: 8 });

    const second = { analyzeVideo: async () => response([{ start_sec: 0.5, end_sec: 2, description: 'Gull', quality: 6 }]) };
    await analyzeClips([clip], DEFAULT_CONFIG, clipRepo, () => {}, hlRepo, second);
    const after = hlRepo.findByClip(clip.id);
    expect(after.map((h) => h.description)).toEqual(['Gull']);
  });
});
