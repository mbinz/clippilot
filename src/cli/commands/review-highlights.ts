import { Command } from 'commander';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { HighlightRepository } from '../../db/repositories/highlight.repository.js';
import { ProjectRepository } from '../../db/repositories/project.repository.js';
import { resolveClippilotDir, resolveDbPath } from '../../utils/fs.js';
import { buildReviewData } from '../../core/review/review-data.js';
import { renderReviewHtml } from '../../core/review/review-html.js';

export function registerReviewHighlightsCommand(parent: Command): void {
  parent
    .command('review-highlights')
    .description('Write a self-contained HTML page for reviewing clips and their highlights')
    .option('--project <name>', 'Project name (default: the only project)')
    .option('-o, --output <path>', 'Output file (default: .clippilot/review.html)')
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

        const data = buildReviewData(
          new ClipRepository(db).listByProject(project.id),
          new HighlightRepository(db).listByProject(project.id),
          { project: project.name, generated_at: new Date().toISOString() },
        );
        const output = path.resolve(options.output ?? path.join(resolveClippilotDir(process.cwd()), 'review.html'));
        await mkdir(path.dirname(output), { recursive: true });
        await writeFile(output, renderReviewHtml(data), 'utf8');

        const highlights = data.clips.reduce((n, c) => n + c.highlights.length, 0);
        console.log(JSON.stringify({ output, clips: data.clips.length, highlights }));
      } finally {
        db.close();
      }
    });
}
