import type { PM } from '../../board/types';
import { speedOk } from '../../board/logic';
import { sectionLabel } from './ui';

/** Speed 100 / 50 / 25 % of a moment; options the clip's frame rate cannot support are disabled. */
export function SpeedSegment({ m, onSpeed }: { m: PM; onSpeed: (v: number) => void }) {
  const fps = m.clip.fps;
  return (
    <div className="mt-3">
      <label className={sectionLabel}>Speed {'·'} clip is {fps ?? '?'} fps</label>
      <div className="inline-flex overflow-hidden rounded-lg border border-bd-line">
        {[1, 0.5, 0.25].map((v) => (
          <button
            key={v}
            disabled={!speedOk(fps, v)}
            title={speedOk(fps, v) ? undefined : 'Footage has too few frames'}
            onClick={() => v !== m.speed && onSpeed(v)}
            className={`cursor-pointer px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-30 ${m.speed === v ? 'bg-bd-s2 text-bd-text' : 'bg-transparent text-bd-muted'}`}
          >
            {v * 100} %
          </button>
        ))}
      </div>
    </div>
  );
}

export const kindLabel = (m: { shot: string | null; role: string | null }): string => [m.shot, m.role].filter(Boolean).join(' ');
