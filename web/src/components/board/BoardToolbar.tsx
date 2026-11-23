import type { Brief, HistoryState } from '../../board/types';
import { fmtClock, isOverTarget } from '../../board/logic';
import { btn, btnIcon, btnPrimary } from './ui';

interface Props {
  projectName: string;
  cutName: string;
  brief: Brief | null;
  briefState: 'none' | 'proposed' | 'confirmed';
  total: number;
  toChooseCount: number;
  history: HistoryState;
  onNextChoose: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onBrief?: () => void;
  onPreview?: () => void;
  onExport?: () => void;
  exporting?: boolean;
}

export function BoardToolbar(p: Props) {
  const target = p.brief?.target_sec ?? 0;
  const over = isOverTarget(p.total, target);
  const dot = p.briefState === 'confirmed' ? 'bg-bd-mine' : p.briefState === 'proposed' ? 'bg-bd-ai' : 'bg-bd-dim';
  const briefText = p.brief
    ? `Brief · ${fmtClock(p.brief.target_sec)} · ${p.brief.audience} · ${p.brief.mood}`
    : 'Brief · not set';
  return (
    <div className="flex flex-none items-center gap-3 border-b border-bd-line px-4 py-2.5 max-[900px]:flex-wrap max-[900px]:gap-2">
      <span className="whitespace-nowrap text-bd-muted">{p.projectName} {'›'} {p.cutName}</span>
      <button
        onClick={p.onBrief}
        disabled={!p.onBrief}
        className="flex max-w-[460px] items-center gap-2 rounded-full max-[900px]:order-9 max-[900px]:max-w-full max-[900px]:basis-full border border-bd-line bg-transparent py-1 pl-2 pr-3 hover:border-bd-line2 disabled:cursor-default"
      >
        <i className={`h-2 w-2 flex-none rounded-full ${dot}`} />
        <span className="truncate text-bd-muted">{briefText}</span>
      </button>
      <div className="flex-1" />
      {p.toChooseCount > 0 && (
        <button
          onClick={p.onNextChoose}
          className="rounded-full border border-bd-attn/40 bg-transparent px-2.5 py-0.5 text-bd-attn"
        >
          {p.toChooseCount} to choose {'→'}
        </button>
      )}
      <span className="flex items-center gap-2 tabular-nums text-bd-muted">
        <b className={`font-semibold ${over ? 'text-bd-attn' : 'text-bd-text'}`}>{fmtClock(p.total)}</b>
        {target > 0 && (
          <>
            {' / '}{fmtClock(target)}
            <span className="h-1 w-[90px] overflow-hidden rounded-sm bg-bd-s2">
              <i
                className={`block h-full ${over ? 'bg-bd-attn' : 'bg-bd-muted'}`}
                style={{ width: `${Math.min(100, (p.total / target) * 100)}%` }}
              />
            </span>
          </>
        )}
      </span>
      <button
        className={btnIcon}
        disabled={!p.history.can_undo}
        onClick={p.onUndo}
        title={p.history.can_undo ? `Undo: ${p.history.undo_label} (⌘Z)` : 'Nothing to undo'}
      >
        {'↶'}
      </button>
      <button
        className={btnIcon}
        disabled={!p.history.can_redo}
        onClick={p.onRedo}
        title={p.history.can_redo ? `Redo: ${p.history.redo_label} (⇧⌘Z)` : 'Nothing to redo'}
      >
        {'↷'}
      </button>
      {p.onPreview && <button className={btn} onClick={p.onPreview}>{'▶'} Preview</button>}
      {p.onExport && (
        <button className={btnPrimary} onClick={p.onExport} disabled={p.exporting}>
          {p.exporting ? 'Exporting…' : 'Export'}
        </button>
      )}
    </div>
  );
}
