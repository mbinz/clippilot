import { Command } from 'commander';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { SimilarityRepository } from '../../db/repositories/similarity.repository.js';
import { resolveDbPath } from '../../utils/fs.js';

export function registerMarkBestCommand(parent: Command): void {
  parent
    .command('mark-best <clip-id>')
    .description('Mark a clip as the best in its similarity group(s)')
    .option('--group <id>', 'Restrict to a single similarity group ID (default: all groups containing the clip)')
    .action(async (clipId: string, options) => {
      const basePath = process.cwd();
      const db = createDb(resolveDbPath(basePath));
      runMigrations(db);
      const clipRepo = new ClipRepository(db);
      const simRepo = new SimilarityRepository(db);

      try {
        const id = parseInt(clipId, 10);
        if (!clipRepo.findById(id)) {
          console.log(JSON.stringify({ ok: false, error: `Clip ${clipId} not found` }));
          process.exit(1);
        }

        const groupIds: number[] = options.group
          ? [parseInt(options.group, 10)]
          : simRepo.findGroupsByClip(id).map((g) => g.id);

        if (groupIds.length === 0) {
          console.log(
            JSON.stringify({
              ok: false,
              error: `Clip ${clipId} is not a member of any similarity group`,
            }),
          );
          process.exit(1);
        }

        for (const groupId of groupIds) {
          simRepo.markBest(groupId, id);
        }

        console.log(
          JSON.stringify(
            { ok: true, clip_id: id, marked_best_in_groups: groupIds },
            null,
            2,
          ),
        );
      } finally {
        db.close();
      }
    });
}
