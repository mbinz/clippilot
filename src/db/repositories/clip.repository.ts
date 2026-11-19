import type Database from 'better-sqlite3';
import { tierRank, tierRankSql } from '../../core/tiers.js';
import type { Clip, InsertClip, ClipAnalysis, SearchFilters } from '../../types/clip.js';

export class ClipRepository {
  private stmtInsert: Database.Statement;
  private stmtFindByHash: Database.Statement;
  private stmtFindById: Database.Statement;
  private stmtFindByPathAndSize: Database.Statement;
  private stmtFindPending: Database.Statement;
  private stmtFindPendingByProject: Database.Statement;
  private stmtUpdateAnalysis: Database.Statement;
  private stmtUpdateAnalysisError: Database.Statement;
  private stmtUpdateAnalysisStatus: Database.Statement;
  private stmtUpdateTags: Database.Statement;
  private stmtListByProject: Database.Statement;
  private stmtListAll: Database.Statement;
  private stmtFindByIds: string;

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO clips (project_id, file_path, proxy_path, file_hash, file_size,
        duration_sec, resolution, fps, nb_frames, has_video, has_audio, codec, recorded_at, start_timecode, location, manual_tags, people, scene_hint)
      VALUES (@project_id, @file_path, @proxy_path, @file_hash, @file_size,
        @duration_sec, @resolution, @fps, @nb_frames, @has_video, @has_audio, @codec, @recorded_at, @start_timecode, @location, @manual_tags, @people, @scene_hint)
    `);

    this.stmtFindByHash = db.prepare('SELECT * FROM clips WHERE file_hash = ?');
    this.stmtFindById = db.prepare('SELECT * FROM clips WHERE id = ?');
    this.stmtFindByPathAndSize = db.prepare('SELECT * FROM clips WHERE file_path = ? AND file_size = ?');
    this.stmtFindPending = db.prepare("SELECT * FROM clips WHERE analysis_status IN ('pending', 'analyzing')");
    this.stmtFindPendingByProject = db.prepare(
      "SELECT * FROM clips WHERE analysis_status IN ('pending', 'analyzing') AND project_id = ?",
    );

    this.stmtUpdateAnalysis = db.prepare(`
      UPDATE clips SET
        analysis_status = 'done',
        ai_scenes = @ai_scenes,
        ai_summary = @ai_summary,
        ai_visual_keywords = @ai_visual_keywords,
        analysis_profile_version = @analysis_profile_version
      WHERE id = @id
    `);

    this.stmtUpdateAnalysisError = db.prepare(
      "UPDATE clips SET analysis_status = 'error', analysis_error = ? WHERE id = ?",
    );

    this.stmtUpdateAnalysisStatus = db.prepare(
      'UPDATE clips SET analysis_status = ? WHERE id = ?',
    );

    this.stmtUpdateTags = db.prepare(
      'UPDATE clips SET manual_tags = ?, location = ?, people = ? WHERE id = ?',
    );

    this.stmtListByProject = db.prepare(
      'SELECT * FROM clips WHERE project_id = ? ORDER BY recorded_at ASC, ingested_at ASC',
    );

    this.stmtListAll = db.prepare('SELECT * FROM clips ORDER BY recorded_at ASC, ingested_at ASC');

    this.stmtFindByIds = 'SELECT * FROM clips WHERE id IN ';
  }

  insert(clip: InsertClip): Clip {
    const result = this.stmtInsert.run({ ...clip, scene_hint: clip.scene_hint ?? null });
    return this.stmtFindById.get(result.lastInsertRowid) as Clip;
  }

  findByHash(hash: string): Clip | null {
    return (this.stmtFindByHash.get(hash) as Clip) ?? null;
  }

  findByPathAndSize(filePath: string, size: number): Clip | null {
    return (this.stmtFindByPathAndSize.get(filePath, size) as Clip) ?? null;
  }

  findById(id: number): Clip | null {
    return (this.stmtFindById.get(id) as Clip) ?? null;
  }

  findByIds(ids: number[]): Clip[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const stmt = this.db.prepare(`${this.stmtFindByIds}(${placeholders})`);
    return stmt.all(...ids) as Clip[];
  }

  findPending(projectId?: number, clipIds?: number[]): Clip[] {
    const rows = projectId !== undefined
      ? (this.stmtFindPendingByProject.all(projectId) as Clip[])
      : (this.stmtFindPending.all() as Clip[]);
    if (!clipIds) return rows;
    const only = new Set(clipIds);
    return rows.filter((c) => only.has(c.id));
  }

  updateAnalysis(id: number, analysis: ClipAnalysis): void {
    this.stmtUpdateAnalysis.run({ analysis_profile_version: null, ...analysis, id });
  }

  updateAnalysisError(id: number, error: string): void {
    this.stmtUpdateAnalysisError.run(error, id);
  }

  updateAnalysisStatus(id: number, status: string): void {
    this.stmtUpdateAnalysisStatus.run(status, id);
  }

  updateTags(id: number, tags: string | null, location: string | null, people: string | null): void {
    this.stmtUpdateTags.run(tags, location, people, id);
  }

  listByProject(projectId: number): Clip[] {
    return this.stmtListByProject.all(projectId) as Clip[];
  }

  listAll(): Clip[] {
    return this.stmtListAll.all() as Clip[];
  }

  search(query: string, filters?: SearchFilters): Clip[] {
    let sql = `
      SELECT clips.* FROM clips_fts
      JOIN clips ON clips.id = clips_fts.rowid
      WHERE clips_fts MATCH ?
    `;
    const params: unknown[] = [query];

    if (filters?.project_id !== undefined) {
      sql += ' AND clips.project_id = ?';
      params.push(filters.project_id);
    }

    if (filters?.min_tier) {
      sql += ` AND EXISTS (SELECT 1 FROM highlights h WHERE h.clip_id = clips.id AND ${tierRankSql('h.tier')} >= ?)`;
      params.push(tierRank(filters.min_tier));
    }

    if (filters?.location) {
      sql += ' AND clips.location = ?';
      params.push(filters.location);
    }

    const sortMap: Record<string, string> = {
      date: 'clips.recorded_at ASC',
      duration: 'clips.duration_sec ASC',
    };

    sql += ` ORDER BY ${sortMap[filters?.sort ?? ''] ?? 'rank'}`;

    if (filters?.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    return this.db.prepare(sql).all(...params) as Clip[];
  }

  getStats(projectId?: number): { total: number; analyzed: number; pending: number; error: number; totalDuration: number } {
    const where = projectId !== undefined ? 'WHERE project_id = ?' : '';
    const params = projectId !== undefined ? [projectId] : [];

    const total = this.db.prepare(`SELECT COUNT(*) as count FROM clips ${where}`).get(...params) as any;
    const analyzed = this.db.prepare(`SELECT COUNT(*) as count FROM clips ${where ? where + " AND" : "WHERE"} analysis_status = 'done'`).get(...params) as any;
    const pending = this.db.prepare(`SELECT COUNT(*) as count FROM clips ${where ? where + " AND" : "WHERE"} analysis_status = 'pending'`).get(...params) as any;
    const errorCount = this.db.prepare(`SELECT COUNT(*) as count FROM clips ${where ? where + " AND" : "WHERE"} analysis_status = 'error'`).get(...params) as any;
    const dur = this.db.prepare(`SELECT COALESCE(SUM(duration_sec), 0) as total FROM clips ${where}`).get(...params) as any;

    return {
      total: total.count,
      analyzed: analyzed.count,
      pending: pending.count,
      error: errorCount.count,
      totalDuration: dur.total,
    };
  }

  resetAnalysis(projectId?: number, clipIds?: number[]): number {
    if (clipIds) {
      if (clipIds.length === 0) return 0;
      const marks = clipIds.map(() => '?').join(',');
      const scope = projectId !== undefined ? ' AND project_id = ?' : '';
      return this.db
        .prepare(`UPDATE clips SET analysis_status = 'pending' WHERE id IN (${marks})${scope}`)
        .run(...clipIds, ...(projectId !== undefined ? [projectId] : [])).changes;
    }
    if (projectId !== undefined) {
      return this.db.prepare("UPDATE clips SET analysis_status = 'pending' WHERE project_id = ?").run(projectId).changes;
    }
    return this.db.prepare("UPDATE clips SET analysis_status = 'pending'").run().changes;
  }

  resetErrors(projectId?: number): number {
    const set = "UPDATE clips SET analysis_status = 'pending', analysis_error = NULL WHERE analysis_status = 'error'";
    if (projectId !== undefined) {
      return this.db.prepare(`${set} AND project_id = ?`).run(projectId).changes;
    }
    return this.db.prepare(set).run().changes;
  }
}
