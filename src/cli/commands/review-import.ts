import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ProjectRepository } from '../../db/repositories/project.repository.js';
import { CalibrationRepository } from '../../db/repositories/calibration.repository.js';
import { parseVerdictExport } from '../../core/calibration/verdict-schema.js';
import { resolveDbPath } from '../../utils/fs.js';
import { resolveProject } from './resolve-project.js';

export function registerReviewImportCommand(parent: Command): void {
  parent
    .command('review')
    .description('Review verdict tools')
    .command('import <file>')
    .description('Import a review-verdicts.json export as a calibration round (prints JSON {round_id, metrics})')
    .option('--project <name>', 'Project name (default: the only project)')
    .action(async (file: string, options) => {
      const db = createDb(resolveDbPath(process.cwd()));
      runMigrations(db);
      try {
        const project = resolveProject(new ProjectRepository(db), options.project);
        if (!project) return;
        const data = parseVerdictExport(JSON.parse(await readFile(file, 'utf8')));
        const result = new CalibrationRepository(db).importRound(project.id, 0, data);
        console.log(JSON.stringify(result));
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      } finally {
        db.close();
      }
    });
}
