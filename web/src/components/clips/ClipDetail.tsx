import { useState } from 'react';
import type { Clip, Thumbnail } from '../../api/types';
import { updateClip, fetchSimilarByClip } from '../../api/client';
import type { SimilarityCluster } from '../../api/types';
import pathUtil from '../../utils/path';

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function QualityBar({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  const pct = (value / 5) * 100;
  const color = value >= 4 ? 'bg-green-500' : value >= 2.5 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 text-gray-600">{label}</span>
      <div className="flex-1 bg-gray-200 rounded h-2">
        <div className={`h-2 rounded ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 text-right text-gray-500">{value.toFixed(1)}</span>
    </div>
  );
}

interface ClipDetailProps {
  clip: Clip;
  thumbnails: Thumbnail[];
  onClose: () => void;
  onUpdated: () => void;
}

export function ClipDetail({ clip, thumbnails, onClose, onUpdated }: ClipDetailProps) {
  const [editingTags, setEditingTags] = useState(false);
  const [tagsInput, setTagsInput] = useState((clip.manual_tags ?? []).join(', '));
  const [locationInput, setLocationInput] = useState(clip.location ?? '');
  const [peopleInput, setPeopleInput] = useState((clip.people ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [similarClusters, setSimilarClusters] = useState<SimilarityCluster[] | null>(null);
  const [loadingSimilar, setLoadingSimilar] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateClip(clip.id, {
        location: locationInput || null,
        manual_tags: tagsInput ? tagsInput.split(',').map((t) => t.trim()).filter(Boolean) : null,
        people: peopleInput ? peopleInput.split(',').map((p) => p.trim()).filter(Boolean) : null,
      });
      setEditingTags(false);
      onUpdated();
    } finally {
      setSaving(false);
    }
  };

  const handleFindSimilar = async () => {
    setLoadingSimilar(true);
    try {
      const res = await fetchSimilarByClip(clip.id);
      setSimilarClusters(res.data);
    } finally {
      setLoadingSimilar(false);
    }
  };

  const proxyUrl = clip.proxy_path
    ? `/media/proxies/${pathUtil.basename(clip.proxy_path)}`
    : undefined;

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-white shadow-2xl border-l border-gray-200 overflow-y-auto z-50">
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <h2 className="font-semibold text-sm truncate">Clip #{clip.id}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
      </div>

      <div className="p-4 flex flex-col gap-4">
        {/* Video proxy preview */}
        {proxyUrl && (
          <video
            src={proxyUrl}
            controls
            className="w-full rounded bg-black aspect-video"
          />
        )}

        {/* Thumbnail strip */}
        {thumbnails.length > 0 && (
          <div className="flex gap-1 overflow-x-auto pb-1">
            {thumbnails.map((t) => (
              <img
                key={t.id}
                src={t.url}
                alt={`${t.timestamp_sec}s`}
                className="h-16 rounded flex-shrink-0"
                title={`${formatDuration(t.timestamp_sec)}`}
              />
            ))}
          </div>
        )}

        {/* File info */}
        <div className="text-xs text-gray-500 space-y-0.5">
          <p className="truncate" title={clip.file_path}>{pathUtil.basename(clip.file_path)}</p>
          <p>{clip.resolution} | {clip.fps}fps | {clip.codec} | {formatBytes(clip.file_size)} | {formatDuration(clip.duration_sec)}</p>
          {clip.recorded_at && <p>Recorded: {new Date(clip.recorded_at).toLocaleDateString()}</p>}
        </div>

        {/* AI Summary */}
        {clip.ai_summary && (
          <div>
            <h3 className="text-xs font-semibold text-gray-700 mb-1">AI Summary</h3>
            <p className="text-sm text-gray-600">{clip.ai_summary}</p>
          </div>
        )}

        {/* Quality scores */}
        {clip.ai_quality_overall !== null && (
          <div>
            <h3 className="text-xs font-semibold text-gray-700 mb-2">Quality Scores</h3>
            <div className="space-y-1.5">
              <QualityBar label="Stability" value={clip.ai_quality_stability} />
              <QualityBar label="Focus" value={clip.ai_quality_focus} />
              <QualityBar label="Exposure" value={clip.ai_quality_exposure} />
              <QualityBar label="Composition" value={clip.ai_quality_composition} />
              <QualityBar label="Audio" value={clip.ai_quality_audio} />
              <QualityBar label="Overall" value={clip.ai_quality_overall} />
            </div>
            {clip.ai_quality_issues && clip.ai_quality_issues.length > 0 && (
              <div className="mt-2 text-xs text-amber-600">
                Issues: {clip.ai_quality_issues.join(', ')}
              </div>
            )}
          </div>
        )}

        {/* Editorial scores */}
        {clip.ai_editorial_emotional !== null && (
          <div>
            <h3 className="text-xs font-semibold text-gray-700 mb-2">Editorial Value</h3>
            <div className="space-y-1.5">
              <QualityBar label="Emotional" value={clip.ai_editorial_emotional} />
              <QualityBar label="Storytelling" value={clip.ai_editorial_storytelling} />
              <QualityBar label="Uniqueness" value={clip.ai_editorial_uniqueness} />
            </div>
            {clip.ai_editorial_suggested_use && (
              <p className="mt-1 text-xs text-gray-500">
                Suggested use: <span className="font-medium">{clip.ai_editorial_suggested_use}</span>
              </p>
            )}
          </div>
        )}

        {/* Scenes */}
        {clip.ai_scenes && clip.ai_scenes.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-700 mb-2">Scenes ({clip.ai_scenes.length})</h3>
            <div className="space-y-2">
              {clip.ai_scenes.map((scene, i) => (
                <div key={i} className="text-xs bg-gray-50 rounded p-2">
                  <div className="flex justify-between text-gray-400 mb-1">
                    <span>{formatDuration(scene.start_sec)} - {formatDuration(scene.end_sec)}</span>
                    <span>{scene.mood}</span>
                  </div>
                  <p className="text-gray-600">{scene.description_de || scene.description_en}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {scene.visual_keywords?.map((kw) => (
                      <span key={kw} className="px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded text-[10px]">
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Visual keywords */}
        {clip.ai_visual_keywords && clip.ai_visual_keywords.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-700 mb-1">Keywords</h3>
            <div className="flex flex-wrap gap-1">
              {clip.ai_visual_keywords.map((kw) => (
                <span key={kw} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                  {kw}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Editable metadata */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-gray-700">Metadata</h3>
            {!editingTags ? (
              <button
                onClick={() => setEditingTags(true)}
                className="text-xs text-blue-600 hover:underline"
              >
                Edit
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setEditingTags(false)}
                  className="text-xs text-gray-400 hover:underline"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {editingTags ? (
            <div className="space-y-2">
              <div>
                <label className="text-xs text-gray-500">Location</label>
                <input
                  type="text"
                  value={locationInput}
                  onChange={(e) => setLocationInput(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Tags (comma-separated)</label>
                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">People (comma-separated)</label>
                <input
                  type="text"
                  value={peopleInput}
                  onChange={(e) => setPeopleInput(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                />
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-500 space-y-1">
              <p>Location: {clip.location || '-'}</p>
              <p>Tags: {clip.manual_tags?.join(', ') || '-'}</p>
              <p>People: {clip.people?.join(', ') || '-'}</p>
            </div>
          )}
        </div>

        {/* Find Similar button */}
        <button
          onClick={handleFindSimilar}
          disabled={loadingSimilar}
          className="w-full px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 transition-colors disabled:opacity-50"
        >
          {loadingSimilar ? 'Searching...' : 'Find Similar Clips'}
        </button>

        {similarClusters !== null && (
          <div>
            {similarClusters.length === 0 ? (
              <p className="text-xs text-gray-400">No similar clusters found. Try computing similarity first.</p>
            ) : (
              <div className="space-y-2">
                {similarClusters.map((cluster) => (
                  <div key={cluster.id} className="text-xs bg-gray-50 rounded p-2">
                    <p className="text-gray-500 mb-1">{cluster.reason}</p>
                    <p className="text-gray-600">
                      {cluster.members.length} clips in cluster
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
