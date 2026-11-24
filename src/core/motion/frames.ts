import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export const DECODE_WIDTH = 320;

export interface FrameRequest { file: string; startSec: number; durationSec: number; fps: number }
export interface FrameSet { w: number; h: number; frames: Uint8Array[] }
/** Adapter: decodes the used source range as gray frames. Injectable for tests. */
export type FrameSource = (req: FrameRequest) => Promise<FrameSet>;

/** Decode `req` at its native fps, scaled to 320 px wide, gray8 rawvideo through an ffmpeg pipe. */
export const decodeFrames: FrameSource = async (req) => {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', req.file]);
  const [sw, sh] = stdout.trim().split(',').map(Number);
  if (!sw || !sh) throw new Error(`could not read frame size of ${req.file}`);
  const w = DECODE_WIDTH;
  const h = Math.max(2, Math.round((w * sh) / sw / 2) * 2);
  const args = ['-v', 'error', '-ss', String(req.startSec), '-t', String(req.durationSec), '-i', req.file, '-an',
    '-vf', `scale=${w}:${h},format=gray`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'];
  const buf = await new Promise<Buffer>((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let err = '';
    p.stdout.on('data', (c: Buffer) => chunks.push(c));
    p.stderr.on('data', (c: Buffer) => { err += c; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg failed (${code}) on ${req.file}: ${err.trim()}`))));
  });
  const size = w * h;
  const frames: Uint8Array[] = [];
  for (let o = 0; o + size <= buf.length; o += size) frames.push(new Uint8Array(buf.subarray(o, o + size)));
  return { w, h, frames };
};
