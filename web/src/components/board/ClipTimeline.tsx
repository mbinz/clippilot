import { useEffect, useRef, useState } from 'react';
import type { PM } from '../../board/types';
import { clampSelection, freeStretch, type Stretch } from '../../board/newmoment';
import { isValidTrim } from '../../board/drawer';
import { btn } from './ui';
import { isHero, type UsageEntry } from '../../board/pool';
import type { ShakeMark } from '../../board/drawer';

interface Props {
  duration: number;
  /** The clip's usable moments (clickable bars). */
  moments: PM[];
  currentId: number | null;
  usage: Record<number, UsageEntry>;
  /** Range of the selected moment (loop range), with trim handles when `editable`. */
  range?: { a: number; b: number };
  editable: boolean;
  /** amber = your edit (panel drawer), white = review (moment drawer). */
  tone: 'amber' | 'white';
  /** Moments already in the story show as neutral bars instead of green / violet. */
  neutralUsage?: boolean;
  onRange?: (a: number, b: number) => void;
  onRangeCommit?: () => void;
  /** Shakes of the selected moment as small ticks (neutral; fainter when low confidence). */
  shakes?: ShakeMark[];
  /** Playhead position as a fraction of the clip. */
  playhead: number;
  onPick: (momentId: number) => void;
  onSeek: (t: number) => void;
  /** Dragging across uncovered footage offers "New moment" for that range (BE4). */
  onCreate?: (a: number, b: number) => void;
}

/** Clip timeline: moment bars (click = select), the selected moment's range with trim handles, click-to-seek lane. */
export function ClipTimeline(p: Props) {
  const L = p.duration || 1;
  const [sel, setSel] = useState<Stretch | null>(null);
  /** A drag is in progress: the button waits for the release. */
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ free: Stretch; t0: number; x0: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const selRef = useRef(sel);
  selRef.current = sel;
  const timeAt = (e: { clientX: number }, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(L, ((e.clientX - r.left) / r.width) * L));
  };
  // The selection belongs to the footage it was made on: gone when the moments change (e.g. after creating one).
  useEffect(() => setSel(null), [p.moments.length]);
  const rng = p.tone === 'amber' ? 'border-bd-attn bg-bd-attn/[.12]' : 'border-bd-focus bg-white/[.08]';
  return (
    <div
      className="relative mt-2"
      // A draggable parent (the right-hand player) would steal the pointer from handles and selections: hold it off meanwhile.
      onPointerDownCapture={(e) => {
        const d = (e.currentTarget as HTMLElement).closest<HTMLElement>('[draggable="true"]');
        if (!d) return;
        d.draggable = false;
        const restore = () => { d.draggable = true; window.removeEventListener('pointerup', restore); window.removeEventListener('pointercancel', restore); };
        window.addEventListener('pointerup', restore);
        window.addEventListener('pointercancel', restore);
      }}
    >
      <div className="relative h-[18px]">
        {p.moments.map((x) => {
          const u = p.usage[x.id];
          const cur = x.id === p.currentId;
          const hero = isHero(x);
          const colour = cur
            ? 'bg-bd-focus'
            : u && p.neutralUsage
              ? 'bg-bd-muted'
              : u
              ? u.source === 'user'
                ? 'bg-[color-mix(in_srgb,var(--color-bd-mine)_55%,var(--color-bd-s2))]'
                : 'bg-[color-mix(in_srgb,var(--color-bd-ai)_55%,var(--color-bd-s2))]'
              : 'bg-bd-line2 hover:bg-bd-muted';
          return (
            <button
              key={x.id}
              onClick={() => p.onPick(x.id)}
              className={`absolute bottom-0.5 top-0.5 min-w-[6px] cursor-pointer rounded-[3px] border-0 p-0 ${colour} ${
                hero ? `before:absolute before:-top-[3px] before:left-[3px] before:text-[10px] before:content-['★'] ${cur ? 'before:text-bd-bg' : 'before:text-bd-text'}` : ''
              }`}
              style={{ left: `${(x.start_sec / L) * 100}%`, width: `${((x.end_sec - x.start_sec) / L) * 100}%` }}
              title={`${hero ? '★ ' : ''}${x.description}${u ? ` — in panel ${u.panelNo}` : ''}`}
            />
          );
        })}
      </div>
      <div
        className="relative mt-[3px] h-[26px] cursor-pointer select-none rounded-md bg-bd-s2"
        onPointerDown={(e) => {
          if (!p.onCreate || e.button !== 0 || (e.target as HTMLElement).tagName === 'INPUT') return;
          setSel(null);
          const t0 = timeAt(e, e.currentTarget);
          const free = freeStretch(p.moments, t0, L);
          if (!free) return;
          drag.current = { free, t0, x0: e.clientX, moved: false };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || (!d.moved && Math.abs(e.clientX - d.x0) < 4)) return;
          d.moved = true;
          setDragging(true);
          setSel(clampSelection(d.free, d.t0, timeAt(e, e.currentTarget)));
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          setDragging(false);
          if (!d?.moved) return;
          suppressClick.current = true; // the click that follows a drag is not a seek
          const s = selRef.current;
          if (!s || !isValidTrim(s.a, s.b)) setSel(null);
        }}
        onPointerCancel={() => { drag.current = null; setDragging(false); setSel(null); }}
        onClick={(e) => {
          if (suppressClick.current) { suppressClick.current = false; return; }
          if ((e.target as HTMLElement).tagName === 'INPUT') return;
          const r = e.currentTarget.getBoundingClientRect();
          p.onSeek(((e.clientX - r.left) / r.width) * L);
        }}
      >
        {p.shakes?.map((k, i) => (
          <i
            key={i}
            className={`pointer-events-none absolute bottom-1 top-1 rounded-[1px] bg-bd-text ${k.low ? 'opacity-30' : 'opacity-80'}`}
            style={{ left: `${k.left}%`, width: `${k.width}%` }}
          />
        ))}
        {sel && (
          <div
            className="pointer-events-none absolute bottom-0 top-0 rounded-md border-2 border-bd-muted bg-white/[.12]"
            style={{ left: `${(sel.a / L) * 100}%`, width: `${((sel.b - sel.a) / L) * 100}%` }}
          />
        )}
        {p.range && (
          <div
            className={`pointer-events-none absolute bottom-0 top-0 rounded-md border-2 ${rng}`}
            style={{ left: `${(p.range.a / L) * 100}%`, width: `${((p.range.b - p.range.a) / L) * 100}%` }}
          />
        )}
        {p.editable && p.range && (
          <>
            <input
              type="range" className="tl-range" min={0} max={L} step={0.1} value={p.range.a}
              onChange={(e) => p.onRange?.(Number(e.target.value), p.range!.b)}
              onPointerUp={p.onRangeCommit} onKeyUp={p.onRangeCommit}
            />
            <input
              type="range" className="tl-range" min={0} max={L} step={0.1} value={p.range.b}
              onChange={(e) => p.onRange?.(p.range!.a, Number(e.target.value))}
              onPointerUp={p.onRangeCommit} onKeyUp={p.onRangeCommit}
            />
          </>
        )}
        <i className="pointer-events-none absolute -bottom-[3px] -top-[3px] w-0.5 bg-bd-focus" style={{ left: `${p.playhead * 100}%` }} />
      </div>
      {sel && !dragging && isValidTrim(sel.a, sel.b) && p.onCreate && (
        <button
          className={`${btn} absolute z-10 mt-1 whitespace-nowrap shadow-lg`}
          // anchored to the selection's start, or to its end in the right half so it stays inside the player
          style={(sel.a + sel.b) / 2 > L / 2 ? { right: `${100 - (sel.b / L) * 100}%` } : { left: `${(sel.a / L) * 100}%` }}
          onClick={() => { p.onCreate?.(sel.a, sel.b); setSel(null); }}
        >
          {'＋'} New moment {'·'} {(sel.b - sel.a).toFixed(1)} s
        </button>
      )}
    </div>
  );
}
