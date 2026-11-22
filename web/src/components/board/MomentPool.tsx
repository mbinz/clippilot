import { useState } from 'react';
import type { BoardMoment } from '../../board/types';
import { groupMoments, isMomentHidden } from '../../board/logic';
import { VideoThumb, stopHoverPlayback } from './VideoThumb';

interface Props {
  moments: BoardMoment[];
  eventId: number | null;
  usage: Record<number, 'mine' | 'ai'>;
  selectedId: number | null;
  onSelect: (id: number) => void;
}

function MomentTile({ m, used, selected, onSelect }: { m: BoardMoment; used?: 'mine' | 'ai'; selected: boolean; onSelect: () => void }) {
  const hid = isMomentHidden(m);
  return (
    <div
      draggable={!hid}
      onDragStart={(e) => {
        stopHoverPlayback();
        e.dataTransfer.setData('text/plain', String(m.id));
      }}
      onClick={onSelect}
      className={`relative aspect-video cursor-pointer overflow-hidden rounded-[7px] bg-black ${
        selected ? 'shadow-[0_0_0_3px_var(--color-bd-focus)]' : 'hover:shadow-[0_0_0_2px_var(--color-bd-line2)]'
      } ${hid ? 'opacity-35 grayscale' : m.tier === 'filler' ? 'opacity-55' : ''}`}
    >
      <VideoThumb poster={m.thumbnail} src={m.clip?.proxy_url ?? null} a={m.start_sec} b={m.end_sec} rate={2} />
      {m.tier === 'hero' && <span className="pointer-events-none absolute left-1.5 top-1 text-xs [text-shadow:0_1px_4px_#000]" title="hero">{'★'}</span>}
      {m.issues.length > 0 && (
        <span className="pointer-events-none absolute right-1.5 top-1 text-[11px] text-bd-bad [text-shadow:0_1px_4px_#000]" title={m.issues.join(', ')}>{'⚠'}</span>
      )}
      {used && (
        <i
          className={`pointer-events-none absolute bottom-[5px] left-1.5 h-2 w-2 rounded-full ${used === 'mine' ? 'bg-bd-mine' : 'bg-bd-ai'}`}
          title="In the cut"
        />
      )}
    </div>
  );
}

const moreBtn = 'cursor-pointer border-0 bg-transparent py-1 text-xs text-bd-muted underline underline-offset-[3px]';

export function MomentPool({ moments, eventId, usage, selectedId, onSelect }: Props) {
  const [scope, setScope] = useState<'event' | 'all'>('event');
  const [filler, setFiller] = useState<Record<string, boolean>>({});
  const [showHidden, setShowHidden] = useState(false);
  const groups = groupMoments(moments, { scope, eventId });

  return (
    <>
      <div className="mb-3 mt-[26px] flex items-center gap-2.5">
        <h3 className="m-0 text-[11px] font-semibold uppercase tracking-[.07em] text-bd-muted">Moments</h3>
        <div className="inline-flex overflow-hidden rounded-lg border border-bd-line">
          {(['event', 'all'] as const).map((v) => (
            <button
              key={v}
              disabled={v === 'event' && eventId === null}
              onClick={() => setScope(v)}
              className={`cursor-pointer px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-30 ${scope === v ? 'bg-bd-s2 text-bd-text' : 'bg-transparent text-bd-muted'}`}
            >
              {v === 'event' ? 'This event' : 'All'}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-bd-dim">Hover to play {'·'} click for details {'·'} drag onto a panel</span>
      </div>

      {groups.roles.map((g) => (
        <div key={g.role} className="mb-3.5">
          <h4 className="mx-0 mb-1.5 mt-0 text-[11.5px] font-medium text-bd-dim">
            {g.role[0].toUpperCase() + g.role.slice(1)} {'·'} {g.total}
          </h4>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-2">
            {(filler[g.role] ? [...g.main, ...g.filler] : g.main).map((m) => (
              <MomentTile key={m.id} m={m} used={usage[m.id]} selected={selectedId === m.id} onSelect={() => onSelect(m.id)} />
            ))}
          </div>
          {g.filler.length > 0 && (
            <button className={moreBtn} onClick={() => setFiller((f) => ({ ...f, [g.role]: !f[g.role] }))}>
              {filler[g.role] ? 'hide' : 'show'} {g.filler.length} filler
            </button>
          )}
        </div>
      ))}

      {groups.hidden.length > 0 && (
        <>
          <button className={moreBtn} onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? 'hide' : 'show'} rejected / hidden {'·'} {groups.hidden.length}
          </button>
          {showHidden && (
            <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-2">
              {groups.hidden.map((m) => (
                <MomentTile key={m.id} m={m} used={usage[m.id]} selected={selectedId === m.id} onSelect={() => onSelect(m.id)} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
