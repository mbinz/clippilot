import { useEffect, useState } from 'react';
import { fetchEventClips } from '../../api/client';
import type { EventClip, EventItem } from '../../api/types';
import { useEvents } from '../../hooks/useEvents';

interface EventsViewProps {
  projectId: number | undefined;
}

function formatRange(start: string | null, end: string | null): string {
  if (!start) return 'undated';
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const s = new Date(start);
  const e = end ? new Date(end) : s;
  const sameDay = s.toDateString() === e.toDateString();
  return sameDay
    ? `${day.format(s)}, ${time.format(s)} - ${time.format(e)}`
    : `${day.format(s)} ${time.format(s)} - ${day.format(e)} ${time.format(e)}`;
}

function EventName({ event, onRename }: { event: EventItem; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(event.name);

  useEffect(() => setDraft(event.name), [event.name]);

  const commit = () => {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== event.name) onRename(name);
    else setDraft(event.name);
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        title="Click to rename"
        className="text-left font-semibold text-gray-900 hover:text-blue-700"
      >
        {event.name}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setDraft(event.name);
          setEditing(false);
        }
      }}
      onBlur={commit}
      className="font-semibold text-gray-900 border border-blue-400 rounded px-1 py-0.5 w-72"
    />
  );
}

function SplitPicker({
  event,
  onPick,
  onCancel,
}: {
  event: EventItem;
  onPick: (clipId: number) => void;
  onCancel: () => void;
}) {
  const [clips, setClips] = useState<EventClip[] | null>(null);

  useEffect(() => {
    fetchEventClips(event.id).then((res) => setClips(res.data)).catch(() => setClips([]));
  }, [event.id]);

  return (
    <div className="mt-3 border-t border-gray-200 pt-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-600">Click the first clip of the new event (the first clip of this event cannot be chosen).</p>
        <button onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-800">Cancel</button>
      </div>
      {clips === null ? (
        <p className="text-xs text-gray-400">Loading clips...</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {clips.map((clip, i) => (
            <button
              key={clip.id}
              disabled={i === 0}
              onClick={() => onPick(clip.id)}
              title={`${clip.file_name}${i === 0 ? ' (first clip)' : ' - split here'}`}
              className="w-28 text-left rounded border border-gray-200 bg-white hover:border-blue-500 disabled:opacity-40 disabled:hover:border-gray-200"
            >
              {clip.thumbnail ? (
                <img src={clip.thumbnail} alt="" className="w-full h-16 object-cover rounded-t" />
              ) : (
                <div className="w-full h-16 bg-gray-200 rounded-t" />
              )}
              <div className="px-1 py-0.5 text-[10px] text-gray-600 truncate">{clip.file_name}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function EventsView({ projectId }: EventsViewProps) {
  const { events, loading, error, rename, merge, split } = useEvents(projectId);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [splittingId, setSplittingId] = useState<number | null>(null);

  useEffect(() => {
    setSelected(new Set());
    setSplittingId(null);
  }, [projectId]);

  if (projectId === undefined) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Select a project to see its events.
      </div>
    );
  }

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleMerge = async () => {
    const ids = events.filter((e) => selected.has(e.id)).map((e) => e.id);
    if (ids.length < 2) return;
    const [target, ...others] = ids;
    setSelected(new Set());
    await merge(target, others);
  };

  return (
    <div className="p-4 flex flex-col gap-4 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Events ({events.length})</h2>
        <button
          onClick={handleMerge}
          disabled={selected.size < 2}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          Merge selected ({selected.size})
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading && events.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-gray-400">Loading events...</div>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-2">
          <p>No events yet.</p>
          <p className="text-xs">Run "clippilot events rebuild" to create them.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <div key={event.id} className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(event.id)}
                  onChange={() => toggle(event.id)}
                  aria-label={`Select ${event.name}`}
                  className="mt-1.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <EventName event={event} onRename={(name) => rename(event.id, name)} />
                    <span className="text-xs text-gray-500">{event.clip_count} clips</span>
                    <span className="text-xs text-gray-400">{event.source === 'folder' ? 'folder' : 'by time'}</span>
                  </div>
                  <p className="text-xs text-gray-500">{formatRange(event.start, event.end)}</p>
                  <div className="flex gap-1 mt-2 overflow-x-auto">
                    {event.thumbnails.map((url, i) => (
                      <img key={`${url}-${i}`} src={url} alt="" className="h-14 w-24 object-cover rounded flex-none" />
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => setSplittingId(splittingId === event.id ? null : event.id)}
                  disabled={event.clip_count < 2}
                  className="text-sm text-gray-600 hover:text-gray-900 disabled:opacity-40"
                >
                  Split...
                </button>
              </div>
              {splittingId === event.id && (
                <SplitPicker
                  event={event}
                  onCancel={() => setSplittingId(null)}
                  onPick={async (clipId) => {
                    setSplittingId(null);
                    await split(event.id, clipId);
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
