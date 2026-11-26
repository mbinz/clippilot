import { useEffect, useRef, useState } from 'react';
import type { BoardPanel, BoardScene, PM } from '../../board/types';
import type { Candidate } from '../../board/panelview';
import { dragKind } from '../../board/grid';
import { starLabel } from '../../board/drawer';
import { fitOne, fitTwoUp } from '../../board/fullscreen';
import { isHero, isOut, type UsageEntry } from '../../board/pool';
import { REASONS, btn, btnAttn, btnDanger, btnGhost, btnPrimary, kbd, tagAi, tagMine } from './ui';
import { ClipPlayer } from './ClipPlayer';
import { MomentTile } from './MomentTile';
import { SpeedSegment, kindLabel } from './MomentBits';
import { InlineText } from './InlineText';
import { Spoken } from './Spoken';

export interface PanelViewProps {
  panel: BoardPanel;
  scene: BoardScene;
  /** Left: what is in the panel (the first candidate of a CHOOSE panel); null for an empty panel. */
  left: PM | null;
  /** Right: the candidate to compare; null when there is none. */
  right: PM | null;
  /** Candidate row (pure `candidateRow`), resolved to moments. */
  row: { m: PM; c: Candidate }[];
  moments: PM[];
  usage: Record<number, UsageEntry>;
  currentSceneIndex: number;
  /** Keys are live (off while a modal is open). */
  keysOn: boolean;
  onClose: () => void;
  /** Make this moment the right-hand candidate. */
  onSelect: (momentId: number) => void;
  /** "Use this" for a moment (pick for a CHOOSE candidate, else place). */
  onUse: (m: PM) => void;
  /** A moment (from the pool, the candidate row or the right player) was dropped on the left side. */
  onDropUse: (momentId: number) => void;
  onStep: (dir: 1 | -1) => void;
  onNextChoose: () => void;
  onTrim: (m: PM, a: number, b: number) => void;
  /** "New moment" from a selection on a clip's timeline (BE4). */
  onCreate: (clipId: number, a: number, b: number) => void;
  onSpeed: (m: PM, speed: number) => void;
  onIntent: (text: string) => void;
  /** Inline edit of a moment's description. */
  onDescribe: (m: PM, text: string) => void;
  onDelete: () => void;
  onStar: (m: PM) => void;
  onReject: (m: PM, reason: string) => void;
  onSeen: (momentId: number, seen: boolean) => void;
  onFinder: (m: PM) => void;
  onHide: (m: PM) => void;
}

const typing = (): boolean => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable);
};

type Fs = null | 'both' | 'left' | 'right';

const FS_PAD = 12;
const FS_GAP = 16;
/** Full-screen chrome above / under the picture: header bar, tag row, player controls, timeline + range label. */
const FS_HEADER = 40;
const FS_TAGS = 32;
const FS_CONTROLS = 44;
const FS_TIMELINE = 76;
const FS_TRANSCRIPT = 130;

function useViewport(): { w: number; h: number } {
  const [v, setV] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setV({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return v;
}

const emptyFrame = 'flex aspect-video items-center justify-center rounded-[10px] border border-dashed border-bd-line2 bg-black text-bd-dim';

/** ⋯ menu: show in Finder, hide clip. */
function MoreMenu({ m, onFinder, onHide }: { m: PM; onFinder: (m: PM) => void; onHide: (m: PM) => void }) {
  const [open, setOpen] = useState(false);
  const item = 'block w-full cursor-pointer whitespace-nowrap border-0 bg-transparent px-3 py-1.5 text-left text-bd-text hover:bg-bd-s2';
  return (
    <span className="relative">
      <button className={btnGhost} onClick={() => setOpen((o) => !o)} title="More">{'⋯'}</button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full right-0 z-20 mb-1 overflow-hidden rounded-lg border border-bd-line2 bg-bd-s1 py-1 shadow-lg">
            <button className={item} onClick={() => { setOpen(false); onFinder(m); }}>Show in Finder</button>
            {!m.clip.hidden && <button className={item} onClick={() => { setOpen(false); onHide(m); }}>Hide clip</button>}
          </div>
        </>
      )}
    </span>
  );
}

/** ★ / ✕ / seen / ⋯ of one moment. */
function MomentTools({ m, p }: { m: PM; p: PanelViewProps }) {
  const [reasons, setReasons] = useState(false);
  useEffect(() => setReasons(false), [m.id]);
  const out = isOut(m);
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {out ? (
          <span className="text-bd-muted">{m.status === 'rejected' ? '\u{1F44E} rejected' : 'Clip hidden'}</span>
        ) : (
          <>
            <button
              className={`${btn} ${isHero(m) && m.user_tier ? '!border-bd-mine/50 !text-bd-mine' : ''}`}
              onClick={() => p.onStar(m)}
              title={m.user_tier ? 'Star set by you' : 'Star from the analysis'}
            >
              {starLabel(m)}
            </button>
            <button className={btn} onClick={() => setReasons((r) => !r)} title="Not usable">{'\u{1F44E}'}</button>
          </>
        )}
        <button className={btnGhost} onClick={() => p.onSeen(m.id, !m.seen)}>{m.seen ? 'Mark unseen' : 'Mark seen'}</button>
        <div className="flex-1" />
        <MoreMenu m={m} onFinder={p.onFinder} onHide={p.onHide} />
      </div>
      {reasons && !out && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {REASONS.map((r) => (
            <button
              key={r}
              onClick={() => { setReasons(false); p.onReject(m, r); }}
              className="cursor-pointer rounded-full border border-bd-line bg-transparent px-2.5 py-0.5 text-xs text-bd-bad"
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** Inline edit of the panel's intent: commit on blur / Enter. */
function IntentInput({ panel, onIntent }: { panel: BoardPanel; onIntent: (text: string) => void }) {
  const [intent, setIntent] = useState(panel.intent);
  useEffect(() => setIntent(panel.intent), [panel.id, panel.intent]);
  return (
    <input
      value={intent}
      onChange={(e) => setIntent(e.target.value)}
      onBlur={() => intent !== panel.intent && onIntent(intent)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      placeholder="Intent of this panel"
      className="mt-2 w-full rounded-lg border border-bd-line bg-bd-s2 px-[9px] py-1.5 font-[inherit] text-bd-text"
    />
  );
}

/**
 * The panel view (BE2): two-up of what is in the panel (left) and a candidate (right), the candidate row under them.
 * Mount with `key={panel.id}`. Both players loop their own range and restart together when the right candidate changes.
 */
export function PanelView(p: PanelViewProps) {
  const { panel, scene, left, right } = p;
  const index = scene.panels.findIndex((x) => x.id === panel.id);
  const undecided = panel.state === 'candidates';
  const [sound, setSound] = useState<'left' | 'right'>('left');
  /** Bumped when the right player has (re)started: the left restarts with it. */
  const [restart, setRestart] = useState(0);
  const [dropOver, setDropOver] = useState(false);
  /** Full screen (BE5): both sides, or one side alone with its long timeline and transcript. The players stay mounted. */
  const [fs, setFs] = useState<Fs>(null);
  /** Where Esc / ⤡ goes back to from one side alone: the two-up, or the normal view when it was entered from there. */
  const fsBack = useRef<Fs>(null);
  const [aspect, setAspect] = useState({ left: 16 / 9, right: 16 / 9 });
  const view = useViewport();
  const boxRef = useRef<HTMLElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    boxRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, []);

  // Keep the selected candidate tile visible inside the row (horizontal only: never scroll the page).
  useEffect(() => {
    const box = rowRef.current;
    const tile = box?.querySelector<HTMLElement>('[data-sel="1"]');
    if (!box || !tile) return;
    const b = box.getBoundingClientRect();
    const t = tile.getBoundingClientRect();
    if (t.left < b.left) box.scrollLeft -= b.left - t.left + 8;
    else if (t.right > b.right) box.scrollLeft += t.right - b.right + 8;
  }, [right?.id]);

  const rightIndex = right ? p.row.findIndex((x) => x.m.id === right.id) : -1;
  const latest = useRef({ p, rightIndex });
  latest.current = { p, rightIndex };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { p: q, rightIndex: ri } = latest.current;
      if (!q.keysOn || e.metaKey || e.ctrlKey || e.altKey || typing()) return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const next = e.key === 'ArrowRight' ? q.row[ri + 1] : ri > 0 ? q.row[ri - 1] : undefined;
        if (next) { e.preventDefault(); q.onSelect(next.m.id); }
      } else if (e.key === 'Enter') {
        if (tag === 'BUTTON' || tag === 'A') return; // the focused button handles its own Enter
        if (q.right) { e.preventDefault(); q.onUse(q.right); }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        q.onStep(e.shiftKey ? -1 : 1);
      } else if ((e.key === 'n' || e.key === 'N') && !e.shiftKey) {
        e.preventDefault();
        q.onNextChoose();
      } else if ((e.key === 'f' || e.key === 'F') && !e.shiftKey) {
        e.preventDefault();
        setFs((cur) => (cur ? null : 'both'));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Esc leaves full screen first: caught before the board's own Esc (which closes the panel view).
  useEffect(() => {
    if (!fs) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || typing()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setFs((cur) => (cur === 'left' || cur === 'right' ? fsBack.current : null));
    };
    document.addEventListener('keydown', onEsc, true);
    return () => document.removeEventListener('keydown', onEsc, true);
  }, [fs]);

  // Sound follows the full-screen side; otherwise the toggle.
  const soundSide = fs === 'left' || fs === 'right' ? fs : sound;

  // Full-screen picture sizes (pure `fitTwoUp` / `fitOne`).
  const availW = view.w - 2 * FS_PAD;
  const availH = view.h - 2 * FS_PAD - FS_HEADER - FS_TAGS - FS_CONTROLS;
  const rects = fs === 'both' ? fitTwoUp(availW, availH, aspect.left, aspect.right, FS_GAP) : null;
  const one = fs === 'left' || fs === 'right'
    ? fitOne(availW, availH - FS_TIMELINE - FS_TRANSCRIPT, aspect[fs])
    : null;
  const boxOf = (side: 'left' | 'right') => (rects ? { w: rects[side].w, h: rects[side].h } : one && fs === side ? { w: one.w, h: one.h } : undefined);
  /** Two-up: a column as wide as its picture. One side alone: the whole width (long timeline), the picture centred. */
  const colStyle = (side: 'left' | 'right') => (fs === 'both' ? { width: rects![side].w } : fs === side ? { width: availW } : undefined);
  const fsOpen = (side: Exclude<Fs, null | 'both'>) => (
    <button
      className={btnGhost}
      onClick={() => {
        if (fs !== side) fsBack.current = fs;
        setFs(fs === side ? fsBack.current : side);
      }}
      title={fs === side ? 'Back (Esc)' : 'This side full screen'}
    >
      {fs === side ? '⤡' : '⤢'}
    </button>
  );

  const tone = panel.state === 'gap' ? 'border-dashed border-bd-line2' : panel.source === 'user' && !undecided ? 'border-solid border-bd-mine' : 'border-dashed border-bd-ai';
  const clipMoments = (m: PM) => p.moments.filter((x) => x.clip_id === m.clip_id && !isOut(x));
  const footer = (m: PM) => `${Math.round(m.clip.duration_sec)} s · ${m.clip.file_name}`;

  return (
    <section
      ref={boxRef}
      className={fs
        ? 'fixed inset-0 z-50 flex flex-col overflow-hidden bg-black p-3'
        : 'my-1 w-full rounded-xl border border-bd-line2 bg-bd-s1 p-3.5 max-[900px]:fixed max-[900px]:inset-0 max-[900px]:z-[15] max-[900px]:my-0 max-[900px]:overflow-auto max-[900px]:rounded-none'}
    >
      <div className={`flex flex-wrap items-center gap-2 ${fs ? 'h-10 flex-none' : 'mb-2.5'}`}>
        <span className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-bd-muted">
          Panel {index + 1} of {scene.panels.length} {'·'} {scene.name}
        </span>
        <div className="flex-1" />
        <div className="inline-flex items-center overflow-hidden rounded-lg border border-bd-line text-xs" title="Which side plays sound">
          <span className="px-2 text-bd-dim">{'\u{1F50A}'}</span>
          {(['left', 'right'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSound(s)}
              className={`cursor-pointer border-0 px-2.5 py-1 ${soundSide === s ? 'bg-bd-s2 text-bd-text' : 'bg-transparent text-bd-muted'}`}
            >
              {s}
            </button>
          ))}
        </div>
        <button className={btnGhost} onClick={() => p.onStep(-1)} title="Previous panel (Shift+Tab)">{'‹'}</button>
        <button className={btnGhost} onClick={() => p.onStep(1)} title="Next panel (Tab)">{'›'}</button>
        <button className={btnGhost} onClick={() => setFs(fs ? null : 'both')} title={fs ? 'Leave full screen (Esc)' : 'Full screen (F)'}>{fs ? '⤡' : '⤢'}</button>
        {!fs && <button className={btnGhost} onClick={p.onClose} title="Close (Esc)">{'✕'}</button>}
      </div>

      <div className={fs ? `flex min-h-0 flex-1 justify-center gap-4 overflow-auto ${fs === 'both' ? 'items-center' : 'items-start'}` : 'grid grid-cols-2 gap-4 max-[700px]:grid-cols-1'}>
        {/* left: what is in the panel; a moment dropped here is used */}
        <div
          onDragOver={(e) => {
            if (dragKind(e.dataTransfer.types) !== 'moment') return;
            e.preventDefault();
            setDropOver(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOver(false);
          }}
          onDrop={(e) => {
            if (dragKind(e.dataTransfer.types) !== 'moment') return;
            e.preventDefault();
            setDropOver(false);
            const mid = Number(e.dataTransfer.getData('text/plain'));
            if (mid && mid !== left?.id) p.onDropUse(mid);
          }}
          style={colStyle('left')}
          className={`flex min-w-0 flex-col ${fs ? `flex-none ${fs === 'right' ? 'hidden' : ''} ${fs === 'left' ? 'h-full' : ''}` : `rounded-[10px] border-2 p-2 ${dropOver ? 'border-solid border-bd-focus' : tone}`}`}
        >
          <div className={`mb-1.5 flex items-center gap-2 ${fs ? 'h-[26px]' : ''}`}>
            {panel.state === 'filled' && (panel.source === 'user' ? <span className={tagMine}>{'✓'} YOURS</span> : <span className={tagAi}>AI</span>)}
            {undecided && <span className={tagAi}>AI default {'·'} not decided</span>}
            {panel.state === 'gap' && <span className={kbd}>empty panel</span>}
            <div className="flex-1" />
            {undecided && left && <button className={btnAttn} onClick={() => p.onUse(left)}>Use this</button>}
            {left && fsOpen('left')}
          </div>
          {left ? (
            <>
              <ClipPlayer
                key={left.id}
                moment={left}
                clipMoments={clipMoments(left)}
                usage={p.usage}
                editable={!isOut(left)}
                tone="amber"
                neutralUsage
                muted={soundSide !== 'left'}
                restartToken={restart}
                hint="loops the moment"
                footer={footer(left)}
                onPick={(id) => id !== left.id && p.onSelect(id)}
                onTrim={(a, b) => p.onTrim(left, a, b)}
                onCreate={(a, b) => p.onCreate(left.clip_id, a, b)}
                box={boxOf('left')}
                bare={fs === 'both'}
                onAspect={(a) => setAspect((cur) => ({ ...cur, left: a }))}
              />
              {fs === 'both' ? null : (
                <>
                  <p className="mb-0 mt-2 line-clamp-2 text-[12.5px] text-[#cfd3db]">
                    <InlineText value={left.description} placeholder="Add a description" onSave={(t) => p.onDescribe(left, t)} />
                  </p>
                  {fs === 'left' ? <Spoken moment={left} /> : (
                    <>
                      <IntentInput panel={panel} onIntent={p.onIntent} />
                      {!isOut(left) && <SpeedSegment m={left} onSpeed={(v) => p.onSpeed(left, v)} />}
                      <div className="mt-2.5"><MomentTools m={left} p={p} /></div>
                    </>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <div className={emptyFrame}>empty {'—'} drop or pick a moment</div>
              {!fs && <IntentInput panel={panel} onIntent={p.onIntent} />}
            </>
          )}
          {!fs && (
            <div className="mt-2.5 flex justify-end">
              <button className={btnDanger} onClick={p.onDelete}>Delete panel</button>
            </div>
          )}
        </div>

        {/* right: the candidate (drag it onto the left side to use it) */}
        <div
          style={colStyle('right')}
          className={`flex min-w-0 flex-col ${fs ? `flex-none ${fs === 'left' ? 'hidden' : ''} ${fs === 'right' ? 'h-full' : ''}` : 'rounded-[10px] border-2 border-solid border-bd-line p-2'}`}
        >
          <div className={`mb-1.5 flex items-center gap-2 ${fs ? 'h-[26px]' : ''}`}>
            <span className={kbd}>
              {right ? `Candidate${rightIndex >= 0 ? ` ${rightIndex + 1} of ${p.row.length}` : ''}` : 'No candidate'}
              {right && p.usage[right.id] ? ` · in panel ${p.usage[right.id].panelNo}` : ''}
            </span>
            <div className="flex-1" />
            {right && <button className={undecided ? btnAttn : btnPrimary} onClick={() => p.onUse(right)} title="Enter">Use this</button>}
            {right && fsOpen('right')}
          </div>
          {right ? (
            <>
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', String(right.id));
                  e.dataTransfer.effectAllowed = 'copyMove';
                }}
              >
                <ClipPlayer
                  key={right.id}
                  moment={right}
                  clipMoments={clipMoments(right)}
                  usage={p.usage}
                  editable={!isOut(right)}
                  tone="white"
                  neutralUsage
                  muted={soundSide !== 'right'}
                  onStarted={() => setRestart((n) => n + 1)}
                  box={boxOf('right')}
                  bare={fs === 'both'}
                  onAspect={(a) => setAspect((cur) => ({ ...cur, right: a }))}
                  hint="loops the moment"
                  footer={footer(right)}
                  onPick={(id) => id !== right.id && p.onSelect(id)}
                  onTrim={(a, b) => p.onTrim(right, a, b)}
                  onCreate={(a, b) => p.onCreate(right.clip_id, a, b)}
                />
              </div>
              {fs === 'both' ? null : (
                <>
                  <p className="mb-0 mt-2 line-clamp-2 text-[12.5px] text-[#cfd3db]">
                    <InlineText value={right.description} placeholder="Add a description" onSave={(t) => p.onDescribe(right, t)} />{' '}
                    <span className={kbd}>{kindLabel(right)}</span>
                  </p>
                  {fs === 'right' ? <Spoken moment={right} /> : <div className="mt-2.5"><MomentTools m={right} p={p} /></div>}
                </>
              )}
            </>
          ) : (
            <div className={emptyFrame}>nothing to compare {'—'} no other moments in this event</div>
          )}
        </div>
      </div>

      {/* candidate row (hidden in full screen) */}
      {!fs && <div className="mt-3.5 border-t border-bd-line pt-3">
        <div className="mb-2 flex items-center gap-2">
          <b className="text-[11px] font-semibold uppercase tracking-[.07em] text-bd-muted">Candidates</b>
          <span className={kbd}>{p.row.length} {'·'} {'←'} {'→'} step, Enter use, Tab next panel</span>
        </div>
        <div ref={rowRef} className="flex gap-2 overflow-x-auto pb-1.5">
          {p.row.map(({ m, c }, i) => (
            <div
              key={m.id}
              data-sel={m.id === right?.id ? '1' : undefined}
              className={`w-[132px] flex-none ${i > 0 && p.row[i - 1].c.group !== c.group ? 'ml-2 border-l border-bd-line pl-2' : ''}`}
            >
              <MomentTile
                m={m} used={p.usage[m.id]} currentSceneIndex={p.currentSceneIndex}
                selected={m.id === right?.id} onSelect={() => p.onSelect(m.id)} onSeen={(id) => p.onSeen(id, true)}
              />
            </div>
          ))}
          {p.row.length === 0 && <span className={kbd}>No other candidates.</span>}
        </div>
      </div>}
    </section>
  );
}
