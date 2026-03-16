import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrations/runner.js';
import { ClipRepository } from '../../src/db/repositories/clip.repository.js';
import { ProjectRepository } from '../../src/db/repositories/project.repository.js';
import { ThumbnailRepository } from '../../src/db/repositories/thumbnail.repository.js';
import { ingestDirectory } from '../../src/core/ingest/index.js';
import { ensureDir } from '../../src/utils/fs.js';

const execFileAsync = promisify(execFile);

// Check if ffmpeg is available
async function hasFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

describe('ingest integration', () => {
  let tmpDir: string;
  let videoDir: string;
  let ffmpegAvailable: boolean;

  beforeAll(async () => {
    ffmpegAvailable = await hasFfmpeg();
    if (!ffmpegAvailable) return;

    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'clippilot-integ-'));
    videoDir = path.join(tmpDir, 'videos');
    await ensureDir(videoDir);

    // Generate a tiny test video with ffmpeg
    await execFileAsync('ffmpeg', [
      '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=25',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast',
      '-c:a', 'aac', '-y',
      path.join(videoDir, 'test_clip.mp4'),
    ], { timeout: 30000 });
  });

  afterAll(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true });
  });

  it('ingests a video file end-to-end', async () => {
    if (!ffmpegAvailable) {
      console.log('Skipping: ffmpeg not available');
      return;
    }

    const basePath = tmpDir;
    const dbPath = path.join(basePath, '.clippilot', 'clippilot.db');
    await ensureDir(path.dirname(dbPath));

    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const clipRepo = new ClipRepository(db);
    const projectRepo = new ProjectRepository(db);
    const thumbnailRepo = new ThumbnailRepository(db);
    const project = projectRepo.findOrCreate('test-project');

    const result = await ingestDirectory(videoDir, {
      projectId: project.id,
      location: 'Test Location',
      tags: 'test,integration',
      date: null,
      noProxy: false,
      proxyResolution: 720,
      basePath,
    }, {
      clipRepo,
      thumbnailRepo,
      onProgress: () => {},
    });

    expect(result.total).toBe(1);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);

    // Check DB record
    const clips = clipRepo.listAll();
    expect(clips).toHaveLength(1);
    expect(clips[0].location).toBe('Test Location');
    expect(clips[0].analysis_status).toBe('pending');
    expect(clips[0].proxy_path).toBeTruthy();

    // Check proxy file exists
    expect(existsSync(clips[0].proxy_path!)).toBe(true);

    // Check thumbnails
    const thumbs = thumbnailRepo.findByClip(clips[0].id);
    expect(thumbs.length).toBeGreaterThan(0);

    // Test idempotency: re-ingest should skip
    const result2 = await ingestDirectory(videoDir, {
      projectId: project.id,
      location: 'Test Location',
      tags: null,
      date: null,
      noProxy: false,
      proxyResolution: 720,
      basePath,
    }, {
      clipRepo,
      thumbnailRepo,
      onProgress: () => {},
    });

    expect(result2.imported).toBe(0);
    expect(result2.skipped).toBe(1);

    // Still only 1 clip in DB
    expect(clipRepo.listAll()).toHaveLength(1);

    db.close();
  });
});
