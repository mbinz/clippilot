import { useEffect, useState } from 'react';
import { fetchFacets } from '../api/client';
import type { Facets } from '../api/types';

const EMPTY_FACETS: Facets = {
  locations: [],
  suggested_uses: [],
  tags: [],
  people: [],
  moods: [],
};

export function useFacets(): { facets: Facets; loading: boolean } {
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFacets()
      .then((res) => {
        setFacets(res.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return { facets, loading };
}
