import { useEffect, useRef } from 'react';
import type { PM } from '../../board/types';
import { fades, isHero, isOut } from '../../board/pool';
import { shakeHint, storyMark } from '../../board/drawer';
import type { UsageEntry } from '../../board/pool';
import { VideoThumb, stopHoverPlayback } from './VideoThumb';

/** Hovered this long = seen. */
const SEEN_HOVER_MS = 2000;

interface Props {
  m: PM;
  used: UsageEntry | undefined;
  currentSceneIndex: number;
  selected: boolean;
  onSelect: () => void;
  onSeen: (id: number) => void;
}

/** One moment tile (pool and drawer grids): ★, ⚠, ≈ (shaky / shake), bold in-story frame + panel badge, faded when seen. */
export function MomentTile({ m, used, currentSceneIndex, selected, onSelect, onSeen }: Props) {
  const out = isOut(m);
  const shake = shakeHint(m);
  const mark = storyMark(used, currentSceneIndex);
  const faded = fades(m, { inStory: !!mark, seen: !!m.seen, hovered: false, selected });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div
      draggable={!out}
      title={m.description}
      onDragStart={(e) => {
        clearTimeout(timer.current);
        stopHoverPlayback();
        e.dataTransfer.setData('text/plain', String(m.id));
      }}
      onMouseEnter={() => {
        if (m.seen) return;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => onSeen(m.id), SEEN_HOVER_MS);
      }}
      onMouseLeave={() => clearTimeout(timer.current)}
      onClick={onSelect}
      className={`group/tile relative aspect-video cursor-pointer overflow-hidden rounded-[7px] bg-black ${
        selected ? 'shadow-[0_0_0_3px_var(--color-bd-focus)]' : 'hover:shadow-[0_0_0_2px_var(--color-bd-line2)]'
      } ${out ? 'opacity-35' : faded ? 'opacity-[.38] hover:opacity-100' : ''}`}
    >
      <VideoThumb
        poster={m.thumbnail}
        src={m.clip.proxy_url}
        a={m.start_sec}
        b={m.end_sec}
        rate={2}
        fps={m.clip.fps}
        className={out ? 'grayscale' : faded ? '[filter:saturate(0)_brightness(.7)] group-hover/tile:[filter:none]' : ''}
      />
      {mark && (
        <div
          className={`pointer-events-none absolute inset-0 z-[3] rounded-[7px] border-[3px] ${
            mark.tone === 'mine' ? 'border-solid border-bd-mine' : 'border-dashed border-bd-ai'
          }`}
        />
      )}
      {isHero(m) && <span className="pointer-events-none absolute left-1.5 top-[3px] z-[4] text-[13px] [text-shadow:0_1px_4px_#000]" title="★">{'★'}</span>}
      {m.issues.length > 0 && (
        <span className="pointer-events-none absolute right-1.5 top-1 z-[4] text-[11px] text-bd-bad [text-shadow:0_1px_4px_#000]" title={m.issues.join(', ')}>{'⚠'}</span>
      )}
      {shake && (
        <span className="pointer-events-none absolute bottom-[5px] right-1.5 z-[4] text-[12px] leading-none text-bd-text [text-shadow:0_1px_4px_#000]" title={shake}>{'≈'}</span>
      )}
      {mark && (
        <span
          className={`pointer-events-none absolute bottom-[5px] left-[5px] z-[4] rounded-[5px] px-1.5 text-[10.5px] font-bold ${
            mark.tone === 'mine' ? 'bg-bd-mine text-[#00281a]' : 'bg-bd-ai text-[#1a0b3d]'
          }`}
          title={`In panel ${used!.panelNo}`}
        >
          {mark.badge}
        </span>
      )}
    </div>
  );
}
