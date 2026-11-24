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
}

interface Row {
  clip_id: number; language: string; model: string; text: string;
  segments_json: string; words_json: string; created_at: string;
}

export class TranscriptRepository {
  constructor(private db: Database.Database) {}

  has(clipId: number): boolean {
    return this.db.prepare('SELECT 1 FROM transcripts WHERE clip_id = ?').get(clipId) !== undefined;
  }

  get(clipId: number): TranscriptRecord | null {
    const r = this.db.prepare('SELECT * FROM transcripts WHERE clip_id = ?').get(clipId) as Row | undefined;
    if (!r) return null;
    return {
      clip_id: r.clip_id, language: r.language, model: r.model, text: r.text, created_at: r.created_at,
      segments: JSON.parse(r.segments_json) as TranscriptSegment[],
      words: JSON.parse(r.words_json) as TranscriptWord[],
    };
  }

  /** Store (or replace) the transcript of a clip and mirror its text into the clip search. */
  save(clipId: number, model: string, t: Transcript): void {
    const text = t.segments.map((s) => s.text).join(' ');
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO transcripts (clip_id, language, model, text, segments_json, words_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(clip_id) DO UPDATE SET language = excluded.language, model = excluded.model, text = excluded.text,
          segments_json = excluded.segments_json, words_json = excluded.words_json, created_at = datetime('now')
      `).run(clipId, t.language, model, text, JSON.stringify(t.segments), JSON.stringify(t.words));
      this.db.prepare('UPDATE clips SET transcript_text = ? WHERE id = ?').run(text, clipId);
    })();
  }
}
