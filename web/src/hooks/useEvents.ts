import { useCallback, useEffect, useState } from 'react';
import { fetchEvents, mergeEvents, renameEvent, splitEvent } from '../api/client';
import type { EventItem } from '../api/types';

export function useEvents(projectId: number | undefined) {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (projectId === undefined) {
      setEvents([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchEvents(projectId);
      setEvents(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const run = useCallback(async (action: () => Promise<void>) => {
    try {
      await action();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    await refetch();
  }, [refetch]);

  return {
    events,
    loading,
    error,
    rename: (id: number, name: string) => run(() => renameEvent(id, name)),
    merge: (targetId: number, otherIds: number[]) => run(() => mergeEvents(targetId, otherIds)),
    split: (id: number, atClipId: number) => run(() => splitEvent(id, atClipId)),
  };
}
