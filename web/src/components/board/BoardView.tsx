import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchProjects } from '../../api/client';
import { useBoard } from '../../board/useBoard';
import { cutLength, fmtClock, sceneLength, toChoose } from '../../board/logic';
import { starTarget, storyLink } from '../../board/drawer';
import { alternatives, otherInEvent, usage as usageOfTree } from '../../board/pool';
import type { BoardMoment, BoardPanel, BoardScene, PM } from '../../board/types';
import { BoardToolbar } from './BoardToolbar';
import { SceneNav } from './SceneNav';
import { PanelStrip } from './PanelStrip';
import { MomentPool } from './MomentPool';
import { PanelDrawer } from './PanelDrawer';
import { MomentDrawer } from './MomentDrawer';
import { BriefModal } from './BriefModal';
import { PreviewModal, type PreviewItem } from './PreviewModal';
import { panelMedia } from './media';
import { exportCut, revealClip, putSelection } from '../../board/api';
import { selectionKey, type SelectionBody } from '../../board/refresh';
import { Toast } from './Toast';
import { btnGhost, intentFrom } from './ui';

type Open =
  | { kind: 'panel'; slot: number; preview: number | null }
  | { kind: 'moment'; mid: number; othersOpen: boolean }
  | null;

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
  /** Which drawer is open, by what was clicked: a panel in the strip, or a moment in the pool. */
  const [open, setOpen] = useState<Open>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (projectId === undefined) return;
    fetchProjects().then((r) => setProjectName(r.data.find((p) => p.id === projectId)?.name ?? '')).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    setSceneId(null);
    setOpen(null);
  }, [projectId, board.cutId]);

  const scenes: BoardScene[] = tree?.scenes ?? [];
  const scene = scenes.find((s) => s.id === sceneId) ?? scenes[0] ?? null;
  const momentsById = useMemo(() => new Map<number, BoardMoment>(moments.map((m) => [m.id, m])), [moments]);
  const pms = useMemo(() => moments.filter((m): m is PM => !!m.clip), [moments]);
  const pmById = useMemo(() => new Map<number, PM>(pms.map((m) => [m.id, m])), [pms]);
  const usage = useMemo(() => usageOfTree({ scenes }), [scenes]);
  const choose = useMemo(() => toChoose(scenes), [scenes]);

  const findPanel = (id: number | null): { panel: BoardPanel; scene: BoardScene } | null => {
    if (id === null) return null;
    for (const s of scenes) {
      const p = s.panels.find((x) => x.id === id);
      if (p) return { panel: p, scene: s };
    }
    return null;
  };
  const selPanel = open?.kind === 'panel' ? findPanel(open.slot) : null;
  const selMoment = open?.kind === 'moment' ? pmById.get(open.mid) ?? null : null;
  const drawerKind: 'panel' | 'moment' | null = selPanel ? 'panel' : selMoment ? 'moment' : null;
  const panelCurrentId = (p: BoardPanel): number | null =>
    p.state === 'filled' ? p.moment_id : p.state === 'candidates' ? p.candidates[0]?.id ?? null : null;
  const curMoment = selPanel ? pmById.get(panelCurrentId(selPanel.panel) ?? -1) ?? null : null;
  const shownMoment = selPanel ? (open?.kind === 'panel' && open.preview !== null ? pmById.get(open.preview) ?? null : curMoment) : null;

  // Opening a moment (or previewing one in a panel drawer) marks it seen.
  const viewedId = selMoment?.id ?? shownMoment?.id ?? null;
  const setSeen = board.setSeen;
  useEffect(() => {
    if (viewedId !== null) setSeen(viewedId, true);
  }, [viewedId, setSeen, moments.length]);

  const drawerRef = useRef<HTMLElement>(null);
  const drawerKey = `${drawerKind}:${selPanel?.panel.id ?? selMoment?.id ?? ''}`;
  useEffect(() => {
    drawerRef.current?.scrollTo?.({ top: 0 });
  }, [drawerKey]);

  // Tell the server what is selected (debounced; deduped by key) so `clippilot board context` can answer "this panel".
  const selBody: SelectionBody | null = board.cutId !== null && scene
    ? {
      cut_id: board.cutId,
      scene_id: selPanel?.scene.id ?? scene.id,
      panel_id: selPanel?.panel.id ?? null,
      moment_id: selMoment?.id ?? null,
      drawer: drawerKind,
      preview_moment_id: selPanel && open?.kind === 'panel' ? open.preview : null,
    }
    : null;
  const selKey = selBody ? selectionKey(selBody) : null;
  const selRef = useRef(selBody);
  selRef.current = selBody;
  useEffect(() => {
    if (selKey === null) return;
    const t = setTimeout(() => {
      if (selRef.current) putSelection(selRef.current).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [selKey]);

  const closeDrawer = () => setOpen(null);
  const openPanel = (id: number, preview?: number) => {
    if (open?.kind === 'panel' && open.slot === id && preview === undefined) return setOpen(null);
    const f = findPanel(id);
    if (!f) return;
    setSceneId(f.scene.id);
    setOpen({ kind: 'panel', slot: id, preview: preview ?? null });
  };
  const openMoment = (mid: number) =>
    setOpen(open?.kind === 'moment' && open.mid === mid ? null : { kind: 'moment', mid, othersOpen: false });

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
  const toast = board.say;

  const addPanel = async () => {
    const r = await actions.addPanel(scene.id, { intent: 'New shot' });
    if (r) setOpen({ kind: 'panel', slot: r.id, preview: null });
  };
  const dropMoment = async (mid: number, pid: number | null) => {
    const m = momentsById.get(mid);
    if (!m) return;
    if (pid === null) {
      const r = await actions.addPanel(scene.id, { moment_id: mid, intent: intentFrom(m.description) }, 'Add moment as new panel');
      if (r) setOpen({ kind: 'panel', slot: r.id, preview: null });
    } else {
      const f = findPanel(pid)!;
      const r = await actions.placeMoment(pid, mid, `Place moment in panel ${f.scene.panels.indexOf(f.panel) + 1}`);
      if (r) setOpen({ kind: 'panel', slot: pid, preview: null });
    }
  };
  /** "Use this in panel N": a candidate is picked, anything else is placed. */
  const useInPanel = async (f: { panel: BoardPanel; scene: BoardScene }, m: PM) => {
    const no = f.scene.panels.indexOf(f.panel) + 1;
    const isCandidate = f.panel.state === 'candidates' && f.panel.candidates.some((c) => c.id === m.id);
    const r = isCandidate ? await actions.pickCandidate(f.panel.id, m.id) : await actions.placeMoment(f.panel.id, m.id, `Use moment in panel ${no}`);
    if (r) setOpen({ kind: 'panel', slot: f.panel.id, preview: null });
  };
  const trim = (m: PM, a: number, b: number) => void actions.patchMoment(m.id, { start_sec: a, end_sec: b }, 'Trim moment');
  const speed = (m: PM, v: number) => void actions.patchMoment(m.id, { speed: v }, `Speed ${Math.round(v * 100)} %`);

  const openPreview = (list: BoardScene[]) => {
    setPreview(list.flatMap((s) => s.panels.map((panel) => ({ scene: s, panel, src: panelMedia(panel, momentsById).src }))));
  };
  const doExport = async () => {
    if (board.cutId === null) return;
    setExporting(true);
    try {
      const r = await exportCut(board.cutId, 'otio');
      board.say(`Wrote ${r.path} — ${r.clips} clips, ${r.scenes} scene markers, ${r.skipped_gaps} gaps skipped`, false, true);
    } catch (err) {
      board.say(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  const eventName = (m: PM) => scenes.find((s) => s.event?.id === m.clip.event_id)?.event?.name ?? '';
  const panelNo = (f: { panel: BoardPanel; scene: BoardScene }) => f.scene.panels.indexOf(f.panel) + 1;

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-bd-bg text-[13px] leading-[1.45] text-bd-text">
      <BoardToolbar
        projectName={projectName || 'Project'}
        cutId={tree.cut.id}
        cutName={tree.cut.name}
        cuts={board.cuts}
        onSelectCut={board.selectCut}
        brief={tree.brief}
        briefState={tree.brief_state}
        total={cutLength(scenes)}
        toChooseCount={choose.length}
        history={history}
        onNextChoose={() => choose[0] && openPanel(choose[0].panelId)}
        onUndo={board.undo}
        onRedo={board.redo}
        onBrief={() => setBriefOpen(true)}
        onPreview={() => openPreview(scenes)}
        onExport={() => void doExport()}
        exporting={exporting}
      />

      {/* The drawer is a real grid column: it pushes the board aside. Below 900 px it is a full-screen sheet. */}
      <div
        className="grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)_var(--dw)] overflow-hidden transition-[grid-template-columns] duration-[180ms] ease-out max-[900px]:grid-cols-[minmax(0,1fr)] max-[900px]:grid-rows-[auto_minmax(0,1fr)]"
        style={{ '--dw': drawerKind ? 'min(480px,42vw)' : '0px' } as React.CSSProperties}
      >
        <SceneNav
          scenes={scenes}
          selectedId={scene.id}
          onSelect={(id) => {
            setSceneId(id);
            setOpen(null);
          }}
          onAdd={async () => {
            const r = await actions.addScene('New scene', sceneIdx + 1, scene.event_id);
            if (r) {
              setSceneId(r.id);
              setOpen(null);
            }
          }}
          onMove={(dir) => void actions.moveScene(scene.id, sceneIdx + dir)}
          onDelete={async () => {
            const next = scenes[sceneIdx - 1] ?? scenes[sceneIdx + 1];
            const r = await actions.deleteScene(scene.id, scene.name);
            if (r) {
              setSceneId(next?.id ?? null);
              setOpen(null);
            }
          }}
        />

        <main className="min-w-0 overflow-auto px-[22px] pb-[60px] pt-4 max-[900px]:px-4 max-[900px]:pt-3">
          <div className="mb-3 flex items-baseline gap-3">
            <SceneTitle name={scene.name} onRename={(n) => void actions.renameScene(scene.id, n)} />
            <span className="text-bd-muted">
              {scene.event?.name ?? ''} {'·'} {scene.panels.length} panels {'·'} {fmtClock(sceneLength(scene))}
            </span>
            <div className="flex-1" />
            <button className={btnGhost} onClick={() => openPreview([scene])}>{'▶'} Scene</button>
          </div>

          <PanelStrip
            panels={scene.panels}
            selectedId={selPanel?.panel.id ?? null}
            compact={drawerKind !== null}
            momentsById={momentsById}
            onSelect={(id) => openPanel(id)}
            onAdd={addPanel}
            onDropMoment={dropMoment}
          />

          <MomentPool
            moments={pms}
            eventId={scene.event_id}
            usage={usage}
            currentSceneIndex={sceneIdx}
            selectedId={selMoment?.id ?? (selPanel ? shownMoment?.id ?? null : null)}
            onSelect={openMoment}
            onSeen={(id) => setSeen(id, true)}
          />
        </main>

        <aside
          ref={drawerRef}
          className={`col-start-3 min-w-0 overflow-auto px-4 pb-[30px] pt-3.5 max-[900px]:fixed max-[900px]:inset-0 max-[900px]:z-[15] max-[900px]:border-l-0 ${
            drawerKind === 'panel'
              ? 'border-l-[3px] border-bd-attn bg-[color-mix(in_srgb,var(--color-bd-attn)_6%,var(--color-bd-s1))]'
              : 'border-l border-bd-line2 bg-bd-s1'
          } ${drawerKind ? '' : 'hidden'}`}
        >
          {selPanel && (
            <PanelDrawer
              key={selPanel.panel.id}
              panel={selPanel.panel}
              scene={selPanel.scene}
              current={curMoment}
              shown={shownMoment}
              moments={pms}
              momentsById={momentsById}
              usage={usage}
              currentSceneIndex={sceneIdx}
              onPreview={(id) => setOpen({ kind: 'panel', slot: selPanel.panel.id, preview: id })}
              onUse={(m) => void useInPanel(selPanel, m)}
              onClose={closeDrawer}
              onSpeed={speed}
              onTrim={trim}
              onIntent={(t) => void actions.patchPanel(selPanel.panel.id, { intent: t }, 'Edit intent')}
              onMove={(dir) => void actions.movePanel(selPanel.panel.id, selPanel.scene.id, selPanel.scene.panels.indexOf(selPanel.panel) + dir)}
              onDelete={async () => {
                const r = await actions.deletePanel(selPanel.panel.id, panelNo(selPanel));
                if (r) closeDrawer();
              }}
              onReview={(mid) => setOpen({ kind: 'moment', mid, othersOpen: false })}
              onPanel={(id) => openPanel(id)}
              onSeen={(id) => setSeen(id, true)}
            />
          )}
          {!selPanel && selMoment && open?.kind === 'moment' && (
            <MomentDrawer
              key={selMoment.id}
              moment={selMoment}
              clipMoments={pms.filter((m) => m.clip_id === selMoment.clip_id)}
              usage={usage}
              currentSceneIndex={sceneIdx}
              eventName={eventName(selMoment)}
              sceneName={scene.name}
              story={storyLink(selMoment, { scenes }, pms, scene.id)}
              similar={alternatives(selMoment, pms) as PM[]}
              others={otherInEvent(selMoment, pms) as PM[]}
              othersOpen={open.othersOpen}
              onToggleOthers={() => setOpen({ ...open, othersOpen: !open.othersOpen })}
              onClose={closeDrawer}
              onSelect={(mid) => setOpen({ kind: 'moment', mid, othersOpen: open.othersOpen })}
              onOpenMoment={(mid) => setOpen({ kind: 'moment', mid, othersOpen: false })}
              onFinder={() => revealClip(selMoment.clip_id).catch((err) => toast(err instanceof Error ? err.message : String(err)))}
              onStar={() => {
                const t = starTarget(selMoment);
                void actions.patchMoment(selMoment.id, { tier: t }, t === 'hero' ? '★' : 'Remove ★');
              }}
              onReject={(reason) => void actions.rejectMoment(selMoment.id, reason)}
              onRestore={() =>
                void (selMoment.status === 'rejected'
                  ? actions.unrejectMoment(selMoment.id)
                  : actions.unhideClip(selMoment.clip_id, selMoment.clip.file_name))}
              onUnseen={() => {
                setSeen(selMoment.id, false);
                toast('Marked unseen');
              }}
              onSpeed={(v) => speed(selMoment, v)}
              onTrim={(a, b) => trim(selMoment, a, b)}
              onOpenPanel={(id) => openPanel(id)}
              onCompare={(id) => openPanel(id, selMoment.id)}
              onAdd={() => void actions.addPanel(scene.id, { moment_id: selMoment.id, intent: intentFrom(selMoment.description) }, `Add moment to “${scene.name}”`)}
              onHide={() => void actions.hideClip(selMoment.clip_id, selMoment.clip.file_name)}
              onSeen={(id) => setSeen(id, true)}
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
