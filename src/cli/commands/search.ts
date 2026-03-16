import { Command } from 'commander';
import chalk from 'chalk';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { formatClipTable } from '../formatters/table.js';
import { searchClips } from '../../core/search/engine.js';

export function registerSearchCommand(parent: Command): void {
  parent
    .command('search <query>')
    .description('Full-text search over analyzed clips')
    .option('--project <name>', 'Search within project')
    .option('--min-quality <score>', 'Minimum quality score (1-5)')
    .option('--sort <field>', 'Sort by: quality, date, emotional, duration')
    .option('--limit <n>', 'Max results', '20')
    .action(async (query: string, options) => {
      const basePath = process.cwd();
      const db = createDb(resolveDbPath(basePath));
      runMigrations(db);
      const clipRepo = new ClipRepository(db);

      try {
        const results = searchClips(clipRepo, query, {
          min_quality: options.minQuality ? parseFloat(options.minQuality) : undefined,
          sort: options.sort,
          limit: parseInt(options.limit, 10),
        });

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
