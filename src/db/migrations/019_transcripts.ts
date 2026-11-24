import type Database from 'better-sqlite3';

/**
 * Spoken-word transcripts (whisper.cpp). `transcripts` holds segments + word timings per clip; the plain text is
 * mirrored into `clips.transcript_text` so the clip search (clips_fts, external content) finds spoken words.
 */
export function migration019(db: Database.Database): void {
  db.exec(`
    CREATE TABLE transcripts (
      clip_id INTEGER PRIMARY KEY REFERENCES clips(id) ON DELETE CASCADE,
      language TEXT NOT NULL,
      model TEXT NOT NULL,
      text TEXT NOT NULL,
      segments_json TEXT NOT NULL,
      words_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    ALTER TABLE clips ADD COLUMN transcript_text TEXT;

    DROP TRIGGER clips_ai;
    DROP TRIGGER clips_au;
    DROP TRIGGER clips_ad;
    DROP TABLE clips_fts;

    CREATE VIRTUAL TABLE clips_fts USING fts5(
      ai_summary,
      ai_visual_keywords,
      location,
      manual_tags,
      people,
      transcript_text,
      content='clips',
      content_rowid='id'
    );

    CREATE TRIGGER clips_ai AFTER INSERT ON clips BEGIN
      INSERT INTO clips_fts(rowid, ai_summary, ai_visual_keywords, location, manual_tags, people, transcript_text)
      VALUES (new.id, new.ai_summary, new.ai_visual_keywords, new.location, new.manual_tags, new.people, new.transcript_text);
    END;

    CREATE TRIGGER clips_au AFTER UPDATE ON clips BEGIN
      INSERT INTO clips_fts(clips_fts, rowid, ai_summary, ai_visual_keywords, location, manual_tags, people, transcript_text)
      VALUES ('delete', old.id, old.ai_summary, old.ai_visual_keywords, old.location, old.manual_tags, old.people, old.transcript_text);
      INSERT INTO clips_fts(rowid, ai_summary, ai_visual_keywords, location, manual_tags, people, transcript_text)
      VALUES (new.id, new.ai_summary, new.ai_visual_keywords, new.location, new.manual_tags, new.people, new.transcript_text);
    END;

    CREATE TRIGGER clips_ad AFTER DELETE ON clips BEGIN
      INSERT INTO clips_fts(clips_fts, rowid, ai_summary, ai_visual_keywords, location, manual_tags, people, transcript_text)
      VALUES ('delete', old.id, old.ai_summary, old.ai_visual_keywords, old.location, old.manual_tags, old.people, old.transcript_text);
    END;

    INSERT INTO clips_fts(clips_fts) VALUES ('rebuild');
  `);
}
