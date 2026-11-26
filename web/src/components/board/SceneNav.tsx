import type { BoardScene } from '../../board/types';
import { useState } from 'react';
import { PANEL_MIME, dragKind } from '../../board/grid';
import { btnGhost } from './ui';

interface Props {
  scenes: BoardScene[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onAdd: () => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  /** A panel was dropped on a scene: move it to the end of that scene. */
  onDropPanel: (panelId: number, sceneId: number) => void;
}

export function SceneNav({ scenes, selectedId, onSelect, onAdd, onMove, onDelete, onDropPanel }: Props) {
  const [dropId, setDropId] = useState<number | null>(null);
  const idx = scenes.findIndex((s) => s.id === selectedId);
  return (
    <nav className="overflow-auto border-r border-bd-line px-2 py-3 max-[900px]:flex max-[900px]:gap-1 max-[900px]:overflow-x-auto max-[900px]:border-b max-[900px]:border-r-0 max-[900px]:py-1.5">
      <div className="max-[900px]:flex max-[900px]:gap-1">
        {scenes.map((s, i) => (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            onDragOver={(e) => {
              if (dragKind(e.dataTransfer.types) !== 'panel') return;
              e.preventDefault();
              setDropId(s.id);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropId((d) => (d === s.id ? null : d));
            }}
            onDrop={(e) => {
              if (dragKind(e.dataTransfer.types) !== 'panel') return;
              e.preventDefault();
              setDropId(null);
              const pid = Number(e.dataTransfer.getData(PANEL_MIME));
              if (pid) onDropPanel(pid, s.id);
            }}
            className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-[7px] max-[900px]:flex-none hover:bg-bd-s1 hover:text-bd-text ${
              dropId === s.id ? 'bg-bd-s2 text-bd-text shadow-[0_0_0_2px_var(--color-bd-focus)]' : s.id === selectedId ? 'bg-bd-s2 text-bd-text' : 'text-bd-muted'
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
      <div className="mt-2 flex gap-0.5 max-[900px]:mt-0">
        <button className={btnGhost} onClick={onAdd} title="Add scene">{'＋'}</button>
        <button className={btnGhost} onClick={() => onMove(-1)} disabled={idx <= 0} title="Move up">{'↑'}</button>
        <button className={btnGhost} onClick={() => onMove(1)} disabled={idx < 0 || idx >= scenes.length - 1} title="Move down">{'↓'}</button>
        <button className={btnGhost} onClick={onDelete} disabled={scenes.length <= 1} title="Delete scene">{'✕'}</button>
      </div>
    </nav>
  );
}
