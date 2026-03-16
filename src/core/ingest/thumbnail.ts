import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { DEFAULT_THUMBNAIL_COUNT } from '../../constants.js';

const execFileAsync = promisify(execFile);

export interface ThumbnailResult {
  path: string;
  timestamp_sec: number;
}

export async function extractThumbnails(
  videoPath: string,
  hash: string,
  durationSec: number,
  thumbnailDir: string,
  count: number = DEFAULT_THUMBNAIL_COUNT,
): Promise<ThumbnailResult[]> {
  const results: ThumbnailResult[] = [];

  if (durationSec <= 0) return results;

  // Calculate timestamps: evenly distributed
  const timestamps: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = (durationSec / (count + 1)) * (i + 1);
    timestamps.push(Math.min(t, durationSec - 0.1));
  }

  for (let i = 0; i < timestamps.length; i++) {
    const timestamp = timestamps[i];
    const outputPath = path.join(thumbnailDir, `${hash}_${i}.jpg`);

    try {
      await execFileAsync('ffmpeg', [
        '-ss', String(timestamp),
        '-i', videoPath,
        '-vframes', '1',
        '-vf', 'scale=320:-2',
        '-q:v', '5',
        '-y',
        outputPath,
      ], { timeout: 30000 });

      results.push({ path: outputPath, timestamp_sec: timestamp });
    } catch {
      // Skip failed thumbnails silently
    }
  }

  return results;
}
