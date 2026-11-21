/**
 * M2.7 G6 shake spike (measurement only, not wired into the CLI, not in tsconfig include).
 *
 * Usage: npx tsx scripts/spikes/shake-spike.ts [pilot.db]
 * Default DB: ~/Video/ClipPilot M2 Pilot/.clippilot/clippilot.db (opened read-only; proxies only read via ffmpeg).
 * Zero API calls.
 *
 * Labels:
 *   shaky  = current `highlights` of clips 26, 30, 16, plus any moment whose 👎 verdict reasons include shake
 *   steady = 👍-only verdict ranges (calibration snapshot) on other clips, no shake reason
 * Clip 16 also has a 👍 verdict (0-5 s), so the tables are computed twice
 * (A: spec labels incl. all of clip 16 as shaky, B: clip 16 only where it overlaps the 👎 "quality" verdict).
 *
 * Metrics (per moment, ffmpeg over [start,end] on the proxy, -an):
 *   deshake log (Ori x/y = raw global motion px/frame, Avg = smoothed path):
 *     motion  = mean |Ori|              (camera speed; pans are large but not shaky)
 *     jitter  = RMS(Ori - Avg) * fps    (high-frequency residual vs. smoothed path, px/s)
 *     jerk    = RMS(dOri) * fps         (frame-to-frame change of global motion, px/s)
 *   signalstats YDIF mean, blurdetect mean.
 */
import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const DB = process.argv[2] ?? join(homedir(), "Video/ClipPilot M2 Pilot/.clippilot/clippilot.db");
const SHAKY_CLIPS = new Set([26, 30, 16]);

type Moment = { clipId: number; start: number; end: number; label: "shaky" | "steady"; proxy: string; fps: number; ambiguous: boolean };
type Row = Moment & { motion: number; jitter: number; jerk: number; ydif: number; blur: number; ms: Record<string, number> };

const db = new Database(DB, { readonly: true, fileMustExist: true });
const clips = new Map<number, { proxy: string; fps: number }>();
for (const c of db.prepare("SELECT id, proxy_path, fps FROM clips WHERE proxy_path IS NOT NULL").all() as { id: number; proxy_path: string; fps: number | null }[])
  clips.set(c.id, { proxy: c.proxy_path, fps: c.fps ?? 25 });

const moments: Moment[] = [];
const mk = (clipId: number, start: number, end: number, label: "shaky" | "steady") => {
  const c = clips.get(clipId);
  if (c) moments.push({ clipId, start, end, label, proxy: c.proxy, fps: c.fps, ambiguous: false });
};
type Verdict = { clip_id: number; start_sec: number; end_sec: number; verdicts: string };
for (const h of db.prepare("SELECT clip_id, start_sec, end_sec FROM highlights WHERE clip_id IN (26,30,16)").all() as { clip_id: number; start_sec: number; end_sec: number }[])
  mk(h.clip_id, h.start_sec, h.end_sec, "shaky");
const verdicts = db.prepare("SELECT clip_id, start_sec, end_sec, verdicts FROM highlight_verdicts").all() as Verdict[];
for (const v of verdicts) {
  const arr: string[] = JSON.parse(v.verdicts);
  const shakeReason = arr.some((r) => /shak|wobbl/i.test(r));
  if (arr.includes("bad") && shakeReason && !SHAKY_CLIPS.has(v.clip_id)) mk(v.clip_id, v.start_sec, v.end_sec, "shaky");
  else if (arr.length === 1 && arr[0] === "good" && !SHAKY_CLIPS.has(v.clip_id)) mk(v.clip_id, v.start_sec, v.end_sec, "steady");
  else if (arr.length === 1 && arr[0] === "good") console.log(`note: clip ${v.clip_id} ${v.start_sec}-${v.end_sec} has a good verdict but is on the shaky clip list`);
}
// variant B: clip 16 moments are shaky only where they overlap a 👎 verdict
const clip16Bad = verdicts.filter((v) => v.clip_id === 16 && (JSON.parse(v.verdicts) as string[]).includes("bad"));
for (const m of moments) if (m.clipId === 16) m.ambiguous = !clip16Bad.some((v) => m.start < v.end_sec && m.end > v.start_sec);
db.close();

function ff(args: string[]): { sec: number; err: string } {
  const t = process.hrtime.bigint();
  const r = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", ...args], { encoding: "utf8" });
  return { sec: Number(process.hrtime.bigint() - t) / 1e9, err: r.stderr };
}
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const rms = (a: number[]) => Math.sqrt(mean(a.map((x) => x * x)));
const metaVals = (file: string, key: string) =>
  readFileSync(file, "utf8").split("\n").filter((l) => l.includes(key + "=")).map((l) => parseFloat(l.split("=")[1]!)).filter((x) => Number.isFinite(x));

const tmp = mkdtempSync(join(tmpdir(), "shake-spike-"));
const rows: Row[] = [];
for (const m of moments) {
  const seek = ["-ss", String(m.start), "-to", String(m.end), "-i", m.proxy, "-an"];
  const dlog = join(tmp, "ds.log"), ylog = join(tmp, "y.txt"), blog = join(tmp, "b.txt");
  const a = ff([...seek, "-vf", `deshake=filename=${dlog}`, "-f", "null", "-"]);
  const b = ff([...seek, "-vf", `signalstats,metadata=print:key=lavfi.signalstats.YDIF:file=${ylog}`, "-f", "null", "-"]);
  const c = ff([...seek, "-vf", `blurdetect,metadata=print:key=lavfi.blur:file=${blog}`, "-f", "null", "-"]);
  if (a.err || b.err || c.err) console.error("ffmpeg stderr", m, a.err, b.err, c.err);
  const lines = readFileSync(dlog, "utf8").trim().split("\n").slice(1).map((l) => l.split(",").map(Number));
  const ox = lines.map((l) => l[0]!), oy = lines.map((l) => l[3]!), ax = lines.map((l) => l[1]!), ay = lines.map((l) => l[4]!);
  const motion = mean(ox.map((x, i) => Math.hypot(x, oy[i]!)));
  const jitter = rms(ox.map((x, i) => Math.hypot(x - ax[i]!, oy[i]! - ay[i]!))) * m.fps;
  const jerk = rms(ox.slice(1).map((x, i) => Math.hypot(x - ox[i]!, oy[i + 1]! - oy[i]!))) * m.fps;
  rows.push({ ...m, motion, jitter, jerk, ydif: mean(metaVals(ylog, "lavfi.signalstats.YDIF")), blur: mean(metaVals(blog, "lavfi.blur")), ms: { deshake: a.sec, signalstats: b.sec, blurdetect: c.sec } });
}
rmSync(tmp, { recursive: true, force: true });

console.log("\nPer moment (motion px/f | jitter px/s | jerk px/s | ydif | blur | wall s deshake/signalstats/blurdetect)");
for (const r of rows.sort((x, y) => x.label.localeCompare(y.label) || x.clipId - y.clipId || x.start - y.start))
  console.log(`${r.label.padEnd(6)}${r.ambiguous ? "*" : " "} clip ${String(r.clipId).padStart(2)} ${r.start.toFixed(1).padStart(5)}-${r.end.toFixed(1).padEnd(5)} dur ${(r.end - r.start).toFixed(1).padStart(4)} | ${r.motion.toFixed(2).padStart(6)} | ${r.jitter.toFixed(1).padStart(7)} | ${r.jerk.toFixed(1).padStart(7)} | ${r.ydif.toFixed(2).padStart(6)} | ${r.blur.toFixed(2).padStart(6)} | ${r.ms.deshake!.toFixed(2)}/${r.ms.signalstats!.toFixed(2)}/${r.ms.blurdetect!.toFixed(2)}`);
console.log("(* = clip 16 moment that does not overlap the thumbs-down verdict)");

const q = (s: number[], p: number) => { const a = [...s].sort((x, y) => x - y); const i = (a.length - 1) * p; return a[Math.floor(i)]! + (a[Math.ceil(i)]! - a[Math.floor(i)]!) * (i - Math.floor(i)); };
const dist = (s: number[]) => `n=${s.length} min=${Math.min(...s).toFixed(2)} med=${q(s, 0.5).toFixed(2)} max=${Math.max(...s).toFixed(2)}`;
const metrics = ["motion", "jitter", "jerk", "ydif", "blur"] as const;

function report(title: string, set: Row[]) {
  const sh = set.filter((r) => r.label === "shaky"), st = set.filter((r) => r.label === "steady");
  console.log(`\n===== ${title}: ${sh.length} shaky, ${st.length} steady =====`);
  for (const k of metrics) {
    console.log(`\n[${k}]\n  shaky  ${dist(sh.map((r) => r[k]))}\n  steady ${dist(st.map((r) => r[k]))}`);
    const vals = [...new Set(set.map((r) => r[k]))].sort((a, b) => a - b);
    let best = { bal: -1, acc: 0, t: 0, dir: 1 };
    for (let i = 0; i < vals.length - 1; i++) {
      const t = (vals[i]! + vals[i + 1]!) / 2;
      for (const dir of [1, -1]) {
        const pred = (r: Row) => (dir * (r[k] - t) > 0 ? "shaky" : "steady");
        const tpr = sh.filter((r) => pred(r) === "shaky").length / sh.length, tnr = st.filter((r) => pred(r) === "steady").length / st.length;
        const bal = (tpr + tnr) / 2;
        if (bal > best.bal) best = { bal, acc: set.filter((r) => pred(r) === r.label).length / set.length, t, dir };
      }
    }
    const wrong = set.filter((r) => (best.dir * (r[k] - best.t) > 0 ? "shaky" : "steady") !== r.label);
    console.log(`  best: ${best.dir > 0 ? "shaky if >" : "shaky if <"} ${best.t.toFixed(3)}  accuracy ${(best.acc * 100).toFixed(0)}%  balanced ${(best.bal * 100).toFixed(0)}%`);
    console.log(`  misclassified: ${wrong.map((r) => `#${r.clipId}@${r.start}-${r.end}(${r.label},${r[k].toFixed(2)})`).join(" ") || "none"}`);
  }
}
report("Variant A (spec: all clip 16 moments shaky)", rows);
report("Variant B (clip 16 only where thumbs-down overlaps)", rows.filter((r) => !r.ambiguous));
const per = (k: string) => mean(rows.map((r) => r.ms[k]!));
const perSec = (k: string) => mean(rows.map((r) => r.ms[k]! / (r.end - r.start)));
console.log(`\nCost (wall s per moment, mean dur ${mean(rows.map((r) => r.end - r.start)).toFixed(1)} s): deshake ${per("deshake").toFixed(2)}, signalstats ${per("signalstats").toFixed(2)}, blurdetect ${per("blurdetect").toFixed(2)}; per moment-second: ${perSec("deshake").toFixed(2)} / ${perSec("signalstats").toFixed(2)} / ${perSec("blurdetect").toFixed(2)}`);
