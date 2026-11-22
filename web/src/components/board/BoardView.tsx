import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchProjects } from '../../api/client';
import { useBoard } from '../../board/useBoard';
import { cutLength, fmtClock, sceneLength, toChoose, usageOf } from '../../board/logic';
import type { BoardMoment, BoardPanel, BoardScene } from '../../board/types';
import { BoardToolbar } from './BoardToolbar';
import { SceneNav } from './SceneNav';
import { PanelStrip } from './PanelStrip';
import { MomentPool } from './MomentPool';
import { PanelDrawer } from './PanelDrawer';
import { MomentDrawer } from './MomentDrawer';
import { BriefModal } from './BriefModal';
import { PreviewModal, type PreviewItem } from './PreviewModal';
import { panelMedia } from './media';
import { exportCut } from '../../board/api';
import { Toast } from './Toast';
import { btnGhost, intentFrom } from './ui';

interface Props {
  projectId: number | undefined;
}

function SceneTitle({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) ref.current.textContent = name;
  }, [name]);
  return (
    <h2
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      className="m-0 rounded text-lg font-semibold outline-none focus:shadow-[0_0_0_1px_var(--color-bd-line2)]"
      onBlur={(e) => {
        const v = (e.currentTarget.textContent ?? '').trim();
        if (v && v !== name) onRename(v);
        else e.currentTarget.textContent = name;
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function BoardView({ projectId }: Props) {
  const board = useBoard(projectId);
  const { tree, moments, history, actions } = board;
  const [projectName, setProjectName] = useState('');
  const [sceneId, setSceneId] = useState<number | null>(null);
  const [panelId, setPanelId] = useState<number | null>(null);
  const [momentId, setMomentId] = useState<number | null>(null);
  /** Empty/candidate panel the user selected before opening a moment: the "Place in panel N" target. */
  const [panelTarget, setPanelTarget] = useState<number | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (projectId === undefined) return;
    fetchProjects().then((r) => setProjectName(r.data.find((p) => p.id === projectId)?.name ?? '')).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    setSceneId(null);
    setPanelId(null);
    setMomentId(null);
    setPanelTarget(null);
  }, [projectId]);

  const scenes: BoardScene[] = tree?.scenes ?? [];
  const scene = scenes.find((s) => s.id === sceneId) ?? scenes[0] ?? null;
  const momentsById = useMemo(() => new Map<number, BoardMoment>(moments.map((m) => [m.id, m])), [moments]);
  const usage = useMemo(() => usageOf(scenes), [scenes]);
  const choose = useMemo(() => toChoose(scenes), [scenes]);

  const findPanel = (id: number | null): { panel: BoardPanel; scene: BoardScene } | null => {
    if (id === null) return null;
    for (const s of scenes) {
      const p = s.panels.find((x) => x.id === id);
      if (p) return { panel: p, scene: s };
    }
    return null;
  };
  const selPanel = findPanel(panelId);
  const selMoment = momentId !== null ? momentsById.get(momentId) ?? null : null;
  const target = findPanel(panelTarget);
  const placeTarget = target && target.panel.state !== 'filled' ? target : null;
  const drawerOpen = Boolean(selPanel || selMoment);

  const select = (opts: { scene?: number | null; panel?: number | null; moment?: number | null }) => {
    if (opts.scene !== undefined) setSceneId(opts.scene);
    if (opts.panel !== undefined) setPanelId(opts.panel);
    if (opts.moment !== undefined) setMomentId(opts.moment);
  };
  const closeDrawer = () => select({ panel: null, moment: null });

  // Keyboard: ⌘Z / ⇧⌘Z (not while typing), Esc closes the drawer.
  const kb = useRef({ undo: board.undo, redo: board.redo, closeDrawer, escape: () => {} });
  kb.current = {
    undo: board.undo,
    redo: board.redo,
    closeDrawer,
    // Esc closes the topmost layer: preview, then brief, then the drawer.
    escape: () => (preview ? setPreview(null) : briefOpen ? setBriefOpen(false) : closeDrawer()),
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) void kb.current.redo();
        else void kb.current.undo();
      }
      if (e.key === 'Escape') kb.current.escape();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (projectId === undefined) {
    return <div className="flex h-full items-center justify-center bg-bd-bg text-bd-muted">Select a project to open its board.</div>;
  }
  if (!tree || !scene) {
    return (
      <div className="flex h-full items-center justify-center bg-bd-bg text-bd-muted">
        {board.error ?? (board.loading || !tree ? 'Loading board…' : 'This cut has no scenes yet. Ask Claude to draft one, or add a scene.')}
        {tree && !scene && (
          <button className={`${btnGhost} ml-3`} onClick={() => void actions.addScene('Scene 1')}>{'＋'} Add scene</button>
        )}
      </div>
    );
  }

  const sceneIdx = scenes.indexOf(scene);

  const addPanel = async () => {
    const r = await actions.addPanel(scene.id, { intent: 'New shot' });
    if (r) select({ panel: r.id, moment: null });
  };
  const dropMoment = async (mid: number, pid: number | null) => {
    const m = momentsById.get(mid);
    if (!m) return;
    if (pid === null) {
      const r = await actions.addPanel(scene.id, { moment_id: mid, intent: intentFrom(m.description) }, 'Add moment as new panel');
      if (r) select({ panel: r.id, moment: null });
    } else {
      const f = findPanel(pid)!;
      const r = await actions.placeMoment(pid, mid, `Place moment in panel ${f.scene.panels.indexOf(f.panel) + 1}`);
      if (r) select({ panel: pid, moment: null });
    }
  };
  const placeSelectedMoment = async (m: BoardMoment) => {
    if (placeTarget) {
      const no = placeTarget.scene.panels.indexOf(placeTarget.panel) + 1;
      const r = await actions.placeMoment(placeTarget.panel.id, m.id, `Place moment in panel ${no}`);
      if (r) select({ panel: placeTarget.panel.id, moment: null });
    } else {
      const r = await actions.addPanel(scene.id, { moment_id: m.id, intent: intentFrom(m.description) }, `Add moment to “${scene.name}”`);
      if (r) select({ panel: r.id, moment: null });
    }
  };

  const openPreview = (list: BoardScene[]) => {
    setPreview(list.flatMap((s) => s.panels.map((panel) => ({ scene: s, panel, src: panelMedia(panel, momentsById).src }))));
  };
  const doExport = async () => {
    if (board.cutId === null) return;
    setExporting(true);
    try {
      const r = await exportCut(board.cutId, 'otio');
      board.say(`Wrote ${r.path} \u2014 ${r.clips} clips, ${r.scenes} scene markers, ${r.skipped_gaps} gaps skipped`, false, true);
    } catch (err) {
      board.say(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-bd-bg text-[13px] leading-[1.45] text-bd-text">
      <BoardToolbar
        projectName={projectName || 'Project'}
        cutName={tree.cut.name}
        brief={tree.brief}
        briefState={tree.brief_state}
        total={cutLength(scenes)}
        toChooseCount={choose.length}
        history={history}
        onNextChoose={() => choose[0] && select({ scene: choose[0].sceneId, panel: choose[0].panelId, moment: null })}
        onUndo={board.undo}
        onRedo={board.redo}
        onBrief={() => setBriefOpen(true)}
        onPreview={() => openPreview(scenes)}
        onExport={() => void doExport()}
        exporting={exporting}
      />

      <div className="relative grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)] overflow-hidden">
        <SceneNav
          scenes={scenes}
          selectedId={scene.id}
          onSelect={(id) => select({ scene: id, panel: null, moment: null })}
          onAdd={async () => {
            const r = await actions.addScene('New scene', sceneIdx + 1);
            if (r) select({ scene: r.id, panel: null, moment: null });
          }}
          onMove={(dir) => void actions.moveScene(scene.id, sceneIdx + dir)}
          onDelete={async () => {
            const next = scenes[sceneIdx - 1] ?? scenes[sceneIdx + 1];
            const r = await actions.deleteScene(scene.id, scene.name);
            if (r) select({ scene: next?.id ?? null, panel: null });
          }}
        />

        <main className="overflow-auto px-[22px] pb-[60px] pt-4">
          <div className="mb-3 flex items-baseline gap-3">
            <SceneTitle name={scene.name} onRename={(n) => void actions.renameScene(scene.id, n)} />
            <span className="text-bd-muted">
              {scene.event?.name ?? ''} {'·'} {scene.panels.length} panels {'·'} {fmtClock(sceneLength(scene))}
            </span>
            <div className="flex-1" />
            <button className={btnGhost} onClick={() => openPreview([scene])}>{'\u25b6'} Scene</button>
          </div>

          <PanelStrip
            panels={scene.panels}
            selectedId={selPanel?.panel.id ?? null}
            momentsById={momentsById}
            onSelect={(id) => {
              select({ panel: panelId === id ? null : id, moment: null });
              setPanelTarget(panelId === id ? null : id);
            }}
            onAdd={addPanel}
            onDropMoment={dropMoment}
          />

          <MomentPool
            moments={moments}
            eventId={scene.event_id}
            usage={usage}
            selectedId={momentId}
            onSelect={(id) => {
              if (panelId !== null) setPanelTarget(panelId);
              select({ moment: id, panel: null });
            }}
          />
        </main>

        <aside
          className={`absolute bottom-0 right-0 top-0 z-10 w-[min(460px,100%)] overflow-auto border-l border-bd-line2 bg-bd-s1 px-[18px] pb-[30px] pt-4 shadow-[-20px_0_40px_#0008] transition-transform duration-[180ms] ease-out ${
            drawerOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          {selPanel && (
            <PanelDrawer
              key={selPanel.panel.id}
              panel={selPanel.panel}
              scene={selPanel.scene}
              momentsById={momentsById}
              allMoments={moments}
              onClose={closeDrawer}
              onSpeed={(v) => void actions.patchPanel(selPanel.panel.id, { speed: v }, `Speed ${v * 100} %`)}
              onPick={(mid) => void actions.pickCandidate(selPanel.panel.id, mid)}
              onTrim={(a, b) => void actions.patchPanel(selPanel.panel.id, { start_sec: a, end_sec: b }, 'Trim panel')}
              onIntent={(t) => void actions.patchPanel(selPanel.panel.id, { intent: t }, 'Edit intent')}
              onMove={(dir) => void actions.movePanel(selPanel.panel.id, selPanel.scene.id, selPanel.scene.panels.indexOf(selPanel.panel) + dir)}
              onDelete={async () => {
                const r = await actions.deletePanel(selPanel.panel.id, selPanel.scene.panels.indexOf(selPanel.panel) + 1);
                if (r) select({ panel: null });
              }}
            />
          )}
          {!selPanel && selMoment && (
            <MomentDrawer
              key={selMoment.id}
              moment={selMoment}
              sameClip={moments.filter((m) => m.clip_id === selMoment.clip_id)}
              sceneName={scene.name}
              target={placeTarget ? { no: placeTarget.scene.panels.indexOf(placeTarget.panel) + 1 } : null}
              canUndoReject={Boolean(history.can_undo && history.undo_label && /^(\u{1F44E}|Reject moment)/u.test(history.undo_label))}
              onClose={closeDrawer}
              onPlace={() => void placeSelectedMoment(selMoment)}
              onReject={async (reason) => {
                const r = await actions.rejectMoment(selMoment.id, reason);
                if (r) select({ moment: null });
              }}
              onHide={async () => {
                const r = await actions.hideClip(selMoment.clip_id, selMoment.clip?.file_name ?? `clip ${selMoment.clip_id}`);
                if (r) select({ moment: null });
              }}
              onUnhide={() => void actions.unhideClip(selMoment.clip_id, selMoment.clip?.file_name ?? `clip ${selMoment.clip_id}`)}
              onUndoReject={() => void board.undo()}
            />
          )}
        </aside>
      </div>

      {briefOpen && (
        <BriefModal
          brief={tree.brief}
          state={tree.brief_state}
          momentsById={momentsById}
          onClose={() => setBriefOpen(false)}
          onConfirm={async (b) => {
            const r = await actions.saveBrief(b, 'confirmed');
            if (r) setBriefOpen(false);
          }}
        />
      )}
      {preview && <PreviewModal items={preview} onClose={() => setPreview(null)} />}

      <Toast toast={board.toast} onUndo={() => void board.undo()} />
    </div>
  );
}
