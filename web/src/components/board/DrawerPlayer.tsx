import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { seekState } from '../../board/pool';
import { frameLoopTarget, frameSec, useFrameWatch } from '../../board/frameWatch';
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
  /** Clip fps (frame duration for the exact loop end); default 25. */
  fps?: number | null;
  hint: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Filled by the player: seek to a clip time (outside the range = play on, inside = loop again). */
  seekRef: MutableRefObject<((t: number) => void) | null>;
  /** Playhead position as a fraction of the clip. */
  onTime: (fraction: number) => void;
  /** Sound off (default). Only one of two side-by-side players should be unmuted. */
  muted?: boolean;
  /** Changes = restart the loop from `a` (two-up: both sides start together). */
  restartToken?: number;
  /** The video is ready and started playing (the other side of a two-up restarts now). */
  onStarted?: () => void;
  /** Full screen: exact pixel size of the picture (the controls under it follow its width). Default: 16:9 across the column. */
  box?: { w: number; h: number };
  /** Displayed width / height of the clip, once known (portrait clips are < 1). */
  onAspect?: (aspect: number) => void;
}

/** Drawer player: the range loops; a seek outside it plays the clip on until the next seek back inside. */
/** play(), falling back to muted when the browser refuses autoplay with sound (Safari). */
function playOn(v: HTMLVideoElement): void {
  v.play().catch(() => {
    v.muted = true;
    v.play().catch(() => {});
  });
}

export function DrawerPlayer({ src, a, b, rate, duration, fps, hint, videoRef, seekRef, onTime, muted = true, restartToken, onStarted, box, onAspect }: Props) {
  const cur = useRef({ a, b, rate });
  cur.current = { a, b, rate };
  const free = useRef(false);
  const [label, setLabel] = useState({ t: 0, free: false });
  const [paused, setPaused] = useState(false);

  // Loop on the last frame before b; mediaTime is read once per frame (Safari).
  useFrameWatch(videoRef, (t, v) => {
    const jump = frameLoopTarget(t, cur.current.a, cur.current.b, free.current, frameSec(fps));
    if (jump !== null) v.currentTime = jump;
  }, [src, fps]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted, videoRef]);

  // A new token restarts the loop (not on mount: the player starts itself once its metadata is loaded).
  const lastToken = useRef(restartToken);
  useEffect(() => {
    if (lastToken.current === restartToken) return;
    lastToken.current = restartToken;
    const v = videoRef.current;
    if (!v) return;
    free.current = false;
    v.currentTime = cur.current.a;
    v.playbackRate = cur.current.rate;
    playOn(v);
  }, [restartToken, videoRef]);

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
      <div
        className={`relative overflow-hidden rounded-[10px] bg-black ${box ? 'mx-auto' : 'aspect-video'}`}
        style={box ? { width: box.w, height: box.h } : undefined}
      >
        <video
          ref={videoRef}
          className="block h-full w-full cursor-pointer object-contain"
          src={src ?? undefined}
          muted={muted}
          playsInline
          preload="auto"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            v.currentTime = cur.current.a;
            v.playbackRate = cur.current.rate;
            playOn(v);
            if (v.videoWidth && v.videoHeight) onAspect?.(v.videoWidth / v.videoHeight);
            onStarted?.();
          }}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime; // read once (Safari advances it between reads)
            const now = t;
            if (duration) onTime(now / duration);
            setLabel({ t: now, free: free.current });
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
      <div className={`mt-2 flex items-center gap-2.5 tabular-nums ${box ? 'mx-auto' : ''}`} style={box ? { width: box.w } : undefined}>
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
