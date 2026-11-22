import { useRef, useState } from 'react';
import type { BoardMoment } from '../../board/types';
import { fmtSec } from '../../board/logic';
import { btn, btnGhost, btnPrimary } from './ui';
import { DrawerPlayer } from './DrawerPlayer';
import { ClipTimeline } from './ClipTimeline';

const REASONS = ['shake', 'blur', 'boring', 'duplicate', 'bad timing', 'other'];

interface Props {
  moment: BoardMoment;
  sameClip: BoardMoment[];
  sceneName: string;
  /** Empty or candidate panel the user came from: "Place in panel N". */
  target: { no: number } | null;
  onClose: () => void;
  onPlace: () => void;
  onReject: (reason: string) => void;
  onHide: () => void;
  onUnhide: () => void;
  onUndoReject: () => void;
}

export function MomentDrawer(p: Props) {
  const m = p.moment;
  const clip = m.clip;
  const [whole, setWhole] = useState(false);
  const [reasons, setReasons] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const rejected = m.status === 'rejected';
  const hidden = Boolean(clip?.hidden);

  return (
    <>
      <div className="mb-2.5 flex items-center gap-2">
        <h3 className="m-0 flex-1 text-sm">{m.tier === 'hero' ? '★ ' : ''}{clip?.file_name ?? `Clip ${m.clip_id}`}</h3>
        <button className={btnGhost} onClick={() => setWhole((w) => !w)}>{whole ? 'Moment' : 'Whole clip'}</button>
        <button className={btnGhost} onClick={p.onClose} title="Close (Esc)">{'✕'}</button>
      </div>
      <DrawerPlayer
        key={m.id}
        src={clip?.proxy_url ?? null} a={m.start_sec} b={m.end_sec} rate={1} whole={whole}
        videoRef={videoRef} onTime={setPlayhead}
      />
      <ClipTimeline duration={clip?.duration_sec ?? 0} moments={p.sameClip} currentMomentId={m.id} playhead={playhead} />
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-bd-muted">
        <span>{fmtSec(m.start_sec)}</span>
        <span>moment {fmtSec(m.end_sec - m.start_sec)} of {fmtSec(clip?.duration_sec ?? 0)}</span>
        <span>{fmtSec(m.end_sec)}</span>
      </div>
      <p className="mt-2.5 text-[12.5px] text-[#cfd3db]">{m.description}</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Fact>{m.tier}</Fact>
        {m.shot && <Fact>{m.shot}</Fact>}
        {m.role && <Fact>{m.role}</Fact>}
        {m.slowmo !== 'none' && (
          <Fact>{'\u{1F422}'} {(clip?.fps ?? 0) >= 48 ? 'slow-mo ok' : `slow-mo wanted, only ${clip?.fps ?? '?'} fps`}</Fact>
        )}
        {m.audio_keep && <Fact>{'\u{1F50A}'} {m.audio_type}</Fact>}
        {m.issues.map((x) => <Fact key={x} bad>{'⚠'} {x}</Fact>)}
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {rejected || hidden ? (
          rejected ? (
            <button className={btn} onClick={p.onUndoReject}>Undo {'\u{1F44E}'}</button>
          ) : (
            <button className={btn} onClick={p.onUnhide}>Unhide clip</button>
          )
        ) : (
          <>
            <button className={btnPrimary} onClick={p.onPlace}>
              {p.target ? `Place in panel ${p.target.no}` : `Add to “${p.sceneName}”`}
            </button>
            <button className={btn} onClick={() => setReasons((r) => !r)}>{'\u{1F44E}'}</button>
            <button className={btn} onClick={p.onHide}>Hide clip</button>
          </>
        )}
      </div>
      {reasons && !rejected && !hidden && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {REASONS.map((r) => (
            <button
              key={r}
              onClick={() => p.onReject(r)}
              className="cursor-pointer rounded-full border border-bd-bad/45 bg-transparent px-2.5 py-0.5 text-xs text-bd-bad"
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function Fact({ children, bad }: { children: React.ReactNode; bad?: boolean }) {
  return (
    <span className={`rounded-full border border-bd-line px-[9px] py-px text-[11.5px] ${bad ? 'text-bd-bad' : 'text-bd-muted'}`}>{children}</span>
  );
}
