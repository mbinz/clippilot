import { useEffect, useState } from 'react';
import type { PM } from '../../board/types';
import { starLabel, transcriptView, shakeLine, shakeFitLine, jitterLine, type SpokenSegment, type StoryLink } from '../../board/drawer';
import { fetchTranscript } from '../../board/api';
import { effectiveTier, isHero, isOut, type UsageEntry } from '../../board/pool';
import { btn, btnGhost, kbd, tagAi, tagMine } from './ui';
import { ClipPlayer } from './ClipPlayer';
import { MomentTile } from './MomentTile';
import { SpeedSegment, kindLabel } from './MomentBits';
import { GRID } from './MomentPool';

const REASONS = ['shake', 'blur', 'boring', 'duplicate', 'bad timing', 'other'];
const link = 'cursor-pointer border-0 bg-transparent p-0 text-bd-text underline underline-offset-[3px]';
const boxHead = 'text-[11px] font-semibold uppercase tracking-[.07em] text-bd-muted';

interface Props {
  moment: PM;
  /** All moments of the clip, rejected and hidden included. */
  clipMoments: PM[];
  usage: Record<number, UsageEntry>;
  currentSceneIndex: number;
  eventName: string;
  sceneName: string;
  story: StoryLink;
  /** Similar by look, nearest first (empty = none or no fingerprint: section hidden). */
  similar: PM[];
  /** Rest of the event, by time (collapsed). */
  others: PM[];
  othersOpen: boolean;
  onToggleOthers: () => void;
  onClose: () => void;
  onSelect: (momentId: number) => void;
  onOpenMoment: (momentId: number) => void;
  onFinder: () => void;
  onStar: () => void;
  onReject: (reason: string) => void;
  onRestore: () => void;
  onUnseen: () => void;
  onSpeed: (speed: number) => void;
  onTrim: (a: number, b: number) => void;
  onOpenPanel: (panelId: number) => void;
  onCompare: (panelId: number) => void;
  onAdd: () => void;
  onHide: () => void;
  onSeen: (momentId: number) => void;
}

const f1 = (s: number) => `${s.toFixed(1)} s`;

// Fetched once per clip (the drawer re-mounts per moment, so cache by clip id for the session).
const transcriptCache = new Map<number, SpokenSegment[]>();

function useTranscript(clipId: number): SpokenSegment[] {
  const [segs, setSegs] = useState<SpokenSegment[]>(transcriptCache.get(clipId) ?? []);
  useEffect(() => {
    if (transcriptCache.has(clipId)) { setSegs(transcriptCache.get(clipId)!); return; }
    let live = true;
    fetchTranscript(clipId)
      .then((t) => {
        const s = 'segments' in t ? t.segments : [];
        transcriptCache.set(clipId, s);
        if (live) setSegs(s);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [clipId]);
  return segs;
}

/** "Review this clip": the whole clip, all its moments, ★ / 👎 / hide, one link into the story. Neutral. */
export function MomentDrawer(p: Props) {
  const m = p.moment;
  const clip = m.clip;
  const out = isOut(m);
  const rejected = m.status === 'rejected';
  const [reasons, setReasons] = useState(false);
  const when = clip.recorded_at ? new Date(clip.recorded_at) : null;
  const whenText = when && !isNaN(when.getTime())
    ? when.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '';
  const spoken = transcriptView(useTranscript(clip.id), m.start_sec, m.end_sec);
  const inClip = [...p.clipMoments].sort((a, b) => a.start_sec - b.start_sec);

  return (
    <>
      <div className="-mx-4 -mt-3.5 mb-3 border-b border-bd-line2 px-4 py-3">
        <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[.08em] text-bd-muted">
          <span className="text-bd-muted">{'◉'} </span>Clip review {'·'} {p.eventName}{whenText ? ` · ${whenText}` : ''}
        </div>
        <div className="flex items-center gap-1.5">
          <h3 className="m-0 min-w-0 flex-1 truncate text-sm">{clip.file_name}</h3>
          <span className={`${kbd} whitespace-nowrap`}>{Math.round(clip.duration_sec)} s {'·'} {clip.fps ?? '?'} fps</span>
          <button className={btnGhost} onClick={p.onFinder} title="Show this file in Finder">Show in Finder</button>
          <button className={btnGhost} onClick={p.onClose} title="Close (Esc)">{'✕'}</button>
        </div>
      </div>

      <ClipPlayer
        key={m.id}
        moment={m}
        clipMoments={p.clipMoments.filter((x) => !isOut(x))}
        usage={p.usage}
        editable={!out}
        tone="white"
        hint="loops the moment · click outside it to play the clip"
        footer={`${Math.round(clip.duration_sec)} s · whole clip`}
        onPick={p.onSelect}
        onTrim={p.onTrim}
      />

      <div className="mt-4 border-t border-bd-line pt-3">
        <div className="mb-2"><b className={boxHead}>Moments in this clip {'·'} {inClip.length}</b></div>
        {inClip.map((x) => {
          const u = p.usage[x.id];
          const xo = isOut(x);
          const sel = x.id === m.id;
          return (
            <div
              key={x.id}
              onClick={() => p.onSelect(x.id)}
              className={`flex cursor-pointer gap-2.5 rounded-lg border p-1.5 hover:bg-bd-s2 ${sel ? 'border-bd-focus bg-bd-s2' : 'border-transparent'} ${xo ? 'opacity-50' : ''}`}
            >
              <i
                className="aspect-video w-[84px] flex-none rounded-[5px] bg-black bg-cover bg-center"
                style={x.thumbnail ? { backgroundImage: `url(${x.thumbnail})` } : undefined}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {isHero(x) && <span className="text-xs">{'★'}</span>}
                  <span className={kbd}>{f1(x.start_sec)} {'–'} {f1(x.end_sec)}</span>
                  {u && <span className={u.source === 'user' ? tagMine : tagAi}>{u.source === 'user' ? '✓ ' : ''}PANEL {u.panelNo}</span>}
                  {xo && <span className="text-[11px] text-bd-bad">{x.status === 'rejected' ? '\u{1F44E}' : 'hidden'}</span>}
                </div>
                <div className="mt-0.5 line-clamp-2 text-xs text-[#cfd3db]">{x.description}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 border-t border-bd-line pt-3">
        <div className="mb-2 flex items-center gap-2">
          <b className={boxHead}>Selected moment</b>
          <span className={kbd}>
            {effectiveTier(m)} {'·'} {kindLabel(m)}
            {m.audio_keep ? ` · \u{1F50A} ${m.audio_type}` : ''}
            {m.slowmo !== 'none' ? ` · \u{1F422} ${(clip.fps ?? 0) >= 48 ? 'slow-mo ok' : 'slow-mo wanted'}` : ''}
          </span>
        </div>
        <p className="m-0 mb-2 text-[12.5px] text-[#cfd3db]">{m.description}</p>
        {(m.jitter || (m.shakes && m.shakes.length > 0) || shakeFitLine(m)) && (
          <div className="mb-2 text-[11px] leading-snug text-bd-muted">
            {jitterLine(m.jitter) && <div>{jitterLine(m.jitter)}</div>}
            {m.shakes?.map((k, i) => <div key={i}>{shakeLine(k)}</div>)}
            {shakeFitLine(m) && <div>{shakeFitLine(m)}</div>}
          </div>
        )}
        {spoken.parts.length > 0 && (
          <div className="mb-2">
            <div className={`${boxHead} mb-0.5`}>Spoken</div>
            <p className="m-0 text-[12.5px] leading-snug">
              {spoken.parts.map((x, i) => (
                <span key={i} className={x.inMoment ? 'text-[#cfd3db]' : 'text-bd-muted opacity-60'}>{i ? ' ' : ''}{x.text}</span>
              ))}
            </p>
            {spoken.cut && (
              <div className="mt-0.5 text-[11px] text-bd-muted">
                Sentence cut at the {spoken.cut === 'both' ? 'start and end' : spoken.cut}
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {out ? (
            <button className={btn} onClick={p.onRestore}>{rejected ? 'Undo \u{1F44E}' : 'Unhide clip'}</button>
          ) : (
            <>
              <button
                className={`${btn} ${isHero(m) && m.user_tier ? '!border-bd-mine/50 !text-bd-mine' : ''}`}
                onClick={p.onStar}
                title={m.user_tier ? 'Star set by you' : 'Star from the analysis'}
              >
                {starLabel(m)}
              </button>
              <button className={btn} onClick={() => setReasons((r) => !r)}>{'\u{1F44E}'} Not usable</button>
            </>
          )}
          <div className="flex-1" />
          <button className={btnGhost} onClick={p.onUnseen}>Mark unseen</button>
        </div>
        {reasons && !out && (
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
        {!out && <SpeedSegment m={m} onSpeed={p.onSpeed} />}
        {p.story.kind !== 'none' && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-dashed border-bd-line pt-2.5">
            {p.story.kind === 'in' && (
              <>
                <span className="text-bd-muted">In the story:</span>
                <button className={link} onClick={() => p.onOpenPanel((p.story as Extract<StoryLink, { kind: 'in' }>).panelId)}>
                  panel {p.story.panelNo} {'·'} {p.story.sceneName}
                </button>
              </>
            )}
            {p.story.kind === 'compare' && (
              <>
                <span className="text-bd-muted">Panel {p.story.panelNo} has a similar shot.</span>
                <button className={btn} onClick={() => p.onCompare((p.story as Extract<StoryLink, { kind: 'compare' }>).panelId)}>
                  Compare in panel {p.story.panelNo} {'→'}
                </button>
              </>
            )}
            {p.story.kind === 'add' && (
              <>
                <span className="text-bd-muted">Nothing similar in the story.</span>
                <button className={btn} onClick={p.onAdd}>Add to {'“'}{p.sceneName}{'”'}</button>
              </>
            )}
          </div>
        )}
      </div>

      {p.similar.length > 0 && (
        <div className="mt-4 border-t border-bd-line pt-3">
          <div className="flex items-center gap-2">
            <b className="text-[11px] font-semibold uppercase tracking-[.07em] text-bd-muted">Similar moments {'·'} {p.similar.length}</b>
            <span className={kbd}>{kindLabel(m)}</span>
          </div>
          <div className={`${GRID} mt-2 !grid-cols-[repeat(auto-fill,minmax(118px,1fr))]`}>
            {p.similar.map((x) => (
              <MomentTile
                key={x.id} m={x} used={p.usage[x.id]} currentSceneIndex={p.currentSceneIndex}
                selected={false} onSelect={() => p.onOpenMoment(x.id)} onSeen={p.onSeen}
              />
            ))}
          </div>
        </div>
      )}

      {p.others.length > 0 && (
        <div className="mt-4 border-t border-bd-line pt-3">
          <button className={link} onClick={p.onToggleOthers}>{p.othersOpen ? '▾' : '▸'} Other moments in this event {'·'} {p.others.length}</button>
          {p.othersOpen && (
            <div className={`${GRID} mt-2 !grid-cols-[repeat(auto-fill,minmax(118px,1fr))]`}>
              {p.others.map((x) => (
                <MomentTile
                  key={x.id} m={x} used={p.usage[x.id]} currentSceneIndex={p.currentSceneIndex}
                  selected={false} onSelect={() => p.onOpenMoment(x.id)} onSeen={p.onSeen}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {!(out && clip.hidden) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-bd-line pt-3">
          <span className={kbd}>The whole clip:</span>
          <button className={btn} onClick={p.onHide}>Hide clip</button>
          <span className={kbd}>hidden clips leave the pool and the story</span>
        </div>
      )}
    </>
  );
}
