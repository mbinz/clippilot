import type { ClipRepository } from '../../db/repositories/clip.repository.js';
import type { Clip, SearchFilters } from '../../types/clip.js';

export function searchClips(
  clipRepo: ClipRepository,
  query: string,
  filters?: Omit<SearchFilters, 'project_id'> & { project_id?: number },
): Clip[] {
  // Sanitize query for FTS5: wrap each term in quotes if the raw query fails
  const sanitized = sanitizeFtsQuery(query);

  try {
    return clipRepo.search(sanitized, filters);
  } catch {
    // Fallback: quote each word individually
    const words = query.split(/\s+/).filter(Boolean);
    const quoted = words.map((w) => `"${w}"`).join(' ');
    try {
      return clipRepo.search(quoted, filters);
    } catch {
      return [];
    }
  }
}

function sanitizeFtsQuery(query: string): string {
  // If already looks like a quoted phrase, pass through
  if (query.startsWith('"') && query.endsWith('"')) {
    return query;
  }

  // Remove FTS5 special characters that could cause syntax errors
  return query.replace(/[{}()\[\]:^~*]/g, '');
}
