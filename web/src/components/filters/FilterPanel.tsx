import type { Facets, ClipSearchParams } from '../../api/types';
import { SearchBar } from './SearchBar';
import { QualitySlider } from './QualitySlider';
import { FacetFilter } from './FacetFilter';
import { SortControl } from './SortControl';
import { DateRangeFilter } from './DateRangeFilter';

interface FilterPanelProps {
  facets: Facets;
  filters: ClipSearchParams;
  searchText: string;
  onSearchTextChange: (value: string) => void;
  onFilterChange: (key: keyof ClipSearchParams, value: unknown) => void;
  onClearAll: () => void;
}

export function FilterPanel({
  facets,
  filters,
  searchText,
  onSearchTextChange,
  onFilterChange,
  onClearAll,
}: FilterPanelProps) {
  return (
    <aside className="w-64 bg-gray-50 border-r border-gray-200 p-4 flex flex-col gap-4 overflow-y-auto">
      <SearchBar value={searchText} onChange={onSearchTextChange} />

      <SortControl
        sort={filters.sort ?? ''}
        sortDir={filters.sort_dir ?? 'desc'}
        onSortChange={(v) => onFilterChange('sort', v || undefined)}
        onSortDirChange={(v) => onFilterChange('sort_dir', v)}
      />

      <QualitySlider
        value={filters.min_quality ?? 0}
        onChange={(v) => onFilterChange('min_quality', v > 0 ? v : undefined)}
      />

      <FacetFilter
        label="Location"
        options={facets.locations}
        value={filters.location ?? ''}
        onChange={(v) => onFilterChange('location', v || undefined)}
      />

      <FacetFilter
        label="Suggested Use"
        options={facets.suggested_uses}
        value={filters.suggested_use ?? ''}
        onChange={(v) => onFilterChange('suggested_use', v || undefined)}
      />

      <FacetFilter
        label="Mood"
        options={facets.moods}
        value={filters.mood ?? ''}
        onChange={(v) => onFilterChange('mood', v || undefined)}
      />

      <FacetFilter
        label="Tag"
        options={facets.tags}
        value={filters.tags?.[0] ?? ''}
        onChange={(v) => onFilterChange('tags', v ? [v] : undefined)}
      />

      <FacetFilter
        label="Person"
        options={facets.people}
        value={filters.people?.[0] ?? ''}
        onChange={(v) => onFilterChange('people', v ? [v] : undefined)}
      />

      <DateRangeFilter
        dateFrom={filters.date_from ?? ''}
        dateTo={filters.date_to ?? ''}
        onDateFromChange={(v) => onFilterChange('date_from', v || undefined)}
        onDateToChange={(v) => onFilterChange('date_to', v || undefined)}
      />

      <button
        onClick={onClearAll}
        className="mt-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded hover:bg-gray-100 transition-colors"
      >
        Clear All Filters
      </button>
    </aside>
  );
}
