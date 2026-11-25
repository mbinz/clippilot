import { GoogleGenAI } from '@google/genai';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { INLINE_MAX_BYTES } from '../analyze/gemini-client.js';
import type { Part } from './plan.js';

const exec = promisify(execFile);
const MAX_PARSE_ATTEMPTS = 3;
const MAX_API_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ShakePrompt { system: string; user: string }

/** One check: a stretch of a clip's video (clip seconds `from`..`to`) and the question about it. */
export interface VerifyRequest { source: string; from: number; to: number; prompt: ShakePrompt }

/** The model call: video segment + prompt in, the model's raw text out. Injectable for tests. */
export interface ShakeVerifier { verify(req: VerifyRequest): Promise<string> }

export const VerdictSchema = z.object({ keeps_content: z.boolean(), reason: z.string() });
export type Verdict = z.infer<typeof VerdictSchema>;

const SYSTEM = `You are a film editor checking an automatic edit of a short video. The video you see is an excerpt of a longer \
recording. A tool found moments where the camera jolts (a shake) and wants to cut these out. Your only job is to say whether \
the cut would lose what the moment is about.`;

const SEGMENT_PAD_SEC = 0.5;

/** The stretch sent to the model: the moment's range +- 0.5 s, kept inside the clip. */
export function segmentBounds(range: Part, clipDuration: number): { from: number; to: number } {
  return { from: r2(Math.max(0, range.start - SEGMENT_PAD_SEC)), to: r2(Math.min(clipDuration, range.end + SEGMENT_PAD_SEC)) };
}

const span = (a: number, b: number, off: number) => `${r2(a - off).toFixed(2)}-${r2(b - off).toFixed(2)} s`;

/**
 * The question for one moment. All times are seconds from the start of the excerpt (clip time minus `from`), because
 * that is what the model sees on the video's timeline.
 */
export function buildShakePrompt(o: {
  description: string; range: Part; shakes: { start_sec: number; end_sec: number }[]; parts: Part[]; from: number;
}): ShakePrompt {
  const lost = o.shakes.map((k) => span(Math.max(k.start_sec, o.range.start), Math.min(k.end_sec, o.range.end), o.from)).join(', ');
  const user = `This video is an excerpt of a recording. All times below are seconds from the start of this excerpt.
The moment we want to use: ${span(o.range.start, o.range.end, o.from)}. What it shows: "${o.description}"
The camera shakes (a sudden jolt) at: ${lost}. The edit removes these stretches.
The edit keeps only: ${o.parts.map((p) => span(p.start, p.end, o.from)).join(', ')}.

Question: does the edited version still contain the moment's key action complete?
Answer false if the key action (what the description is about, for example a kiss, a jump, a wave breaking, a hand-over) \
happens during a removed stretch or is cut in half by the edit. Answer true if what matters is still in the kept parts and \
only camera wobble or dead time is removed.
Answer with JSON only: {"keeps_content": true or false, "reason": "one short sentence"}`;
  return { system: SYSTEM, user };
}

/** Ask the verifier; malformed or schema-invalid answers are retried up to 3 times, API errors are not (they propagate). */
export async function askVerdict(verifier: ShakeVerifier, req: VerifyRequest): Promise<Verdict> {
  let last = '';
  for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
    const text = await verifier.verify(req);
    try {
      return VerdictSchema.parse(JSON.parse(text));
    } catch (err) {
      last = (err as Error).message;
    }
  }
  throw new Error(`Shake check answer was invalid after ${MAX_PARSE_ATTEMPTS} attempts: ${last}`);
}

/** Re-encode a small 360p excerpt of the proxy (ffmpeg `-ss/-t`) and return it. */
export type SegmentExtractor = (source: string, from: number, to: number, out: string) => Promise<void>;

export const extractSegment: SegmentExtractor = async (source, from, to, out) => {
  await exec('ffmpeg', ['-v', 'error', '-y', '-ss', String(from), '-t', String(r2(to - from)), '-i', source,
    '-vf', 'scale=-2:360', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '48k', '-movflags', '+faststart', out], { maxBuffer: 16 * 1024 * 1024 });
};

export interface GeminiShakeDeps {
  extract?: SegmentExtractor;
  generate?: (req: { model: string; contents: unknown; config: unknown }) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
}

/** Real verifier: the excerpt goes inline (it is a few MB at most) to `model` together with the prompt. */
export function createGeminiShakeVerifier(apiKey: string, model: string, deps: GeminiShakeDeps = {}): ShakeVerifier {
  const extract = deps.extract ?? extractSegment;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let ai: GoogleGenAI | null = null;
  const generate = deps.generate ?? (async (req) => {
    ai ??= new GoogleGenAI({ apiKey });
    return (await ai.models.generateContent(req as Parameters<typeof ai.models.generateContent>[0])).text ?? '';
  });
  return {
    async verify(req) {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'clippilot-shake-'));
      try {
        const out = path.join(dir, 'segment.mp4');
        await extract(req.source, req.from, req.to, out);
        const data = await readFile(out);
        if (Math.ceil(data.length / 3) * 4 > INLINE_MAX_BYTES) throw new Error('Excerpt too large to send inline');
        const request = {
          model,
          contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'video/mp4', data: data.toString('base64') } }, { text: req.prompt.user }] }],
          config: { systemInstruction: req.prompt.system, responseMimeType: 'application/json' },
        };
        for (let attempt = 0; ; attempt++) {
          try {
            return await generate(request);
          } catch (err) {
            const status = (err as { status?: number; httpStatusCode?: number }).status ?? (err as { httpStatusCode?: number }).httpStatusCode;
            if ((status === 429 || status === 503) && attempt + 1 < MAX_API_RETRIES) { await sleep(INITIAL_BACKOFF_MS * 2 ** attempt); continue; }
            throw err;
          }
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
