import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { FfmpegNotFoundError } from '../../utils/errors.js';
import { DEFAULT_PROXY_CRF, DEFAULT_AUDIO_BITRATE } from '../../constants.js';

const execFileAsync = promisify(execFile);

/**
 * ffmpeg arguments for a browser-friendly proxy: 8-bit 4:2:0 High profile (hardware decodable, even from 10-bit
 * 4:2:2 originals) and a keyframe every second independent of source fps (cheap seeks and loops).
 */
export function proxyArgs(inputPath: string, outputPath: string, resolution: number): string[] {
  return [
    '-i', inputPath,
    '-vf', `scale=-2:${resolution}`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-profile:v', 'high',
    '-preset', 'fast',
    '-crf', String(DEFAULT_PROXY_CRF),
    '-force_key_frames', 'expr:gte(t,n_forced*1)',
    '-sc_threshold', '0',
    '-c:a', 'aac',
    '-b:a', DEFAULT_AUDIO_BITRATE,
    '-movflags', '+faststart',
    '-y',
    outputPath,
  ];
}

export type ProxyEncoder = (inputPath: string, outputPath: string, resolution: number) => Promise<void>;

const ffmpegEncode: ProxyEncoder = async (inputPath, outputPath, resolution) => {
  try {
    await execFileAsync('ffmpeg', proxyArgs(inputPath, outputPath, resolution), { timeout: 600000 });
  } catch (err: any) {
    if (err.code === 'ENOENT') throw new FfmpegNotFoundError();
    throw new Error(`Proxy creation failed for ${path.basename(inputPath)}: ${err.message}`);
  }
};

/** Re-encode a proxy next to the old one and atomically swap it in; the old proxy survives any failure. */
export async function rebuildProxy(
  inputPath: string,
  proxyPath: string,
  resolution: number,
  encode: ProxyEncoder = ffmpegEncode,
): Promise<void> {
  const partialPath = proxyPath.replace(/\.mp4$/i, '') + '.partial.mp4';
  try {
    await encode(inputPath, partialPath, resolution);
    await rename(partialPath, proxyPath);
  } catch (err) {
    await rm(partialPath, { force: true });
    throw err;
  }
}

export async function probePixFmt(filePath: string): Promise<string | null> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt', '-of', 'csv=p=0', filePath,
  ]);
  return stdout.trim() || null;
}

export interface RebuildClip { id: number; file_path: string; proxy_path: string | null }
export interface RebuildResult { clip_id: number; file: string; status: 'ok' | 'skipped' | 'failed'; reason?: string }
export interface RebuildOptions {
  resolution: number;
  onlyBad?: boolean;
  encode?: ProxyEncoder;
  probePixFmt?: (proxyPath: string) => Promise<string | null>;
  onProgress?: (line: string) => void;
}

/** Sequentially rebuild the proxies of the given clips; never throws for a single clip. */
export async function rebuildProxies(clips: RebuildClip[], opts: RebuildOptions) {
  const probe = opts.probePixFmt ?? probePixFmt;
  const results: RebuildResult[] = [];
  const todo = clips.filter((c) => c.proxy_path);
  for (const [i, clip] of todo.entries()) {
    const file = path.basename(clip.file_path);
    const res = await rebuildOne(clip, opts, probe);
    results.push({ clip_id: clip.id, file, ...res });
    opts.onProgress?.(`[${i + 1}/${todo.length}] ${file} ${res.status}${res.reason ? `: ${res.reason}` : ''}`);
  }
  const count = (s: RebuildResult['status']) => results.filter((r) => r.status === s).length;
  return {
    results,
    summary: { total: results.length, ok: count('ok'), skipped: count('skipped'), failed: count('failed') },
  };
}

async function rebuildOne(
  clip: RebuildClip,
  opts: RebuildOptions,
  probe: (p: string) => Promise<string | null>,
): Promise<{ status: RebuildResult['status']; reason?: string }> {
  const proxyPath = clip.proxy_path!;
  if (!existsSync(clip.file_path)) return { status: 'skipped', reason: 'original missing' };
  try {
    if (opts.onlyBad && existsSync(proxyPath) && (await probe(proxyPath)) === 'yuv420p') {
      return { status: 'skipped', reason: 'already yuv420p' };
    }
    await rebuildProxy(clip.file_path, proxyPath, opts.resolution, opts.encode);
    return { status: 'ok' };
  } catch (err: any) {
    return { status: 'failed', reason: err.message };
  }
}

export async function createProxy(
  inputPath: string,
  hash: string,
  proxyDir: string,
  resolution: number = 720,
): Promise<string> {
  const outputPath = path.join(proxyDir, `${hash}.mp4`);

  // Skip if proxy already exists
  if (existsSync(outputPath)) {
    return outputPath;
  }

  const partialPath = path.join(proxyDir, `${hash}.partial.mp4`);

  try {
    await execFileAsync('ffmpeg', proxyArgs(inputPath, partialPath, resolution), { timeout: 600000 }); // 10 minute timeout per clip
    await rename(partialPath, outputPath);
  } catch (err: any) {
    await rm(partialPath, { force: true });
    if (err.code === 'ENOENT') {
      throw new FfmpegNotFoundError();
    }
    throw new Error(`Proxy creation failed for ${path.basename(inputPath)}: ${err.message}`);
  }

  return outputPath;
}
