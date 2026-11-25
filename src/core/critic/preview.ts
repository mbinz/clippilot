import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { CutTree } from '../storyboard/service.js';
import { panelLabels } from './findings.js';

const exec = promisify(execFile);

export const PREVIEW_W = 854;
export const PREVIEW_H = 480;
const FPS = 25;
const BED_DB = -18;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** One played piece of the preview: a moment's range at its speed. */
export interface PreviewSegment {
  /** "S2·P3", burned into the top-left corner so findings can name the panel. */
  label: string;
  file: string;
  start: number;
  end: number;
  speed: number;
  /** keep-audio panels play at full volume, all others as a −18 dB bed. */
  keepAudio: boolean;
  hasAudio: boolean;
}

const playedSec = (s: PreviewSegment) => r3((s.end - s.start) / s.speed);
export const previewDuration = (segs: PreviewSegment[]): number => r3(segs.reduce((a, s) => a + playedSec(s), 0));

/** atempo accepts 0.5..2 per instance: slower speeds chain halves (0.25 = two times 0.5). '' for speed 1. */
export function atempoChain(speed: number): string {
  if (speed === 1) return '';
  const parts: string[] = [];
  let s = speed;
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  while (s > 2) { parts.push('atempo=2'); s /= 2; }
  if (Math.abs(s - 1) > 1e-9) parts.push(`atempo=${r3(s)}`);
  return parts.join(',');
}

/**
 * Filter graph of the preview. Inputs 0..n-1 are the sources (already seeked to their range by `-ss/-t`), inputs
 * n..2n-1 the label images. Video: speed via setpts, letterboxed to 480p, label overlaid. Audio: atempo, bed volume
 * for non-keep panels, silence for clips without audio. Everything is concatenated.
 */
export function buildPreviewGraph(segs: PreviewSegment[]): string {
  const n = segs.length;
  const parts: string[] = [];
  segs.forEach((s, i) => {
    parts.push(`[${i}:v]setpts=(PTS-STARTPTS)/${s.speed},scale=${PREVIEW_W}:${PREVIEW_H}:force_original_aspect_ratio=decrease,`
      + `pad=${PREVIEW_W}:${PREVIEW_H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p[vb${i}]`);
    parts.push(`[vb${i}][${n + i}:v]overlay=8:8:shortest=1,format=yuv420p[v${i}]`);
    const fmt = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
    const vol = s.keepAudio ? '' : `,volume=${BED_DB}dB`;
    if (s.hasAudio) {
      const tempo = atempoChain(s.speed);
      parts.push(`[${i}:a]asetpts=PTS-STARTPTS${tempo ? `,${tempo}` : ''},${fmt}${vol}[a${i}]`);
    } else {
      parts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${playedSec(s)},asetpts=PTS-STARTPTS,${fmt}[a${i}]`);
    }
  });
  parts.push(`${segs.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${n}:v=1:a=1[v][a]`);
  return parts.join(';');
}

/** ffmpeg arguments for the whole preview (480p H.264 / AAC). `labelFiles[i]` is the PNG of segment i. */
export function buildPreviewArgs(segs: PreviewSegment[], labelFiles: string[], outPath: string): string[] {
  const args = ['-v', 'error', '-y'];
  for (const s of segs) args.push('-ss', String(s.start), '-t', String(r3(s.end - s.start)), '-i', s.file);
  segs.forEach((s, i) => args.push('-loop', '1', '-framerate', String(FPS), '-t', String(playedSec(s)), '-i', labelFiles[i]!));
  args.push('-filter_complex', buildPreviewGraph(segs), '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', outPath);
  return args;
}

/** Where a clip plays from: its proxy (else the original), and whether it has sound. */
export interface PreviewClip { file: string; hasAudio: boolean }

/** Segments of a cut in order: filled panels, candidate panels with their first candidate (as the export does); gaps are skipped. */
export function previewSegments(tree: CutTree, clipOf: (clipId: number) => PreviewClip | null): PreviewSegment[] {
  const labels = panelLabels(tree);
  const segs: PreviewSegment[] = [];
  for (const p of tree.scenes.flatMap((s) => s.panels)) {
    const m = p.state === 'filled' ? p.moment : p.state === 'candidates' ? p.candidates[0] ?? null : null;
    const clip = m ? clipOf(m.clip_id) : null;
    if (!m || !clip) continue;
    segs.push({
      label: labels.get(p.id)!, file: clip.file, start: m.start_sec, end: m.end_sec, speed: m.speed,
      keepAudio: m.audio_keep === 1, hasAudio: clip.hasAudio,
    });
  }
  return segs;
}

export interface CostEstimate { input_tokens: number; output_tokens: number; estimate_usd: number }

/** Gemini 2.5 Pro list price: $1.25 / M in and $10 / M out up to 200k input tokens, $2.50 / $15 above; video ~300 tokens/s incl. audio. */
export function estimateCost(o: { duration_sec: number; prompt_chars: number; output_tokens?: number }): CostEstimate {
  const input = Math.round(o.duration_sec * 300 + o.prompt_chars / 4);
  const output = o.output_tokens ?? 4000;
  const [pin, pout] = input <= 200_000 ? [1.25, 10] : [2.5, 15];
  return { input_tokens: input, output_tokens: output, estimate_usd: r3((input * pin + output * pout) / 1e6) };
}

async function labelPng(label: string, file: string): Promise<void> {
  const w = 16 + label.length * 11;
  const svg = `<svg width="${w}" height="30" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="30" fill="black" fill-opacity="0.65"/>`
    + `<text x="8" y="21" font-family="monospace" font-size="18" fill="white">${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
}

export type FfmpegRunner = (args: string[]) => Promise<void>;
const runFfmpeg: FfmpegRunner = async (args) => { await exec('ffmpeg', args, { maxBuffer: 64 * 1024 * 1024 }); };

/** Render the preview of `segs` to `outPath`; returns its duration (sum of played lengths). */
export async function renderPreview(segs: PreviewSegment[], outPath: string, run: FfmpegRunner = runFfmpeg): Promise<{ path: string; duration_sec: number }> {
  if (segs.length === 0) throw new Error('The cut has no filled panels to preview');
  await mkdir(path.dirname(outPath), { recursive: true });
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'clippilot-preview-'));
  try {
    const labels = await Promise.all(segs.map(async (s, i) => {
      const f = path.join(tmp, `l${i}.png`);
      await labelPng(s.label, f);
      return f;
    }));
    await run(buildPreviewArgs(segs, labels, outPath));
    return { path: outPath, duration_sec: previewDuration(segs) };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
