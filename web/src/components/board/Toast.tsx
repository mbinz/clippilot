import { useEffect, useState } from 'react';
import type { Toast as ToastData } from '../../board/useBoard';

interface Props {
  toast: ToastData | null;
  onUndo: () => void;
}

/** Bottom-centre toast; edits offer an inline "Undo". Fades after 3.5 s. */
export function Toast({ toast, onUndo }: Props) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setShown(true);
    const t = setTimeout(() => setShown(false), toast.sticky ? 8000 : 3500);
    return () => clearTimeout(t);
  }, [toast?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!toast) return null;
  return (
    <div
      className={`fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-[10px] border border-bd-line2 bg-bd-s2 px-3.5 py-[9px] text-bd-text transition-opacity ${
        shown ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
    >
      <span>{toast.text}</span>
      {toast.undo && (
        <button
          onClick={() => { setShown(false); onUndo(); }}
          className="cursor-pointer border-0 bg-transparent font-semibold text-bd-focus underline underline-offset-[3px]"
        >
          Undo
        </button>
      )}
    </div>
  );
}
