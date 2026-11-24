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

/** Largest gap between consecutive keyframes, including the last keyframe to the end of the clip. */
export function maxKeyframeGap(keyframeTimes: number[], duration: number): number {
  if (keyframeTimes.length === 0) return duration;
  const t = [...keyframeTimes].sort((a, b) => a - b);
  let max = Math.max(0, duration - t[t.length - 1]);
  for (let i = 1; i < t.length; i++) max = Math.max(max, t[i] - t[i - 1]);
  return max;
}

/** Max keyframe gap (s) of a file's first video stream, via ffprobe. */
export async function probeKeyframeGap(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time',
    '-of', 'csv=p=0', filePath,
  ], { maxBuffer: 64 * 1024 * 1024 });
  const times = stdout.split('\n').map((l) => parseFloat(l.split(',')[0])).filter((n) => Number.isFinite(n));
  const { stdout: dur } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath,
  ]);
  return maxKeyframeGap(times, parseFloat(dur) || 0);
}

export const MAX_GOOD_KEYFRAME_GAP_SEC = 2;

export interface RebuildClip { id: number; file_path: string; proxy_path: string | null }
export interface RebuildResult { clip_id: number; file: string; status: 'ok' | 'skipped' | 'failed'; reason?: string }
export interface RebuildOptions {
  resolution: number;
  onlyBad?: boolean;
  encode?: ProxyEncoder;
  probePixFmt?: (proxyPath: string) => Promise<string | null>;
  probeKeyframeGap?: (proxyPath: string) => Promise<number>;
  onProgress?: (line: string) => void;
}

/** Sequentially rebuild the proxies of the given clips; never throws for a single clip. */
export async function rebuildProxies(clips: RebuildClip[], opts: RebuildOptions) {
  const probe: Probes = {
    pixFmt: opts.probePixFmt ?? probePixFmt,
    keyframeGap: opts.probeKeyframeGap ?? probeKeyframeGap,
  };
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

interface Probes {
  pixFmt: (p: string) => Promise<string | null>;
  keyframeGap: (p: string) => Promise<number>;
}

async function rebuildOne(
  clip: RebuildClip,
  opts: RebuildOptions,
  probe: Probes,
): Promise<{ status: RebuildResult['status']; reason?: string }> {
  const proxyPath = clip.proxy_path!;
  if (!existsSync(clip.file_path)) return { status: 'skipped', reason: 'original missing' };
  try {
    if (opts.onlyBad && existsSync(proxyPath)) {
      const pix = await probe.pixFmt(proxyPath);
      if ((pix === 'yuv420p' || pix === 'yuvj420p') && (await probe.keyframeGap(proxyPath)) <= MAX_GOOD_KEYFRAME_GAP_SEC) {
        return { status: 'skipped', reason: 'already yuv420p with dense keyframes' };
      }
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
