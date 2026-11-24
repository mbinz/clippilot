import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Clip } from '../../types/clip.js';
import type { AppConfig } from '../../types/config.js';
import type { HighlightRepository } from '../../db/repositories/highlight.repository.js';
import type { TranscriptRepository } from '../../db/repositories/transcript.repository.js';
import { parseWhisperJson, filterHallucinations } from './whisper.js';
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
  onProgress?: (done: number, total: number, fileName: string) => void;
}

export interface TranscribeResult {
  transcribed: number;
  skipped_existing: number;
  skipped_no_audio: number;
  /** Unprotected moments widened to whole sentences. */
  snapped: number;
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
  const result: TranscribeResult = { transcribed: 0, skipped_existing: 0, skipped_no_audio: 0, snapped: 0, errors: [] };

  let done = 0;
  for (const clip of clips) {
    const name = path.basename(clip.file_path);
    if (!clip.has_audio) result.skipped_no_audio++;
    else if (!opts.force && deps.transcripts.has(clip.id)) result.skipped_existing++;
    else {
      try {
        const transcript = filterHallucinations(parseWhisperJson(await runner(clip, opts.model)));
        deps.transcripts.save(clip.id, modelName, transcript);
        result.transcribed++;
        for (const m of deps.highlights.findUnprotected(clip.id)) {
          const s = snapToSpeech({ start: m.start_sec, end: m.end_sec }, transcript.segments, clip.duration_sec);
          if (s.extended && (s.start !== m.start_sec || s.end !== m.end_sec)) {
            deps.highlights.snapUnprotected(m.id, round2(s.start), round2(s.end));
            result.snapped++;
          }
        }
      } catch (err) {
        result.errors.push({ clip_id: clip.id, message: err instanceof Error ? err.message : String(err) });
      }
    }
    opts.onProgress?.(++done, clips.length, name);
  }
  return result;
}
