import type { BoardMoment } from '../../board/types';

interface Props {
  duration: number;
  moments: BoardMoment[];
  currentMomentId: number | null;
  /** When set the timeline shows trim handles (in/out). */
  range?: { a: number; b: number };
  onRange?: (a: number, b: number) => void;
  onRangeCommit?: () => void;
  /** Playhead position as a fraction of the clip. */
  playhead: number;
}

/** Clip timeline: the clip's moments as bars, the panel's range and two range inputs as trim handles. */
export function ClipTimeline({ duration, moments, currentMomentId, range, onRange, onRangeCommit, playhead }: Props) {
  const L = duration || 1;
  return (
    <div className="relative mt-2.5 h-[26px] cursor-pointer rounded-md bg-bd-s2">
      {moments.map((x) => (
        <i
          key={x.id}
          className={`absolute bottom-1 top-1 rounded-[3px] ${x.id === currentMomentId ? 'bg-bd-muted' : 'bg-bd-line2'}`}
          style={{ left: `${(x.start_sec / L) * 100}%`, width: `${((x.end_sec - x.start_sec) / L) * 100}%` }}
          title={`${x.tier}: ${x.description.replace(/"/g, '')}`}
        />
      ))}
      {range && (
        <>
          <div
            className="absolute bottom-0 top-0 rounded-md border-2 border-bd-focus bg-white/[.08]"
            style={{ left: `${(range.a / L) * 100}%`, width: `${((range.b - range.a) / L) * 100}%` }}
          />
          <input
            type="range" className="tl-range" min={0} max={L} step={0.1} value={range.a}
            onChange={(e) => onRange?.(Number(e.target.value), range.b)}
            onPointerUp={onRangeCommit} onKeyUp={onRangeCommit}
          />
          <input
            type="range" className="tl-range" min={0} max={L} step={0.1} value={range.b}
            onChange={(e) => onRange?.(range.a, Number(e.target.value))}
            onPointerUp={onRangeCommit} onKeyUp={onRangeCommit}
          />
        </>
      )}
      <i className="absolute -bottom-[3px] -top-[3px] w-0.5 bg-bd-focus" style={{ left: `${playhead * 100}%` }} />
    </div>
  );
}
