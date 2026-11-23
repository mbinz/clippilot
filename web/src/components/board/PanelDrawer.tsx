import { useEffect, useState } from 'react';
import type { BoardMoment, BoardPanel, BoardScene, PM } from '../../board/types';
import { decisionFor, optionList } from '../../board/drawer';
import { effectiveTier, isOut, type UsageEntry } from '../../board/pool';
import { btn, btnAttn, btnDanger, btnGhost, kbd, sectionLabel, tagAi, tagMine } from './ui';
import { ClipPlayer } from './ClipPlayer';
import { MomentTile } from './MomentTile';
import { MomentFacts, SpeedSegment, kindLabel } from './MomentBits';
import { GRID } from './MomentPool';
import { panelMedia } from './media';

interface Props {
  panel: BoardPanel;
  scene: BoardScene;
  /** The moment the panel plays now (null for an empty panel). */
  current: PM | null;
  /** The moment being previewed (the current one when not previewing). */
  shown: PM | null;
  moments: PM[];
  momentsById: Map<number, BoardMoment>;
  usage: Record<number, UsageEntry>;
  currentSceneIndex: number;
  onPreview: (momentId: number | null) => void;
  onUse: (m: PM) => void;
  onClose: () => void;
  onSpeed: (m: PM, speed: number) => void;
  onTrim: (m: PM, a: number, b: number) => void;
  onIntent: (text: string) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  onReview: (momentId: number) => void;
  onPanel: (panelId: number) => void;
  onSeen: (momentId: number) => void;
}

/** "Choose the shot for this slot" (amber = your edit). Clicking an option only previews it. */
export function PanelDrawer(p: Props) {
  const { panel, scene, current, shown: m } = p;
  const index = scene.panels.findIndex((x) => x.id === panel.id);
  const [intent, setIntent] = useState(panel.intent);
  useEffect(() => setIntent(panel.intent), [panel.id, panel.intent]);

  const decision = decisionFor({ state: panel.state, source: panel.source, current, shown: m });
  const editable = !!m && !isOut(m);
  const options = optionList({
    current, shown: m, moments: p.moments, eventId: scene.event_id,
    candidateIds: panel.state === 'candidates' ? panel.candidates.map((c) => c.id) : [],
  });
  const base = current ?? m;
  const neighbours = [scene.panels[index - 1], panel, scene.panels[index + 1]];
  const ring = (x: BoardPanel) =>
    x.state === 'gap' ? 'border border-dashed border-bd-line' : x.source === 'user' ? 'outline outline-2 -outline-offset-2 outline-bd-mine' : 'outline outline-2 -outline-offset-2 outline-dashed outline-bd-ai';

  return (
    <>
      <div className="-mx-4 -mt-3.5 mb-3 border-b border-bd-attn/45 bg-[color-mix(in_srgb,var(--color-bd-attn)_16%,var(--color-bd-s1))] px-4 py-3">
        <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[.08em] text-bd-attn">
          Panel {index + 1} of {scene.panels.length} {'·'} {scene.name}
        </div>
        <div className="flex items-center gap-1.5">
          <h3 className="m-0 min-w-0 flex-1 text-base">{panel.intent}</h3>
          <button className={btnGhost} onClick={p.onClose} title="Close (Esc)">{'✕'}</button>
        </div>
        <div className="mt-2.5 flex items-center gap-1.5">
          {neighbours.map((x, k) => {
            const poster = x ? panelMedia(x, p.momentsById).poster : null;
            return (
              <div key={k} className="flex items-center gap-1.5">
                {k > 0 && <i className="not-italic text-bd-dim">{'›'}</i>}
                {x ? (
                  <div
                    onClick={k === 1 ? undefined : () => p.onPanel(x.id)}
                    className={`relative aspect-video rounded-md bg-black bg-cover bg-center ${ring(x)} ${
                      k === 1 ? 'w-[104px] shadow-[0_0_0_2px_var(--color-bd-attn)]' : 'w-[76px] cursor-pointer opacity-55 hover:opacity-100'
                    }`}
                    style={poster ? { backgroundImage: `url(${poster})` } : undefined}
                  >
                    <span className="absolute left-[3px] top-0.5 rounded bg-black/80 px-1 text-[10px]">{index + k}</span>
                  </div>
                ) : (
                  <div className="aspect-video w-[76px] rounded-md border border-dashed border-bd-line" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {m && (
        <ClipPlayer
          key={m.id}
          moment={m}
          clipMoments={p.moments.filter((x) => x.clip_id === m.clip_id && !isOut(x))}
          usage={p.usage}
          editable={editable}
          tone="amber"
          hint="loops the moment · click outside it to play on"
          footer={`${Math.round(m.clip.duration_sec)} s · ${m.clip.file_name}`}
          onPick={(id) => p.onPreview(id)}
          onTrim={(a, b) => p.onTrim(m, a, b)}
        />
      )}

      {/* the one decision */}
      <div className="mt-3 flex flex-wrap items-center gap-2.5 rounded-[10px] border border-bd-attn/55 bg-[color-mix(in_srgb,var(--color-bd-attn)_10%,var(--color-bd-s2))] px-3 py-2.5">
        {decision.kind === 'out' && (
          <span className="text-bd-muted">{decision.rejected ? '\u{1F44E} rejected' : 'Clip hidden'} {'—'} review it in the moment drawer</span>
        )}
        {decision.kind === 'use' && m && (
          <>
            <button className={`${btnAttn} !px-4 !py-2`} onClick={() => p.onUse(m)}>Use this in panel {index + 1}</button>
            {current && (
              <>
                <span className="text-bd-muted">instead of</span>
                <i
                  className="aspect-video w-16 flex-none rounded bg-cover bg-center"
                  style={current.thumbnail ? { backgroundImage: `url(${current.thumbnail})` } : undefined}
                />
                <button className={btnGhost} onClick={() => p.onPreview(null)}>Back to current</button>
              </>
            )}
          </>
        )}
        {decision.kind === 'default' && m && (
          <>
            <span className="text-bd-muted">Claude{'’'}s default pick</span>
            <div className="flex-1" />
            <button className={btnAttn} onClick={() => p.onUse(m)}>Use this one</button>
          </>
        )}
        {decision.kind === 'picked' && (
          <>
            <span className={`font-semibold ${decision.mine ? 'text-bd-mine' : 'text-bd-ai'}`}>{decision.mine ? '✓ Your pick' : 'AI pick'}</span>
            <span className={kbd}>click an option below to compare</span>
          </>
        )}
        {decision.kind === 'empty' && <span className="text-bd-muted">Empty panel {'—'} click an option below to try it.</span>}
      </div>

      {/* options: in the story now first, then similar shots */}
      <div className="mt-4 border-t border-bd-line pt-3">
        <div className="mb-2 flex items-center gap-2">
          <b className="text-[11px] font-semibold uppercase tracking-[.07em] text-bd-muted">Options</b>
          <span className={kbd}>{base ? `${kindLabel(base)} · ` : ''}{options.length}{current ? ' · first = in the story now' : ''}</span>
        </div>
        <div className={`${GRID} !grid-cols-[repeat(auto-fill,minmax(118px,1fr))]`}>
          {options.map((x) => (
            <MomentTile
              key={x.id} m={x} used={p.usage[x.id]} currentSceneIndex={p.currentSceneIndex}
              selected={m?.id === x.id} onSelect={() => p.onPreview(x.id)} onSeen={p.onSeen}
            />
          ))}
        </div>
      </div>

      {m && (
        <div className="mt-4 border-t border-bd-line pt-3">
          <div className="mb-2 flex items-center gap-2">
            <b className="text-[11px] font-semibold uppercase tracking-[.07em] text-bd-muted">This moment</b>
            <span className={kbd}>{effectiveTier(m)} {'·'} {kindLabel(m)}</span>
            <div className="flex-1" />
            <button className="cursor-pointer border-0 bg-transparent p-0 text-bd-text underline underline-offset-[3px]" onClick={() => p.onReview(m.id)}>
              Review clip {'→'}
            </button>
          </div>
          <p className="m-0 text-[12.5px] text-[#cfd3db]">{m.description}</p>
          <MomentFacts m={m} />
          {editable && <SpeedSegment m={m} onSpeed={(v) => p.onSpeed(m, v)} />}
          <p className={`${kbd} mb-0 mt-2`}>In/out and speed belong to the moment {'—'} wherever it{'’'}s used, it plays like this.</p>
        </div>
      )}

      <div className="mt-4 border-t border-bd-line pt-3">
        <div className="mb-2 flex items-center gap-2">
          <b className="text-[11px] font-semibold uppercase tracking-[.07em] text-bd-muted">Panel</b>
          {panel.state === 'filled' && (panel.source === 'user' ? <span className={tagMine}>{'✓'} YOURS</span> : <span className={tagAi}>AI</span>)}
        </div>
        <label className={sectionLabel}>Intent</label>
        <textarea
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          onBlur={() => intent !== panel.intent && p.onIntent(intent)}
          className="min-h-11 w-full resize-y rounded-lg border border-bd-line bg-bd-s2 px-[9px] py-[7px] font-[inherit] text-bd-text"
        />
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button className={btn} disabled={index === 0} onClick={() => p.onMove(-1)}>{'←'} Move</button>
          <button className={btn} disabled={index === scene.panels.length - 1} onClick={() => p.onMove(1)}>Move {'→'}</button>
          <div className="flex-1" />
          <button className={btnDanger} onClick={p.onDelete}>Delete panel</button>
        </div>
      </div>
    </>
  );
}
