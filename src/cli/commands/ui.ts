import { Command } from 'commander';
import chalk from 'chalk';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { loadConfig } from '../../core/config/manager.js';
import { resolveDbPath } from '../../utils/fs.js';
import { startServer } from '../../core/server/index.js';

export function registerUiCommand(parent: Command): void {
  parent
    .command('ui')
    .description('Launch the web UI for browsing and filtering clips')
    .option('-p, --port <port>', 'Port number', String)
    .option('--no-open', 'Do not open browser automatically')
    .action(async (options) => {
      const basePath = process.cwd();
      const config = await loadConfig(basePath);
      const port = options.port ? parseInt(options.port, 10) : config.web_ui_port;

      const db = createDb(resolveDbPath(basePath));
      runMigrations(db);

      try {
        const { url } = await startServer({ db, basePath, port });

        console.log(chalk.green(`\nClipPilot UI running at ${chalk.bold(url)}\n`));

        if (options.open !== false) {
          const { default: open } = await import('open');
          await open(url);
        }

        console.log(chalk.dim('Press Ctrl+C to stop.'));

        // Keep process alive
        await new Promise<void>((resolve) => {
          process.on('SIGINT', () => {
            console.log(chalk.dim('\nShutting down...'));
            db.close();
            resolve();
            process.exit(0);
          });
        });
      } catch (err: any) {
        db.close();
        throw err;
      }
    });
}
