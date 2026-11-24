import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Clip } from '../../types/clip.js';
import type { AppConfig } from '../../types/config.js';
import type { HighlightRepository } from '../../db/repositories/highlight.repository.js';
import type { TranscriptRepository } from '../../db/repositories/transcript.repository.js';
import { parseWhisperJson, filterHallucinationsWithStats, type DropReason } from './whisper.js';
import { MIN_MOMENT_SEC } from '../analyze/highlights.js';
import { snapToSpeech } from './speech.js';
import { whisperCliRunner, type WhisperRunner } from './runner.js';

export type { WhisperRunner } from './runner.js';

export interface TranscribeDeps {
  transcripts: TranscriptRepository;
  highlights: HighlightRepository;
}

export interface TranscribeOptions {
  /** Model file path (stored by file name on the transcript). */
  model: string;
  /** Redo clips that already have a transcript. */
  force?: boolean;
  runner?: WhisperRunner;
  /** Silero VAD model path (must exist); see `resolveVadModel`. */
  vadModel?: string;
  vadThreshold?: number;
  vadPadMs?: number;
  /** Allowed ISO language codes; a clip detected as another language gets an empty transcript. Unset = all. */
  languages?: string[];
  onProgress?: (done: number, total: number, fileName: string) => void;
}

export interface TranscribeResult {
  transcribed: number;
  skipped_existing: number;
  skipped_no_audio: number;
  /** Clips whose detected language is not allowed (stored with an empty transcript). */
  dropped_language: number;
  /** Clips whose detected language was not allowed but one of the allowed languages gave speech. */
  language_fallback: number;
  /** Hallucinated segments dropped, by reason. */
  dropped_segments: Partial<Record<DropReason, number>>;
  /** Unprotected moments widened toward whole sentences (includes the clamped ones). */
  snapped: number;
  /** Of `snapped`: widened only up to a neighbouring moment. */
  snap_clamped: number;
  /** Left unchanged because a neighbouring moment left no room. */
  snap_skipped_overlap: number;
  errors: { clip_id: number; message: string }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

/** The configured whisper model path; throws a clear message when the file is missing (no silent skip). */
export function requireWhisperModel(config: Pick<AppConfig, 'whisper_model'>): string {
  const model = expandHome(config.whisper_model);
  if (!existsSync(model)) {
    throw new Error(
      `Whisper model not found: ${model}\n`
      + 'Download a multilingual ggml model (e.g. ggml-large-v3-turbo.bin from huggingface.co/ggerganov/whisper.cpp) '
      + 'or point the config key "whisper_model" at one: clippilot config set --global whisper_model <path>',
    );
  }
  return model;
}

/** The VAD model path when the file exists, else undefined (the caller warns once and goes on without VAD). */
export function resolveVadModel(config: Pick<AppConfig, 'whisper_vad_model'>): string | undefined {
  const p = expandHome(config.whisper_vad_model);
  return existsSync(p) ? p : undefined;
}

/** The one-line warning for a missing VAD model. */
export function vadMissingWarning(config: Pick<AppConfig, 'whisper_vad_model'>): string {
  return `Warning: VAD model not found at ${expandHome(config.whisper_vad_model)}; transcribing without VAD (more hallucinations on wind/sea). Config key: whisper_vad_model.`;
}

/** Whether a whisper model is configured and present (for hints, no throw). */
export function whisperModelAvailable(config: Pick<AppConfig, 'whisper_model'>): boolean {
  return existsSync(expandHome(config.whisper_model));
}

/**
 * Transcribe clips one after another (resumable: clips with a transcript are skipped unless `force`). After each
 * transcript, unprotected moments of the clip that cut into a sentence are widened to the sentence; protected
 * moments (confirmed, rejected, edited, in use) are never touched.
 */
export async function transcribeClips(
  clips: Clip[],
  deps: TranscribeDeps,
  opts: TranscribeOptions,
): Promise<TranscribeResult> {
  const runner = opts.runner ?? whisperCliRunner;
  const modelName = path.basename(opts.model);
  const result: TranscribeResult = { transcribed: 0, skipped_existing: 0, skipped_no_audio: 0, dropped_language: 0, language_fallback: 0, dropped_segments: {}, snapped: 0, snap_clamped: 0, snap_skipped_overlap: 0, errors: [] };

  let done = 0;
  for (const clip of clips) {
    const name = path.basename(clip.file_path);
    if (!clip.has_audio) result.skipped_no_audio++;
    else if (!opts.force && deps.transcripts.has(clip.id)) result.skipped_existing++;
    else {
      try {
        const ropts = { vadModel: opts.vadModel, vadThreshold: opts.vadThreshold, vadPadMs: opts.vadPadMs };
        const parsed = parseWhisperJson(await runner(clip, opts.model, ropts));
        if (opts.languages && !opts.languages.some((l) => l.toLowerCase() === parsed.language.toLowerCase())) {
          // Detected a language the footage does not use (usually ambient sound). Try each allowed language and keep the best.
          let best: { t: ReturnType<typeof filterHallucinationsWithStats>; p: number } | null = null;
          for (const code of opts.languages) {
            const t = filterHallucinationsWithStats(parseWhisperJson(await runner(clip, opts.model, { ...ropts, language: code })));
            if (t.transcript.segments.length === 0) continue;
            const ps = t.transcript.segments.map((x) => x.p ?? 0);
            const p = ps.reduce((a, b) => a + b, 0) / ps.length;
            if (!best || p > best.p) best = { t, p };
          }
          if (best) {
            result.language_fallback++;
            await storeAndSnap(clip, best.t);
          } else {
            // Stored empty so the clip is not retried.
            deps.transcripts.save(clip.id, modelName, { language: parsed.language, segments: [], words: [] });
            result.dropped_language++;
          }
        } else await storeAndSnap(clip, filterHallucinationsWithStats(parsed));
      } catch (err) {
        result.errors.push({ clip_id: clip.id, message: err instanceof Error ? err.message : String(err) });
      }
    }
    opts.onProgress?.(++done, clips.length, name);
  }
  return result;

  async function storeAndSnap(clip: Clip, filtered: ReturnType<typeof filterHallucinationsWithStats>): Promise<void> {
    const { transcript, dropped } = filtered;
    for (const [reason, n] of Object.entries(dropped) as [DropReason, number][]) {
      result.dropped_segments[reason] = (result.dropped_segments[reason] ?? 0) + n;
    }
    deps.transcripts.save(clip.id, modelName, transcript);
    result.transcribed++;
    for (const m of deps.highlights.findUnprotected(clip.id)) {
      const want = snapToSpeech({ start: m.start_sec, end: m.end_sec }, transcript.segments, clip.duration_sec);
      if (!want.extended || (want.start === m.start_sec && want.end === m.end_sec)) continue;
      // Never overlap another moment of the clip (protected or not, current ranges): stop at its boundary.
      const others = deps.highlights.findByClip(clip.id).filter((o) => o.id !== m.id);
      let start = want.start;
      let end = want.end;
      for (const o of others) {
        if (o.end_sec <= m.start_sec && o.end_sec > start) start = o.end_sec;
        if (o.start_sec >= m.end_sec && o.start_sec < end) end = o.start_sec;
      }
      start = round2(start);
      end = round2(end);
      if (end - start < MIN_MOMENT_SEC || (start === m.start_sec && end === m.end_sec)) {
        result.snap_skipped_overlap++;
        continue;
      }
      deps.highlights.snapUnprotected(m.id, start, end);
      result.snapped++;
      if (start !== round2(want.start) || end !== round2(want.end)) result.snap_clamped++;
    }
  }
}
