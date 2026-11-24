import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrations/runner.js';
import { ClipRepository } from '../../src/db/repositories/clip.repository.js';
import { HighlightRepository } from '../../src/db/repositories/highlight.repository.js';
import { TranscriptRepository } from '../../src/db/repositories/transcript.repository.js';
import { loadConfig } from '../../src/core/config/manager.js';
import { expandHome, transcribeClips } from '../../src/core/transcribe/index.js';

const run = promisify(execFile);

async function has(cmd: string, args: string[]): Promise<boolean> {
  try { await run(cmd, args); return true; } catch { return false; }
}

// Needs the configured whisper model (a download), whisper-cli, ffmpeg and macOS `say`; skipped otherwise.
const config = await loadConfig(process.cwd());
const model = expandHome(process.env['CLIPPILOT_WHISPER_MODEL'] ?? config.whisper_model);
const ready = existsSync(model)
  && (await has('whisper-cli', ['--help']) || await has('whisper-cli', ['-h']))
  && await has('ffmpeg', ['-version'])
  && existsSync('/usr/bin/say');

describe.skipIf(!ready)('transcribe integration (real whisper-cli)', () => {
  let dir: string;
  let video: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'clippilot-tr-int-'));
    const speech = path.join(dir, 'speech.aiff');
    await run('/usr/bin/say', ['-o', speech, 'Look at the dolphins. They are swimming right next to the boat.']);
    video = path.join(dir, 'clip.mp4');
    await run('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=25:d=6', '-i', speech,
      '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', video]);
  }, 60000);

  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('transcribes a generated clip and snaps an unprotected moment to the sentence', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const clips = new ClipRepository(db);
    const highlights = new HighlightRepository(db);
    const transcripts = new TranscriptRepository(db);
    const clip = clips.insert({
      project_id: null, file_path: video, proxy_path: null, file_hash: 'h', file_size: 1, duration_sec: 6,
      resolution: '160x90', fps: 25, nb_frames: null, has_video: 1, has_audio: 1, codec: null,
      recorded_at: null, start_timecode: null, location: null, manual_tags: null, people: null,
    });
    highlights.replaceForClip(clip.id, [{ start_sec: 0.4, end_sec: 3, description: 'dolphins', tier: 'hero' }]);

    const r = await transcribeClips([clip], { transcripts, highlights }, { model });
    expect(r.errors).toEqual([]);
    expect(r.transcribed).toBe(1);

    const t = transcripts.get(clip.id)!;
    expect(t.language).toBe('en');
    expect(t.text.toLowerCase()).toContain('dolphins');
    expect(t.words.length).toBeGreaterThan(8);
    expect(t.segments[0].start).toBeLessThan(0.5);
    // The moment started inside the first sentence: it now starts at the sentence start.
    expect(highlights.findByClip(clip.id)[0].start_sec).toBeLessThan(0.1);
  }, 600000);
});
