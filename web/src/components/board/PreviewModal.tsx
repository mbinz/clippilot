import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardPanel, BoardScene } from '../../board/types';
import { panelLength, panelRange, type PanelRange } from '../../board/logic';
import { stopHoverPlayback } from './VideoThumb';
import { btn } from './ui';

export interface PreviewItem {
  scene: BoardScene;
  panel: BoardPanel;
  src: string | null;
}

interface Props {
  items: PreviewItem[];
  onClose: () => void;
}

interface Step extends PreviewItem {
  range: PanelRange;
  src: string;
}

/** Plays the panels in order from the proxies at panel speed. Gaps and panels without a proxy are skipped. */
export function PreviewModal({ items, onClose }: Props) {
  const seq = useMemo<Step[]>(
    () => items.flatMap((it) => {
      const range = panelRange(it.panel);
      return range && it.src ? [{ ...it, range, src: it.src }] : [];
    }),
    [items],
  );
  const [k, setK] = useState(0);
  const [rate, setRate] = useState<1 | 2>(1);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [title, setTitle] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastScene = useRef<number | null>(null);

  // Silence everything else on the page while the preview runs.
  useEffect(() => {
    stopHoverPlayback();
    document.querySelectorAll('video').forEach((v) => { if (v !== videoRef.current) v.pause(); });
    const v = videoRef.current;
    return () => {
      v?.pause();
      v?.removeAttribute('src');
    };
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (k >= seq.length) {
      v.pause();
      return;
    }
    const { range: r, src } = seq[k];
    setProgress(0);
    const start = () => {
      v.currentTime = r.a;
      v.playbackRate = r.speed * rate;
      v.play().catch(() => {});
    };
    const url = new URL(src, location.href).href;
    if (v.src !== url) {
      v.src = url;
      v.addEventListener('loadedmetadata', start, { once: true });
    } else {
      start();
    }
    return () => {
      v.removeEventListener('loadedmetadata', start);
    };
  }, [k, rate, seq]);

  // Scene title overlay: fades in when the scene changes, out after 1.8 s.
  const titleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const scene = seq[k]?.scene;
    if (!scene || lastScene.current === scene.id) return;
    lastScene.current = scene.id;
    setTitle(scene.name);
    clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => setTitle(null), 1800);
  }, [k, seq]);
  useEffect(() => () => clearTimeout(titleTimer.current), []);

  const cur = seq[k];
  const ended = k >= seq.length;

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/80"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[88vh] w-[min(1000px,94vw)] overflow-auto rounded-[14px] border border-bd-line2 bg-bd-s1 px-[22px] py-5 text-bd-text">
        {seq.length === 0 ? (
          <p className="m-0 text-bd-muted">Nothing to preview {'—'} no panel has footage with a proxy yet.</p>
        ) : (
          <>
            <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
              <video
                ref={videoRef}
                className="absolute inset-0 h-full w-full object-contain"
                playsInline
                preload="auto"
                onPlay={() => setPaused(false)}
                onPause={() => setPaused(true)}
                onTimeUpdate={(e) => {
                  if (!cur) return;
                  const t = e.currentTarget.currentTime;
                  setProgress(Math.min(1, Math.max(0, (t - cur.range.a) / (cur.range.b - cur.range.a))));
                  if (t >= cur.range.b) setK(k + 1);
                }}
              />
              <div
                className={`absolute bottom-6 left-[26px] text-2xl font-semibold transition-opacity duration-500 [text-shadow:0_2px_14px_#000] ${title ? 'opacity-100' : 'opacity-0'}`}
              >
                {title}
              </div>
              {cur && cur.range.speed !== 1 && (
                <span className="absolute right-3.5 top-3 rounded-md bg-black/65 px-2 py-px text-xs">{'\u{1F422}'} {cur.range.speed * 100} %</span>
              )}
            </div>
            <div className="mt-2.5 flex h-2.5 gap-0.5">
              {seq.map((s, i) => (
                <span
                  key={s.panel.id}
                  onClick={() => setK(i)}
                  title={`${s.scene.name} · ${s.panel.intent}`}
                  className="relative cursor-pointer overflow-hidden rounded-sm bg-bd-s2"
                  style={{ flex: panelLength(s.panel) }}
                >
                  <i
                    className={`absolute inset-0 ${i === k ? 'bg-bd-focus' : 'bg-bd-muted'}`}
                    style={{ width: `${i < k ? 100 : i === k ? progress * 100 : 0}%` }}
                  />
                </span>
              ))}
            </div>
            <div className="mt-2.5 flex items-center gap-2.5">
              <button
                className={btn}
                onClick={() => {
                  const v = videoRef.current;
                  if (!v) return;
                  if (ended) setK(0);
                  else if (v.paused) v.play().catch(() => {});
                  else v.pause();
                }}
              >
                {ended || paused ? '▶' : '⏸'}
              </button>
              <span className="text-bd-muted">{ended ? 'End' : `${cur.scene.name} · ${cur.panel.intent}`}</span>
              <div className="flex-1" />
              <div className="inline-flex overflow-hidden rounded-lg border border-bd-line">
                {([1, 2] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRate(r)}
                    className={`cursor-pointer px-2.5 py-1 ${rate === r ? 'bg-bd-s2 text-bd-text' : 'bg-transparent text-bd-muted'}`}
                  >
                    {r}{'×'}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-bd-dim">Gaps skipped {'·'} candidates play their default {'·'} Esc closes</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
