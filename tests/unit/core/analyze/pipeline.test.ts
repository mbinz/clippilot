import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../../src/db/repositories/clip.repository.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';
import { TranscriptRepository } from '../../../../src/db/repositories/transcript.repository.js';
import { MotionRepository } from '../../../../src/db/repositories/motion.repository.js';
import { analyzeAware } from '../../../../src/core/analyze/pipeline.js';
import { DEFAULT_CONFIG } from '../../../../src/core/config/defaults.js';

describe('analyzeAware (A2 order)', () => {
  it('transcribe -> measure -> Gemini (with the block in the prompt) -> moment columns', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const clips = new ClipRepository(db), highlights = new HighlightRepository(db);
    const transcripts = new TranscriptRepository(db), motion = new MotionRepository(db);
    const clip = clips.insert({
      project_id: null, file_path: '/v/a.mp4', proxy_path: null, file_hash: 'h', file_size: 1, duration_sec: 20, resolution: null,
      fps: 25, nb_frames: null, has_video: 1, has_audio: 1, codec: null, recorded_at: null, start_timecode: null,
      location: null, manual_tags: null, people: null,
    });
    const log: string[] = [];
    const steps = {
      transcribe: async () => { log.push('transcribe'); transcripts.save(clip.id, 'm', { language: 'de', words: [], segments: [{ start: 3, end: 7, text: 'Eins, zwei.' }] }); },
      measure: async () => {
        log.push('measure');
        motion.save(clip.id, {
          curve: { fps: 25, width: 320, srcWidth: 1920, dx: new Int8Array(500), dy: new Int8Array(500), change: new Float32Array(500) },
          medianResidual: 0.1, continuous: false,
          shakes: [{ start_sec: 4.74, end_sec: 4.94, peak_sec: 4.8, peak: 5, jump_pct: 1, jump_px: 20, disagreement: 0.1, moving_scene: false, confidence: 'high' }],
        });
      },
    };
    let prompt: string | undefined;
    const client = { analyzeVideo: async (_p: string, ctx?: string) => {
      log.push('gemini'); prompt = ctx;
      return { scenes: [], clip_summary: 's', highlights: [{ start_sec: 8, end_sec: 12, description: 'x', tier: 'solid' as const, shot: 'wide' as const, role: 'action' as const }] } as any;
    } };
    const r = await analyzeAware([clip], DEFAULT_CONFIG, { clips, highlights, transcripts, motion }, steps, () => {}, client);
    expect(log).toEqual(['transcribe', 'measure', 'gemini']);
    expect(prompt).toContain('Kamerawackler (gemessen): 4.74–4.94 s (stark)');
    expect(prompt).toContain('[3.0–7.0 s] "Eins, zwei."');
    expect(r).toEqual({ success: 1, errors: 0 });
    // the new moment already carries its motion columns (the curve exists), no second decode needed
    expect(highlights.findByClip(clip.id)[0]!.jitter_score).not.toBeNull();
  });

  it('a failing step does not stop the analysis (no block when nothing is known)', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const clips = new ClipRepository(db), highlights = new HighlightRepository(db);
    const clip = clips.insert({
      project_id: null, file_path: '/v/a.mp4', proxy_path: null, file_hash: 'h', file_size: 1, duration_sec: 20, resolution: null,
      fps: 25, nb_frames: null, has_video: 1, has_audio: 1, codec: null, recorded_at: null, start_timecode: null,
      location: null, manual_tags: null, people: null,
    });
    let ctx: string | undefined = 'unset';
    const client = { analyzeVideo: async (_p: string, c?: string) => { ctx = c; return { scenes: [], clip_summary: 's', highlights: [] } as any; } };
    const boom = async () => { throw new Error('boom'); };
    const r = await analyzeAware([clip], DEFAULT_CONFIG, { clips, highlights, transcripts: new TranscriptRepository(db), motion: new MotionRepository(db) },
      { transcribe: boom, measure: boom }, () => {}, client);
    expect(r.success).toBe(1);
    expect(ctx).toBeUndefined();
  });
});
