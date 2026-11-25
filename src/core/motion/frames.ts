import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { checkFrameCount } from './curve.js';

const exec = promisify(execFile);

export const DECODE_WIDTH = 320;

export interface ClipFrameRequest { file: string; fps: number }
/** Gray frames of a whole clip as a stream (w x h each), plus the width of the source video. */
export interface ClipFrames { w: number; h: number; srcWidth: number; frames: AsyncIterable<Uint8Array> }
/** Adapter: decodes a whole clip as gray frames. Injectable for tests. */
export type ClipFrameSource = (req: ClipFrameRequest) => Promise<ClipFrames>;

/**
 * Decode a whole clip at its native fps, scaled to 320 px wide, gray8 rawvideo through an ffmpeg pipe (software decode:
 * hwaccel drops frames on 10-bit Sony footage). When the stream ends the frame count is checked against the container's
 * `nb_read_packets`; a mismatch throws from the iterator, so the clip fails instead of giving a wrong curve.
 */
export const decodeClipFrames: ClipFrameSource = async (req) => {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', req.file]);
  const [sw, sh] = stdout.trim().split(',').map(Number);
  if (!sw || !sh) throw new Error(`could not read frame size of ${req.file}`);
  const w = DECODE_WIDTH;
  const h = Math.max(2, Math.round((w * sh) / sw / 2) * 2);
  const size = w * h;
  const args = ['-v', 'error', '-i', req.file, '-an', '-vf', `scale=${w}:${h},format=gray`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'];

  async function* frames(): AsyncGenerator<Uint8Array> {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (c: Buffer) => { err += c; });
    const exited = new Promise<number | null>((resolve, reject) => { p.on('error', reject); p.on('close', resolve); });
    exited.catch(() => {});
    let pending = Buffer.alloc(0);
    let count = 0;
    try {
      for await (const chunk of p.stdout as AsyncIterable<Buffer>) {
        pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
        while (pending.length >= size) {
          yield new Uint8Array(pending.subarray(0, size));
          pending = pending.subarray(size);
          count++;
        }
      }
    } finally {
      if (p.exitCode === null) p.kill();
    }
    const code = await exited;
    if (code !== 0) throw new Error(`ffmpeg failed (${code}) on ${req.file}: ${err.trim()}`);
    const { stdout: n } = await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', req.file]);
    checkFrameCount(count, Number(n.trim()) || null);
  }
  return { w, h, srcWidth: sw, frames: frames() };
};
