import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import type { ClipMetadata } from '../../types/clip.js';
import { FfmpegNotFoundError } from '../../utils/errors.js';

const execFileAsync = promisify(execFile);

export async function probeFile(filePath: string): Promise<ClipMetadata> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);

    const data = JSON.parse(stdout);
    const videoStream = data.streams?.find((s: any) => s.codec_type === 'video');
    const format = data.format;

    const fileStat = await stat(filePath);

    const duration = parseFloat(format?.duration ?? videoStream?.duration ?? '0');
    const width = videoStream?.width ?? 0;
    const height = videoStream?.height ?? 0;

    // Try to extract FPS
    let fps = 0;
    if (videoStream?.r_frame_rate) {
      const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
      if (den > 0) fps = Math.round((num / den) * 100) / 100;
    }

    // Try to extract recording date
    let recorded_at: string | null = null;
    const creationTime = format?.tags?.creation_time
      ?? videoStream?.tags?.creation_time
      ?? null;
    if (creationTime) {
      recorded_at = creationTime;
    }

    const start_timecode: string | null =
      videoStream?.tags?.timecode
      ?? data.streams?.find((s: any) => s.tags?.timecode)?.tags?.timecode
      ?? format?.tags?.timecode
      ?? null;

    const nb_frames: number = parseInt(videoStream?.nb_frames ?? '0', 10) || 0;

    return {
      duration_sec: duration,
      resolution: `${width}x${height}`,
      fps,
      nb_frames,
      codec: videoStream?.codec_name ?? 'unknown',
      recorded_at,
      start_timecode,
      file_size: fileStat.size,
    };
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new FfmpegNotFoundError();
    }
    throw err;
  }
}

export function parseProbeOutput(stdout: string, fileSize: number): ClipMetadata {
  const data = JSON.parse(stdout);
  const videoStream = data.streams?.find((s: any) => s.codec_type === 'video');
  const format = data.format;

  const duration = parseFloat(format?.duration ?? videoStream?.duration ?? '0');
  const width = videoStream?.width ?? 0;
  const height = videoStream?.height ?? 0;

  let fps = 0;
  if (videoStream?.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    if (den > 0) fps = Math.round((num / den) * 100) / 100;
  }

  let recorded_at: string | null = null;
  const creationTime = format?.tags?.creation_time ?? videoStream?.tags?.creation_time ?? null;
  if (creationTime) {
    recorded_at = creationTime;
  }

  const start_timecode: string | null =
    videoStream?.tags?.timecode
    ?? data.streams?.find((s: any) => s.tags?.timecode)?.tags?.timecode
    ?? format?.tags?.timecode
    ?? null;

  const nb_frames: number = parseInt(videoStream?.nb_frames ?? '0', 10) || 0;

  return {
    duration_sec: duration,
    resolution: `${width}x${height}`,
    fps,
    nb_frames,
    codec: videoStream?.codec_name ?? 'unknown',
    recorded_at,
    start_timecode,
    file_size: fileSize,
  };
}
