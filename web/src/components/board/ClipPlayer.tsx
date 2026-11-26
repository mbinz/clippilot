import { useRef, useState } from 'react';
import type { PM } from '../../board/types';
import { rangeLabel, fmtClock, shakeMarks } from '../../board/drawer';
import type { UsageEntry } from '../../board/pool';
import { DrawerPlayer } from './DrawerPlayer';
import { ClipTimeline } from './ClipTimeline';
import { useTrim } from './useTrim';

interface Props {
  moment: PM;
  /** Usable moments of the same clip (bars on the timeline). */
  clipMoments: PM[];
  usage: Record<number, UsageEntry>;
  editable: boolean;
  tone: 'amber' | 'white';
  hint: string;
  /** Right end of the label row, e.g. "2:10 · whole clip". */
  footer: string;
  onPick: (momentId: number) => void;
  onTrim: (a: number, b: number) => void;
  /** Two-up extras, passed to the player / timeline. */
  muted?: boolean;
  restartToken?: number;
  onStarted?: () => void;
  /** Moments in the story as neutral bars (not green / violet). */
  neutralUsage?: boolean;
  /** "New moment" from a selection on the timeline (BE4). */
  onCreate?: (a: number, b: number) => void;
}

/** Player + timeline + range label of one moment. Mount with `key={moment.id}`. */
export function ClipPlayer({ moment: m, clipMoments, usage, editable, tone, hint, footer, onPick, onTrim, muted, restartToken, onStarted, neutralUsage, onCreate }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const seekRef = useRef<((t: number) => void) | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const trim = useTrim(m, videoRef, onTrim);
  const dragging = trim.range.a !== m.start_sec || trim.range.b !== m.end_sec;
  return (
    <>
      <DrawerPlayer
        src={m.clip.proxy_url} a={trim.range.a} b={trim.range.b} rate={m.speed} duration={m.clip.duration_sec} fps={m.clip.fps}
        hint={hint} videoRef={videoRef} seekRef={seekRef} onTime={setPlayhead}
        muted={muted} restartToken={restartToken} onStarted={onStarted}
      />
      <ClipTimeline
        duration={m.clip.duration_sec} moments={clipMoments} currentId={m.id} usage={usage}
        range={trim.range} editable={editable} tone={tone} neutralUsage={neutralUsage} onRange={trim.live} onRangeCommit={trim.release}
        shakes={shakeMarks(m.shakes, trim.range, m.clip.duration_sec)}
        playhead={playhead} onPick={onPick} onSeek={(t) => seekRef.current?.(t)} onCreate={onCreate}
      />
      <div className="mt-1 flex justify-between gap-2 text-[11px] tabular-nums text-bd-muted">
        <span>0:00</span>
        <span className="text-center">
          {dragging
            ? `${trim.range.a.toFixed(1)} s – ${trim.range.b.toFixed(1)} s · release to apply`
            : rangeLabel(m, editable)}
        </span>
        <span className="text-right">{footer || fmtClock(m.clip.duration_sec)}</span>
      </div>
    </>
  );
}
