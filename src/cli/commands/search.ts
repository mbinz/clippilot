import { Command } from 'commander';
import chalk from 'chalk';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { ThumbnailRepository } from '../../db/repositories/thumbnail.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { formatClipTable } from '../formatters/table.js';
import { searchClips } from '../../core/search/engine.js';
import { clipsToJson } from '../json.js';

export function registerSearchCommand(parent: Command): void {
  parent
    .command('search <query>')
    .description('Full-text search over analyzed clips')
    .option('--project <name>', 'Search within project')
    .option('--min-quality <score>', 'Minimum quality score (1-5)')
    .option('--sort <field>', 'Sort by: quality, date, emotional, duration')
    .option('--limit <n>', 'Max results', '20')
    .option('--json', 'Emit JSON instead of a table (for scripts and Claude skills)')
    .action(async (query: string, options) => {
      const basePath = process.cwd();
      const db = createDb(resolveDbPath(basePath));
      runMigrations(db);
      const clipRepo = new ClipRepository(db);
      const thumbnailRepo = new ThumbnailRepository(db);

      try {
        const results = searchClips(clipRepo, query, {
          min_quality: options.minQuality ? parseFloat(options.minQuality) : undefined,
          sort: options.sort,
          limit: parseInt(options.limit, 10),
        });

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                query,
                count: results.length,
                clips: clipsToJson(results, thumbnailRepo),
              },
              null,
              2,
            ),
          );
          return;
        }

        if (results.length === 0) {
          console.log(chalk.yellow('No clips found matching your query.'));
          return;
        }

        console.log(chalk.green(`Found ${results.length} clip(s):\n`));
        console.log(formatClipTable(results));
      } finally {
        db.close();
      }
    });
}
