import { useEffect, useRef, type RefObject } from 'react';

interface Props {
  src: string | null;
  /** Loop range in source seconds (ignored when `whole`). */
  a: number;
  b: number;
  rate: number;
  whole?: boolean;
  /** Shown top right when the panel is slowed down. */
  speedBadge?: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Playhead position as a fraction of the clip. */
  onTime: (fraction: number) => void;
}

/** Drawer player: loops [a, b] (or the whole clip), click toggles pause. */
export function DrawerPlayer({ src, a, b, rate, whole = false, speedBadge, videoRef, onTime }: Props) {
  const range = useRef({ a, b, rate, whole });
  range.current = { a, b, rate, whole };

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = rate;
  }, [rate, videoRef]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || v.readyState < 1) return;
    v.currentTime = whole ? 0 : a;
    v.play().catch(() => {});
    // Only re-seek when switching between moment and whole clip; trimming moves a/b without restarting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whole]);

  return (
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
          v.currentTime = range.current.whole ? 0 : range.current.a;
          v.playbackRate = range.current.rate;
          v.play().catch(() => {});
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          const r = range.current;
          if (!r.whole && (v.currentTime >= r.b || v.currentTime < r.a - 0.3)) v.currentTime = r.a;
          if (v.duration) onTime(v.currentTime / v.duration);
        }}
        onEnded={(e) => {
          const v = e.currentTarget;
          v.currentTime = range.current.whole ? 0 : range.current.a;
          v.play().catch(() => {});
        }}
        onClick={(e) => {
          const v = e.currentTarget;
          if (v.paused) v.play().catch(() => {});
          else v.pause();
        }}
      />
      {speedBadge !== undefined && speedBadge !== 1 && (
        <span className="absolute right-2 top-2 rounded-[5px] bg-black/80 px-[7px] py-px text-[11px]">{'\u{1F422}'} {speedBadge * 100} %</span>
      )}
    </div>
  );
}
