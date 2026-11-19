import type { SimilarityCluster } from '../../api/types';
import { markBest } from '../../api/client';

// similarity_score = tier rank of the clip's best moment (hero 3, solid 2, filler 1, none 0)
const TIER_BY_RANK: Record<number, string> = { 3: 'hero', 2: 'solid', 1: 'filler' };

interface ClusterCardProps {
  cluster: SimilarityCluster;
  onRefresh: () => void;
}

export function ClusterCard({ cluster, onRefresh }: ClusterCardProps) {
  const handleMarkBest = async (clipId: number) => {
    await markBest(cluster.id, clipId);
    onRefresh();
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-sm text-gray-600 mb-3">{cluster.reason}</p>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {cluster.members.map((member) => (
          <div
            key={member.id}
            className={`flex-shrink-0 w-40 rounded border ${
              member.is_best ? 'border-green-500 ring-2 ring-green-200' : 'border-gray-200'
            }`}
          >
            <div className="aspect-video bg-gray-800 rounded-t relative">
              <img
                src={`/media/thumbnails/${member.clip_id}_0.jpg`}
                alt={`Clip #${member.clip_id}`}
                className="w-full h-full object-cover rounded-t"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              {member.is_best && (
                <span className="absolute top-1 left-1 px-1.5 py-0.5 bg-green-500 text-white text-[10px] font-bold rounded">
                  BEST
                </span>
              )}
              <span className="absolute top-1 right-1 px-1.5 py-0.5 bg-black/70 text-white text-[10px] rounded">
                {TIER_BY_RANK[member.similarity_score] ?? '-'}
              </span>
            </div>
            <div className="p-2 flex gap-1">
              <button
                onClick={() => handleMarkBest(member.clip_id)}
                className="flex-1 text-[10px] px-1.5 py-1 bg-green-50 text-green-700 rounded hover:bg-green-100"
              >
                Best
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
