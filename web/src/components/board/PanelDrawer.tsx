import { useEffect, useRef, useState } from 'react';
import type { BoardMoment, BoardPanel, BoardScene } from '../../board/types';
import { fmtSec, speedOk } from '../../board/logic';
import { btn, btnDanger, btnGhost, sectionLabel, tagAi, tagMine } from './ui';
import { DrawerPlayer } from './DrawerPlayer';
import { ClipTimeline } from './ClipTimeline';
import { VideoThumb } from './VideoThumb';

const MIN_TRIM = 0.5;

interface Props {
  panel: BoardPanel;
  scene: BoardScene;
  momentsById: Map<number, BoardMoment>;
  allMoments: BoardMoment[];
  onClose: () => void;
  onSpeed: (speed: number) => void;
  onPick: (momentId: number) => void;
  onTrim: (a: number, b: number) => void;
  onIntent: (text: string) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}

export function PanelDrawer(p: Props) {
  const { panel, scene } = p;
  const index = scene.panels.findIndex((x) => x.id === panel.id);
  const [trim, setTrim] = useState({ a: panel.start_sec ?? 0, b: panel.end_sec ?? 0 });
  const [intent, setIntent] = useState(panel.intent);
  const [playhead, setPlayhead] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trimRef = useRef(trim);
  trimRef.current = trim;

  useEffect(() => setTrim({ a: panel.start_sec ?? 0, b: panel.end_sec ?? 0 }), [panel.id, panel.start_sec, panel.end_sec]);
  useEffect(() => setIntent(panel.intent), [panel.id, panel.intent]);

  const clip = panel.clip;
  const fps = clip?.fps ?? null;
  const live = (a: number, b: number) => {
    setTrim({ a, b });
    if (b - a >= MIN_TRIM && videoRef.current) videoRef.current.currentTime = a !== trimRef.current.a ? a : Math.max(a, b - 1);
  };
  const commit = () => {
    const { a, b } = trimRef.current;
    if (a === panel.start_sec && b === panel.end_sec) return;
    if (b - a >= MIN_TRIM) p.onTrim(a, b);
    else setTrim({ a: panel.start_sec ?? 0, b: panel.end_sec ?? 0 });
  };

  let body;
  if (panel.state === 'filled' && clip) {
    const trimmedLen = trim.b - trim.a;
    body = (
      <>
        <DrawerPlayer
          key={panel.id}
          src={clip.proxy_url} a={trim.a} b={trim.b} rate={panel.speed} speedBadge={panel.speed}
          videoRef={videoRef} onTime={setPlayhead}
        />
        <ClipTimeline
          duration={clip.duration_sec}
          moments={p.allMoments.filter((m) => m.clip_id === clip.id)}
          currentMomentId={panel.moment_id}
          range={trim} onRange={live} onRangeCommit={commit} playhead={playhead}
        />
        <div className="mt-1 flex justify-between text-[11px] tabular-nums text-bd-muted">
          <span>in {fmtSec(trim.a)}</span>
          <span>{fmtSec(trimmedLen)} {'→'} {fmtSec(trimmedLen / panel.speed)} on the timeline</span>
          <span>out {fmtSec(trim.b)}</span>
        </div>
        <div className="mt-2.5 flex items-center gap-2 text-xs text-bd-muted">
          {panel.source === 'user'
            ? <><span className={tagMine}>YOURS</span> confirmed</>
            : <><span className={tagAi}>AI</span> proposed {'—'} trimming, speed or placing makes it yours</>}
        </div>
        <p className="mt-2.5 text-[12.5px] text-[#cfd3db]">{panel.moment?.description}</p>
        <div className="mt-4">
          <label className={sectionLabel}>Speed {'·'} clip is {fps ?? '?'} fps</label>
          <div className="inline-flex overflow-hidden rounded-lg border border-bd-line">
            {[1, 0.5, 0.25].map((v) => (
              <button
                key={v}
                disabled={!speedOk(fps, v)}
                title={speedOk(fps, v) ? undefined : 'Footage has too few frames'}
                onClick={() => v !== panel.speed && p.onSpeed(v)}
                className={`cursor-pointer px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-30 ${panel.speed === v ? 'bg-bd-s2 text-bd-text' : 'bg-transparent text-bd-muted'}`}
              >
                {v * 100} %
              </button>
            ))}
          </div>
        </div>
      </>
    );
  } else if (panel.state === 'candidates') {
    body = (
      <>
        <p className="m-0 mb-2.5 text-bd-muted">Pick one. If you don{'’'}t, the first one is used on export.</p>
        <div className="grid grid-cols-3 gap-2">
          {panel.candidates.map((c, k) => (
            <div key={c.id} className="group cursor-pointer" onClick={() => p.onPick(c.id)}>
              <div className="relative aspect-video overflow-hidden rounded-[7px] bg-black">
                <VideoThumb
                  poster={p.momentsById.get(c.id)?.thumbnail ?? c.thumbnail}
                  src={c.proxy_url ?? c.clip?.proxy_url ?? null}
                  a={c.start_sec} b={c.end_sec} rate={2}
                />
                <div className="pointer-events-none absolute inset-0 rounded-[7px] border-2 border-dashed border-bd-ai group-hover:border-solid group-hover:border-bd-focus" />
              </div>
              <p className="mt-1 text-[11px] text-bd-muted">{k === 0 ? 'default · ' : ''}{c.tier} {'·'} {fmtSec(c.end_sec - c.start_sec)}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-bd-dim">Hover to play, click to use it.</p>
      </>
    );
  } else {
    body = <p className="m-0 text-bd-muted">Nothing placed yet. Drag a moment from the pool onto this panel. Gaps are skipped on export.</p>;
  }

  return (
    <>
      <div className="mb-2.5 flex items-center gap-2">
        <h3 className="m-0 flex-1 text-sm">Panel {index + 1} {'·'} {scene.name}</h3>
        <button className={btnGhost} onClick={p.onClose} title="Close (Esc)">{'✕'}</button>
      </div>
      {body}
      <div className="mt-4">
        <label className={sectionLabel}>Intent</label>
        <textarea
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          onBlur={() => intent !== panel.intent && p.onIntent(intent)}
          className="min-h-11 w-full resize-y rounded-lg border border-bd-line bg-bd-s2 px-[9px] py-[7px] font-[inherit] text-bd-text"
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        <button className={btn} disabled={index === 0} onClick={() => p.onMove(-1)}>{'←'} Move</button>
        <button className={btn} disabled={index === scene.panels.length - 1} onClick={() => p.onMove(1)}>Move {'→'}</button>
        <div className="flex-1" />
        <button className={btnDanger} onClick={p.onDelete}>Delete panel</button>
      </div>
    </>
  );
}
