import type { Clip } from '../../api/types';
import { ClipCard } from './ClipCard';

interface ClipGridProps {
  clips: Clip[];
  loading: boolean;
  error: string | null;
  total: number;
  page: number;
  totalPages: number;
  onClipClick: (clip: Clip) => void;
  onPageChange: (page: number) => void;
}

export function ClipGrid({
  clips,
  loading,
  error,
  total,
  page,
  totalPages,
  onClipClick,
  onPageChange,
}: ClipGridProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Loading clips...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-red-500">
        Error: {error}
      </div>
    );
  }

  if (clips.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        No clips found. Try adjusting your filters or run "clippilot ingest" first.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 text-sm text-gray-500 border-b border-gray-200">
        {total} clip{total !== 1 ? 's' : ''} found
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {clips.map((clip) => (
            <ClipCard key={clip.id} clip={clip} onClick={onClipClick} />
          ))}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-center gap-2">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="px-3 py-1 text-sm rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-sm text-gray-600">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="px-3 py-1 text-sm rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
