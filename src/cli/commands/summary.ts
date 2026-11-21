import { Command } from 'commander';
import chalk from 'chalk';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { HighlightRepository } from '../../db/repositories/highlight.repository.js';
import { EventRepository } from '../../db/repositories/event.repository.js';
import { ProjectRepository } from '../../db/repositories/project.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { buildProjectSummary } from '../../core/summary.js';
import { formatDuration } from '../../utils/timecode.js';

export function registerSummaryCommand(parent: Command): void {
  parent
    .command('summary')
    .description('Summarize a project: scene hints, places, moments, best highlights')
    .option('--project <name>', 'Project name (default: the only project)')
    .option('--top <n>', 'Number of best highlights to list', '10')
    .option('--json', 'Emit JSON instead of a table (for scripts and Claude skills)')
    .action(async (options) => {
      const db = createDb(resolveDbPath(process.cwd()));
      runMigrations(db);
      try {
        const projectRepo = new ProjectRepository(db);
        const projects = projectRepo.list();
        let project = options.project ? projectRepo.findByName(options.project) : null;
        if (options.project && !project) {
          console.error(`Project "${options.project}" not found. Projects: ${projects.map((p) => p.name).join(', ') || '(none)'}`);
          process.exitCode = 1;
          return;
        }
        if (!project) {
          if (projects.length !== 1) {
            console.error(
              projects.length === 0
                ? 'No projects found. Run "clippilot ingest <path>" first.'
                : `Multiple projects; pass --project. Projects: ${projects.map((p) => p.name).join(', ')}`,
            );
            process.exitCode = 1;
            return;
          }
          project = projects[0];
        }

        const top = Math.max(0, parseInt(options.top, 10) || 0);
        const summary = buildProjectSummary(
          new ClipRepository(db).listByProject(project.id),
          new HighlightRepository(db).listByProject(project.id),
          { top, events: new EventRepository(db).listByProject(project.id) },
        );

        if (options.json) {
          console.log(JSON.stringify({ project: project.name, ...summary }, null, 2));
          return;
        }

        const c = summary.clips;
        console.log(chalk.bold(`\nProject: ${project.name}`));
        console.log(`Clips: ${c.total} (analyzed ${c.analyzed}, pending ${c.pending}, error ${c.error}), ${formatDuration(summary.total_duration_sec)}`);
        console.log(chalk.bold('\nScene hints'));
        for (const s of summary.scene_hints) {
          console.log(`  ${s.scene_hint ?? '(none)'}: ${s.clips} clips, ${formatDuration(s.duration_sec)}, ${s.highlights} highlights`);
        }
        if (summary.events.length > 0) {
          console.log(chalk.bold('\nEvents'));
          for (const e of summary.events) {
            console.log(`  ${e.name}: ${e.clips} clips, ${formatDuration(e.duration_sec)}, ${e.highlights} highlights`);
          }
        }
        console.log(chalk.bold('\nPlaces'));
        for (const p of summary.places.slice(0, 10)) console.log(`  ${p.name} (${p.clips})`);
        console.log(chalk.bold('\nMoments'));
        for (const m of summary.moments.slice(0, 10)) console.log(`  ${m.name} (${m.clips})`);
        console.log(chalk.bold('\nBest highlights'));
        for (const h of summary.best_highlights) {
          console.log(`  [${h.tier}] ${h.file_name} ${h.start_sec}-${h.end_sec}s  ${h.description}`);
        }
      } finally {
        db.close();
      }
    });
}
