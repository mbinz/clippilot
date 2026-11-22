// Mockup data: run from a ClipPilot working dir, writes JSON with events, clips, moments and small base64 thumbnails.
// Usage: cd <workdir> && npx tsx <repo>/scripts/mockups/extract-mockup-data.ts out.json  (wrap as window.DATA=…; for the mockup)
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
const db = new Database('.clippilot/clippilot.db', { readonly: true });
const events = db.prepare('select id, trim(name) name from events order by sort_order').all();
const clips = db.prepare('select id, event_id, file_path, duration_sec, fps, recorded_at, ai_summary from clips order by recorded_at').all() as any[];
const moments = db.prepare('select id, clip_id, start_sec, end_sec, description, tier, shot, role, issues, slowmo, suggested_speed, audio_keep, audio_type from highlights order by clip_id, start_sec').all() as any[];
const thumbs: Record<string,string> = {};
for (const m of moments) {
  const t = db.prepare('select file_path from thumbnails where clip_id=? order by abs(timestamp_sec-?) limit 1').get(m.clip_id, (m.start_sec+m.end_sec)/2) as any;
  if (t) thumbs[m.id] = 'data:image/jpeg;base64,' + (await sharp(t.file_path).resize(240).jpeg({ quality: 62 }).toBuffer()).toString('base64');
  m.issues = JSON.parse(m.issues || '[]');
}
const out = { events, clips: clips.map(c => ({ ...c, file: path.basename(c.file_path), file_path: undefined })), moments, thumbs };
writeFileSync(process.argv[2] ?? 'arrifana.json', JSON.stringify(out));
console.log(events.length, clips.length, moments.length, Object.keys(thumbs).length);
