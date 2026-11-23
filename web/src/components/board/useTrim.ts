import { useEffect, useRef, useState, type RefObject } from 'react';
import { isValidTrim } from '../../board/drawer';

/** Live trim state for one moment: dragging previews, releasing commits one change (one undo step). */
export function useTrim(
  moment: { id: number; start_sec: number; end_sec: number },
  videoRef: RefObject<HTMLVideoElement | null>,
  commit: (a: number, b: number) => void,
) {
  const [range, setRange] = useState({ a: moment.start_sec, b: moment.end_sec });
  const ref = useRef(range);
  ref.current = range;

  useEffect(() => {
    setRange({ a: moment.start_sec, b: moment.end_sec });
  }, [moment.id, moment.start_sec, moment.end_sec]);

  const live = (a: number, b: number) => {
    const prev = ref.current;
    setRange({ a, b });
    const v = videoRef.current;
    if (v && isValidTrim(a, b)) v.currentTime = a !== prev.a ? a : Math.max(a, b - 1);
  };
  const release = () => {
    const { a, b } = ref.current;
    if (a === moment.start_sec && b === moment.end_sec) return;
    if (isValidTrim(a, b)) commit(a, b);
    else setRange({ a: moment.start_sec, b: moment.end_sec });
  };
  return { range, live, release };
}
