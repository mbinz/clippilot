import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Clip } from '../../types/clip.js';
import { FfmpegNotFoundError } from '../../utils/errors.js';

const execFileAsync = promisify(execFile);

/** Runs speech recognition for one clip and returns whisper.cpp's full JSON. Injected in tests. */
export type WhisperRunner = (clip: Clip, model: string) => Promise<unknown>;

/** ffmpeg arguments: 16 kHz mono 16-bit WAV, the format whisper.cpp reads. */
export function audioArgs(input: string, output: string): string[] {
  return ['-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', output];
}

/** whisper-cli arguments: language auto-detect, full JSON (segments + token timestamps) next to `outBase`. */
export function whisperArgs(model: string, wav: string, outBase: string): string[] {
  return ['-m', model, '-f', wav, '-l', 'auto', '-ojf', '-of', outBase, '-np'];
}

/** The original when it exists, else the proxy. */
export function audioSource(clip: Pick<Clip, 'file_path' | 'proxy_path'>): string {
  if (existsSync(clip.file_path)) return clip.file_path;
  if (clip.proxy_path && existsSync(path.resolve(clip.proxy_path))) return path.resolve(clip.proxy_path);
  throw new Error(`Neither the original nor the proxy of ${path.basename(clip.file_path)} is available`);
}

export const whisperCliRunner: WhisperRunner = async (clip, model) => {
  const source = audioSource(clip);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clippilot-whisper-'));
  try {
    const wav = path.join(dir, 'audio.wav');
    try {
      await execFileAsync('ffmpeg', ['-loglevel', 'error', ...audioArgs(source, wav)], { timeout: 600000 });
    } catch (err: any) {
      if (err.code === 'ENOENT') throw new FfmpegNotFoundError();
      throw new Error(`Audio extraction failed for ${path.basename(source)}: ${err.message}`);
    }
    const outBase = path.join(dir, 'out');
    try {
      await execFileAsync('whisper-cli', whisperArgs(model, wav, outBase), { timeout: 3600000, maxBuffer: 64 * 1024 * 1024 });
    } catch (err: any) {
      if (err.code === 'ENOENT') throw new Error('whisper-cli not found. Install whisper.cpp (brew install whisper-cpp).');
      throw new Error(`whisper-cli failed for ${path.basename(source)}: ${String(err.stderr ?? err.message).split('\n').slice(-3).join(' ').trim()}`);
    }
    return JSON.parse(await readFile(`${outBase}.json`, 'utf-8'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
