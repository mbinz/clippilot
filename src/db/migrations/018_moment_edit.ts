import type Database from 'better-sqlite3';
import { speedAllowed } from '../../core/analyze/highlights.js';

/**
 * The moment is the edit (v0.3): in/out + speed move from the panel onto the moment.
 * - highlights gain `speed`, `ai_start_sec`/`ai_end_sec` (the analysis' original range), `user_tier` and `seen_at`.
 * - every filled panel's start/end/speed is copied into its moment (the first panel by cut/scene/position wins when
 *   a moment is used twice), then story_segments is rebuilt without those columns.
 * - the undo log is cleared: its snapshots hold panel ranges that no longer exist.
 */
export function migration018(db: Database.Database): void {
  db.exec(`
    ALTER TABLE highlights ADD COLUMN speed REAL NOT NULL DEFAULT 1;
    ALTER TABLE highlights ADD COLUMN ai_start_sec REAL;
    ALTER TABLE highlights ADD COLUMN ai_end_sec REAL;
    ALTER TABLE highlights ADD COLUMN user_tier TEXT CHECK (user_tier IN ('hero', 'solid', 'filler'));
    ALTER TABLE highlights ADD COLUMN seen_at TEXT;
    UPDATE highlights SET ai_start_sec = start_sec, ai_end_sec = end_sec;
    -- Rows inserted later (analysis, fixtures) get their ai range from their first range.
    CREATE TRIGGER highlights_ai_range AFTER INSERT ON highlights WHEN NEW.ai_start_sec IS NULL BEGIN
      UPDATE highlights SET ai_start_sec = NEW.start_sec, ai_end_sec = NEW.end_sec WHERE id = NEW.id;
    END;
  `);

  // Default speed: the suggested speed when the clip's frame rate allows it, else 1.
  const setSpeed = db.prepare('UPDATE highlights SET speed = ? WHERE id = ?');
  const all = db.prepare('SELECT h.id, h.suggested_speed, c.fps FROM highlights h JOIN clips c ON c.id = h.clip_id')
    .all() as { id: number; suggested_speed: number; fps: number | null }[];
  for (const h of all) {
    const speed = speedAllowed(h.suggested_speed, h.fps) ? h.suggested_speed : 1;
    if (speed !== 1) setSpeed.run(speed, h.id);
  }

  // Filled panels: their range and speed become the moment's.
  type Old = { id: number; clip_id: number; moment_id: number | null; start_sec: number; end_sec: number; speed: number };
  const filled = db.prepare(`
    SELECT p.id, p.clip_id, p.moment_id, p.start_sec, p.end_sec, p.speed
    FROM story_segments p JOIN scenes s ON s.id = p.scene_id
    WHERE p.state = 'filled' ORDER BY p.story_id, s.position, p.position
  `).all() as Old[];
  const setRange = db.prepare('UPDATE highlights SET start_sec = ?, end_sec = ?, speed = ? WHERE id = ?');
  const link = db.prepare('UPDATE story_segments SET moment_id = ? WHERE id = ?');
  const synth = db.prepare(`INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier, status)
    VALUES (?, ?, ?, '', 'solid', 'confirmed')`);
  const done = new Set<number>();
  for (const p of filled) {
    let momentId = p.moment_id;
    if (momentId === null) {
      // The moment was deleted after the panel was filled; keep the edit as a moment of its own.
      momentId = Number(synth.run(p.clip_id, p.start_sec, p.end_sec).lastInsertRowid);
      link.run(momentId, p.id);
    }
    if (done.has(momentId)) continue;
    done.add(momentId);
    setRange.run(p.start_sec, p.end_sec, p.speed, momentId);
  }

  // Rebuild story_segments without start_sec / end_sec / speed. Dropping the table would cascade to
  // panel_candidates, so those rows are parked in a temp table meanwhile.
  db.exec(`
    CREATE TEMP TABLE _candidates AS SELECT panel_id, moment_id, position FROM panel_candidates;
    DELETE FROM panel_candidates;

    CREATE TABLE story_segments_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      intent TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'gap' CHECK (state IN ('filled', 'candidates', 'gap')),
      source TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'user')),
      clip_id INTEGER REFERENCES clips(id),
      moment_id INTEGER REFERENCES highlights(id) ON DELETE SET NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(scene_id, position),
      CHECK (state <> 'filled' OR (clip_id IS NOT NULL AND moment_id IS NOT NULL))
    );
    INSERT INTO story_segments_new (id, story_id, scene_id, position, intent, state, source, clip_id, moment_id, notes, created_at)
      SELECT id, story_id, scene_id, position, intent, state, source, clip_id, moment_id, notes, created_at FROM story_segments;
    DROP INDEX idx_story_segments_story;
    DROP INDEX idx_story_segments_scene;
    DROP TABLE story_segments;
    ALTER TABLE story_segments_new RENAME TO story_segments;
    CREATE INDEX idx_story_segments_story ON story_segments(story_id);
    CREATE INDEX idx_story_segments_scene ON story_segments(scene_id);

    INSERT INTO panel_candidates (panel_id, moment_id, position) SELECT panel_id, moment_id, position FROM _candidates;
    DROP TABLE _candidates;

    DELETE FROM operations;
  `);
}
