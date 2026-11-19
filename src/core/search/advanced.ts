import type Database from 'better-sqlite3';
import type { Clip } from '../../types/clip.js';
import { tierRank, tierRankSql, type Tier } from '../tiers.js';

export interface AdvancedSearchFilters {
  q?: string;
  project_id?: number;
  location?: string;
  date_from?: string;
  date_to?: string;
  min_tier?: Tier;
  tags?: string[];
  people?: string[];
  mood?: string;
  sort?: 'date' | 'duration';
  sort_dir?: 'asc' | 'desc';
  page?: number;
  per_page?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export function advancedSearch(
  db: Database.Database,
  filters: AdvancedSearchFilters,
): PaginatedResult<Clip> {
  const page = Math.max(1, filters.page ?? 1);
  const perPage = Math.min(100, Math.max(1, filters.per_page ?? 50));
  const params: unknown[] = [];

  let fromClause: string;
  let whereConditions: string[] = [];

  if (filters.q) {
    const sanitized = sanitizeFtsQuery(filters.q);
    fromClause = 'FROM clips_fts JOIN clips ON clips.id = clips_fts.rowid';
    whereConditions.push('clips_fts MATCH ?');
    params.push(sanitized);
  } else {
    fromClause = 'FROM clips';
  }

  if (filters.project_id !== undefined) {
    whereConditions.push('clips.project_id = ?');
    params.push(filters.project_id);
  }

  if (filters.location) {
    whereConditions.push('clips.location = ?');
    params.push(filters.location);
  }

  if (filters.date_from) {
    whereConditions.push('clips.recorded_at >= ?');
    params.push(filters.date_from);
  }

  if (filters.date_to) {
    whereConditions.push('clips.recorded_at <= ?');
    params.push(filters.date_to);
  }

  if (filters.min_tier) {
    whereConditions.push(
      `EXISTS (SELECT 1 FROM highlights h WHERE h.clip_id = clips.id AND ${tierRankSql('h.tier')} >= ?)`,
    );
    params.push(tierRank(filters.min_tier));
  }

  if (filters.tags && filters.tags.length > 0) {
    const tagPlaceholders = filters.tags.map(() => '?').join(',');
    whereConditions.push(
      `EXISTS (SELECT 1 FROM json_each(clips.manual_tags) WHERE json_each.value IN (${tagPlaceholders}))`,
    );
    params.push(...filters.tags);
  }

  if (filters.people && filters.people.length > 0) {
    const peoplePlaceholders = filters.people.map(() => '?').join(',');
    whereConditions.push(
      `EXISTS (SELECT 1 FROM json_each(clips.people) WHERE json_each.value IN (${peoplePlaceholders}))`,
    );
    params.push(...filters.people);
  }

  if (filters.mood) {
    whereConditions.push(
      `EXISTS (SELECT 1 FROM json_each(clips.ai_scenes) WHERE json_extract(json_each.value, '$.mood') = ?)`,
    );
    params.push(filters.mood);
  }

  const whereClause = whereConditions.length > 0
    ? 'WHERE ' + whereConditions.join(' AND ')
    : '';

  // Count query
  const countSql = `SELECT COUNT(*) as total ${fromClause} ${whereClause}`;
  const countResult = db.prepare(countSql).get(...params) as { total: number };
  const total = countResult.total;

  // Sort
  const sortMap: Record<string, string> = {
    date: 'clips.recorded_at',
    duration: 'clips.duration_sec',
  };

  const sortField = sortMap[filters.sort ?? ''];
  const sortDir = filters.sort_dir === 'asc' ? 'ASC' : 'DESC';
  let orderClause: string;

  if (sortField) {
    orderClause = `ORDER BY ${sortField} ${sortDir}`;
  } else if (filters.q) {
    orderClause = 'ORDER BY rank';
  } else {
    orderClause = 'ORDER BY clips.recorded_at DESC, clips.ingested_at DESC';
  }

  const offset = (page - 1) * perPage;
  const dataSql = `SELECT clips.* ${fromClause} ${whereClause} ${orderClause} LIMIT ? OFFSET ?`;
  const dataParams = [...params, perPage, offset];
  const items = db.prepare(dataSql).all(...dataParams) as Clip[];

  return {
    items,
    total,
    page,
    per_page: perPage,
    total_pages: Math.ceil(total / perPage),
  };
}

function sanitizeFtsQuery(query: string): string {
  if (query.startsWith('"') && query.endsWith('"')) {
    return query;
  }
  return query.replace(/[{}()\[\]:^~*]/g, '');
}
