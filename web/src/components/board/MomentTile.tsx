import { useEffect, useRef, useState } from 'react';
import type { PM } from '../../board/types';
import { fades, isHero, isOut, type PoolMark } from '../../board/pool';
import { shakeHint, storyMark } from '../../board/drawer';
import type { UsageEntry } from '../../board/pool';
import { VideoThumb, stopHoverPlayback } from './VideoThumb';
import { REASONS } from './ui';

/** Hovered this long = seen. */
const SEEN_HOVER_MS = 2000;

interface Props {
  m: PM;
  used: UsageEntry | undefined;
  currentSceneIndex: number;
  selected: boolean;
  onSelect: () => void;
  onSeen: (id: number) => void;
  /** Pool: "≈ N" (neutral grey) when a similar moment is already in panel N. */
  mark?: PoolMark;
  /** Pool: hover buttons ★ / ✕ / seen (and restore for rejected / hidden). Without them the tile has none. */
  tools?: {
    onStar: (m: PM) => void;
    onReject: (m: PM, reason: string) => void;
    onToggleSeen: (m: PM) => void;
    onRestore: (m: PM) => void;
  };
}

/** One moment tile (pool and candidate row): ★, ⚠, ≈ (shaky / shake), bold in-story frame + panel badge, greyed out until seen. */
export function MomentTile({ m, used, currentSceneIndex, selected, onSelect, onSeen, mark: poolMark, tools }: Props) {
  const [reasons, setReasons] = useState(false);
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
      onMouseLeave={() => {
        clearTimeout(timer.current);
        setReasons(false);
      }}
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
      {poolMark?.kind === 'similar' && (
        <span
          className="pointer-events-none absolute bottom-[5px] left-[5px] z-[4] rounded-[5px] bg-black/75 px-1.5 text-[10.5px] font-semibold text-bd-muted"
          title={`Something like this is already in panel ${poolMark.panelNo}`}
        >
          {'≈'} {poolMark.panelNo}
        </span>
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
      {tools && (
        <div
          className="absolute right-1 top-1 z-[6] flex gap-0.5 opacity-0 transition-opacity group-hover/tile:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          {out ? (
            <TileBtn title="Restore" onClick={() => tools.onRestore(m)}>{'↺'}</TileBtn>
          ) : (
            <>
              <TileBtn title={isHero(m) ? 'Remove ★' : 'Star'} onClick={() => tools.onStar(m)}>{isHero(m) ? '★' : '☆'}</TileBtn>
              <TileBtn title="Not usable" onClick={() => setReasons((r) => !r)}>{'✕'}</TileBtn>
            </>
          )}
          <TileBtn title={m.seen ? 'Mark unseen' : 'Mark seen'} onClick={() => tools.onToggleSeen(m)}>{m.seen ? '◉' : '○'}</TileBtn>
        </div>
      )}
      {tools && reasons && !out && (
        <div className="absolute inset-0 z-[7] flex flex-wrap content-center justify-center gap-1 bg-black/80 p-1.5" onClick={(e) => e.stopPropagation()}>
          {REASONS.map((r) => (
            <button
              key={r}
              onClick={() => { setReasons(false); tools.onReject(m, r); }}
              className="cursor-pointer rounded-full border border-bd-line bg-transparent px-2 py-px text-[10.5px] text-bd-bad"
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TileBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="h-5 min-w-5 cursor-pointer rounded-[5px] border-0 bg-black/70 px-1 text-[11px] leading-none text-bd-text hover:bg-black"
    >
      {children}
    </button>
  );
}
