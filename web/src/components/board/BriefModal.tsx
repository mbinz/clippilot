import { useState } from 'react';
import type { BoardMoment, Brief } from '../../board/types';
import { btn, btnGhost, btnPrimary, fieldInput, sectionLabel, tagAi, tagMine } from './ui';

interface Props {
  brief: Brief | null;
  state: 'none' | 'proposed' | 'confirmed';
  momentsById: Map<number, BoardMoment>;
  onClose: () => void;
  /** Save the edited brief as confirmed (one logged, undoable step). */
  onConfirm: (brief: Brief) => void;
}

const EMPTY: Brief = { target_sec: 180, audience: '', mood: '', must_have: [], ending: '', notes: '' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="my-3">
      <label className={sectionLabel}>{label}</label>
      {children}
    </div>
  );
}

export function BriefModal({ brief, state, momentsById, onClose, onConfirm }: Props) {
  const initial = brief ?? EMPTY;
  const [minutes, setMinutes] = useState(String(initial.target_sec / 60));
  const [audience, setAudience] = useState(initial.audience);
  const [mood, setMood] = useState(initial.mood);
  const [mustHave, setMustHave] = useState(initial.must_have);
  const [ending, setEnding] = useState(initial.ending);
  const [notes, setNotes] = useState(initial.notes ?? '');

  const seconds = Math.round(Number(minutes) * 60);
  const valid = seconds > 0 && audience.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/80"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[88vh] w-[min(560px,92vw)] overflow-auto rounded-[14px] border border-bd-line2 bg-bd-s1 px-[22px] py-5 text-bd-text">
        <div className="flex items-center gap-2.5">
          <h3 className="m-0 text-base">Brief</h3>
          {state === 'confirmed' ? <span className={tagMine}>CONFIRMED</span> : state === 'proposed' ? <span className={tagAi}>PROPOSED BY CLAUDE</span> : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Length (min)">
            <input className={fieldInput} type="number" step={0.25} min={0} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </Field>
          <Field label="Audience">
            <input className={fieldInput} value={audience} onChange={(e) => setAudience(e.target.value)} />
          </Field>
        </div>
        <Field label="Mood">
          <input className={fieldInput} value={mood} onChange={(e) => setMood(e.target.value)} />
        </Field>
        <Field label="Must-haves">
          {mustHave.map((x, i) => {
            const thumb = x.moment_id !== undefined ? momentsById.get(x.moment_id)?.thumbnail : null;
            return (
              <div key={`${x.moment_id ?? 't'}-${i}`} className="mb-[5px] flex items-center gap-2">
                <i
                  className="aspect-video w-14 flex-none rounded bg-bd-s2 bg-cover bg-center"
                  style={{ backgroundImage: thumb ? `url(${thumb})` : undefined }}
                />
                <span className="flex-1 text-xs">{x.text}</span>
                <button className={btnGhost} title="Remove" onClick={() => setMustHave((l) => l.filter((_, j) => j !== i))}>{'✕'}</button>
              </div>
            );
          })}
          {mustHave.length === 0 && <span className="text-xs text-bd-dim">None.</span>}
        </Field>
        <Field label="Ending">
          <input className={fieldInput} value={ending} onChange={(e) => setEnding(e.target.value)} />
        </Field>
        <Field label="Notes">
          <textarea className={`${fieldInput} min-h-11 resize-y`} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="flex flex-wrap justify-end gap-1.5">
          <button className={btn} onClick={onClose}>Close</button>
          <button
            className={btnPrimary}
            disabled={!valid}
            title={valid ? undefined : 'Length and audience are required'}
            onClick={() => onConfirm({
              target_sec: seconds, audience: audience.trim(), mood, must_have: mustHave, ending,
              ...(notes.trim() ? { notes } : {}),
            })}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
