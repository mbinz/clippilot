import { Command } from 'commander';
import chalk from 'chalk';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { ThumbnailRepository } from '../../db/repositories/thumbnail.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { clipToJson } from '../json.js';

export function registerTagCommand(parent: Command): void {
  parent
    .command('tag <clip-id>')
    .description('Edit metadata for a clip')
    .option('-l, --location <location>', 'Set location')
    .option('-t, --tags <tags>', 'Comma-separated tags')
    .option('--people <people>', 'Comma-separated people names')
    .option('--json', 'Emit JSON confirmation instead of a status line')
    .action(async (clipId: string, options) => {
      const basePath = process.cwd();
      const db = createDb(resolveDbPath(basePath));
      runMigrations(db);
      const clipRepo = new ClipRepository(db);
      const thumbnailRepo = new ThumbnailRepository(db);

      try {
        const id = parseInt(clipId, 10);
        const clip = clipRepo.findById(id);
        if (!clip) {
          if (options.json) {
            console.log(JSON.stringify({ ok: false, error: `Clip ${clipId} not found` }));
          } else {
            console.error(chalk.red(`Error: Clip ${clipId} not found`));
          }
          process.exit(1);
        }

        const tags = options.tags ? JSON.stringify(options.tags.split(',').map((s: string) => s.trim())) : clip.manual_tags;
        const location = options.location ?? clip.location;
        const people = options.people ? JSON.stringify(options.people.split(',').map((s: string) => s.trim())) : clip.people;

        clipRepo.updateTags(id, tags, location, people);

        if (options.json) {
          const updated = clipRepo.findById(id)!;
          const thumbs = thumbnailRepo.findByClip(id).map((t) => t.file_path);
          console.log(JSON.stringify({ ok: true, clip: clipToJson(updated, thumbs) }, null, 2));
          return;
        }

        console.log(chalk.green(`Updated metadata for clip ${clipId}`));
      } finally {
        db.close();
      }
    });
}
