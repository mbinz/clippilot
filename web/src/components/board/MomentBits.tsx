import type { ReactNode } from 'react';
import type { PM } from '../../board/types';
import { speedOk } from '../../board/logic';
import { effectiveTier } from '../../board/pool';
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

export function Fact({ children, bad }: { children: ReactNode; bad?: boolean }) {
  return (
    <span className={`rounded-full border border-bd-line px-[9px] py-px text-[11.5px] ${bad ? 'text-bd-bad' : 'text-bd-muted'}`}>{children}</span>
  );
}

/** Tags of a moment: tier, shot, role, slow-mo, audio, issues. */
export function MomentFacts({ m }: { m: PM }) {
  const fps = m.clip.fps ?? 0;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <Fact>{effectiveTier(m)}</Fact>
      {m.shot && <Fact>{m.shot}</Fact>}
      {m.role && <Fact>{m.role}</Fact>}
      {m.slowmo !== 'none' && <Fact>{'\u{1F422}'} {fps >= 48 ? 'slow-mo ok' : `slow-mo wanted, only ${m.clip.fps ?? '?'} fps`}</Fact>}
      {m.audio_keep && <Fact>{'\u{1F50A}'} {m.audio_type}</Fact>}
      {m.issues.map((x) => <Fact key={x} bad>{'⚠'} {x}</Fact>)}
    </div>
  );
}

export const kindLabel = (m: { shot: string | null; role: string | null }): string => [m.shot, m.role].filter(Boolean).join(' ');
