import { Command } from 'commander';
import { registerIngestCommand } from './commands/ingest.js';
import { registerAnalyzeCommand } from './commands/analyze.js';
import { registerSearchCommand } from './commands/search.js';
import { registerExportCommand } from './commands/export.js';
import { registerTagCommand } from './commands/tag.js';
import { registerStatsCommand } from './commands/stats.js';
import { registerConfigCommand } from './commands/config.js';
import { registerUiCommand } from './commands/ui.js';
import { registerContactSheetCommand } from './commands/contact-sheet.js';
import { registerGetClipCommand } from './commands/get-clip.js';
import { registerSimilarCommand } from './commands/similar.js';
import { registerMarkBestCommand } from './commands/mark-best.js';
import { setLogLevel } from '../utils/logger.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('clippilot')
    .description('AI-powered video footage review and story-building tool')
    .version('0.1.0')
    .option('-v, --verbose', 'Enable verbose logging')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.opts();
      if (opts.verbose) {
        setLogLevel('debug');
      }
    });

  registerIngestCommand(program);
  registerAnalyzeCommand(program);
  registerTagCommand(program);
  registerSearchCommand(program);
  registerExportCommand(program);
  registerStatsCommand(program);
  registerConfigCommand(program);
  registerUiCommand(program);
  registerContactSheetCommand(program);
  registerGetClipCommand(program);
  registerSimilarCommand(program);
  registerMarkBestCommand(program);

  return program;
}
