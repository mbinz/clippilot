import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../../src/db/repositories/clip.repository.js';
import { TranscriptRepository } from '../../../../src/db/repositories/transcript.repository.js';
import { searchClips } from '../../../../src/core/search/engine.js';
import { advancedSearch } from '../../../../src/core/search/advanced.js';

const clipInput = (n: number) => ({
  project_id: null, file_path: `/v/${n}.mp4`, proxy_path: null, file_hash: `h${n}`, file_size: 1,
  duration_sec: 30, resolution: null, fps: 25, nb_frames: null, has_video: 1, has_audio: 1,
  codec: null, recorded_at: null, start_timecode: null, location: null, manual_tags: null, people: null,
});

const transcript = {
  language: 'de',
  segments: [{ start: 1, end: 3, text: 'Schau mal, ein Delfin!' }],
  words: [{ start: 1, end: 1.5, text: 'Schau', p: 0.9 }, { start: 2, end: 3, text: 'Delfin!', p: 0.8 }],
};

describe('migration 019 + TranscriptRepository', () => {
  let db: Database.Database;
  let clips: ClipRepository;
  let repo: TranscriptRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    clips = new ClipRepository(db);
    repo = new TranscriptRepository(db);
  });

  it('creates the transcripts table', () => {
    const cols = (db.prepare('PRAGMA table_info(transcripts)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(['clip_id', 'language', 'model', 'text', 'segments_json', 'words_json', 'created_at', 'raw_segments_json', 'raw_words_json']);
  });

  it('save / get round-trips segments and words; has() and replace work', () => {
    const clip = clips.insert(clipInput(1));
    expect(repo.has(clip.id)).toBe(false);
    expect(repo.get(clip.id)).toBeNull();
    repo.save(clip.id, 'ggml-test', transcript);
    expect(repo.has(clip.id)).toBe(true);
    expect(repo.get(clip.id)).toMatchObject({ clip_id: clip.id, language: 'de', model: 'ggml-test', text: 'Schau mal, ein Delfin!', segments: transcript.segments, words: transcript.words });
    repo.save(clip.id, 'ggml-test', { ...transcript, segments: [{ start: 0, end: 1, text: 'Neu' }], words: [] });
    expect(repo.get(clip.id)!.text).toBe('Neu');
  });

  it('save keeps the pre-cross-clip segments as raw; saveEffective changes only what is shown and searched', () => {
    const a = clips.insert(clipInput(1));
    repo.save(a.id, 'm', transcript);
    repo.saveEffective(a.id, [], []);
    const t = repo.get(a.id)!;
    expect(t).toMatchObject({ text: '', segments: [], words: [], raw_segments: transcript.segments, raw_words: transcript.words });
    expect(searchClips(clips, 'Delfin')).toEqual([]);
    repo.saveEffective(a.id, transcript.segments, transcript.words);
    expect(searchClips(clips, 'Delfin')).toHaveLength(1);
  });

  it('listByProject returns the transcripts of the project only', () => {
    const projects = db.prepare("INSERT INTO projects (name) VALUES ('p1'), ('p2')").run();
    const a = clips.insert({ ...clipInput(1), project_id: 1 });
    const b = clips.insert({ ...clipInput(2), project_id: 2 });
    repo.save(a.id, 'm', transcript);
    repo.save(b.id, 'm', transcript);
    expect(projects.changes).toBe(2);
    expect(repo.listByProject(1).map((t) => t.clip_id)).toEqual([a.id]);
  });

  it('spoken words are found by search (FTS) and by advanced search', () => {
    const a = clips.insert(clipInput(1));
    const b = clips.insert(clipInput(2));
    repo.save(a.id, 'm', transcript);
    expect(searchClips(clips, 'Delfin').map((c) => c.id)).toEqual([a.id]);
    expect(advancedSearch(db, { q: 'Delfin' }).items.map((c) => c.id)).toEqual([a.id]);
    expect(searchClips(clips, 'Delfin').map((c) => c.id)).not.toContain(b.id);
  });

  it('a replaced transcript no longer matches the old words', () => {
    const a = clips.insert(clipInput(1));
    repo.save(a.id, 'm', transcript);
    repo.save(a.id, 'm', { ...transcript, segments: [{ start: 0, end: 1, text: 'Hai' }] });
    expect(searchClips(clips, 'Delfin')).toEqual([]);
    expect(searchClips(clips, 'Hai')).toHaveLength(1);
  });

  it('deleting the clip deletes its transcript', () => {
    const a = clips.insert(clipInput(1));
    repo.save(a.id, 'm', transcript);
    db.prepare('DELETE FROM clips WHERE id = ?').run(a.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM transcripts').get()).toEqual({ n: 0 });
  });
});
