// Compare the stored shakes of a project with the user's verdicts (tests/fixtures/shakes/arrifana-verdicts.json).
// Usage: npm run eval:shakes -- <project dir> [verdicts.json]   (not part of test:all; the project needs `clippilot motion` run)
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { evaluateShakes, type Verdicts } from '../src/core/motion/eval.js';

const [projectDir, verdictsPath] = process.argv.slice(2);
if (!projectDir) {
  console.error('Usage: npm run eval:shakes -- <project dir> [verdicts.json]');
  process.exit(2);
}
const verdicts = JSON.parse(fs.readFileSync(verdictsPath ?? new URL('../tests/fixtures/shakes/arrifana-verdicts.json', import.meta.url), 'utf8')) as Verdicts;
const db = new Database(path.join(projectDir, '.clippilot', 'clippilot.db'), { readonly: true });
const rows = db.prepare('SELECT c.file_path AS file_path, s.start_sec AS start, s.end_sec AS end FROM shakes s JOIN clips c ON c.id = s.clip_id').all() as
  { file_path: string; start: number; end: number }[];
db.close();
const r = evaluateShakes(rows.map((x) => ({ file: path.basename(x.file_path), start: x.start, end: x.end })), verdicts);
console.log(`${rows.length} shakes detected; ${r.judged} judged candidates (${r.yes} yes).`);
console.log(`precision ${r.precision.toFixed(2)} (${r.kept_yes}/${r.kept} kept candidates are real)  recall ${r.recall.toFixed(2)} (${r.kept_yes}/${r.yes})`);
console.log(`${r.unjudged} detections overlap no judged candidate (new, to be reviewed).`);
