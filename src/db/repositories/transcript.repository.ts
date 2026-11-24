import type Database from 'better-sqlite3';
import type { Transcript, TranscriptSegment, TranscriptWord } from '../../core/transcribe/whisper.js';

export interface TranscriptRecord {
  clip_id: number;
  language: string;
  model: string;
  text: string;
  segments: TranscriptSegment[];
  words: TranscriptWord[];
  created_at: string;
  /** Before the project-level cross-clip filter (what `segments`/`words` are recomputed from). */
  raw_segments: TranscriptSegment[];
  raw_words: TranscriptWord[];
}

interface Row {
  clip_id: number; language: string; model: string; text: string;
  segments_json: string; words_json: string; created_at: string;
  raw_segments_json: string | null; raw_words_json: string | null;
}

export class TranscriptRepository {
  constructor(private db: Database.Database) {}

  has(clipId: number): boolean {
    return this.db.prepare('SELECT 1 FROM transcripts WHERE clip_id = ?').get(clipId) !== undefined;
  }

  private toRecord(r: Row): TranscriptRecord {
    const segments = JSON.parse(r.segments_json) as TranscriptSegment[];
    const words = JSON.parse(r.words_json) as TranscriptWord[];
    return {
      clip_id: r.clip_id, language: r.language, model: r.model, text: r.text, created_at: r.created_at,
      segments, words,
      raw_segments: r.raw_segments_json ? JSON.parse(r.raw_segments_json) : segments,
      raw_words: r.raw_words_json ? JSON.parse(r.raw_words_json) : words,
    };
  }

  get(clipId: number): TranscriptRecord | null {
    const r = this.db.prepare('SELECT * FROM transcripts WHERE clip_id = ?').get(clipId) as Row | undefined;
    return r ? this.toRecord(r) : null;
  }

  /** Transcripts of the clips of a project. */
  listByProject(projectId: number): TranscriptRecord[] {
    return (this.db.prepare(`SELECT t.* FROM transcripts t JOIN clips c ON c.id = t.clip_id
      WHERE c.project_id = ? ORDER BY t.clip_id`).all(projectId) as Row[]).map((r) => this.toRecord(r));
  }

  /** Change what is shown and searched (cross-clip filter); the raw transcript stays. */
  saveEffective(clipId: number, segments: TranscriptSegment[], words: TranscriptWord[]): void {
    const text = segments.map((s) => s.text).join(' ');
    this.db.transaction(() => {
      this.db.prepare('UPDATE transcripts SET text = ?, segments_json = ?, words_json = ? WHERE clip_id = ?')
        .run(text, JSON.stringify(segments), JSON.stringify(words), clipId);
      this.db.prepare('UPDATE clips SET transcript_text = ? WHERE id = ?').run(text, clipId);
    })();
  }

  /** Store (or replace) the transcript of a clip (raw = effective until the cross-clip filter runs) and mirror its text into the clip search. */
  save(clipId: number, model: string, t: Transcript): void {
    const text = t.segments.map((s) => s.text).join(' ');
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO transcripts (clip_id, language, model, text, segments_json, words_json, raw_segments_json, raw_words_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(clip_id) DO UPDATE SET language = excluded.language, model = excluded.model, text = excluded.text,
          segments_json = excluded.segments_json, words_json = excluded.words_json,
          raw_segments_json = excluded.raw_segments_json, raw_words_json = excluded.raw_words_json, created_at = datetime('now')
      `).run(clipId, t.language, model, text, JSON.stringify(t.segments), JSON.stringify(t.words),
        JSON.stringify(t.segments), JSON.stringify(t.words));
      this.db.prepare('UPDATE clips SET transcript_text = ? WHERE id = ?').run(text, clipId);
    })();
  }
}
