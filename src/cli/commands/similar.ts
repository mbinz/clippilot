import { Command } from 'commander';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { ThumbnailRepository } from '../../db/repositories/thumbnail.repository.js';
import { SimilarityRepository } from '../../db/repositories/similarity.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { clipToJson } from '../json.js';

export function registerSimilarCommand(parent: Command): void {
  parent
    .command('similar <clip-id>')
    .description('List similarity groups (and member clips) that include the given clip')
    .action(async (clipId: string) => {
      const basePath = process.cwd();
      const db = createDb(resolveDbPath(basePath));
      runMigrations(db);
      const clipRepo = new ClipRepository(db);
      const thumbRepo = new ThumbnailRepository(db);
      const simRepo = new SimilarityRepository(db);

      try {
        const id = parseInt(clipId, 10);
        if (!clipRepo.findById(id)) {
          console.log(JSON.stringify({ ok: false, error: `Clip ${clipId} not found` }));
          process.exit(1);
        }

        const groups = simRepo.findGroupsByClip(id);
        const result = groups.map((g) => {
          const detail = simRepo.getGroupWithMembers(g.id);
          if (!detail) return null;
          return {
            group_id: g.id,
            reason: g.reason,
            computed_at: g.computed_at,
            members: detail.members.map((m) => {
              const c = clipRepo.findById(m.clip_id);
              return {
                clip_id: m.clip_id,
                is_best: m.is_best === 1,
                similarity_score: m.similarity_score,
                clip: c ? clipToJson(c, thumbRepo.findByClip(m.clip_id).map((t) => t.file_path)) : null,
              };
            }),
          };
        }).filter(Boolean);

        console.log(JSON.stringify({ ok: true, clip_id: id, groups: result }, null, 2));
      } finally {
        db.close();
      }
    });
}
