import { useEffect, useRef, useState } from 'react';

interface Props {
  value: string;
  placeholder: string;
  /** Called with the new text when it changed (Enter or blur). */
  onSave: (text: string) => void;
  maxLength?: number;
  className?: string;
}

/** Text that turns into an input on click: Enter saves, Esc cancels (and does not close the panel view). */
export function InlineText({ value, placeholder, onSave, maxLength = 300, className = '' }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);

  const save = () => {
    setEditing(false);
    const t = draft.trim();
    if (t !== value.trim()) onSave(t);
  };

  if (!editing) {
    return (
      <span
        role="button"
        tabIndex={0}
        title="Click to edit the description"
        onClick={() => setEditing(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); e.stopPropagation(); setEditing(true); } }}
        className={`cursor-text rounded hover:bg-bd-s2 ${value ? '' : 'italic text-bd-dim'} ${className}`}
      >
        {value || placeholder}
      </span>
    );
  }
  return (
    <input
      ref={input}
      autoFocus
      value={draft}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.stopPropagation(); setDraft(value); setEditing(false); }
      }}
      className="w-full rounded-lg border border-bd-line bg-bd-s2 px-[9px] py-1 font-[inherit] text-[12.5px] text-bd-text"
    />
  );
}
