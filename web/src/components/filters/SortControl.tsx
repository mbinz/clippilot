interface SortControlProps {
  sort: string;
  sortDir: 'asc' | 'desc';
  onSortChange: (sort: string) => void;
  onSortDirChange: (dir: 'asc' | 'desc') => void;
}

export function SortControl({ sort, sortDir, onSortChange, onSortDirChange }: SortControlProps) {
  return (
    <div className="flex gap-2">
      <div className="flex-1">
        <label className="block text-xs font-medium text-gray-600 mb-1">Sort by</label>
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value)}
          className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Default</option>
          <option value="quality">Quality</option>
          <option value="date">Date</option>
          <option value="emotional">Emotional Impact</option>
          <option value="duration">Duration</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Order</label>
        <button
          onClick={() => onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')}
          className="px-3 py-1.5 bg-white border border-gray-300 rounded text-sm hover:bg-gray-50"
          title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
        >
          {sortDir === 'asc' ? '\u2191' : '\u2193'}
        </button>
      </div>
    </div>
  );
}
