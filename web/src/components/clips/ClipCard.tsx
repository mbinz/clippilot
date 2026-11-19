import type { Clip, Tier } from '../../api/types';
import path from '../../utils/path';

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const TIER_ORDER: Tier[] = ['hero', 'solid', 'filler'];

const TIER_STYLE: Record<Tier, string> = {
  hero: 'bg-amber-500',
  solid: 'bg-blue-500',
  filler: 'bg-gray-500',
};

interface ClipCardProps {
  clip: Clip;
  onClick: (clip: Clip) => void;
}

export function ClipCard({ clip, onClick }: ClipCardProps) {
  const thumbnailUrl = clip.proxy_path
    ? `/media/thumbnails/${path.basename(clip.file_hash)}_0.jpg`
    : undefined;

  const tiers = TIER_ORDER
    .map((tier) => [tier, (clip.highlights ?? []).filter((m) => m.tier === tier).length] as [Tier, number])
    .filter(([, count]) => count > 0);

  return (
    <div
      onClick={() => onClick(clip)}
      className="group relative bg-white rounded-lg overflow-hidden shadow-sm border border-gray-200 cursor-pointer hover:shadow-md hover:border-gray-300 transition-all"
    >
      <div className="aspect-video bg-gray-800 relative">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={clip.ai_summary ?? 'Video clip'}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
            No thumbnail
          </div>
        )}

        {/* Moment tiers: one chip per tier present, best first */}
        {tiers.length > 0 && (
          <span className="absolute top-2 left-2 flex gap-1">
            {tiers.map(([tier, count]) => (
              <span key={tier} className={`px-1.5 py-0.5 rounded text-xs font-bold text-white ${TIER_STYLE[tier]}`}>
                {count} {tier}
              </span>
            ))}
          </span>
        )}

        {/* Duration badge */}
        <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-white text-xs font-mono">
          {formatDuration(clip.duration_sec)}
        </span>
      </div>

      <div className="p-2">
        <p className="text-xs text-gray-600 line-clamp-2">
          {clip.ai_summary ?? clip.file_path.split('/').pop()}
        </p>
        {clip.location && (
          <p className="text-xs text-gray-400 mt-0.5">{clip.location}</p>
        )}
      </div>
    </div>
  );
}
