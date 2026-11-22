import { useState, useCallback, useEffect } from 'react';
import { Header } from './components/layout/Header';
import { FilterPanel } from './components/filters/FilterPanel';
import { ClipGrid } from './components/clips/ClipGrid';
import { ClipDetail } from './components/clips/ClipDetail';
import { EventsView } from './components/events/EventsView';
import { SimilarityView } from './components/similarity/SimilarityView';
import { BoardView } from './components/board/BoardView';
import { useClips } from './hooks/useClips';
import { useFacets } from './hooks/useFacets';
import { useClipDetail } from './hooks/useClipDetail';
import { useDebounce } from './hooks/useDebounce';
import { fetchProjects } from './api/client';
import type { Clip, ClipSearchParams } from './api/types';

const EMPTY_FILTERS: ClipSearchParams = {};

export function App() {
  const [activeTab, setActiveTab] = useState<'browse' | 'events' | 'similarity' | 'board'>('browse');
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>();
  const [filters, setFilters] = useState<ClipSearchParams>(EMPTY_FILTERS);
  const [searchText, setSearchText] = useState('');
  const [selectedClipId, setSelectedClipId] = useState<number | null>(null);

  // The board needs a project: pick it automatically when there is exactly one.
  useEffect(() => {
    if (activeTab !== 'board' || selectedProjectId !== undefined) return;
    let cancelled = false;
    fetchProjects()
      .then((res) => { if (!cancelled && res.data.length === 1) setSelectedProjectId(res.data[0].id); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeTab, selectedProjectId]);

  const debouncedSearch = useDebounce(searchText, 300);

  const searchParams: ClipSearchParams = {
    ...filters,
    project_id: selectedProjectId,
    q: debouncedSearch || undefined,
  };

  const { clips, total, page, totalPages, loading, error, setPage, refetch } = useClips(searchParams);
  const { facets } = useFacets();
  const { clip: detailClip, thumbnails, refetch: refetchDetail } = useClipDetail(selectedClipId);

  const handleFilterChange = useCallback((key: keyof ClipSearchParams, value: unknown) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleClearAll = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setSearchText('');
  }, []);

  const handleClipClick = useCallback((clip: Clip) => {
    setSelectedClipId(clip.id);
  }, []);

  const handleClipUpdated = useCallback(() => {
    refetchDetail();
    refetch();
  }, [refetchDetail, refetch]);

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      <Header
        selectedProjectId={selectedProjectId}
        onProjectChange={setSelectedProjectId}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <div className="flex flex-1 overflow-hidden">
        {activeTab === 'browse' ? (
          <>
            <FilterPanel
              facets={facets}
              filters={filters}
              searchText={searchText}
              onSearchTextChange={setSearchText}
              onFilterChange={handleFilterChange}
              onClearAll={handleClearAll}
            />
            <main className="flex-1 overflow-hidden">
              <ClipGrid
                clips={clips}
                loading={loading}
                error={error}
                total={total}
                page={page}
                totalPages={totalPages}
                onClipClick={handleClipClick}
                onPageChange={setPage}
              />
            </main>
          </>
        ) : activeTab === 'events' ? (
          <main className="flex-1 overflow-hidden">
            <EventsView projectId={selectedProjectId} />
          </main>
        ) : activeTab === 'board' ? (
          <main className="flex-1 overflow-hidden">
            <BoardView projectId={selectedProjectId} />
          </main>
        ) : (
          <main className="flex-1 overflow-hidden">
            <SimilarityView projectId={selectedProjectId} />
          </main>
        )}
      </div>

      {detailClip && (
        <ClipDetail
          clip={detailClip}
          thumbnails={thumbnails}
          onClose={() => setSelectedClipId(null)}
          onUpdated={handleClipUpdated}
        />
      )}
    </div>
  );
}
