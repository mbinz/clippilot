import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { FfmpegNotFoundError } from '../../utils/errors.js';
import { DEFAULT_PROXY_CRF, DEFAULT_AUDIO_BITRATE } from '../../constants.js';

const execFileAsync = promisify(execFile);

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

  try {
    await execFileAsync('ffmpeg', [
      '-i', inputPath,
      '-vf', `scale=-2:${resolution}`,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', String(DEFAULT_PROXY_CRF),
      '-c:a', 'aac',
      '-b:a', DEFAULT_AUDIO_BITRATE,
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ], { timeout: 600000 }); // 10 minute timeout per clip
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new FfmpegNotFoundError();
    }
    throw new Error(`Proxy creation failed for ${path.basename(inputPath)}: ${err.message}`);
  }

  return outputPath;
}
