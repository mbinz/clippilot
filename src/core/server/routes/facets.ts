import { Hono } from 'hono';
import type Database from 'better-sqlite3';

export function createFacetRoutes(db: Database.Database): Hono {
  const app = new Hono();

  // GET /facets - Get distinct filter values for dropdowns
  app.get('/', (c) => {
    const locations = db.prepare(
      "SELECT DISTINCT location FROM clips WHERE location IS NOT NULL AND location != '' ORDER BY location",
    ).all().map((r: any) => r.location as string);

    const suggested_uses = db.prepare(
      "SELECT DISTINCT ai_editorial_suggested_use FROM clips WHERE ai_editorial_suggested_use IS NOT NULL ORDER BY ai_editorial_suggested_use",
    ).all().map((r: any) => r.ai_editorial_suggested_use as string);

    // Extract tags from JSON arrays
    const tagRows = db.prepare(
      "SELECT DISTINCT manual_tags FROM clips WHERE manual_tags IS NOT NULL AND manual_tags != '[]'",
    ).all() as { manual_tags: string }[];
    const tagSet = new Set<string>();
    for (const row of tagRows) {
      try {
        const parsed = JSON.parse(row.manual_tags) as string[];
        for (const tag of parsed) tagSet.add(tag);
      } catch { /* skip invalid JSON */ }
    }

    // Extract people from JSON arrays
    const peopleRows = db.prepare(
      "SELECT DISTINCT people FROM clips WHERE people IS NOT NULL AND people != '[]'",
    ).all() as { people: string }[];
    const peopleSet = new Set<string>();
    for (const row of peopleRows) {
      try {
        const parsed = JSON.parse(row.people) as string[];
        for (const p of parsed) peopleSet.add(p);
      } catch { /* skip invalid JSON */ }
    }

    // Extract moods from ai_scenes JSON
    const sceneRows = db.prepare(
      "SELECT ai_scenes FROM clips WHERE ai_scenes IS NOT NULL AND ai_scenes != '[]'",
    ).all() as { ai_scenes: string }[];
    const moodSet = new Set<string>();
    for (const row of sceneRows) {
      try {
        const scenes = JSON.parse(row.ai_scenes) as Array<{ mood?: string }>;
        for (const scene of scenes) {
          if (scene.mood) moodSet.add(scene.mood);
        }
      } catch { /* skip invalid JSON */ }
    }

    return c.json({
      data: {
        locations,
        suggested_uses,
        tags: [...tagSet].sort(),
        people: [...peopleSet].sort(),
        moods: [...moodSet].sort(),
      },
    });
  });

  return app;
}
