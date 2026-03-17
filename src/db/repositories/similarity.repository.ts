import type Database from 'better-sqlite3';

export interface SimilarityGroupRow {
  id: number;
  project_id: number | null;
  reason: string;
  computed_at: string;
}

export interface SimilarityMemberRow {
  id: number;
  group_id: number;
  clip_id: number;
  is_best: number;
  similarity_score: number;
}

export class SimilarityRepository {
  private stmtInsertGroup: Database.Statement;
  private stmtInsertMember: Database.Statement;
  private stmtGetGroups: Database.Statement;
  private stmtGetGroupsByProject: Database.Statement;
  private stmtGetGroupById: Database.Statement;
  private stmtGetMembers: Database.Statement;
  private stmtFindGroupsByClip: Database.Statement;
  private stmtClearAllGroups: Database.Statement;
  private stmtClearByProject: Database.Statement;
  private stmtResetBest: Database.Statement;
  private stmtMarkBest: Database.Statement;

  constructor(private db: Database.Database) {
    this.stmtInsertGroup = db.prepare(
      'INSERT INTO clip_similarity_groups (project_id, reason) VALUES (?, ?)',
    );

    this.stmtInsertMember = db.prepare(
      'INSERT INTO clip_similarity_members (group_id, clip_id, is_best, similarity_score) VALUES (?, ?, ?, ?)',
    );

    this.stmtGetGroups = db.prepare(
      'SELECT * FROM clip_similarity_groups ORDER BY computed_at DESC',
    );

    this.stmtGetGroupsByProject = db.prepare(
      'SELECT * FROM clip_similarity_groups WHERE project_id = ? ORDER BY computed_at DESC',
    );

    this.stmtGetGroupById = db.prepare(
      'SELECT * FROM clip_similarity_groups WHERE id = ?',
    );

    this.stmtGetMembers = db.prepare(
      'SELECT * FROM clip_similarity_members WHERE group_id = ? ORDER BY similarity_score DESC',
    );

    this.stmtFindGroupsByClip = db.prepare(`
      SELECT g.* FROM clip_similarity_groups g
      JOIN clip_similarity_members m ON m.group_id = g.id
      WHERE m.clip_id = ?
    `);

    this.stmtClearAllGroups = db.prepare('DELETE FROM clip_similarity_groups');

    this.stmtClearByProject = db.prepare(
      'DELETE FROM clip_similarity_groups WHERE project_id = ?',
    );

    this.stmtResetBest = db.prepare(
      'UPDATE clip_similarity_members SET is_best = 0 WHERE group_id = ?',
    );

    this.stmtMarkBest = db.prepare(
      'UPDATE clip_similarity_members SET is_best = 1 WHERE group_id = ? AND clip_id = ?',
    );
  }

  insertGroup(projectId: number | null, reason: string): number {
    const result = this.stmtInsertGroup.run(projectId, reason);
    return result.lastInsertRowid as number;
  }

  insertMembers(groupId: number, members: { clip_id: number; is_best: boolean; score: number }[]): void {
    const insertAll = this.db.transaction((items: typeof members) => {
      for (const m of items) {
        this.stmtInsertMember.run(groupId, m.clip_id, m.is_best ? 1 : 0, m.score);
      }
    });
    insertAll(members);
  }

  getGroups(projectId?: number): SimilarityGroupRow[] {
    if (projectId !== undefined) {
      return this.stmtGetGroupsByProject.all(projectId) as SimilarityGroupRow[];
    }
    return this.stmtGetGroups.all() as SimilarityGroupRow[];
  }

  getGroupWithMembers(groupId: number): { group: SimilarityGroupRow; members: SimilarityMemberRow[] } | null {
    const group = this.stmtGetGroupById.get(groupId) as SimilarityGroupRow | undefined;
    if (!group) return null;
    const members = this.stmtGetMembers.all(groupId) as SimilarityMemberRow[];
    return { group, members };
  }

  findGroupsByClip(clipId: number): SimilarityGroupRow[] {
    return this.stmtFindGroupsByClip.all(clipId) as SimilarityGroupRow[];
  }

  markBest(groupId: number, clipId: number): void {
    const tx = this.db.transaction(() => {
      this.stmtResetBest.run(groupId);
      this.stmtMarkBest.run(groupId, clipId);
    });
    tx();
  }

  clearGroups(projectId?: number): void {
    if (projectId !== undefined) {
      this.stmtClearByProject.run(projectId);
    } else {
      this.stmtClearAllGroups.run();
    }
  }
}
