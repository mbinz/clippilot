import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { StoryRepository } from '../../db/repositories/story.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { exportSegments } from '../../core/export/index.js';
import type { ExportFormat, ExportSegment } from '../../types/export.js';
import path from 'node:path';

export function registerExportCommand(parent: Command): void {
  parent
    .command('export')
    .description('Export a story or clip list for DaVinci Resolve')
    .option('--story <id>', 'Story ID to export')
    .option('--clips <ids>', 'Comma-separated clip IDs (e.g., 1,5,12)')
    .option('--format <format>', 'Export format: csv, json, edl, fcpxml', 'edl')
    .option('--output <path>', 'Output file path')
    .option('--title <title>', 'Timeline title', 'ClipPilot Export')
    .option('--fps <fps>', 'Frame rate for timecode', '30')
    .option('--json', 'Emit JSON confirmation (requires --output)')
    .action(async (options) => {
      if (!options.story && !options.clips) {
        console.error(chalk.red('Error: Specify --story <id> or --clips <id1,id2,...>'));
        process.exit(1);
      }

      const basePath = process.cwd();
      const db = createDb(resolveDbPath(basePath));
      runMigrations(db);

      try {
        let segments: ExportSegment[];
        const format = options.format as ExportFormat;
        const fps = parseFloat(options.fps);

        if (options.story) {
          const storyRepo = new StoryRepository(db);
          const story = storyRepo.getStoryWithSegments(parseInt(options.story, 10));
          if (!story) {
            console.error(chalk.red(`Error: Story ${options.story} not found`));
            process.exit(1);
          }

          segments = story.segments.map((seg) => ({
            position: seg.position,
            clip_id: seg.clip_id,
            file_path: seg.file_path,
            file_name: path.basename(seg.file_path),
            duration_sec: seg.duration_sec,
            start_sec: seg.start_sec,
            end_sec: seg.end_sec ?? seg.duration_sec,
            start_timecode: seg.start_timecode ?? null,
            nb_frames: null,
            fps,
            resolution: seg.resolution,
            ai_summary: seg.ai_summary,
            ai_quality_overall: null,
            segment_role: seg.segment_role,
            notes: seg.notes,
          }));
        } else {
          const clipIds = options.clips.split(',').map((s: string) => parseInt(s.trim(), 10));
          const clipRepo = new ClipRepository(db);
          const clips = clipRepo.findByIds(clipIds);

          if (clips.length === 0) {
            console.error(chalk.red('Error: No clips found with the specified IDs'));
            process.exit(1);
          }

          // Maintain the order specified by the user
          const clipMap = new Map(clips.map(c => [c.id, c]));
          segments = clipIds
            .filter((id: number) => clipMap.has(id))
            .map((id: number, idx: number) => {
              const clip = clipMap.get(id)!;
              return {
                position: idx + 1,
                clip_id: clip.id,
                file_path: clip.file_path,
                file_name: path.basename(clip.file_path),
                duration_sec: clip.duration_sec,
                start_sec: 0,
                end_sec: clip.duration_sec,
                start_timecode: clip.start_timecode ?? null,
                nb_frames: clip.nb_frames ?? null,
                fps: clip.fps ?? fps,
                resolution: clip.resolution,
                ai_summary: clip.ai_summary,
                ai_quality_overall: clip.ai_quality_overall,
                segment_role: null,
                notes: null,
              };
            });
        }

        const output = exportSegments(segments, {
          title: options.title,
          fps,
          format,
        });

        if (options.output) {
          await writeFile(options.output, output, 'utf-8');
          if (options.json) {
            console.log(
              JSON.stringify(
                {
                  ok: true,
                  path: path.resolve(options.output),
                  format,
                  count: segments.length,
                },
                null,
                2,
              ),
            );
          } else {
            console.log(chalk.green(`Exported ${segments.length} segment(s) to ${options.output}`));
          }
        } else {
          console.log(output);
        }
      } finally {
        db.close();
      }
    });
}
