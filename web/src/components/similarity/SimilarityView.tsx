import { useCallback, useEffect, useState } from 'react';
import { fetchClusters, computeSimilarity } from '../../api/client';
import type { SimilarityCluster } from '../../api/types';
import { ClusterCard } from './ClusterCard';

interface SimilarityViewProps {
  projectId: number | undefined;
}

export function SimilarityView({ projectId }: SimilarityViewProps) {
  const [clusters, setClusters] = useState<SimilarityCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);

  const loadClusters = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchClusters(projectId);
      setClusters(res.data);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadClusters();
  }, [loadClusters]);

  const handleCompute = async () => {
    setComputing(true);
    try {
      await computeSimilarity();
      await loadClusters();
    } finally {
      setComputing(false);
    }
  };

  return (
    <div className="p-4 flex flex-col gap-4 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">
          Similar Clip Clusters ({clusters.length})
        </h2>
        <button
          onClick={handleCompute}
          disabled={computing}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {computing ? 'Computing...' : 'Recompute Similarity'}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400">
          Loading clusters...
        </div>
      ) : clusters.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-2">
          <p>No similarity clusters found.</p>
          <p className="text-xs">Click "Recompute Similarity" to analyze your clips.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {clusters.map((cluster) => (
            <ClusterCard
              key={cluster.id}
              cluster={cluster}
              onRefresh={loadClusters}
            />
          ))}
        </div>
      )}
    </div>
  );
}
