import { Command } from 'commander';
import path from 'node:path';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { ProjectRepository } from '../../db/repositories/project.repository.js';
import { ThumbnailRepository } from '../../db/repositories/thumbnail.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { ingestDirectory } from '../../core/ingest/index.js';
import { createProgressBar } from '../formatters/progress.js';
import { logger } from '../../utils/logger.js';

export function registerIngestCommand(parent: Command): void {
  parent
    .command('ingest <path>')
    .description('Import video footage, create proxies, and extract metadata')
    .option('-l, --location <location>', 'Set location metadata for imported clips')
    .option('-t, --tags <tags>', 'Comma-separated tags to apply')
    .option('--project <name>', 'Project name (default: folder name)')
    .option('--date <date>', 'Override recording date (YYYY-MM-DD)')
    .option('--skip-analysis', 'Skip automatic analysis after ingest', false)
    .option('--no-proxy', 'Skip proxy file generation')
    .option('--proxy-resolution <pixels>', 'Proxy vertical resolution (720 or 480)', '720')
    .action(async (inputPath: string, options) => {
      const absPath = path.resolve(inputPath);
      if (!existsSync(absPath)) {
        console.error(chalk.red(`Error: Path not found: ${absPath}`));
        process.exit(1);
      }

      const basePath = process.cwd();
      const dbPath = resolveDbPath(basePath);
      const db = createDb(dbPath);
      runMigrations(db);

      const clipRepo = new ClipRepository(db);
      const projectRepo = new ProjectRepository(db);
      const thumbnailRepo = new ThumbnailRepository(db);

      const projectName = options.project ?? path.basename(absPath);
      const project = projectRepo.findOrCreate(projectName);

      const bar = createProgressBar('Ingest');
      let barStarted = false;

      try {
        const result = await ingestDirectory(absPath, {
          projectId: project.id,
          location: options.location ?? null,
          tags: options.tags ?? null,
          date: options.date ?? null,
          noProxy: !options.proxy,
          proxyResolution: parseInt(options.proxyResolution, 10),
          basePath,
        }, {
          clipRepo,
          thumbnailRepo,
          onProgress: (current, total, filename) => {
            if (!barStarted) {
              bar.start(total, 0, { filename: '' });
              barStarted = true;
            }
            bar.update(current, { filename });
          },
        });

        if (barStarted) bar.stop();

        console.log('');
        console.log(chalk.green(`Ingest complete for project "${projectName}"`));
        console.log(`  Total files found: ${result.total}`);
        console.log(`  New clips imported: ${result.imported}`);
        console.log(`  Skipped (already known): ${result.skipped}`);
        console.log(`  Errors: ${result.errors}`);
      } catch (err) {
        if (barStarted) bar.stop();
        throw err;
      } finally {
        db.close();
      }
    });
}
