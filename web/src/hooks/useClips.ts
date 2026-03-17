import { useCallback, useEffect, useState } from 'react';
import { fetchClips } from '../api/client';
import type { Clip, ClipSearchParams } from '../api/types';

interface UseClipsResult {
  clips: Clip[];
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  error: string | null;
  setPage: (page: number) => void;
  refetch: () => void;
}

export function useClips(params: ClipSearchParams): UseClipsResult {
  const [clips, setClips] = useState<Clip[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(params.page ?? 1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refetchKey, setRefetchKey] = useState(0);

  const refetch = useCallback(() => setRefetchKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchClips({ ...params, page })
      .then((res) => {
        if (cancelled) return;
        setClips(res.data);
        setTotal(res.meta.total);
        setTotalPages(res.meta.total_pages);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => { cancelled = true; };
    // Serialize params to track changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(params), page, refetchKey]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify({ ...params, page: undefined })]);

  return { clips, total, page, totalPages, loading, error, setPage, refetch };
}
