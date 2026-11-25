import type Database from 'better-sqlite3';
import { defaultSpeed } from '../../core/storyboard/range.js';

/**
 * B1: moments whose speed was changed by the AI before `ai_speed` existed counted as the user's speed edit. Every user
 * edit confirms a moment, so a still-`proposed` moment with a speed other than its default can only come from the AI:
 * record that speed as `ai_speed`.
 */
export function migration026(db: Database.Database): void {
  const rows = db.prepare(`SELECT h.id, h.speed, h.suggested_speed, c.fps FROM highlights h
    JOIN clips c ON c.id = h.clip_id WHERE h.status = 'proposed' AND h.ai_speed IS NULL`)
    .all() as { id: number; speed: number; suggested_speed: number; fps: number | null }[];
  const set = db.prepare('UPDATE highlights SET ai_speed = ? WHERE id = ?');
  for (const r of rows) {
    if (r.speed !== defaultSpeed(r.suggested_speed, r.fps)) set.run(r.speed, r.id);
  }
}
