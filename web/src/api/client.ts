import type {
  Clip,
  Project,
  Thumbnail,
  Facets,
  SimilarityCluster,
  EventItem,
  EventClip,
  PaginatedResponse,
  ApiResponse,
  ClipSearchParams,
} from './types';

const BASE = '/api';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json();
}

export async function fetchClips(params: ClipSearchParams): Promise<PaginatedResponse<Clip>> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.project_id !== undefined) qs.set('project_id', String(params.project_id));
  if (params.location) qs.set('location', params.location);
  if (params.date_from) qs.set('date_from', params.date_from);
  if (params.date_to) qs.set('date_to', params.date_to);
  if (params.min_tier) qs.set('min_tier', params.min_tier);
  if (params.tags?.length) qs.set('tags', params.tags.join(','));
  if (params.people?.length) qs.set('people', params.people.join(','));
  if (params.mood) qs.set('mood', params.mood);
  if (params.sort) qs.set('sort', params.sort);
  if (params.sort_dir) qs.set('sort_dir', params.sort_dir);
  if (params.page !== undefined) qs.set('page', String(params.page));
  if (params.per_page !== undefined) qs.set('per_page', String(params.per_page));

  return fetchJson(`${BASE}/clips?${qs}`);
}

export async function fetchClip(id: number): Promise<ApiResponse<Clip>> {
  return fetchJson(`${BASE}/clips/${id}`);
}

export async function updateClip(
  id: number,
  data: {
    location?: string | null;
    manual_tags?: string[] | null;
    people?: string[] | null;
  },
): Promise<ApiResponse<Clip>> {
  return fetchJson(`${BASE}/clips/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function fetchThumbnails(clipId: number): Promise<ApiResponse<Thumbnail[]>> {
  return fetchJson(`${BASE}/clips/${clipId}/thumbnails`);
}

export async function fetchProjects(): Promise<ApiResponse<Project[]>> {
  return fetchJson(`${BASE}/projects`);
}

export async function fetchFacets(): Promise<ApiResponse<Facets>> {
  return fetchJson(`${BASE}/facets`);
}

export async function fetchClusters(projectId?: number): Promise<ApiResponse<SimilarityCluster[]>> {
  const qs = projectId !== undefined ? `?project_id=${projectId}` : '';
  return fetchJson(`${BASE}/similarity/clusters${qs}`);
}

export async function computeSimilarity(): Promise<ApiResponse<{ clusters_found: number }>> {
  return fetchJson(`${BASE}/similarity/compute`, { method: 'POST' });
}

export async function markBest(clusterId: number, clipId: number): Promise<void> {
  await fetchJson(`${BASE}/similarity/clusters/${clusterId}/best`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clip_id: clipId }),
  });
}

export async function fetchSimilarByClip(clipId: number): Promise<ApiResponse<SimilarityCluster[]>> {
  return fetchJson(`${BASE}/similarity/by-clip/${clipId}`);
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function fetchEvents(projectId: number): Promise<ApiResponse<EventItem[]>> {
  return fetchJson(`${BASE}/projects/${projectId}/events`);
}

export async function fetchEventClips(eventId: number): Promise<ApiResponse<EventClip[]>> {
  return fetchJson(`${BASE}/events/${eventId}/clips`);
}

export async function renameEvent(eventId: number, name: string): Promise<void> {
  await fetchJson(`${BASE}/events/${eventId}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  });
}

export async function mergeEvents(targetId: number, otherIds: number[]): Promise<void> {
  await fetchJson(`${BASE}/events/${targetId}/merge`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ other_ids: otherIds }),
  });
}

export async function splitEvent(eventId: number, atClipId: number): Promise<void> {
  await fetchJson(`${BASE}/events/${eventId}/split`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ at_clip_id: atClipId }),
  });
}
