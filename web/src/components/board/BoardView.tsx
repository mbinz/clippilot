import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchEvents, fetchProjects } from '../../api/client';
import { useBoard } from '../../board/useBoard';
import { cutLength, fmtClock, sceneLength, toChoose } from '../../board/logic';
import { moveTarget } from '../../board/grid';
import { starTarget } from '../../board/drawer';
import { ghostSlot, isOut, placementScene, poolMark, usage as usageOfTree, type PoolMark } from '../../board/pool';
import { afterUse, candidateRow, nextPanel } from '../../board/panelview';
import type { BoardMoment, BoardPanel, BoardScene, PM } from '../../board/types';
import { BoardToolbar } from './BoardToolbar';
import { SceneNav } from './SceneNav';
import { PanelStrip } from './PanelStrip';
import { MomentPool } from './MomentPool';
import { PanelView } from './PanelView';
import { PlacementView } from './PlacementView';
import { BriefModal } from './BriefModal';
import { PreviewModal, type PreviewItem } from './PreviewModal';
import { panelMedia } from './media';
import { exportCut, revealClip, putSelection } from '../../board/api';
import { selectionKey, type SelectionBody } from '../../board/refresh';
import { Toast } from './Toast';
import { btnGhost, btnPrimary, intentFrom } from './ui';

type Open =
  | { kind: 'panel'; slot: number; preview: number | null }
  /** Placement of a new moment: the ghost sits at insert slot `slot` of scene `sceneId` (null = no scene for its event yet). */
  | { kind: 'place'; mid: number; sceneId: number | null; slot: number }
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
  const [eventNames, setEventNames] = useState<Map<number, string>>(new Map());
  const [sceneId, setSceneId] = useState<number | null>(null);
  /** What is open: the panel view under a panel's row (`preview` = the chosen right-hand candidate), or a placement (ghost). */
  const [open, setOpen] = useState<Open>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (projectId === undefined) return;
    fetchProjects().then((r) => setProjectName(r.data.find((p) => p.id === projectId)?.name ?? '')).catch(() => {});
    fetchEvents(projectId).then((r) => setEventNames(new Map(r.data.map((e) => [e.id, e.name])))).catch(() => {});
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
  /** The moment being placed (its ghost), if any; `placeScene` is null while the event has no scene yet. */
  const placing = open?.kind === 'place' ? pmById.get(open.mid) ?? null : null;
  const placeScene = open?.kind === 'place' && open.sceneId !== null ? scenes.find((s) => s.id === open.sceneId) ?? null : null;
  const panelCurrentId = (p: BoardPanel): number | null =>
    p.state === 'filled' ? p.moment_id : p.state === 'candidates' ? p.candidates[0]?.id ?? null : null;
  const curMoment = selPanel ? pmById.get(panelCurrentId(selPanel.panel) ?? -1) ?? null : null;
  const row = useMemo(
    () => (selPanel ? candidateRow(selPanel.panel, { scenes }, pms).flatMap((c) => { const m = pmById.get(c.id); return m ? [{ m, c }] : []; }) : []),
    [selPanel, scenes, pms, pmById],
  );
  // Right-hand candidate: the one chosen (row click, ←/→, timeline, pool "compare"), else the first of the row.
  const chosenId = selPanel && open?.kind === 'panel' && open.preview !== null && open.preview !== curMoment?.id ? open.preview : null;
  const rightMoment = selPanel ? (chosenId !== null ? pmById.get(chosenId) : undefined) ?? row[0]?.m ?? null : null;

  // Opening a moment, or showing one in the panel view, marks it seen.
  const viewedKey = [placing?.id, curMoment?.id, rightMoment?.id].filter((x) => x !== undefined).join(',');
  const setSeen = board.setSeen;
  useEffect(() => {
    for (const id of viewedKey.split(',')) if (id) setSeen(Number(id), true);
  }, [viewedKey, setSeen, moments.length]);

  // Tell the server what is selected (debounced; deduped by key) so `clippilot board context` can answer "this panel".
  const selBody: SelectionBody | null = board.cutId !== null && scene
    ? {
      cut_id: board.cutId,
      scene_id: selPanel?.scene.id ?? placeScene?.id ?? scene.id,
      panel_id: selPanel?.panel.id ?? null,
      // a placement reports as the "moment" focus of the selection (the server's `drawer: 'moment'`)
      moment_id: placing?.id ?? null,
      drawer: selPanel ? 'panel' : placing ? 'moment' : null,
      preview_moment_id: selPanel ? rightMoment?.id ?? null : null,
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
  const openPanel = (id: number, preview?: number, keepOpen = false) => {
    if (!keepOpen && open?.kind === 'panel' && open.slot === id && preview === undefined) return setOpen(null);
    const f = findPanel(id);
    if (!f) return;
    setSceneId(f.scene.id);
    setOpen({ kind: 'panel', slot: id, preview: preview ?? null });
  };
  /** Click / double-click on a pool tile: ≈ N opens panel N with the moment on the right; a new one starts its placement. */
  const poolClick = (m: PM, mark: PoolMark) => {
    if (isOut(m)) return;
    if (mark.kind === 'similar') return openPanel(mark.panelId, m.id, true);
    const target = placementScene(m, { scenes }, pms, scene.id);
    const ts = scenes.find((s) => s.id === target);
    if (ts) setSceneId(ts.id);
    setOpen({ kind: 'place', mid: m.id, sceneId: ts?.id ?? null, slot: ts ? ghostSlot(m, ts, pms) : 0 });
  };

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

  const addPanel = async (position?: number) => {
    const r = await actions.addPanel(scene.id, { intent: 'New shot', position });
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
  const insertMoment = async (mid: number, position: number, intoSceneId = scene.id) => {
    const m = momentsById.get(mid);
    if (!m) return;
    const r = await actions.addPanel(intoSceneId, { moment_id: mid, position, intent: intentFrom(m.description) }, 'Add moment as new panel');
    if (r) setOpen({ kind: 'panel', slot: r.id, preview: null });
  };
  /** "New scene for <event>", then the placed moment goes in as its first panel. */
  const newSceneForPlacing = async () => {
    if (!placing) return;
    const name = eventNames.get(placing.clip.event_id ?? -1) ?? 'New scene';
    const r = await actions.addScene(name, sceneIdx + 1, placing.clip.event_id);
    if (!r) return;
    setSceneId(r.id);
    await insertMoment(placing.id, 0, r.id);
  };
  /** The ghost was dropped on an empty / CHOOSE panel: fill / decide that panel with the moment. */
  const ghostOnPanel = (panelId: number) => {
    const f = findPanel(panelId);
    if (f && placing) void useInPanel(f, placing);
  };
  /** A panel dropped on a scene in the nav: to the end of that scene. */
  const dropPanelOnScene = (panelId: number, targetId: number) => {
    const target = scenes.find((s) => s.id === targetId);
    if (!target) return;
    const pos = moveTarget(target.panels.map((p) => p.id), panelId, target.panels.length);
    if (pos !== null) void actions.movePanel(panelId, targetId, pos);
  };
  /** "Use this in panel N": a candidate is picked, anything else is placed. */
  const useInPanel = async (f: { panel: BoardPanel; scene: BoardScene }, m: PM) => {
    const no = f.scene.panels.indexOf(f.panel) + 1;
    const isCandidate = f.panel.state === 'candidates' && f.panel.candidates.some((c) => c.id === m.id);
    const prev = panelCurrentId(f.panel);
    const r = isCandidate ? await actions.pickCandidate(f.panel.id, m.id) : await actions.placeMoment(f.panel.id, m.id, `Use moment in panel ${no}`);
    // The panel is yours now; what was in it becomes the right-hand candidate (using it again swaps back).
    if (r) setOpen({ kind: 'panel', slot: f.panel.id, preview: afterUse(prev === m.id ? null : prev, []) });
  };
  /** Tab / Shift+Tab: the next / previous panel in cut order, across scenes. */
  const stepPanel = (dir: 1 | -1) => {
    const id = selPanel ? nextPanel({ scenes }, selPanel.panel.id, dir) : null;
    const f = findPanel(id);
    if (!f) return;
    setSceneId(f.scene.id);
    setOpen({ kind: 'panel', slot: f.panel.id, preview: null });
  };
  const nextChoose = () => {
    const c = choose.find((x) => x.panelId !== selPanel?.panel.id) ?? choose[0];
    if (c) openPanel(c.panelId, undefined, true);
  };
  const starMoment = (m: PM) => {
    const t = starTarget(m);
    void actions.patchMoment(m.id, { tier: t }, t === 'hero' ? '★' : 'Remove ★');
  };
  /** "New moment" from a selection: it becomes the right-hand candidate of the open panel view, or replaces the placed moment. */
  const createMoment = async (clipId: number, a: number, b: number) => {
    const r = await actions.createMoment(clipId, a, b);
    if (!r) return;
    if (open?.kind === 'panel') setOpen({ ...open, preview: r.id });
    else if (open?.kind === 'place') setOpen({ ...open, mid: r.id });
  };
  const trim = (m: PM, a: number, b: number) => void actions.patchMoment(m.id, { start_sec: a, end_sec: b }, 'Trim moment');
  const describe = (m: PM, text: string) => void actions.patchMoment(m.id, { description: text }, 'Edit description');
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
        onNextChoose={nextChoose}
        onUndo={board.undo}
        onRedo={board.redo}
        onBrief={() => setBriefOpen(true)}
        onPreview={() => openPreview(scenes)}
        onExport={() => void doExport()}
        exporting={exporting}
      />

      <div className="grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)] overflow-hidden max-[900px]:grid-cols-[minmax(0,1fr)] max-[900px]:grid-rows-[auto_minmax(0,1fr)]">
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
          onDropPanel={dropPanelOnScene}
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
            momentsById={momentsById}
            onSelect={(id) => openPanel(id)}
            onAdd={addPanel}
            onDropMoment={dropMoment}
            onInsertMoment={insertMoment}
            onMovePanel={(id, pos) => void actions.movePanel(id, scene.id, pos)}
            ghost={placing && placeScene && placeScene.id === scene.id ? { moment: placing, slot: Math.min(open?.kind === 'place' ? open.slot : 0, scene.panels.length) } : undefined}
            onMoveGhost={(slot) => open?.kind === 'place' && setOpen({ ...open, slot })}
            onGhostOnPanel={ghostOnPanel}
            view={placing && placeScene && placeScene.id === scene.id && open?.kind === 'place' ? (
              <PlacementView
                key={placing.id}
                moment={placing}
                scene={placeScene}
                slot={Math.min(open.slot, placeScene.panels.length)}
                moments={pms}
                usage={usage}
                keysOn={!preview && !briefOpen}
                onInsert={() => void insertMoment(placing.id, Math.min(open.slot, placeScene.panels.length), placeScene.id)}
                onShift={(dir) => setOpen({ ...open, slot: Math.max(0, Math.min(placeScene.panels.length, open.slot + dir)) })}
                onCancel={closeDrawer}
                onPick={(id) => {
                  const m = pmById.get(id);
                  if (m) poolClick(m, poolMark(m, { scenes }, pms, scene.id));
                }}
                onCreate={(clipId, a, b) => void createMoment(clipId, a, b)}
                onDescribe={describe}
              />
            ) : selPanel && selPanel.scene.id === scene.id ? (
              <PanelView
                key={selPanel.panel.id}
                panel={selPanel.panel}
                scene={selPanel.scene}
                left={curMoment}
                right={rightMoment}
                row={row}
                moments={pms}
                usage={usage}
                currentSceneIndex={sceneIdx}
                keysOn={!preview && !briefOpen}
                onClose={closeDrawer}
                onSelect={(id) => setOpen({ kind: 'panel', slot: selPanel.panel.id, preview: id })}
                onUse={(m) => void useInPanel(selPanel, m)}
                onDropUse={(mid) => {
                  const m = pmById.get(mid);
                  if (m) void useInPanel(selPanel, m);
                }}
                onStep={stepPanel}
                onNextChoose={nextChoose}
                onTrim={trim}
                onCreate={(clipId, a, b) => void createMoment(clipId, a, b)}
                onSpeed={speed}
                onDescribe={describe}
                onIntent={(t) => void actions.patchPanel(selPanel.panel.id, { intent: t }, 'Edit intent')}
                onDelete={async () => {
                  const r = await actions.deletePanel(selPanel.panel.id, panelNo(selPanel));
                  if (r) closeDrawer();
                }}
                onStar={starMoment}
                onReject={(m, reason) => void actions.rejectMoment(m.id, reason)}
                onSeen={(id, seen) => {
                  setSeen(id, seen);
                  if (!seen) toast('Marked unseen');
                }}
                onFinder={(m) => revealClip(m.clip_id).catch((err) => toast(err instanceof Error ? err.message : String(err)))}
                onHide={(m) => void actions.hideClip(m.clip_id, m.clip.file_name)}
              />
            ) : undefined}
          />

          {/* No scene for the placed moment's event yet: offer one. */}
          {placing && open?.kind === 'place' && !placeScene && (
            <div className="mb-3 flex flex-wrap items-center gap-2.5 rounded-xl border border-dashed border-bd-ai px-3.5 py-2.5">
              <span className="text-bd-muted">
                No scene for {eventNames.get(placing.clip.event_id ?? -1) ?? 'this moment\u2019s event'} yet.
              </span>
              <button className={btnPrimary} onClick={() => void newSceneForPlacing()}>
                New scene for {eventNames.get(placing.clip.event_id ?? -1) ?? 'its event'}
              </button>
              <button className={btnGhost} onClick={closeDrawer}>Cancel</button>
            </div>
          )}

          {/* The pool makes room for the panel view and returns when it closes. */}
          {!selPanel && (
            <MomentPool
              moments={pms}
              tree={{ scenes }}
              sceneId={scene.id}
              eventId={scene.event_id}
              usage={usage}
              currentSceneIndex={sceneIdx}
              selectedId={placing?.id ?? null}
              onSelect={poolClick}
              onSeen={(id) => setSeen(id, true)}
              tools={{
                onStar: starMoment,
                onReject: (m, reason) => void actions.rejectMoment(m.id, reason),
                onToggleSeen: (m) => {
                  setSeen(m.id, !m.seen);
                  if (m.seen) toast('Marked unseen');
                },
                onRestore: (m) =>
                  void (m.status === 'rejected' ? actions.unrejectMoment(m.id) : actions.unhideClip(m.clip_id, m.clip.file_name)),
              }}
            />
          )}
        </main>
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
