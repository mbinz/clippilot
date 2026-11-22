import type Database from 'better-sqlite3';

/**
 * Storyboard: Cut (stories) -> Scene -> Panel (story_segments).
 * story_segments was empty everywhere, so it is dropped and recreated.
 * A panel stores its own clip/in/out/speed; moment_id is provenance only.
 */
export function migration016(db: Database.Database): void {
  db.exec(`
    ALTER TABLE stories ADD COLUMN brief TEXT;
    ALTER TABLE stories ADD COLUMN brief_state TEXT NOT NULL DEFAULT 'none'
      CHECK (brief_state IN ('none', 'proposed', 'confirmed'));

    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      name TEXT NOT NULL,
      event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(story_id, position)
    );
    CREATE INDEX idx_scenes_story ON scenes(story_id);

    DROP INDEX idx_story_segments_story;
    DROP TABLE story_segments;
    CREATE TABLE story_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      intent TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'gap' CHECK (state IN ('filled', 'candidates', 'gap')),
      source TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'user')),
      clip_id INTEGER REFERENCES clips(id),
      moment_id INTEGER REFERENCES highlights(id) ON DELETE SET NULL,
      start_sec REAL,
      end_sec REAL,
      speed REAL NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(scene_id, position),
      CHECK (state <> 'filled' OR (clip_id IS NOT NULL AND start_sec IS NOT NULL AND end_sec IS NOT NULL))
    );
    CREATE INDEX idx_story_segments_story ON story_segments(story_id);
    CREATE INDEX idx_story_segments_scene ON story_segments(scene_id);

    CREATE TABLE panel_candidates (
      panel_id INTEGER NOT NULL REFERENCES story_segments(id) ON DELETE CASCADE,
      moment_id INTEGER NOT NULL REFERENCES highlights(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      PRIMARY KEY (panel_id, moment_id)
    );

    ALTER TABLE highlights ADD COLUMN status TEXT NOT NULL DEFAULT 'proposed'
      CHECK (status IN ('proposed', 'confirmed', 'rejected'));
    ALTER TABLE highlights ADD COLUMN reject_reason TEXT;
    ALTER TABLE clips ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
  `);
}
