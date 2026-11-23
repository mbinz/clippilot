import type { PM } from '../../board/types';
import { isHero, type UsageEntry } from '../../board/pool';

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
  onRange?: (a: number, b: number) => void;
  onRangeCommit?: () => void;
  /** Playhead position as a fraction of the clip. */
  playhead: number;
  onPick: (momentId: number) => void;
  onSeek: (t: number) => void;
}

/** Clip timeline: moment bars (click = select), the selected moment's range with trim handles, click-to-seek lane. */
export function ClipTimeline(p: Props) {
  const L = p.duration || 1;
  const rng = p.tone === 'amber' ? 'border-bd-attn bg-bd-attn/[.12]' : 'border-bd-focus bg-white/[.08]';
  return (
    <div className="mt-2">
      <div className="relative h-[18px]">
        {p.moments.map((x) => {
          const u = p.usage[x.id];
          const cur = x.id === p.currentId;
          const hero = isHero(x);
          const colour = cur
            ? 'bg-bd-focus'
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
        className="relative mt-[3px] h-[26px] cursor-pointer rounded-md bg-bd-s2"
        onClick={(e) => {
          if ((e.target as HTMLElement).tagName === 'INPUT') return;
          const r = e.currentTarget.getBoundingClientRect();
          p.onSeek(((e.clientX - r.left) / r.width) * L);
        }}
      >
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
    </div>
  );
}
