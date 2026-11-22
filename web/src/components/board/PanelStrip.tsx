import { useState } from 'react';
import type { BoardMoment, BoardPanel } from '../../board/types';
import { fmtSec, panelLength, panelRange } from '../../board/logic';
import { VideoThumb } from './VideoThumb';
import { panelMedia } from './media';

interface Props {
  panels: BoardPanel[];
  selectedId: number | null;
  momentsById: Map<number, BoardMoment>;
  onSelect: (id: number) => void;
  onAdd: () => void;
  /** A moment (id from the pool) was dropped on a panel, or on the "+" tile (panelId null). */
  onDropMoment: (momentId: number, panelId: number | null) => void;
}

export function PanelStrip({ panels, selectedId, momentsById, onSelect, onAdd, onDropMoment }: Props) {
  const [drop, setDrop] = useState<number | 'add' | null>(null);

  const over = (key: number | 'add') => (e: React.DragEvent) => {
    e.preventDefault();
    setDrop(key);
  };
  const leave = (key: number | 'add') => (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop((d) => (d === key ? null : d));
  };
  const drops = (panelId: number | null) => (e: React.DragEvent) => {
    e.preventDefault();
    setDrop(null);
    const mid = Number(e.dataTransfer.getData('text/plain'));
    if (mid) onDropMoment(mid, panelId);
  };

  return (
    <div className="flex items-start gap-3 overflow-x-auto px-1 pb-3.5 pt-1">
      {panels.map((p, i) => {
        const r = panelRange(p);
        const { poster, src } = panelMedia(p, momentsById);
        const ring =
          p.state === 'gap' ? 'border-2 border-dashed border-bd-line2'
          : p.source === 'user' ? 'border-[2.5px] border-solid border-bd-mine'
          : 'border-2 border-dashed border-bd-ai';
        const sel = p.id === selectedId || drop === p.id;
        return (
          <div
            key={p.id}
            className="group w-[200px] flex-none cursor-pointer"
            onClick={() => onSelect(p.id)}
            onDragOver={over(p.id)}
            onDragLeave={leave(p.id)}
            onDrop={drops(p.id)}
          >
            <div
              className={`relative aspect-video overflow-hidden rounded-[9px] transition-transform ${
                sel ? 'shadow-[0_0_0_3px_var(--color-bd-focus)]' : ''
              } ${drop === p.id ? 'scale-[1.02]' : ''} ${p.state === 'gap' ? 'flex items-center justify-center bg-bd-s1 text-xs text-bd-dim' : 'bg-black'}`}
            >
              {p.state === 'gap' ? (
                <span>empty {'—'} drop a moment</span>
              ) : (
                <VideoThumb poster={poster} src={src} a={r!.a} b={r!.b} rate={Math.max(1, 2 * r!.speed)} />
              )}
              <div className={`pointer-events-none absolute inset-0 z-[3] rounded-[9px] ${ring}`} />
              <span className="pointer-events-none absolute left-1.5 top-1.5 z-[4] rounded-[5px] bg-black/80 px-1.5 text-[10.5px] tabular-nums">{i + 1}</span>
              {p.state === 'candidates' && (
                <span className="pointer-events-none absolute right-1.5 top-1.5 z-[4] rounded-[5px] bg-bd-attn px-1.5 text-[10.5px] font-bold text-[#1d1400]">
                  CHOOSE {'·'} {p.candidates.length}
                </span>
              )}
              {r && (
                <span className="pointer-events-none absolute bottom-1.5 right-1.5 z-[4] rounded-[5px] bg-black/80 px-1.5 text-[10.5px] tabular-nums">
                  {r.speed !== 1 ? `\u{1F422} ${r.speed * 100}% · ` : ''}{fmtSec(panelLength(p))}
                </span>
              )}
            </div>
            <div className="mt-1.5 truncate text-xs text-bd-muted group-hover:text-bd-text">{p.intent}</div>
          </div>
        );
      })}
      <div
        onClick={onAdd}
        onDragOver={over('add')}
        onDragLeave={leave('add')}
        onDrop={drops(null)}
        title="Add panel (or drop a moment here)"
        className={`flex aspect-[9/12.6] w-16 flex-none cursor-pointer items-center justify-center rounded-[9px] border-2 border-dashed text-[22px] hover:border-bd-muted hover:text-bd-text ${
          drop === 'add' ? 'border-bd-muted text-bd-text' : 'border-bd-line2 text-bd-dim'
        }`}
      >
        {'＋'}
      </div>
    </div>
  );
}
