import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../../src/db/repositories/clip.repository.js';
import { ProjectRepository } from '../../../../src/db/repositories/project.repository.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';
import { CalibrationRepository, UnknownHighlightsError } from '../../../../src/db/repositories/calibration.repository.js';
import { parseVerdictExport } from '../../../../src/core/calibration/verdict-schema.js';

describe('CalibrationRepository', () => {
  let db: Database.Database;
  let repo: CalibrationRepository;
  let hlRepo: HighlightRepository;
  let projectId: number;
  let clipA: number;
  let clipB: number;
  let hlIds: number[];

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    projectId = new ProjectRepository(db).findOrCreate('Delfine').id;
    const clips = new ClipRepository(db);
    const mk = (p: string, h: string) => clips.insert({
      project_id: projectId, file_path: p, proxy_path: null, file_hash: h, file_size: 1, duration_sec: 30,
      resolution: null, fps: null, nb_frames: null, has_video: 1, has_audio: 1, codec: null,
      recorded_at: null, start_timecode: null, location: null, manual_tags: null, people: null,
    }).id;
    clipA = mk('/v/a.mp4', 'ha');
    clipB = mk('/v/b.mp4', 'hb');
    hlRepo = new HighlightRepository(db);
    hlRepo.replaceForClip(clipA, [
      { start_sec: 2, end_sec: 5, description: 'Dolphin jumps', quality: 9 },
      { start_sec: 10, end_sec: 12, description: 'Boat wake', quality: 4 },
    ]);
    hlRepo.replaceForClip(clipB, [{ start_sec: 1, end_sec: 3, description: 'Face close-up', quality: 7 }]);
    hlIds = hlRepo.listByProject(projectId).map((h) => h.id);
    repo = new CalibrationRepository(db);
  });

  function exportJson(overrides: Record<string, unknown> = {}) {
    return parseVerdictExport({
      project: 'Delfine',
      db_generated_at: '2026-11-19T10:00:00Z',
      reviewed_at: '2026-11-19T11:00:00Z',
      highlights: [
        { highlight_id: hlIds[0], clip_id: clipA, verdicts: ['good'], note: 'great' },
        { highlight_id: hlIds[1], clip_id: clipA, verdicts: ['timing', 'quality'], note: '' },
      ],
      missed: [{ clip_id: clipB, at_sec: 7.5, note: 'person waves' }],
      clip_notes: [{ clip_id: clipB, note: 'too dark' }],
      clip_scores: [{ clip_id: clipA, score: 'stability', verdict: 'low' }],
      suggested_use_wrong: [clipA],
      ...overrides,
    });
  }

  it('imports a round with all parts and snapshots highlight data', () => {
    const { round_id, metrics } = repo.importRound(projectId, 3, exportJson());
    expect(metrics.reviewed_highlights).toBe(2);
    expect(metrics.precision).toBe(0.5);
    expect(metrics.missed_moments).toBe(1);
    expect(metrics.reviewed_clips).toBe(2);
    expect(metrics.score_verdicts).toEqual({ stability: { low: 1, ok: 0, high: 0 } });

    const snap = db.prepare('SELECT * FROM highlight_verdicts WHERE round_id = ? AND highlight_id = ?').get(round_id, hlIds[0]) as any;
    expect(snap).toMatchObject({ clip_id: clipA, start_sec: 2, end_sec: 5, description: 'Dolphin jumps', quality: 9, note: 'great' });
    expect(JSON.parse(snap.verdicts)).toEqual(['good']);
    const missed = db.prepare('SELECT * FROM missed_moments WHERE round_id = ?').all(round_id) as any[];
    expect(missed).toMatchObject([{ clip_id: clipB, at_sec: 7.5, note: 'person waves' }]);
    const notes = db.prepare('SELECT * FROM clip_notes WHERE round_id = ? ORDER BY clip_id').all(round_id) as any[];
    expect(notes).toMatchObject([
      { clip_id: clipA, note: '', suggested_use_wrong: 1 },
      { clip_id: clipB, note: 'too dark', suggested_use_wrong: 0 },
    ]);
    const round = db.prepare('SELECT * FROM calibration_rounds WHERE id = ?').get(round_id) as any;
    expect(round).toMatchObject({ project_id: projectId, profile_version: 3 });
  });

  it('keeps the snapshot after re-analysis replaces the highlights', () => {
    const { round_id } = repo.importRound(projectId, 1, exportJson());
    hlRepo.replaceForClip(clipA, []);
    const snap = db.prepare('SELECT description FROM highlight_verdicts WHERE round_id = ? AND highlight_id = ?').get(round_id, hlIds[0]) as any;
    expect(snap.description).toBe('Dolphin jumps');
  });

  it('accepts older exports without clip_scores / suggested_use_wrong', () => {
    const old = parseVerdictExport({
      project: 'Delfine', db_generated_at: 'x', reviewed_at: 'y',
      highlights: [{ highlight_id: hlIds[2], clip_id: clipB, verdicts: ['good'], note: '' }],
      missed: [], clip_notes: [],
    });
    const { metrics } = repo.importRound(projectId, 1, old);
    expect(metrics.reviewed_highlights).toBe(1);
    expect(metrics.score_verdicts).toEqual({});
  });

  it('rejects unknown highlight ids, listing them, and stores nothing', () => {
    const bad = exportJson({
      highlights: [
        { highlight_id: hlIds[0], clip_id: clipA, verdicts: ['good'], note: '' },
        { highlight_id: 9991, clip_id: clipA, verdicts: ['good'], note: '' },
        { highlight_id: 9992, clip_id: clipA, verdicts: ['timing'], note: '' },
      ],
    });
    expect(() => repo.importRound(projectId, 1, bad)).toThrow(UnknownHighlightsError);
    expect(() => repo.importRound(projectId, 1, bad)).toThrow(/9991.*9992/);
    for (const t of ['calibration_rounds', 'highlight_verdicts', 'missed_moments', 'clip_notes', 'clip_score_verdicts']) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n).toBe(0);
    }
  });

  it('lists rounds newest first with metrics and profile_version', () => {
    const first = repo.importRound(projectId, 1, exportJson());
    const second = repo.importRound(projectId, 2, exportJson({ missed: [] }));
    const rounds = repo.listRounds(projectId);
    expect(rounds.map((r) => r.round_id)).toEqual([second.round_id, first.round_id]);
    expect(rounds[0].profile_version).toBe(2);
    expect(rounds[0].metrics.missed_moments).toBe(0);
    expect(rounds[1].metrics.missed_moments).toBe(1);
    expect(rounds[1].metrics.reviewed_clips).toBe(2);
  });
});

describe('parseVerdictExport', () => {
  it('rejects a malformed verdict file', () => {
    expect(() => parseVerdictExport({ project: 'x' })).toThrow();
    expect(() => parseVerdictExport({
      project: 'x', db_generated_at: 'a', reviewed_at: 'b', highlights: [], missed: [], clip_notes: [],
      clip_scores: [{ clip_id: 1, score: 's', verdict: 'amazing' }],
    })).toThrow();
  });
});
