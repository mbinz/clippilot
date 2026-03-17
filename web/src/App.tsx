import { useState, useCallback } from 'react';
import { Header } from './components/layout/Header';
import { FilterPanel } from './components/filters/FilterPanel';
import { ClipGrid } from './components/clips/ClipGrid';
import { ClipDetail } from './components/clips/ClipDetail';
import { SimilarityView } from './components/similarity/SimilarityView';
import { useClips } from './hooks/useClips';
import { useFacets } from './hooks/useFacets';
import { useClipDetail } from './hooks/useClipDetail';
import { useDebounce } from './hooks/useDebounce';
import type { Clip, ClipSearchParams } from './api/types';

const EMPTY_FILTERS: ClipSearchParams = {};

export function App() {
  const [activeTab, setActiveTab] = useState<'browse' | 'similarity'>('browse');
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>();
  const [filters, setFilters] = useState<ClipSearchParams>(EMPTY_FILTERS);
  const [searchText, setSearchText] = useState('');
  const [selectedClipId, setSelectedClipId] = useState<number | null>(null);

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
