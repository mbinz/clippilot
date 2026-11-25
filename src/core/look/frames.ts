import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Frame times of a moment's look fingerprint: 20 / 50 / 80 % of its range. */
export function lookFrameTimes(startSec: number, endSec: number): number[] {
  const d = endSec - startSec;
  return [0.2, 0.5, 0.8].map((f) => startSec + f * d);
}

/** Grab one frame as JPEG from a video file. Software decode (no hwaccel: it drops frames on 10-bit Sony footage). */
export type FrameGrabber = (file: string, timeSec: number) => Promise<Buffer>;

export const grabFrameJpeg: FrameGrabber = async (file, timeSec) => {
  const { stdout } = await exec('ffmpeg', [
    '-v', 'error', '-ss', timeSec.toFixed(3), '-i', file, '-frames:v', '1', '-an',
    '-vf', 'scale=-2:384', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '3', '-',
  ], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
  if (stdout.length === 0) throw new Error(`no frame at ${timeSec.toFixed(2)} s in ${file}`);
  return stdout;
};
