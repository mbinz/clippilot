import { useMemo, useState } from 'react';
import type { PM } from '../../board/types';
import { isOut, onlyNew, poolMark, poolSort, type PoolMark, type PoolSectionKey, type PoolTree, type UsageEntry } from '../../board/pool';
import { poolView } from '../../board/drawer';
import { MomentTile } from './MomentTile';

interface Props {
  moments: PM[];
  tree: PoolTree;
  eventId: number | null;
  /** The viewed scene: its panels win when several hold a similar moment. */
  sceneId: number;
  usage: Record<number, UsageEntry>;
  currentSceneIndex: number;
  /** The moment being placed (ghost), highlighted. */
  selectedId: number | null;
  onSelect: (m: PM, mark: PoolMark) => void;
  onSeen: (id: number) => void;
  tools: NonNullable<Parameters<typeof MomentTile>[0]['tools']>;
}

const moreBtn = 'cursor-pointer border-0 bg-transparent py-1 text-xs text-bd-muted underline underline-offset-[3px]';
export const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2';

const SECTION: Record<PoolSectionKey, string> = {
  'star-new': '\u2605 new',
  'star-similar': '\u2605 already in the story, similar',
  new: 'New',
  similar: 'Similar to a panel',
};

export function MomentPool({ moments, tree, eventId, sceneId, usage, currentSceneIndex, selectedId, onSelect, onSeen, tools }: Props) {
  const [scope, setScope] = useState<'event' | 'all'>('event');
  const [fresh, setFresh] = useState(false);
  const [showOut, setShowOut] = useState(false);
  const view = poolView(moments, scope, eventId, new Set(Object.keys(usage).map(Number)));
  const markOf = useMemo(() => {
    const cache = new Map<number, PoolMark>();
    return (m: PM): PoolMark => {
      let r = cache.get(m.id);
      if (!r) cache.set(m.id, (r = poolMark(m, tree, moments, sceneId)));
      return r;
    };
  }, [tree, moments, sceneId]);
  const unused = [...view.heroes.flat(), ...view.rest.flat()];
  const nSimilar = unused.filter((m) => markOf(m).kind === 'similar').length;
  const sections = poolSort(fresh ? onlyNew(unused, markOf) : unused, markOf);

  const tile = (m: PM) => (
    <MomentTile
      key={m.id} m={m} used={usage[m.id]} currentSceneIndex={currentSceneIndex} mark={isOut(m) ? undefined : markOf(m)} tools={tools}
      selected={selectedId === m.id} onSelect={() => onSelect(m, markOf(m))} onSeen={onSeen}
    />
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
        <button
          onClick={() => setFresh((v) => !v)}
          title="Hide moments that look like something already in the story"
          className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-xs ${fresh ? 'border-bd-muted bg-bd-s2 text-bd-text' : 'border-bd-line bg-transparent text-bd-muted'}`}
        >
          Only new{nSimilar > 0 ? ` \u00b7 hides ${nSimilar}` : ''}
        </button>
        <div className="flex-1" />
        <div className="flex flex-wrap gap-3.5 text-[11px] text-bd-dim">
          <span>unused only {'·'} {view.inStory} in the story</span>
          <span><i className="mr-[5px] inline-block h-[11px] w-[18px] rounded-[3px] bg-[#555] align-[-1px]" />not seen yet</span>
        </div>
      </div>

      {sections.map((s, i) => (
        <div key={s.key} className={i > 0 ? 'mt-[18px]' : ''}>
          <h4 className={h4}>{SECTION[s.key]} {'·'} {s.moments.length}</h4>
          <div className={GRID}>{s.moments.map(tile)}</div>
        </div>
      ))}
      {sections.length === 0 && <div className="text-bd-dim">Nothing unused{fresh ? ' that is new' : ''} here.</div>}

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
