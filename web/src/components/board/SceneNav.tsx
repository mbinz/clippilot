import type { BoardScene } from '../../board/types';
import { btnGhost } from './ui';

interface Props {
  scenes: BoardScene[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onAdd: () => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}

export function SceneNav({ scenes, selectedId, onSelect, onAdd, onMove, onDelete }: Props) {
  const idx = scenes.findIndex((s) => s.id === selectedId);
  return (
    <nav className="overflow-auto border-r border-bd-line px-2 py-3">
      <div>
        {scenes.map((s, i) => (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-[7px] hover:bg-bd-s1 hover:text-bd-text ${
              s.id === selectedId ? 'bg-bd-s2 text-bd-text' : 'text-bd-muted'
            }`}
          >
            <span className="w-4 tabular-nums text-bd-dim">{i + 1}</span>
            <span className="flex-1 truncate">{s.name}</span>
            {s.panels.some((p) => p.state === 'candidates') && (
              <i className="h-[7px] w-[7px] rounded-full bg-bd-attn" title="Has panels to choose" />
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-0.5">
        <button className={btnGhost} onClick={onAdd} title="Add scene">{'＋'}</button>
        <button className={btnGhost} onClick={() => onMove(-1)} disabled={idx <= 0} title="Move up">{'↑'}</button>
        <button className={btnGhost} onClick={() => onMove(1)} disabled={idx < 0 || idx >= scenes.length - 1} title="Move down">{'↓'}</button>
        <button className={btnGhost} onClick={onDelete} disabled={scenes.length <= 1} title="Delete scene">{'✕'}</button>
      </div>
    </nav>
  );
}
