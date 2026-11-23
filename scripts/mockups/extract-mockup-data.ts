// Mockup data: run from a ClipPilot working dir, writes window.DATA (events, clips, moments, small base64 thumbnails, proxy file names,
// plus the real "Main" cut: brief, scenes, panels, moment statuses, hidden clips).
// Usage: cd <workdir> && npx tsx <repo>/scripts/mockups/extract-mockup-data.ts <repo>/mockups/scene-board.data.js
// Then serve with scripts/mockups/serve.ts so proxies play.
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
const db = new Database('.clippilot/clippilot.db', { readonly: true });
const events = db.prepare('select id, trim(name) name from events order by sort_order').all();
const clips = db.prepare('select id, event_id, file_path, proxy_path, duration_sec, fps, recorded_at, ai_summary, hidden from clips order by recorded_at').all() as any[];
const moments = db.prepare('select id, clip_id, start_sec, end_sec, description, tier, shot, role, issues, slowmo, suggested_speed, audio_keep, audio_type, status, reject_reason from highlights order by clip_id, start_sec').all() as any[];
const thumbs: Record<string,string> = {};
for (const m of moments) {
  const t = db.prepare('select file_path from thumbnails where clip_id=? order by abs(timestamp_sec-?) limit 1').get(m.clip_id, (m.start_sec+m.end_sec)/2) as any;
  if (t) thumbs[m.id] = 'data:image/jpeg;base64,' + (await sharp(t.file_path).resize(240).jpeg({ quality: 62 }).toBuffer()).toString('base64');
  m.issues = JSON.parse(m.issues || '[]');
}
const story = db.prepare("select id, name, brief, brief_state from stories order by (name = 'Main') desc, id limit 1").get() as any;
const cut = story && {
  name: story.name,
  brief: story.brief ? { ...JSON.parse(story.brief), state: story.brief_state } : null,
  scenes: (db.prepare('select id, name, event_id from scenes where story_id=? order by position').all(story.id) as any[]).map(s => ({
    ...s,
    panels: (db.prepare('select id, intent, state, source, clip_id, moment_id, start_sec, end_sec, speed from story_segments where scene_id=? order by position').all(s.id) as any[])
      .map(p => ({ ...p, cands: (db.prepare('select moment_id from panel_candidates where panel_id=? order by position').all(p.id) as any[]).map(c => c.moment_id) })),
  })),
};
const out = { events, clips: clips.map(c => ({ ...c, file: path.basename(c.file_path), proxy: c.proxy_path ? path.basename(c.proxy_path) : null, proxy_path: undefined })), moments, thumbs, cut };
writeFileSync(process.argv[2] ?? 'scene-board.data.js', `window.DATA=${JSON.stringify(out)};`);
console.log(events.length, clips.length, moments.length, Object.keys(thumbs).length, cut ? `${cut.scenes.length} scenes` : 'no cut');
