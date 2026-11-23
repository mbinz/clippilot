import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { loopStep, seekState } from '../../board/pool';
import { playLabel } from '../../board/drawer';
import { btnIcon, kbd } from './ui';

interface Props {
  src: string | null;
  /** The range that loops, in source seconds. */
  a: number;
  b: number;
  /** Playback speed inside the range (outside it the clip plays at 1x). */
  rate: number;
  duration: number;
  hint: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Filled by the player: seek to a clip time (outside the range = play on, inside = loop again). */
  seekRef: MutableRefObject<((t: number) => void) | null>;
  /** Playhead position as a fraction of the clip. */
  onTime: (fraction: number) => void;
}

/** Drawer player: the range loops; a seek outside it plays the clip on until the next seek back inside. */
export function DrawerPlayer({ src, a, b, rate, duration, hint, videoRef, seekRef, onTime }: Props) {
  const cur = useRef({ a, b, rate });
  cur.current = { a, b, rate };
  const free = useRef(false);
  const [label, setLabel] = useState({ t: 0, free: false });
  const [paused, setPaused] = useState(false);

  // Speed only applies inside the range.
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = free.current ? 1 : rate;
  }, [rate, videoRef]);

  seekRef.current = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    free.current = seekState(t, cur.current.a, cur.current.b);
    v.currentTime = t;
    v.playbackRate = free.current ? 1 : cur.current.rate;
    v.play().catch(() => {});
  };

  return (
    <>
      <div className="relative aspect-video overflow-hidden rounded-[10px] bg-black">
        <video
          ref={videoRef}
          className="block h-full w-full cursor-pointer object-contain"
          src={src ?? undefined}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            v.currentTime = cur.current.a;
            v.playbackRate = cur.current.rate;
            v.play().catch(() => {});
          }}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            const s = loopStep(v.currentTime, cur.current.a, cur.current.b, free.current);
            if (s.t !== v.currentTime) v.currentTime = s.t;
            if (duration) onTime(v.currentTime / duration);
            setLabel({ t: v.currentTime, free: free.current });
          }}
          onEnded={(e) => {
            if (free.current) return;
            const v = e.currentTarget;
            v.currentTime = cur.current.a;
            v.play().catch(() => {});
          }}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onClick={(e) => {
            const v = e.currentTarget;
            if (v.paused) v.play().catch(() => {});
            else v.pause();
          }}
        />
        {rate !== 1 && (
          <span className="absolute right-2 top-2 rounded-[5px] bg-black/80 px-[7px] py-px text-[11px]">{'\u{1F422}'} {Math.round(rate * 100)} %</span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2.5 tabular-nums">
        <button
          className={btnIcon}
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            if (v.paused) v.play().catch(() => {});
            else v.pause();
          }}
        >
          {paused ? '▶' : '⏸'}
        </button>
        <span className="text-bd-muted">{playLabel(label.t, duration, label.free)}</span>
        <div className="flex-1" />
        <span className={`${kbd} text-right`}>{hint}</span>
      </div>
    </>
  );
}
