import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { ProjectRepository } from '../../../db/repositories/project.repository.js';
import { ClipRepository } from '../../../db/repositories/clip.repository.js';

export function createProjectRoutes(db: Database.Database): Hono {
  const app = new Hono();
  const projectRepo = new ProjectRepository(db);
  const clipRepo = new ClipRepository(db);

  // GET /projects - List all projects
  app.get('/', (c) => {
    const projects = projectRepo.list();
    return c.json({ data: projects });
  });

  // GET /projects/:id/stats - Get stats for a project
  app.get('/:id/stats', (c) => {
    const id = Number(c.req.param('id'));
    const project = projectRepo.findById(id);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const stats = clipRepo.getStats(id);
    return c.json({ data: { project, ...stats } });
  });

  return app;
}
