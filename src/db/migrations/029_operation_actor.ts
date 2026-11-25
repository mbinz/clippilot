import type Database from 'better-sqlite3';

/**
 * L1: who made an edit. `ai` = `cut apply`, `shakes fix` and edit verbs run with `--ai`; `user` = the board and edit
 * verbs without `--ai`. Existing rows are classified from their label where it is unambiguous (draft apply, shake fix);
 * everything else (an `--ai` trim looks like a user trim) stays `user`.
 */
export function migration029(db: Database.Database): void {
  db.exec("ALTER TABLE operations ADD COLUMN actor TEXT NOT NULL DEFAULT 'user' CHECK (actor IN ('ai','user'))");
  db.exec("UPDATE operations SET actor = 'ai' WHERE label LIKE 'Apply draft (%' OR label LIKE 'Shake fix (%'");
}
