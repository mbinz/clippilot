import { useEffect, useState } from 'react';
import { transcriptView, type SpokenSegment } from '../../board/drawer';
import { fetchTranscript } from '../../board/api';
import type { PM } from '../../board/types';

// Fetched once per clip for the session.
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

/** "Spoken": the clip's transcript; what lies inside the moment is bright. Nothing when the clip has no speech. */
export function Spoken({ moment: m }: { moment: PM }) {
  const spoken = transcriptView(useTranscript(m.clip_id), m.start_sec, m.end_sec);
  if (spoken.parts.length === 0) return null;
  return (
    <div className="mt-3 min-h-0 flex-1 overflow-auto">
      <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-[.07em] text-bd-muted">Spoken</div>
      <p className="m-0 text-[14px] leading-snug">
        {spoken.parts.map((x, i) => (
          <span key={i} className={x.inMoment ? 'text-[#cfd3db]' : 'text-bd-muted opacity-60'}>{i ? ' ' : ''}{x.text}</span>
        ))}
      </p>
      {spoken.cut && (
        <div className="mt-0.5 text-[11px] text-bd-muted">Sentence cut at the {spoken.cut === 'both' ? 'start and end' : spoken.cut}</div>
      )}
    </div>
  );
}
