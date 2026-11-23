import { useState } from 'react';
import type { PM } from '../../board/types';
import type { UsageEntry } from '../../board/pool';
import { poolView } from '../../board/drawer';
import { MomentTile } from './MomentTile';

interface Props {
  moments: PM[];
  eventId: number | null;
  usage: Record<number, UsageEntry>;
  currentSceneIndex: number;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onSeen: (id: number) => void;
}

const moreBtn = 'cursor-pointer border-0 bg-transparent py-1 text-xs text-bd-muted underline underline-offset-[3px]';
export const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2';

export function MomentPool({ moments, eventId, usage, currentSceneIndex, selectedId, onSelect, onSeen }: Props) {
  const [scope, setScope] = useState<'event' | 'all'>('event');
  const [showOut, setShowOut] = useState(false);
  const view = poolView(moments, scope, eventId);
  const nHeroes = view.heroes.reduce((n, g) => n + g.length, 0);
  const nRest = view.rest.reduce((n, g) => n + g.length, 0);

  const tile = (m: PM) => (
    <MomentTile
      key={m.id} m={m} used={usage[m.id]} currentSceneIndex={currentSceneIndex}
      selected={selectedId === m.id} onSelect={() => onSelect(m.id)} onSeen={onSeen}
    />
  );
  // Groups of similar moments sit side by side; a small gap between their grids, no labels.
  const groups = (gs: PM[][]) => (
    <div className="flex flex-col gap-4">{gs.map((g) => <div key={g[0].id} className={GRID}>{g.map(tile)}</div>)}</div>
  );
  const h4 = 'mb-1.5 mt-0 text-[11.5px] font-medium text-bd-dim';

  return (
    <>
      <div className="mb-3 mt-[26px] flex flex-wrap items-center gap-2.5">
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
        <div className="flex-1" />
        <div className="flex flex-wrap gap-3.5 text-[11px] text-bd-dim">
          <span><i className="mr-[5px] inline-block h-[11px] w-[18px] rounded-[3px] border-[3px] border-solid border-bd-mine align-[-1px]" />yours</span>
          <span><i className="mr-[5px] inline-block h-[11px] w-[18px] rounded-[3px] border-[3px] border-dashed border-bd-ai align-[-1px]" />AI{'’'}s pick</span>
          <span><i className="mr-[5px] inline-block h-[11px] w-[18px] rounded-[3px] bg-[#555] align-[-1px]" />seen</span>
        </div>
      </div>

      {nHeroes > 0 && (
        <div>
          <h4 className={h4}>{'★'} {nHeroes}</h4>
          {groups(view.heroes)}
        </div>
      )}
      {nRest > 0 && (
        <div className={nHeroes > 0 ? 'mt-[18px]' : ''}>
          <h4 className={h4}>All other moments {'·'} {nRest} {'·'} similar ones side by side</h4>
          {groups(view.rest)}
        </div>
      )}

      {view.out.length > 0 && (
        <div className="mt-3.5">
          <button className={moreBtn} onClick={() => setShowOut((v) => !v)}>
            {showOut ? 'hide' : 'show'} rejected / hidden {'·'} {view.out.length}
          </button>
          {showOut && <div className={`${GRID} mt-2`}>{view.out.map(tile)}</div>}
        </div>
      )}
    </>
  );
}
