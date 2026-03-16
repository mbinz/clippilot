import type Database from 'better-sqlite3';

export function migration001(db: Database.Database): void {
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE clips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id),
      file_path TEXT NOT NULL,
      proxy_path TEXT,
      file_hash TEXT NOT NULL UNIQUE,
      file_size INTEGER NOT NULL,
      duration_sec REAL NOT NULL,
      resolution TEXT,
      fps REAL,
      codec TEXT,
      recorded_at TEXT,
      ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
      analysis_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (analysis_status IN ('pending', 'analyzing', 'done', 'error')),
      analysis_error TEXT,
      location TEXT,
      manual_tags TEXT,
      people TEXT,
      ai_scenes TEXT,
      ai_summary TEXT,
      ai_quality_stability REAL,
      ai_quality_focus REAL,
      ai_quality_exposure REAL,
      ai_quality_composition REAL,
      ai_quality_audio REAL,
      ai_quality_overall REAL,
      ai_quality_issues TEXT,
      ai_editorial_emotional REAL,
      ai_editorial_storytelling REAL,
      ai_editorial_uniqueness REAL,
      ai_editorial_suggested_use TEXT,
      ai_visual_keywords TEXT
    );

    CREATE TABLE thumbnails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clip_id INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      timestamp_sec REAL NOT NULL
    );

    CREATE INDEX idx_clips_hash ON clips(file_hash);
    CREATE INDEX idx_clips_project ON clips(project_id);
    CREATE INDEX idx_clips_status ON clips(analysis_status);
    CREATE INDEX idx_clips_recorded ON clips(recorded_at);
    CREATE INDEX idx_thumbnails_clip ON thumbnails(clip_id);

    CREATE VIRTUAL TABLE clips_fts USING fts5(
      ai_summary,
      ai_visual_keywords,
      location,
      manual_tags,
      people,
      ai_editorial_suggested_use,
      content='clips',
      content_rowid='id'
    );

    CREATE TRIGGER clips_ai AFTER INSERT ON clips BEGIN
      INSERT INTO clips_fts(rowid, ai_summary, ai_visual_keywords, location,
        manual_tags, people, ai_editorial_suggested_use)
      VALUES (new.id, new.ai_summary, new.ai_visual_keywords, new.location,
        new.manual_tags, new.people, new.ai_editorial_suggested_use);
    END;

    CREATE TRIGGER clips_au AFTER UPDATE ON clips BEGIN
      INSERT INTO clips_fts(clips_fts, rowid, ai_summary, ai_visual_keywords,
        location, manual_tags, people, ai_editorial_suggested_use)
      VALUES ('delete', old.id, old.ai_summary, old.ai_visual_keywords,
        old.location, old.manual_tags, old.people, old.ai_editorial_suggested_use);
      INSERT INTO clips_fts(rowid, ai_summary, ai_visual_keywords, location,
        manual_tags, people, ai_editorial_suggested_use)
      VALUES (new.id, new.ai_summary, new.ai_visual_keywords, new.location,
        new.manual_tags, new.people, new.ai_editorial_suggested_use);
    END;

    CREATE TRIGGER clips_ad AFTER DELETE ON clips BEGIN
      INSERT INTO clips_fts(clips_fts, rowid, ai_summary, ai_visual_keywords,
        location, manual_tags, people, ai_editorial_suggested_use)
      VALUES ('delete', old.id, old.ai_summary, old.ai_visual_keywords,
        old.location, old.manual_tags, old.people, old.ai_editorial_suggested_use);
    END;
  `);
}
