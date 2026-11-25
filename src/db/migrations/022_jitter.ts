import type Database from 'better-sqlite3';

/**
 * Vocabulary: the continuous handheld micro-movement measured in 021 is "jitter" (a "shake" is a single jolt, later).
 * Renames the score columns and drops Gemini's `shake` issue tag from every stored issues array (the measurement
 * replaces it). Rows whose issues are empty or not a JSON array stay untouched.
 */
export function migration022(db: Database.Database): void {
  db.exec(`
    ALTER TABLE highlights RENAME COLUMN shake_score TO jitter_score;
    ALTER TABLE highlights RENAME COLUMN shake_max_px TO jitter_max_px;
  `);
  const rows = db.prepare("SELECT id, issues FROM highlights WHERE issues LIKE '%shake%'").all() as { id: number; issues: string }[];
  const update = db.prepare('UPDATE highlights SET issues = ? WHERE id = ?');
  for (const r of rows) {
    let parsed: unknown;
    try { parsed = JSON.parse(r.issues); } catch { continue; }
    if (!Array.isArray(parsed)) continue;
    update.run(JSON.stringify(parsed.filter((i) => i !== 'shake')), r.id);
  }
}
