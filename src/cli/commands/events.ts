import { Command } from 'commander';
import chalk from 'chalk';
import type Database from 'better-sqlite3';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ProjectRepository } from '../../db/repositories/project.repository.js';
import { EventRepository, type EventSummary } from '../../db/repositories/event.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { assignEvents } from '../../core/events/index.js';
import { resolveProject } from './resolve-project.js';

export function eventJson(e: EventSummary) {
  return {
    id: e.id,
    name: e.name,
    source: e.source,
    folder_path: e.folder_path,
    clip_count: e.clip_count,
    start: e.start,
    end: e.end,
  };
}

function summaryOf(repo: EventRepository, id: number): EventSummary {
  const e = repo.findById(id)!;
  return repo.listByProject(e.project_id).find((x) => x.id === id)!;
}

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

function withDb(fn: (db: Database.Database) => void): void {
  const db = createDb(resolveDbPath(process.cwd()));
  runMigrations(db);
  try {
    fn(db);
  } finally {
    db.close();
  }
}

const toId = (s: string) => Number.parseInt(s, 10);

export function registerEventsCommand(parent: Command): void {
  const events = parent.command('events').description('Events: clips grouped by folder or recording time');

  events
    .command('list')
    .description('List a project\'s events')
    .option('--project <name>', 'Project name (default: the only project)')
    .option('--json', 'Emit JSON')
    .action((options) => withDb((db) => {
      const project = resolveProject(new ProjectRepository(db), options.project);
      if (!project) return;
      const list = new EventRepository(db).listByProject(project.id).map(eventJson);
      if (options.json) {
        console.log(JSON.stringify(list, null, 2));
        return;
      }
      if (list.length === 0) {
        console.log('No events yet. Run "clippilot events rebuild".');
        return;
      }
      for (const e of list) {
        console.log(`${chalk.bold(String(e.id).padStart(3))}  ${e.name}  (${e.clip_count} clips, ${e.source})  ${e.start ?? ''} - ${e.end ?? ''}`);
      }
    }));

  events
    .command('rename <id> <name>')
    .description('Rename an event')
    .action((id: string, name: string) => withDb((db) => {
      const repo = new EventRepository(db);
      if (!repo.findById(toId(id))) return fail(`Event ${id} not found`);
      repo.rename(toId(id), name);
      console.log(JSON.stringify(eventJson(summaryOf(repo, toId(id))), null, 2));
    }));

  events
    .command('merge <targetId> <otherIds...>')
    .description('Merge other events into the target event')
    .action((targetId: string, otherIds: string[]) => withDb((db) => {
      const repo = new EventRepository(db);
      try {
        repo.merge(toId(targetId), otherIds.map(toId));
      } catch (err) {
        return fail((err as Error).message);
      }
      console.log(JSON.stringify(eventJson(summaryOf(repo, toId(targetId))), null, 2));
    }));

  events
    .command('split <id>')
    .description('Split an event: the given clip and all later clips move to a new event')
    .requiredOption('--at-clip <clipId>', 'Clip id where the new event starts')
    .action((id: string, options) => withDb((db) => {
      const repo = new EventRepository(db);
      if (!repo.findById(toId(id))) return fail(`Event ${id} not found`);
      let created;
      try {
        created = repo.split(toId(id), toId(options.atClip));
      } catch (err) {
        return fail((err as Error).message);
      }
      console.log(JSON.stringify([eventJson(summaryOf(repo, toId(id))), eventJson(summaryOf(repo, created.id))], null, 2));
    }));

  events
    .command('rebuild')
    .description('Assign events to clips that have none (--reset: delete and re-derive all)')
    .option('--project <name>', 'Project name (default: the only project)')
    .option('--reset', 'Delete the project\'s events first', false)
    .action((options) => withDb((db) => {
      const project = resolveProject(new ProjectRepository(db), options.project);
      if (!project) return;
      const repo = new EventRepository(db);
      if (options.reset) repo.deleteByProject(project.id);
      assignEvents(db, project.id);
      console.log(JSON.stringify(repo.listByProject(project.id).map(eventJson), null, 2));
    }));
}
