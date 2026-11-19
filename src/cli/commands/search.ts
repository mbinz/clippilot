import { Command } from 'commander';
import chalk from 'chalk';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { ThumbnailRepository } from '../../db/repositories/thumbnail.repository.js';
import { HighlightRepository } from '../../db/repositories/highlight.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { formatClipTable } from '../formatters/table.js';
import { searchClips } from '../../core/search/engine.js';
import { clipsToJson } from '../json.js';
import { TIERS, isTier, tierRank } from '../../core/tiers.js';

export function registerSearchCommand(parent: Command): void {
  parent
    .command('search <query>')
    .description('Full-text search over analyzed clips')
    .option('--project <name>', 'Search within project')
    .option('--min-tier <tier>', 'Only clips with a moment at or above this tier: hero, solid, filler')
    .option('--sort <field>', 'Sort by: date, duration')
    .option('--limit <n>', 'Max results', '20')
    .option('--json', 'Emit JSON instead of a table (for scripts and Claude skills)')
    .action(async (query: string, options) => {
      const basePath = process.cwd();
      const db = createDb(resolveDbPath(basePath));
      runMigrations(db);
      const clipRepo = new ClipRepository(db);
      const thumbnailRepo = new ThumbnailRepository(db);
      const highlightRepo = new HighlightRepository(db);

      try {
        if (options.minTier !== undefined && !isTier(options.minTier)) {
          console.error(chalk.red(`Invalid --min-tier "${options.minTier}". Use: ${TIERS.join(', ')}`));
          process.exitCode = 1;
          return;
        }
        const results = searchClips(clipRepo, query, {
          min_tier: options.minTier,
          sort: options.sort,
          limit: parseInt(options.limit, 10),
        });

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                query,
                count: results.length,
                clips: clipsToJson(results, thumbnailRepo, highlightRepo),
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
        console.log(formatClipTable(results, bestTiers(highlightRepo, results.map((c) => c.id))));
      } finally {
        db.close();
      }
    });
}

function bestTiers(repo: HighlightRepository, clipIds: number[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const id of clipIds) {
    const best = repo.findByClip(id).map((h) => h.tier).sort((a, b) => tierRank(b) - tierRank(a))[0];
    if (best) out.set(id, best);
  }
  return out;
}
