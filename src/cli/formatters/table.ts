import Table from 'cli-table3';
import chalk from 'chalk';
import type { Clip } from '../../types/clip.js';
import { formatDuration } from '../../utils/timecode.js';

/** `bestTiers` maps clip id to the tier of its best moment (shown in the Best column). */
export function formatClipTable(clips: Clip[], bestTiers: Map<number, string> = new Map()): string {
  const table = new Table({
    head: [
      chalk.white('ID'),
      chalk.white('File'),
      chalk.white('Duration'),
      chalk.white('Best'),
      chalk.white('Summary'),
    ],
    colWidths: [6, 30, 10, 9, 40],
    wordWrap: true,
  });

  for (const clip of clips) {
    const fileName = clip.file_path.split('/').pop() ?? clip.file_path;
    table.push([
      clip.id,
      fileName.length > 28 ? fileName.slice(0, 25) + '...' : fileName,
      formatDuration(clip.duration_sec),
      bestTiers.get(clip.id) ?? '-',
      (clip.ai_summary ?? '-').slice(0, 38),
    ]);
  }

  return table.toString();
}

export function formatStatsTable(stats: Record<string, string | number>): string {
  const table = new Table();
  for (const [key, value] of Object.entries(stats)) {
    table.push({ [chalk.cyan(key)]: String(value) });
  }
  return table.toString();
}
