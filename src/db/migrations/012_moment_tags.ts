import type Database from 'better-sqlite3';

const CLIP_SCORE_COLUMNS = [
  'ai_quality_stability',
  'ai_quality_focus',
  'ai_quality_exposure',
  'ai_quality_composition',
  'ai_quality_audio',
  'ai_quality_overall',
  'ai_quality_issues',
  'ai_editorial_emotional',
  'ai_editorial_storytelling',
  'ai_editorial_uniqueness',
  'ai_editorial_suggested_use',
];

/**
 * Clip-level AI scores are gone; moments carry categorical tags instead (tier / shot / role / issues).
 * `ai_editorial_suggested_use` lives in clips_fts and its triggers, so FTS is recreated without it.
 */
export function migration012(db: Database.Database): void {
  db.exec(`
    DROP TRIGGER clips_ai;
    DROP TRIGGER clips_au;
    DROP TRIGGER clips_ad;
    DROP TABLE clips_fts;
  `);

  for (const col of CLIP_SCORE_COLUMNS) {
    db.exec(`ALTER TABLE clips DROP COLUMN ${col}`);
  }

  db.exec(`
    CREATE VIRTUAL TABLE clips_fts USING fts5(
      ai_summary,
      ai_visual_keywords,
      location,
      manual_tags,
      people,
      content='clips',
      content_rowid='id'
    );

    CREATE TRIGGER clips_ai AFTER INSERT ON clips BEGIN
      INSERT INTO clips_fts(rowid, ai_summary, ai_visual_keywords, location, manual_tags, people)
      VALUES (new.id, new.ai_summary, new.ai_visual_keywords, new.location, new.manual_tags, new.people);
    END;

    CREATE TRIGGER clips_au AFTER UPDATE ON clips BEGIN
      INSERT INTO clips_fts(clips_fts, rowid, ai_summary, ai_visual_keywords, location, manual_tags, people)
      VALUES ('delete', old.id, old.ai_summary, old.ai_visual_keywords, old.location, old.manual_tags, old.people);
      INSERT INTO clips_fts(rowid, ai_summary, ai_visual_keywords, location, manual_tags, people)
      VALUES (new.id, new.ai_summary, new.ai_visual_keywords, new.location, new.manual_tags, new.people);
    END;

    CREATE TRIGGER clips_ad AFTER DELETE ON clips BEGIN
      INSERT INTO clips_fts(clips_fts, rowid, ai_summary, ai_visual_keywords, location, manual_tags, people)
      VALUES ('delete', old.id, old.ai_summary, old.ai_visual_keywords, old.location, old.manual_tags, old.people);
    END;

    INSERT INTO clips_fts(clips_fts) VALUES ('rebuild');

    ALTER TABLE highlights DROP COLUMN quality;
    ALTER TABLE highlights ADD COLUMN tier TEXT NOT NULL DEFAULT 'solid'
      CHECK (tier IN ('hero', 'solid', 'filler'));
    ALTER TABLE highlights ADD COLUMN shot TEXT;
    ALTER TABLE highlights ADD COLUMN role TEXT;
    ALTER TABLE highlights ADD COLUMN issues TEXT NOT NULL DEFAULT '[]';


    -- quality snapshot becomes nullable (old rounds keep theirs); rebuild because SQLite cannot drop NOT NULL
    CREATE TABLE highlight_verdicts_new (
      round_id INTEGER NOT NULL REFERENCES calibration_rounds(id) ON DELETE CASCADE,
      highlight_id INTEGER NOT NULL,
      clip_id INTEGER NOT NULL,
      verdicts TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      start_sec REAL NOT NULL,
      end_sec REAL NOT NULL,
      description TEXT NOT NULL,
      quality INTEGER,
      suggested_speed REAL,
      tier TEXT,
      shot TEXT,
      role TEXT,
      PRIMARY KEY (round_id, highlight_id)
    );
    INSERT INTO highlight_verdicts_new
      (round_id, highlight_id, clip_id, verdicts, note, start_sec, end_sec, description, quality, suggested_speed)
      SELECT round_id, highlight_id, clip_id, verdicts, note, start_sec, end_sec, description, quality, suggested_speed
      FROM highlight_verdicts;
    DROP TABLE highlight_verdicts;
    ALTER TABLE highlight_verdicts_new RENAME TO highlight_verdicts;
  `);
}
