import { useEffect, useRef, type DependencyList, type RefObject } from 'react';
import { loopSeekTarget } from './pool';

/** Frame duration from the clip fps; 1/25 when unknown. */
export const frameSec = (fps: number | null | undefined): number => (fps && fps > 0 ? 1 / fps : 1 / 25);

/** The frame shown at `mediaTime` is the last one before `end` (the next frame would start at/after it). */
export const frameEndReached = (mediaTime: number, end: number, frame: number): boolean =>
  mediaTime + frame >= end - 1e-6;

/** Loop decision per presented frame: jump to `a` at the last frame before `b`, else the usual loopSeekTarget rules. */
export function frameLoopTarget(t: number, a: number, b: number, free: boolean, frame: number): number | null {
  if (!free && frameEndReached(t, b, frame)) return a;
  return loopSeekTarget(t, a, b, free);
}

/** Older DOM libs / browsers may lack rVFC, so it is probed at runtime. */
type MaybeRvfc = { requestVideoFrameCallback?: HTMLVideoElement['requestVideoFrameCallback'] };

/**
 * Calls `cb(mediaTime)` for every presented frame (requestVideoFrameCallback; requestAnimationFrame fallback).
 * Returns the cleanup. `mediaTime` is read once per frame (Safari advances currentTime between reads).
 */
export function watchFrames(video: HTMLVideoElement, cb: (mediaTime: number) => void): () => void {
  const v = video;
  let stopped = false;
  let id = 0;
  if ((v as MaybeRvfc).requestVideoFrameCallback) {
    const tick = (_now: number, meta: { mediaTime: number }) => {
      if (stopped) return;
      cb(meta.mediaTime);
      if (!stopped) id = v.requestVideoFrameCallback(tick);
    };
    id = v.requestVideoFrameCallback(tick);
    return () => { stopped = true; v.cancelVideoFrameCallback(id); };
  }
  const tick = () => {
    if (stopped) return;
    if (!v.paused) cb(v.currentTime);
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => { stopped = true; cancelAnimationFrame(id); };
}

/** Watches the video's frames while mounted; re-subscribes when `deps` change (src change, video mounting). */
export function useFrameWatch(
  videoRef: RefObject<HTMLVideoElement | null>,
  cb: (mediaTime: number, video: HTMLVideoElement) => void,
  deps: DependencyList,
): void {
  const latest = useRef(cb);
  latest.current = cb;
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    return watchFrames(v, (t) => latest.current(t, v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
