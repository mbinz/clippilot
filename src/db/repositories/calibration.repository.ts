import type Database from 'better-sqlite3';
import { computeRoundMetrics, type RoundMetrics } from '../../core/calibration/metrics.js';
import type { VerdictExport } from '../../core/calibration/verdict-schema.js';

export class UnknownHighlightsError extends Error {
  constructor(public ids: number[]) {
    super(`Unknown highlight ids (not in the database): ${ids.join(', ')}`);
    this.name = 'UnknownHighlightsError';
  }
}

export interface RoundSummary {
  round_id: number;
  project_id: number | null;
  profile_version: number;
  created_at: string;
  metrics: RoundMetrics;
}

export class CalibrationRepository {
  constructor(private db: Database.Database) {}

  importRound(projectId: number | null, profileVersion: number, data: VerdictExport): { round_id: number; metrics: RoundMetrics } {
    const tx = this.db.transaction(() => {
      const findHl = this.db.prepare('SELECT * FROM highlights WHERE id = ?');
      const snapshots = new Map<number, any>();
      const unknown: number[] = [];
      for (const h of data.highlights) {
        const row = findHl.get(h.highlight_id);
        if (row) snapshots.set(h.highlight_id, row);
        else unknown.push(h.highlight_id);
      }
      if (unknown.length) throw new UnknownHighlightsError(unknown);

      const roundId = Number(
        this.db.prepare('INSERT INTO calibration_rounds (project_id, profile_version) VALUES (?, ?)')
          .run(projectId, profileVersion).lastInsertRowid,
      );
      const insHl = this.db.prepare(`INSERT INTO highlight_verdicts
        (round_id, highlight_id, clip_id, verdicts, note, start_sec, end_sec, description, quality)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const h of data.highlights) {
        const s = snapshots.get(h.highlight_id);
        insHl.run(roundId, h.highlight_id, h.clip_id, JSON.stringify(h.verdicts), h.note,
          s.start_sec, s.end_sec, s.description, s.quality);
      }
      const insMissed = this.db.prepare('INSERT INTO missed_moments (round_id, clip_id, at_sec, note) VALUES (?, ?, ?, ?)');
      for (const m of data.missed) insMissed.run(roundId, m.clip_id, m.at_sec, m.note);
      const insScore = this.db.prepare('INSERT INTO clip_score_verdicts (round_id, clip_id, score, verdict) VALUES (?, ?, ?, ?)');
      for (const s of data.clip_scores) insScore.run(roundId, s.clip_id, s.score, s.verdict);

      const notes = new Map<number, { note: string; wrong: number }>();
      for (const n of data.clip_notes) notes.set(n.clip_id, { note: n.note, wrong: 0 });
      for (const id of data.suggested_use_wrong) {
        notes.set(id, { note: notes.get(id)?.note ?? '', wrong: 1 });
      }
      const insNote = this.db.prepare('INSERT INTO clip_notes (round_id, clip_id, note, suggested_use_wrong) VALUES (?, ?, ?, ?)');
      for (const [clipId, n] of notes) insNote.run(roundId, clipId, n.note, n.wrong);

      return roundId;
    });
    const roundId = tx();
    return { round_id: roundId, metrics: this.metricsFor(roundId) };
  }

  /** Clips that appear in any calibration round (never re-sample these). */
  reviewedClipIds(): Set<number> {
    const rows = this.db.prepare(`
      SELECT clip_id FROM highlight_verdicts UNION SELECT clip_id FROM missed_moments
      UNION SELECT clip_id FROM clip_score_verdicts UNION SELECT clip_id FROM clip_notes
    `).all() as { clip_id: number }[];
    return new Set(rows.map((r) => r.clip_id));
  }

  roundCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM calibration_rounds').get() as { n: number }).n;
  }

  /** Rounds newest first, optionally restricted to a project. */
  listRounds(projectId?: number): RoundSummary[] {
    const rows = (projectId === undefined
      ? this.db.prepare('SELECT * FROM calibration_rounds ORDER BY id DESC').all()
      : this.db.prepare('SELECT * FROM calibration_rounds WHERE project_id = ? ORDER BY id DESC').all(projectId)) as any[];
    return rows.map((r) => ({
      round_id: r.id,
      project_id: r.project_id,
      profile_version: r.profile_version,
      created_at: r.created_at,
      metrics: this.metricsFor(r.id),
    }));
  }

  /** Recomputed from stored rows. A reviewed clip = any verdict, score verdict, missed marker or note. */
  private metricsFor(roundId: number): RoundMetrics {
    const hv = (this.db.prepare('SELECT clip_id, verdicts, note FROM highlight_verdicts WHERE round_id = ?').all(roundId) as any[])
      .map((r) => ({ clip_id: r.clip_id as number, verdicts: JSON.parse(r.verdicts) as string[], note: r.note as string }));
    const missed = this.db.prepare('SELECT clip_id, at_sec, note FROM missed_moments WHERE round_id = ?').all(roundId) as any[];
    const scores = this.db.prepare('SELECT clip_id, score, verdict FROM clip_score_verdicts WHERE round_id = ?').all(roundId) as any[];
    const notes = this.db.prepare('SELECT clip_id, note, suggested_use_wrong FROM clip_notes WHERE round_id = ?').all(roundId) as any[];

    const clips = new Set<number>();
    for (const h of hv) if (h.verdicts.length > 0 || h.note) clips.add(h.clip_id);
    for (const m of missed) clips.add(m.clip_id);
    for (const s of scores) clips.add(s.clip_id);
    for (const n of notes) if (n.note || n.suggested_use_wrong) clips.add(n.clip_id);
    return computeRoundMetrics(hv, missed, clips, scores);
  }
}
