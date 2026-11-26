import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { BoardMoment, BoardPanel, PM } from '../../board/types';
import { fmtSec, panelLength, panelRange } from '../../board/logic';
import { VideoThumb } from './VideoThumb';
import { panelMedia } from './media';
import { GHOST_MIME, PANEL_MIME, dragKind, moveTarget } from '../../board/grid';
import { rowEnd } from '../../board/panelview';

interface Props {
  panels: BoardPanel[];
  selectedId: number | null;
  momentsById: Map<number, BoardMoment>;
  onSelect: (id: number) => void;
  /** New empty panel at `position` (undefined = at the end). */
  onAdd: (position?: number) => void;
  /** A moment (id from the pool) was dropped on a panel, or on the "+" tile (panelId null). */
  onDropMoment: (momentId: number, panelId: number | null) => void;
  /** A moment was dropped on insert slot `position`: new filled panel there. */
  onInsertMoment: (momentId: number, position: number) => void;
  /** A panel was dropped on insert slot `position` of this scene (already corrected for its own removal). */
  onMovePanel: (panelId: number, position: number) => void;
  /** The panel view of the selected panel: shown full width right after the last panel of that panel's row. */
  view?: ReactNode;
  /** Placement ghost (BE3): a moment waiting at insert slot `slot`; `view` (the placement view) then sits under the ghost's row. */
  ghost?: { moment: PM; slot: number };
  onMoveGhost?: (slot: number) => void;
  /** The ghost was dropped on an empty / CHOOSE panel: place / pick it there. */
  onGhostOnPanel?: (panelId: number) => void;
}

export function PanelStrip({ panels, selectedId, momentsById, onSelect, onAdd, onDropMoment, onInsertMoment, onMovePanel, view, ghost, onMoveGhost, onGhostOnPanel }: Props) {
  const [drop, setDrop] = useState<number | 'add' | `slot${number}` | null>(null);
  /** Something is being dragged anywhere on the page: slots show their "＋". */
  const [dragging, setDragging] = useState<'panel' | 'moment' | 'ghost' | null>(null);
  const selectedRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const unitRefs = useRef<(HTMLDivElement | null)[]>([]);
  const ghostSlot = ghost ? Math.min(Math.max(ghost.slot, 0), panels.length) : -1;
  /** Units in grid order: the panels, plus the ghost at its slot. */
  const unitCount = panels.length + (ghost ? 1 : 0);
  const ghostUnit = ghost ? ghostSlot : -1; // flat index of the ghost
  /** Units per row of the wrapping grid (measured: units that share the first one's offsetTop). */
  const [perRow, setPerRow] = useState(Math.max(1, unitCount));

  useLayoutEffect(() => {
    const measure = () => {
      const els = unitRefs.current.slice(0, unitCount);
      if (!els[0]) return;
      const top = els[0].offsetTop;
      let n = 0;
      for (const el of els) {
        if (el && Math.abs(el.offsetTop - top) < 2) n++;
        else break;
      }
      setPerRow(Math.max(1, n));
    };
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (ro && boxRef.current) ro.observe(boxRef.current);
    return () => ro?.disconnect();
  }, [unitCount]);

  // Bring the selected panel's row (and the view under it) to the top: also after "N to choose" jumps to another panel.
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [selectedId]);
  useEffect(() => {
    if (ghost) ghostRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, [ghost?.moment.id, ghostSlot]);
  // flat index of the unit the view hangs under (the ghost, else the selected panel); a panel after the ghost shifts by one
  const flatOfPanel = (i: number): number => (ghost && i >= ghostSlot ? i + 1 : i);
  const selIndex = view ? (ghost ? ghostUnit : panels.findIndex((p) => p.id === selectedId)) : -1;
  const anchor = ghost ? selIndex : selIndex >= 0 ? flatOfPanel(selIndex) : -1;
  const viewAfterFlat = anchor >= 0 ? rowEnd(anchor, perRow, unitCount) : -1;

  useEffect(() => {
    const start = (e: DragEvent) => setDragging(dragKind(e.dataTransfer?.types ?? []));
    const end = () => {
      setDragging(null);
      setDrop(null);
    };
    window.addEventListener('dragenter', start);
    window.addEventListener('dragend', end);
    window.addEventListener('drop', end);
    return () => {
      window.removeEventListener('dragenter', start);
      window.removeEventListener('dragend', end);
      window.removeEventListener('drop', end);
    };
  }, []);

  type Key = number | 'add' | `slot${number}`;
  /** Panels accept moments only; slots accept both. */
  const over = (key: Key, accepts: ('panel' | 'moment' | 'ghost')[]) => (e: React.DragEvent) => {
    const k = dragKind(e.dataTransfer.types);
    if (!k || !accepts.includes(k)) return;
    e.preventDefault();
    setDrop(key);
  };
  const leave = (key: Key) => (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop((d) => (d === key ? null : d));
  };
  const drops = (panelId: number | null) => (e: React.DragEvent) => {
    const k = dragKind(e.dataTransfer.types);
    if (k === 'ghost' && panelId !== null) {
      e.preventDefault();
      setDrop(null);
      onGhostOnPanel?.(panelId);
      return;
    }
    if (k !== 'moment') return;
    e.preventDefault();
    setDrop(null);
    const mid = Number(e.dataTransfer.getData('text/plain'));
    if (mid) onDropMoment(mid, panelId);
  };
  const dropsOnSlot = (index: number) => (e: React.DragEvent) => {
    const k = dragKind(e.dataTransfer.types);
    if (!k) return;
    e.preventDefault();
    setDrop(null);
    if (k === 'ghost') onMoveGhost?.(index);
    else if (k === 'moment') {
      const mid = Number(e.dataTransfer.getData('text/plain'));
      if (mid) onInsertMoment(mid, index);
    } else {
      const pid = Number(e.dataTransfer.getData(PANEL_MIME));
      const to = pid ? moveTarget(panels.map((p) => p.id), pid, index) : null;
      if (to !== null) onMovePanel(pid, to);
    }
  };

  const slot = (index: number) => (
    <div
      key={`slot${index}`}
      onClick={() => onAdd(index)}
      onDragOver={over(`slot${index}`, ['panel', 'moment'])}
      onDragLeave={leave(`slot${index}`)}
      onDrop={dropsOnSlot(index)}
      title="Insert panel here (or drop a moment / panel)"
      className={`group/slot flex w-3 flex-none cursor-pointer items-center justify-center self-stretch rounded-[5px] text-sm leading-none transition-colors ${
        drop === `slot${index}` ? 'bg-bd-focus/40 text-bd-text' : dragging ? 'bg-bd-s2 text-bd-muted' : 'text-transparent hover:bg-bd-s2 hover:text-bd-text'
      }`}
    >
      {'＋'}
    </div>
  );

  /** The placement ghost: a pseudo-panel (dashed violet, the moment's thumb), draggable to any slot or empty / CHOOSE panel. */
  const ghostTile = (m: PM) => (
    <div ref={(el) => { unitRefs.current[ghostUnit] = el; }} className="flex flex-none items-stretch">
      <div
        ref={ghostRef}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(GHOST_MIME, String(m.id));
          e.dataTransfer.effectAllowed = 'move';
        }}
        title="Drag to a slot, or onto an empty / CHOOSE panel"
        className="w-[190px] flex-none cursor-grab"
      >
        <div className="relative aspect-video overflow-hidden rounded-[9px] bg-black">
          <VideoThumb poster={m.thumbnail} src={m.clip.proxy_url} a={m.start_sec} b={m.end_sec} rate={2} fps={m.clip.fps} />
          <div className="pointer-events-none absolute inset-0 z-[3] rounded-[9px] border-[3px] border-dashed border-bd-ai" />
          <span className="pointer-events-none absolute right-1.5 top-1.5 z-[4] rounded-[5px] bg-bd-ai px-1.5 text-[10.5px] font-bold text-[#1a0b3d]">NEW HERE</span>
        </div>
        <div className="mt-1.5 truncate text-xs text-bd-muted">{m.description}</div>
      </div>
    </div>
  );

  /** The ghost, and the placement view when the ghost ends its row. */
  const ghostWithView = (m: PM) => (
    <>
      {ghostTile(m)}
      {viewAfterFlat === ghostUnit && <div className="w-full flex-none">{view}</div>}
    </>
  );

  return (
    <div ref={boxRef} className="flex flex-wrap items-stretch gap-y-3.5 px-1 pb-3.5 pt-1">
      {panels.map((p, i) => {
        const r = panelRange(p);
        const { poster, src } = panelMedia(p, momentsById);
        const ring =
          p.state === 'gap' ? 'border-2 border-dashed border-bd-line2'
          : p.source === 'user' ? 'border-[3px] border-solid border-bd-mine'
          : 'border-[3px] border-dashed border-bd-ai';
        const sel = p.id === selectedId;
        return (
          <Fragment key={p.id}>
          {ghost && i === ghostSlot && ghostWithView(ghost.moment)}
          <div ref={(el) => { unitRefs.current[flatOfPanel(i)] = el; }} className="flex flex-none items-stretch">
          {slot(i)}
          <div
            ref={p.id === selectedId ? selectedRef : undefined}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(PANEL_MIME, String(p.id));
              e.dataTransfer.effectAllowed = 'move';
            }}
            className="group w-[190px] flex-none scroll-mt-1 cursor-pointer"
            onClick={() => onSelect(p.id)}
            onDragOver={over(p.id, p.state === 'filled' ? ['moment'] : ['moment', 'ghost'])}
            onDragLeave={leave(p.id)}
            onDrop={drops(p.id)}
          >
            <div
              className={`relative aspect-video overflow-hidden rounded-[9px] transition-transform ${
                drop === p.id ? 'scale-[1.03] shadow-[0_0_0_3px_var(--color-bd-focus)]' : sel ? 'shadow-[0_0_0_3px_var(--color-bd-attn)]' : ''
              } ${p.state === 'gap' ? 'flex items-center justify-center bg-bd-s1 text-xs text-bd-dim' : 'bg-black'}`}
            >
              {p.state === 'gap' ? (
                <span>empty {'—'} drop a moment</span>
              ) : (
                <VideoThumb poster={poster} src={src} a={r!.a} b={r!.b} rate={Math.max(1, 2 * r!.speed)} fps={p.clip?.fps ?? p.candidates[0]?.clip?.fps} />
              )}
              <div className={`pointer-events-none absolute inset-0 z-[3] rounded-[9px] ${ring}`} />
              <span className="pointer-events-none absolute left-1.5 top-1.5 z-[4] rounded-[5px] bg-black/80 px-1.5 text-[10.5px] tabular-nums">{i + 1}</span>
              {p.state === 'candidates' && (
                <span className="pointer-events-none absolute right-1.5 top-1.5 z-[4] rounded-[5px] bg-bd-attn px-1.5 text-[10.5px] font-bold text-[#1d1400]">
                  CHOOSE {'·'} {p.candidates.length}
                </span>
              )}
              {p.state === 'filled' && (
                <span
                  className={`pointer-events-none absolute right-1.5 top-1.5 z-[4] rounded-[5px] px-1.5 text-[10.5px] font-bold ${
                    p.source === 'user' ? 'bg-bd-mine text-[#00281a]' : 'bg-bd-ai text-[#1a0b3d]'
                  }`}
                >
                  {p.source === 'user' ? '✓ YOURS' : 'AI'}
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
          </div>
          {flatOfPanel(i) === viewAfterFlat && <div className="w-full flex-none">{view}</div>}
          </Fragment>
        );
      })}
      {ghost && ghostSlot === panels.length && ghostWithView(ghost.moment)}
      <div className="flex flex-none items-stretch">
      {slot(panels.length)}
      <div
        onClick={() => onAdd()}
        onDragOver={over('add', ['moment'])}
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
    </div>
  );
}
