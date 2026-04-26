import { Command } from 'commander';
import path from 'node:path';
import os from 'node:os';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { ProjectRepository } from '../../db/repositories/project.repository.js';
import { ThumbnailRepository } from '../../db/repositories/thumbnail.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { searchClips } from '../../core/search/engine.js';
import { renderContactSheet, type ContactSheetCell } from '../../core/contact-sheet.js';
import type { Clip } from '../../types/clip.js';

export function registerContactSheetCommand(parent: Command): void {
  parent
    .command('contact-sheet')
    .description('Render a labeled contact-sheet PNG for visual scanning by humans or Claude')
    .option('--query <q>', 'Restrict to clips matching this FTS query')
    .option('--project <name>', 'Restrict to a project')
    .option('--ids <ids>', 'Comma-separated clip IDs (overrides --query/--project)')
    .option('--cols <n>', 'Grid columns', '4')
    .option('--rows <n>', 'Grid rows', '6')
    .option('--limit <n>', 'Max clips (defaults to cols*rows)')
    .option('--page <n>', 'Page offset, in multiples of limit', '0')
    .option('-o, --output <path>', 'Output PNG path', defaultOutPath())
    .action(async (options) => {
      const basePath = process.cwd();
      const db = createDb(resolveDbPath(basePath));
      runMigrations(db);
      const clipRepo = new ClipRepository(db);
      const projectRepo = new ProjectRepository(db);
      const thumbRepo = new ThumbnailRepository(db);

      const cols = parseInt(options.cols, 10);
      const rows = parseInt(options.rows, 10);
      const limit = options.limit ? parseInt(options.limit, 10) : cols * rows;
      const page = parseInt(options.page, 10);
      const outPath = path.resolve(options.output);

      try {
        const clips = selectClips(options, clipRepo, projectRepo, limit, page);
        const cells = buildCells(clips, thumbRepo);

        if (cells.length === 0) {
          console.log(
            JSON.stringify({
              ok: false,
              error: 'No clips with thumbnails matched the selection',
              path: null,
            }),
          );
          process.exit(1);
        }

        const layout = await renderContactSheet(cells, outPath, { cols, rows });

        console.log(
          JSON.stringify(
            {
              ok: true,
              path: outPath,
              cols: layout.cols,
              rows: layout.rows,
              count: layout.cells.length,
              cells: layout.cells.map((c) => ({
                position: c.position,
                clip_id: c.clip_id,
                label: c.label,
              })),
            },
            null,
            2,
          ),
        );
      } finally {
        db.close();
      }
    });
}

function selectClips(
  options: { query?: string; project?: string; ids?: string },
  clipRepo: ClipRepository,
  projectRepo: ProjectRepository,
  limit: number,
  page: number,
): Clip[] {
  const offset = page * limit;

  if (options.ids) {
    const ids = options.ids
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n));
    return ids
      .map((id) => clipRepo.findById(id))
      .filter((c): c is Clip => c != null)
      .slice(offset, offset + limit);
  }

  if (options.query) {
    const projectId = options.project ? projectRepo.findByName(options.project)?.id : undefined;
    return searchClips(clipRepo, options.query, {
      project_id: projectId ?? undefined,
      limit: offset + limit,
    }).slice(offset, offset + limit);
  }

  if (options.project) {
    const project = projectRepo.findByName(options.project);
    if (!project) return [];
    return clipRepo.listByProject(project.id).slice(offset, offset + limit);
  }

  return clipRepo.listAll().slice(offset, offset + limit);
}

function buildCells(clips: Clip[], thumbRepo: ThumbnailRepository): ContactSheetCell[] {
  const cells: ContactSheetCell[] = [];
  for (const clip of clips) {
    const thumbs = thumbRepo.findByClip(clip.id);
    if (thumbs.length === 0) continue;
    cells.push({
      clip_id: clip.id,
      thumbnail_path: thumbs[Math.floor(thumbs.length / 2)].file_path,
      label: `#${clip.id}`,
    });
  }
  return cells;
}

function defaultOutPath(): string {
  return path.join(os.tmpdir(), `clippilot-contact-sheet-${Date.now()}.png`);
}
