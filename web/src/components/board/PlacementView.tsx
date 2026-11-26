import { useEffect, useRef } from 'react';
import type { BoardScene, PM } from '../../board/types';
import { isOut, type UsageEntry } from '../../board/pool';
import { btnGhost, btnPrimary, kbd } from './ui';
import { ClipPlayer } from './ClipPlayer';
import { kindLabel } from './MomentBits';
import { InlineText } from './InlineText';

interface Props {
  moment: PM;
  scene: BoardScene;
  /** Insert slot of the ghost (0..panels). */
  slot: number;
  moments: PM[];
  usage: Record<number, UsageEntry>;
  keysOn: boolean;
  onInsert: () => void;
  onShift: (dir: 1 | -1) => void;
  onCancel: () => void;
  /** A mark on the clip timeline was clicked. */
  onPick: (momentId: number) => void;
  /** "New moment" from a selection on the clip's timeline (BE4): replaces the moment being placed. */
  onCreate: (clipId: number, a: number, b: number) => void;
  /** Inline edit of the moment's description. */
  onDescribe: (m: PM, text: string) => void;
}

const typing = (): boolean => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable);
};

/** Placement view (BE3): one big player of the moment under the ghost's row; insert it at the ghost's slot. Mount with `key={moment.id}`. */
export function PlacementView(p: Props) {
  const { moment: m, scene, slot } = p;
  const boxRef = useRef<HTMLElement>(null);
  const latest = useRef(p);
  latest.current = p;

  useEffect(() => {
    boxRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const q = latest.current;
      if (!q.keysOn || e.metaKey || e.ctrlKey || e.altKey || typing()) return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (e.key === 'ArrowLeft') { e.preventDefault(); q.onShift(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); q.onShift(1); }
      else if (e.key === 'Enter') {
        if (tag === 'BUTTON' || tag === 'A') return;
        e.preventDefault();
        q.onInsert();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const where = scene.panels.length === 0 ? 'as the first panel' : slot === 0 ? 'before panel 1' : slot >= scene.panels.length ? `after panel ${scene.panels.length}` : `between panels ${slot} and ${slot + 1}`;

  return (
    <section
      ref={boxRef}
      className="my-1 w-full rounded-xl border border-bd-line2 bg-bd-s1 p-3.5 max-[900px]:fixed max-[900px]:inset-0 max-[900px]:z-[15] max-[900px]:my-0 max-[900px]:overflow-auto max-[900px]:rounded-none"
    >
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-bd-muted">
          New panel {'·'} {scene.name} {'·'} {where}
        </span>
        <div className="flex-1" />
        <button className={btnGhost} onClick={() => p.onShift(-1)} disabled={slot <= 0} title="One slot earlier (←)">{'◀'}</button>
        <button className={btnGhost} onClick={() => p.onShift(1)} disabled={slot >= scene.panels.length} title="One slot later (→)">{'▶'}</button>
        <button className={btnPrimary} onClick={p.onInsert} title="Enter">Insert here</button>
        <button className={btnGhost} onClick={p.onCancel} title="Cancel (Esc)">Cancel</button>
      </div>
      <div className="max-w-[880px]">
        <ClipPlayer
          moment={m}
          clipMoments={p.moments.filter((x) => x.clip_id === m.clip_id && !isOut(x))}
          usage={p.usage}
          editable={false}
          tone="white"
          neutralUsage
          muted={false}
          hint="loops the moment"
          footer={`${Math.round(m.clip.duration_sec)} s · ${m.clip.file_name}`}
          onPick={(id) => id !== m.id && p.onPick(id)}
          onTrim={() => {}}
          onCreate={(a, b) => p.onCreate(m.clip_id, a, b)}
        />
        <p className="mb-0 mt-2 line-clamp-2 text-[12.5px] text-[#cfd3db]">
          <InlineText value={m.description} placeholder="Add a description" onSave={(t) => p.onDescribe(m, t)} />{' '}
          <span className={kbd}>{kindLabel(m)}</span>
        </p>
        <p className={`${kbd} mb-0 mt-1.5`}>Drag the dashed panel to any slot, or onto an empty / CHOOSE panel. ← → move it, Enter inserts, Esc cancels.</p>
      </div>
    </section>
  );
}
