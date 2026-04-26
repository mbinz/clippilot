import { Command } from 'commander';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { ThumbnailRepository } from '../../db/repositories/thumbnail.repository.js';
import { SimilarityRepository } from '../../db/repositories/similarity.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { clipToJson } from '../json.js';

export function registerGetClipCommand(parent: Command): void {
  parent
    .command('get-clip <clip-id>')
    .description('Fetch full metadata, thumbnails, and similarity groups for a clip')
    .action(async (clipId: string) => {
      const basePath = process.cwd();
      const db = createDb(resolveDbPath(basePath));
      runMigrations(db);
      const clipRepo = new ClipRepository(db);
      const thumbRepo = new ThumbnailRepository(db);
      const simRepo = new SimilarityRepository(db);

      try {
        const id = parseInt(clipId, 10);
        const clip = clipRepo.findById(id);
        if (!clip) {
          console.log(JSON.stringify({ ok: false, error: `Clip ${clipId} not found` }));
          process.exit(1);
        }

        const thumbs = thumbRepo.findByClip(id).map((t) => t.file_path);
        const groups = simRepo.findGroupsByClip(id).map((g) => ({
          group_id: g.id,
          reason: g.reason,
          computed_at: g.computed_at,
        }));

        console.log(
          JSON.stringify(
            {
              ok: true,
              clip: clipToJson(clip, thumbs),
              similarity_groups: groups,
            },
            null,
            2,
          ),
        );
      } finally {
        db.close();
      }
    });
}
