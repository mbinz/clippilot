import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../../src/db/repositories/clip.repository.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';
import { TranscriptRepository } from '../../../../src/db/repositories/transcript.repository.js';
import { transcribeClips, requireWhisperModel, resolveVadModel, type WhisperRunner } from '../../../../src/core/transcribe/index.js';
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

  describe('allowed languages and filter stats', () => {
    const lang = (language: string, text: string) => ({ result: { language }, transcription: [{ offsets: { from: 0, to: 2000 }, text: ` ${text}`,
      tokens: [{ text: ` ${text}`, offsets: { from: 0, to: 2000 }, p: 0.9 }] }] });

    it('a clip in a language that is not allowed gets an empty stored transcript (not retried), counted as dropped_language', async () => {
      const c = clips.insert(clipInput(1));
      const ja: WhisperRunner = async () => lang('ja', 'ご視聴ありがとうございました');
      const r = await transcribeClips([c], deps(), { model: 'm', runner: ja, languages: ['de', 'en'] });
      expect(r).toMatchObject({ transcribed: 0, dropped_language: 1 });
      expect(transcripts.get(c.id)).toMatchObject({ language: 'ja', text: '', segments: [], words: [] });
      calls = [];
      const again = await transcribeClips([c], deps(), { model: 'm', runner, languages: ['de', 'en'] });
      expect(calls).toEqual([]);
      expect(again.skipped_existing).toBe(1);
    });

    it('an allowed language is kept (case-insensitive); without a list every language is kept', async () => {
      const a = clips.insert(clipInput(1));
      const b = clips.insert(clipInput(2));
      const pt: WhisperRunner = async () => lang('pt', 'Olá a todos');
      await transcribeClips([a], deps(), { model: 'm', runner: pt, languages: ['DE', 'PT'] });
      expect(transcripts.get(a.id)!.text).toBe('Olá a todos');
      await transcribeClips([b], deps(), { model: 'm', runner: pt });
      expect(transcripts.get(b.id)!.text).toBe('Olá a todos');
    });

    it('reports dropped segments by reason', async () => {
      const c = clips.insert(clipInput(1));
      const noisy: WhisperRunner = async () => lang('de', '*Loud noise*');
      const r = await transcribeClips([c], deps(), { model: 'm', runner: noisy, languages: ['de'] });
      expect(r.dropped_segments).toEqual({ sound_description: 1 });
      expect(transcripts.get(c.id)!.segments).toEqual([]);
    });

    describe('language fallback', () => {
      // A fake whisper that answers per forced language (undefined = auto-detect).
      const fake = (byLang: Record<string, [string, number, string?]>): { runner: WhisperRunner; langs: (string | undefined)[] } => {
        const langs: (string | undefined)[] = [];
        return { langs, runner: async (_c, _m, o) => {
          langs.push(o?.language);
          const [text, p, detected] = byLang[o?.language ?? 'auto'];
          return { result: { language: detected ?? o?.language ?? 'auto' }, transcription: [{ offsets: { from: 0, to: 3000 }, text: ` ${text}`,
            tokens: [{ text: ` ${text}`, offsets: { from: 0, to: 3000 }, p }] }] };
        } };
      };

      it('re-runs once per allowed language and keeps the best mean token p', async () => {
        const c = clips.insert(clipInput(1));
        const f = fake({ auto: ['Altyazı M.K. ve Türkçe sesler', 0.9, 'tr'], de: ['Das ist eine richtige Leuchtung hier', 0.8], en: ['The light is nice and clear today', 0.5], pt: ['Eu também não apanhei bem isso', 0.6] });
        const r = await transcribeClips([c], deps(), { model: 'm', runner: f.runner, languages: ['de', 'en', 'pt'] });
        expect(f.langs).toEqual([undefined, 'de', 'en', 'pt']);
        expect(r).toMatchObject({ transcribed: 1, language_fallback: 1, dropped_language: 0 });
        expect(transcripts.get(c.id)).toMatchObject({ language: 'de', text: 'Das ist eine richtige Leuchtung hier' });
      });

      it('candidates that are empty after filtering do not win; if all are empty the empty transcript is stored', async () => {
        const c = clips.insert(clipInput(1));
        const f = fake({ auto: ['ありがとう', 0.9, 'ja'], de: ['*Wind*', 0.9], en: ['Thank you.', 0.9] });
        const r = await transcribeClips([c], deps(), { model: 'm', runner: f.runner, languages: ['de', 'en'] });
        expect(r).toMatchObject({ transcribed: 0, language_fallback: 0, dropped_language: 1 });
        expect(transcripts.get(c.id)).toMatchObject({ text: '', segments: [] });
      });

      it('no fallback when the detected language is allowed', async () => {
        const c = clips.insert(clipInput(1));
        const f = fake({ auto: ['Hallo zusammen, schön hier', 0.9, 'de'] });
        const r = await transcribeClips([c], deps(), { model: 'm', runner: f.runner, languages: ['de', 'en'] });
        expect(f.langs).toEqual([undefined]);
        expect(r.language_fallback).toBe(0);
      });
    });

    it('passes the VAD model to the runner', async () => {
      const c = clips.insert(clipInput(1));
      let seen: string | undefined;
      let opts: any;
      await transcribeClips([c], deps(), { model: 'm', vadModel: '/v/silero.bin', vadThreshold: 0.15, vadPadMs: 200, runner: async (_c, _m, o) => { seen = o?.vadModel; opts = o; return dolphins; } });
      expect(seen).toBe('/v/silero.bin');
      expect(opts).toMatchObject({ vadThreshold: 0.15, vadPadMs: 200 });
    });
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

    describe('no overlaps with neighbours', () => {
      // The fixture sentences are 0-1.4 and 1.4-3.2.
      const ranges = (id: number) => highlights.findByClip(id).map((h) => [h.description, h.start_sec, h.end_sec]);

      it('widening into an unprotected neighbour is clamped to its boundary', async () => {
        const c = clips.insert(clipInput(1));
        highlights.replaceForClip(c.id, [m(0.9, 3, 'mine'), m(3.1, 6, 'next')]);
        const r = await transcribeClips([c], deps(), { model: 'm', runner });
        expect(ranges(c.id)).toContainEqual(['mine', 0, 3.1]);
        expect(r).toMatchObject({ snapped: 1, snap_clamped: 1, snap_skipped_overlap: 1 }); // 'next' has no room left
      });

      it('widening into a protected neighbour is clamped and the neighbour is untouched', async () => {
        const c = clips.insert(clipInput(1));
        highlights.replaceForClip(c.id, [m(0.9, 3, 'mine'), m(3.1, 6, 'next')]);
        db.prepare("UPDATE highlights SET status = 'confirmed' WHERE description = 'next'").run();
        const r = await transcribeClips([c], deps(), { model: 'm', runner });
        expect(ranges(c.id)).toEqual([['mine', 0, 3.1], ['next', 3.1, 6]]);
        expect(r.snap_clamped).toBe(1);
      });

      it('no room: the moment stays unchanged', async () => {
        const c = clips.insert(clipInput(1));
        // left neighbour ends at 0.9, right neighbour starts at 3 -> nothing to gain / < 2 s anyway
        highlights.replaceForClip(c.id, [m(0.2, 0.9, 'left'), m(0.9, 3, 'mine'), m(3, 6, 'right')]);
        db.prepare("UPDATE highlights SET status = 'confirmed' WHERE description IN ('left', 'right')").run();
        const r = await transcribeClips([c], deps(), { model: 'm', runner });
        expect(ranges(c.id)).toContainEqual(['mine', 0.9, 3]);
        expect(r).toMatchObject({ snapped: 0, snap_clamped: 0, snap_skipped_overlap: 1 });
      });

      it('later moments see the already snapped ranges of earlier ones', async () => {
        const c = clips.insert(clipInput(1));
        highlights.replaceForClip(c.id, [m(0.5, 2.5, 'a'), m(2.6, 5, 'b')]);
        await transcribeClips([c], deps(), { model: 'm', runner });
        const [a, b] = highlights.findByClip(c.id);
        expect(a.end_sec).toBeLessThanOrEqual(b.start_sec);
      });
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

  it('config defaults: VAD model path and allowed languages', () => {
    expect(DEFAULT_CONFIG.whisper_vad_model.endsWith(path.join('.clippilot', 'models', 'ggml-silero-v5.1.2.bin'))).toBe(true);
    expect(DEFAULT_CONFIG.languages).toEqual(['de', 'en']);
    expect(DEFAULT_CONFIG.whisper_vad_threshold).toBe(0.15);
    expect(DEFAULT_CONFIG.whisper_vad_pad_ms).toBe(200);
  });

  it('resolveVadModel returns the path only when the file exists', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'vad-'));
    const f = path.join(dir, 'v.bin');
    expect(resolveVadModel({ whisper_vad_model: f })).toBeUndefined();
    writeFileSync(f, 'x');
    expect(resolveVadModel({ whisper_vad_model: f })).toBe(f);
  });

  it('default model path is ~/.clippilot/models/ggml-large-v3-turbo.bin', () => {
    expect(DEFAULT_CONFIG.whisper_model.endsWith(path.join('.clippilot', 'models', 'ggml-large-v3-turbo.bin'))).toBe(true);
  });
});
