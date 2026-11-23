import { Command } from 'commander';
import chalk from 'chalk';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { resolveDbPath } from '../../utils/fs.js';
import { readBoardSelection, resolveBoardContext, selectionFile, type BoardContext } from '../../core/storyboard/selection.js';

const NO_SELECTION = 'No board selection yet. Open the board ("clippilot ui") and click a scene, panel or moment first.';

function printContext(c: BoardContext): void {
  if (c.stale) console.log(chalk.yellow('Some selected items no longer exist (stale).'));
  console.log(chalk.bold(`Cut: ${c.cut ? `${c.cut.name} (id ${c.cut.id})` : 'gone'}`));
  if (c.scene) {
    console.log(`Scene ${c.scene.position + 1}: ${c.scene.name} (id ${c.scene.id})${c.scene.event ? `, event ${c.scene.event.name}` : ''}`);
  } else console.log('Scene: gone');
  if (c.panel) {
    console.log(`Panel ${c.panel.number} (id ${c.panel.id}): "${c.panel.intent}", ${c.panel.state}, source ${c.panel.source}`
      + (c.panel.moment_id !== null ? `, moment ${c.panel.moment_id}` : ''));
  }
  console.log(`Drawer: ${c.drawer ?? 'closed'}${c.preview_moment_id !== null ? `, previewing moment ${c.preview_moment_id}` : ''}`);
  const m = c.moment;
  if (m) {
    console.log(chalk.bold(`Focused moment ${m.id} (${m.focus})`));
    console.log(`  clip ${m.clip.id} ${m.clip.file_name}  ${m.start_sec}-${m.end_sec} s  x${m.speed}  tier ${m.tier}  ${m.status}`);
    console.log(`  ${[m.shot, m.role].filter(Boolean).join(' / ') || 'no shot/role'}: ${m.description}`);
    console.log(`  alternatives: ${m.alternatives.length ? m.alternatives.join(', ') : 'none'}`);
  }
}

export function registerBoardCommand(parent: Command): void {
  const board = parent.command('board').description('The open web board');
  board.command('context')
    .description('What the user has selected in the board (scene, panel, moment, open drawer): resolves "this panel", "here"')
    .option('--json', 'Emit JSON')
    .action((o) => {
      const base = process.cwd();
      const sel = readBoardSelection(base);
      if (!sel) {
        if (o.json) console.log(JSON.stringify({ error: NO_SELECTION, file: selectionFile(base) }, null, 2));
        else console.error(NO_SELECTION);
        process.exitCode = 1;
        return;
      }
      const db = createDb(resolveDbPath(base));
      try {
        runMigrations(db);
        const ctx = resolveBoardContext(db, sel);
        if (o.json) console.log(JSON.stringify(ctx, null, 2));
        else printContext(ctx);
      } catch (err) {
        if (o.json) console.log(JSON.stringify({ error: (err as Error).message }, null, 2));
        else console.error((err as Error).message);
        process.exitCode = 1;
      } finally {
        db.close();
      }
    });
}
