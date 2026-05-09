import type { ClipRepository } from '../../db/repositories/clip.repository.js';
import type { ThumbnailRepository } from '../../db/repositories/thumbnail.repository.js';
import { scanDirectory } from './scanner.js';
import { computeFileHash } from './hasher.js';
import { probeFile } from './probe.js';
import { createProxy } from './proxy.js';
import { extractThumbnails } from './thumbnail.js';
import { ensureDir } from '../../utils/fs.js';
import path from 'node:path';
import { PROXY_DIR, THUMBNAIL_DIR } from '../../constants.js';

export interface IngestOptions {
  projectId: number;
  location: string | null;
  tags: string | null;
  date: string | null;
  noProxy: boolean;
  proxyResolution: number;
  basePath: string;
}

export interface IngestDependencies {
  clipRepo: ClipRepository;
  thumbnailRepo: ThumbnailRepository;
  onProgress: (current: number, total: number, filename: string) => void;
}

export interface IngestResult {
  total: number;
  imported: number;
  skipped: number;
  errors: number;
}

export async function ingestDirectory(
  dirPath: string,
  options: IngestOptions,
  deps: IngestDependencies,
): Promise<IngestResult> {
  const files = await scanDirectory(dirPath);
  const total = files.length;
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  if (total === 0) {
    return { total: 0, imported: 0, skipped: 0, errors: 0 };
  }

  const proxyDir = path.resolve(options.basePath, PROXY_DIR);
  const thumbDir = path.resolve(options.basePath, THUMBNAIL_DIR);
  await ensureDir(proxyDir);
  await ensureDir(thumbDir);

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const fileName = path.basename(filePath);

    try {
      const hash = await computeFileHash(filePath);

      // Idempotency check
      if (deps.clipRepo.findByHash(hash)) {
        skipped++;
        deps.onProgress(imported + skipped + errors, total, `${fileName} (skipped)`);
        continue;
      }

      const metadata = await probeFile(filePath);

      let proxyPath: string | null = null;
      if (!options.noProxy) {
        proxyPath = await createProxy(filePath, hash, proxyDir, options.proxyResolution);
      }

      // Extract thumbnails from proxy (or original if no proxy)
      const sourceForThumbs = proxyPath ?? filePath;
      const thumbnails = await extractThumbnails(sourceForThumbs, hash, metadata.duration_sec, thumbDir);

      // Insert clip
      const clip = deps.clipRepo.insert({
        project_id: options.projectId,
        file_path: filePath,
        proxy_path: proxyPath,
        file_hash: hash,
        file_size: metadata.file_size,
        duration_sec: metadata.duration_sec,
        resolution: metadata.resolution,
        fps: metadata.fps,
        nb_frames: metadata.nb_frames,
        has_video: metadata.has_video ? 1 : 0,
        has_audio: metadata.has_audio ? 1 : 0,
        codec: metadata.codec,
        recorded_at: options.date ?? metadata.recorded_at,
        start_timecode: metadata.start_timecode,
        location: options.location,
        manual_tags: options.tags ? JSON.stringify(options.tags.split(',').map(s => s.trim())) : null,
        people: null,
      });

      // Insert thumbnails
      if (thumbnails.length > 0) {
        deps.thumbnailRepo.insertMany(
          thumbnails.map((t) => ({
            clip_id: clip.id,
            file_path: t.path,
            timestamp_sec: t.timestamp_sec,
          })),
        );
      }

      imported++;
    } catch (err) {
      errors++;
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`\nError processing ${fileName}: ${msg}\n`);
    }

    deps.onProgress(imported + skipped + errors, total, fileName);
  }

  return { total, imported, skipped, errors };
}
