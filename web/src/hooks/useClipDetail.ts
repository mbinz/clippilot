import { useEffect, useState } from 'react';
import { fetchClip, fetchThumbnails } from '../api/client';
import type { Clip, Thumbnail } from '../api/types';

interface UseClipDetailResult {
  clip: Clip | null;
  thumbnails: Thumbnail[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useClipDetail(clipId: number | null): UseClipDetailResult {
  const [clip, setClip] = useState<Clip | null>(null);
  const [thumbnails, setThumbnails] = useState<Thumbnail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refetchKey, setRefetchKey] = useState(0);

  const refetch = () => setRefetchKey((k) => k + 1);

  useEffect(() => {
    if (clipId === null) {
      setClip(null);
      setThumbnails([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([fetchClip(clipId), fetchThumbnails(clipId)])
      .then(([clipRes, thumbRes]) => {
        if (cancelled) return;
        setClip(clipRes.data);
        setThumbnails(thumbRes.data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [clipId, refetchKey]);

  return { clip, thumbnails, loading, error, refetch };
}
