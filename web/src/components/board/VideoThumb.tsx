import { useEffect, useRef, useState, type ReactNode } from 'react';

// One live preview video at a time: starting a hover stops the previous one.
let stopCurrent: (() => void) | null = null;
export function stopHoverPlayback() {
  stopCurrent?.();
  stopCurrent = null;
}

interface VideoThumbProps {
  poster: string | null;
  src: string | null;
  /** Loop range in source seconds. */
  a: number;
  b: number;
  /** Hover playback rate (muted). */
  rate?: number;
  className?: string;
  children?: ReactNode;
}

/** Poster image that plays its range muted and looping from the proxy while hovered. */
export function VideoThumb({ poster, src, a, b, rate = 2, className = '', children }: VideoThumbProps) {
  const [live, setLive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const self = useRef<() => void>(() => {});
  self.current = () => setLive(false);
  const mine = useRef<() => void>(() => self.current());

  useEffect(() => () => {
    if (stopCurrent === mine.current) stopCurrent = null;
  }, []);

  const start = () => {
    if (!src) return;
    stopHoverPlayback();
    setLive(true);
    stopCurrent = mine.current;
  };
  const stop = () => {
    setLive(false);
    if (stopCurrent === mine.current) stopCurrent = null;
  };

  return (
    <div
      className={`absolute inset-0 bg-cover bg-center bg-no-repeat ${className}`}
      style={{ backgroundImage: poster ? `url(${poster})` : undefined }}
      onMouseEnter={start}
      onMouseLeave={stop}
    >
      {live && src && (
        <>
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover"
            src={`${src}#t=${a}`}
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              v.currentTime = a;
              v.playbackRate = rate;
              v.play().catch(() => {});
            }}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (v.currentTime >= b) v.currentTime = a;
              if (barRef.current) barRef.current.style.width = `${Math.max(0, ((v.currentTime - a) / (b - a)) * 100)}%`;
            }}
          />
          <div ref={barRef} className="absolute bottom-0 left-0 h-0.5 w-0 bg-bd-focus" />
        </>
      )}
      {children}
    </div>
  );
}
