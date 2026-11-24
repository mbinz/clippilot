import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../../src/db/repositories/clip.repository.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';
import { TranscriptRepository } from '../../../../src/db/repositories/transcript.repository.js';
import { transcribeClips, requireWhisperModel, type WhisperRunner } from '../../../../src/core/transcribe/index.js';
import { DEFAULT_CONFIG } from '../../../../src/core/config/defaults.js';

const dolphins = JSON.parse(readFileSync('tests/fixtures/whisper/dolphins-en.json', 'utf-8'));
// Segments of the fixture: 0-1.4 "Look at the dolphins." and 1.4-3.2 "They are swimming right next to the boat."

const clipInput = (n: number, over: Record<string, unknown> = {}) => ({
  project_id: null, file_path: `/v/${n}.mp4`, proxy_path: null, file_hash: `h${n}`, file_size: 1,
  duration_sec: 30, resolution: null, fps: 25, nb_frames: null, has_video: 1, has_audio: 1,
  codec: null, recorded_at: null, start_timecode: null, location: null, manual_tags: null, people: null, ...over,
});

describe('transcribeClips', () => {
  let db: Database.Database;
  let clips: ClipRepository;
  let highlights: HighlightRepository;
  let transcripts: TranscriptRepository;
  let calls: number[];
  const runner: WhisperRunner = async (clip) => { calls.push(clip.id); return dolphins; };
  const deps = () => ({ transcripts, highlights });

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    clips = new ClipRepository(db);
    highlights = new HighlightRepository(db);
    transcripts = new TranscriptRepository(db);
    calls = [];
  });

  it('stores the parsed transcript and counts it', async () => {
    const c = clips.insert(clipInput(1));
    const r = await transcribeClips([c], deps(), { model: '/m/ggml-x.bin', runner });
    expect(r).toMatchObject({ transcribed: 1, skipped_existing: 0, skipped_no_audio: 0, errors: [] });
    const t = transcripts.get(c.id)!;
    expect(t.model).toBe('ggml-x.bin');
    expect(t.language).toBe('en');
    expect(t.segments).toHaveLength(2);
    expect(t.words).toHaveLength(12);
  });

  it('is resumable: clips with a transcript are skipped unless --force', async () => {
    const a = clips.insert(clipInput(1));
    const b = clips.insert(clipInput(2));
    await transcribeClips([a], deps(), { model: 'm', runner });
    calls = [];
    const r = await transcribeClips([a, b], deps(), { model: 'm', runner });
    expect(calls).toEqual([b.id]);
    expect(r).toMatchObject({ transcribed: 1, skipped_existing: 1 });
    calls = [];
    const f = await transcribeClips([a, b], deps(), { model: 'm', runner, force: true });
    expect(calls).toEqual([a.id, b.id]);
    expect(f.transcribed).toBe(2);
  });

  it('skips clips without audio', async () => {
    const c = clips.insert(clipInput(1, { has_audio: 0 }));
    const r = await transcribeClips([c], deps(), { model: 'm', runner });
    expect(calls).toEqual([]);
    expect(r).toMatchObject({ transcribed: 0, skipped_no_audio: 1 });
    expect(transcripts.has(c.id)).toBe(false);
  });

  it('a failing clip is reported and the run goes on', async () => {
    const a = clips.insert(clipInput(1));
    const b = clips.insert(clipInput(2));
    const flaky: WhisperRunner = async (clip) => { if (clip.id === a.id) throw new Error('boom'); return dolphins; };
    const r = await transcribeClips([a, b], deps(), { model: 'm', runner: flaky });
    expect(r.errors).toEqual([{ clip_id: a.id, message: 'boom' }]);
    expect(r.transcribed).toBe(1);
    expect(transcripts.has(a.id)).toBe(false);
  });

  it('processes clips sequentially and reports progress', async () => {
    const a = clips.insert(clipInput(1));
    const b = clips.insert(clipInput(2));
    let running = 0; let maxRunning = 0;
    const slow: WhisperRunner = async () => { running++; maxRunning = Math.max(maxRunning, running); await new Promise((r) => setTimeout(r, 5)); running--; return dolphins; };
    const seen: number[] = [];
    await transcribeClips([a, b], deps(), { model: 'm', runner: slow, onProgress: (i) => seen.push(i) });
    expect(maxRunning).toBe(1);
    expect(seen).toEqual([1, 2]);
  });

  describe('speech snap on moments', () => {
    const m = (start_sec: number, end_sec: number, description: string) => ({ start_sec, end_sec, description, tier: 'solid' as const });

    it('widens unprotected moments that cut into a sentence (no cap), updating ai range too', async () => {
      const c = clips.insert(clipInput(1));
      highlights.replaceForClip(c.id, [m(0.5, 2.5, 'cuts both'), m(10, 12, 'no speech')]);
      const r = await transcribeClips([c], deps(), { model: 'm', runner });
      expect(r.snapped).toBe(1);
      const [a, b] = highlights.findByClip(c.id);
      expect(a).toMatchObject({ start_sec: 0, end_sec: 3.2, ai_start_sec: 0, ai_end_sec: 3.2 });
      expect(b).toMatchObject({ start_sec: 10, end_sec: 12 });
    });

    it('never snaps protected moments (confirmed, rejected, edited, starred, in use)', async () => {
      const c = clips.insert(clipInput(1));
      highlights.replaceForClip(c.id, [m(0.5, 2.5, 'confirmed'), m(0.6, 2.6, 'rejected'), m(0.7, 2.7, 'trimmed'), m(0.8, 2.8, 'starred'), m(0.9, 2.9, 'plain')]);
      const id = (d: string) => highlights.findByClip(c.id).find((h) => h.description === d)!.id;
      db.prepare("UPDATE highlights SET status = 'confirmed' WHERE id = ?").run(id('confirmed'));
      db.prepare("UPDATE highlights SET status = 'rejected' WHERE id = ?").run(id('rejected'));
      db.prepare('UPDATE highlights SET start_sec = 0.75 WHERE id = ?').run(id('trimmed'));
      db.prepare("UPDATE highlights SET user_tier = 'hero' WHERE id = ?").run(id('starred'));
      const before = highlights.findByClip(c.id);
      await transcribeClips([c], deps(), { model: 'm', runner });
      const after = highlights.findByClip(c.id);
      for (const name of ['confirmed', 'rejected', 'trimmed', 'starred']) {
        const was = before.find((h) => h.description === name)!;
        const now = after.find((h) => h.description === name)!;
        expect([now.start_sec, now.end_sec, now.ai_start_sec, now.ai_end_sec]).toEqual([was.start_sec, was.end_sec, was.ai_start_sec, was.ai_end_sec]);
      }
      expect(after.find((h) => h.description === 'plain')).toMatchObject({ start_sec: 0, end_sec: 3.2 });
    });

    it('clamps to the clip duration', async () => {
      const c = clips.insert(clipInput(1, { duration_sec: 3 }));
      highlights.replaceForClip(c.id, [m(0.5, 2.5, 'x')]);
      await transcribeClips([c], deps(), { model: 'm', runner });
      expect(highlights.findByClip(c.id)[0]).toMatchObject({ start_sec: 0, end_sec: 3 });
    });
  });
});

describe('requireWhisperModel', () => {
  it('throws a clear message naming the path and the config key when the model file is missing', () => {
    expect(() => requireWhisperModel({ ...DEFAULT_CONFIG, whisper_model: '/nope/ggml.bin' })).toThrow(/whisper_model.*\/nope\/ggml\.bin|\/nope\/ggml\.bin.*whisper_model/s);
  });

  it('returns the path when the file exists, expanding ~', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'wm-'));
    const f = path.join(dir, 'm.bin');
    writeFileSync(f, 'x');
    expect(requireWhisperModel({ ...DEFAULT_CONFIG, whisper_model: f })).toBe(f);
  });

  it('default model path is ~/.clippilot/models/ggml-large-v3-turbo.bin', () => {
    expect(DEFAULT_CONFIG.whisper_model.endsWith(path.join('.clippilot', 'models', 'ggml-large-v3-turbo.bin'))).toBe(true);
  });
});
