import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import type Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createClipRoutes } from './routes/clips.js';
import { createProjectRoutes } from './routes/projects.js';
import { createFacetRoutes } from './routes/facets.js';
import { createSimilarityRoutes } from './routes/similarity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ServerOptions {
  db: Database.Database;
  basePath: string;
  port: number;
}

export function createApp(options: ServerOptions): Hono {
  const { db, basePath } = options;
  const app = new Hono();

  // CORS for dev mode
  app.use('/api/*', cors());

  // API routes
  app.route('/api/clips', createClipRoutes(db));
  app.route('/api/projects', createProjectRoutes(db));
  app.route('/api/facets', createFacetRoutes(db));
  app.route('/api/similarity', createSimilarityRoutes(db));

  // Serve thumbnails from .clippilot/thumbnails/
  const thumbnailDir = path.resolve(basePath, '.clippilot', 'thumbnails');
  app.use('/media/thumbnails/*', serveStatic({
    root: thumbnailDir,
    rewriteRequestPath: (p) => p.replace('/media/thumbnails', ''),
  }));

  // Serve proxies from .clippilot/proxies/
  const proxyDir = path.resolve(basePath, '.clippilot', 'proxies');
  app.use('/media/proxies/*', serveStatic({
    root: proxyDir,
    rewriteRequestPath: (p) => p.replace('/media/proxies', ''),
  }));

  // Serve built React app from dist/web/
  const webDistDir = path.resolve(__dirname, '..', '..', '..', 'dist', 'web');
  if (existsSync(webDistDir)) {
    app.use('/*', serveStatic({ root: webDistDir }));
    // SPA fallback
    app.get('*', serveStatic({ root: webDistDir, path: 'index.html' }));
  } else {
    app.get('/', (c) => {
      return c.text(
        'ClipPilot Web UI not built. Run "cd web && npm install && npm run build" first.\n' +
        'API is available at /api/*',
      );
    });
  }

  return app;
}

export async function startServer(options: ServerOptions): Promise<{
  url: string;
  close: () => void;
}> {
  const app = createApp(options);

  return new Promise((resolve) => {
    const server = serve({
      fetch: app.fetch,
      port: options.port,
    }, () => {
      const url = `http://localhost:${options.port}`;
      resolve({
        url,
        close: () => server.close(),
      });
    });
  });
}
