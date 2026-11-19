# ClipPilot — Status

Single source of truth for what works, what doesn't, and how to make a change.
Update this file whenever the answer to any of those questions shifts.

## Version & state

`v0.1.0` — ingest (resumable) / analyze with timestamped highlights / search / summary; OTIO + FCPXML export verified in free Resolve (M1). No story/storyboard workflow yet (M3).
Solo project, MIT. Run via `tsx`, no compiled binary.

**Direction:** data pipeline + web UI (primary interactive surface) + CLI skill (AI/scripting surface).
Web UI is committed — Phase C deletion plan cancelled. See [PRD.md](PRD.md) for full scope.

## Implemented

- **Ingest** — recursive scan, ffprobe metadata, ffmpeg 720p proxies, thumbnails, content hashing → SQLite
- **Analyze** — Gemini 2.5 Flash on the 720p proxy **video** (inline, ≤ ~20 MB) via `@google/genai`, Zod-validated: scene, quality, editorial + **timestamped highlights** (`highlights` table). Retries malformed JSON (3×); `--retry-errors` re-runs only failed clips; interrupted `analyzing` clips are picked up again.
- **Resumable ingest** — fast skip on same path+size (no re-hash), atomic proxies (`.partial.mp4` → rename), `clips.scene_hint` = source subfolder.
- **Summary** — `clippilot summary --json`: counts, per-scene-hint stats, places, moments, best highlights.
- **Search** — FTS engine (`src/core/search/`); CLI `search --json`
- **Similarity** — duplicate/near-dup detection via union-find on location/time/keywords/scene
- **Export** — CSV, JSON, EDL, FCPXML. CLI `export --story <id>` or `--clips <ids>`. Cut points (`start_sec`/`end_sec`), same clip multiple times, and timecode handling are all implemented in the data layer and exporters. Known defects with mixed fps / formats / TC; never verified in Resolve (see M1).
- **Contact sheet** — `clippilot contact-sheet` renders a labeled grid PNG (default 4×6) for visual scanning by humans or Claude. Uses `sharp`.
- **Skill surface** — `.claude/skills/clippilot/SKILL.md` documents the verbs Claude should use (`search`, `get-clip`, `summary`, `similar`, `mark-best`, `tag`, `contact-sheet`, `export`, `stats`) — all emit JSON.
- **Story data layer** — `stories` + `story_segments` tables (migration 002), `StoryRepository` with full CRUD. Currently flat (no scene layer). Cut points (`start_sec`/`end_sec`) and multiple instances of the same clip are supported. Scene layer, routes, UI → M3/M4.
- **Web UI** — Hono server (`clippilot ui`), Vite frontend in `web/`. Primary interactive surface (browse, filters, clip detail with proxy playback, similarity clusters). Storyboard view not built yet (M4).
- **Tag / Stats / Config** — CLI with `--json`
- **DB migrations** — runner with versioning, migrations 001–008 applied: `001_initial`, `002_stories`, `003_similarity`, `004_timecode` (clips.start_timecode), `005_nb_frames` (clips.nb_frames), `006_has_audio_video` (clips.has_video/has_audio), `007_scene_hint` (clips.scene_hint), `008_highlights` (highlights table)

## Re-plan 2026-11-18

Grilling session reset the direction — see [PRD.md](PRD.md) (Goal, Workflow, Milestones).
Why: the Resolve handoff was unreliable in practice (timelines failed to load, clips "missing"), and the
Portugal test only ever ingested 33 of 508 clips with no story layer — the actual workflow never existed.
The old 6-item backlog (scene schema, per-scene export, cut/scene routes, sequence builder UI,
mark-best UI, cut/scene CLI) is folded into the milestones below. Per-scene export is replaced by
one timeline per cut with scene markers.

Acceptance project: `~/Video/Portugal` — 508 videos / 123 GB, Sony A7C II (`C0xxx`, embedded TC)
+ GoPro (`GH01…`), 25/50/100 fps, folders `01 Flug`…`04 Lissabon`, source root has a trailing space (`Src /`).

## Milestones (v0.2 = M0–M4)

### M0 — Docs reset ✅ 2026-11-18
PRD / ARCHITECTURE / STATUS / CLAUDE.md rewritten around the storyboard workflow.

### M1 — Export that works ✅ 2026-11-18
Fixture: `~/Video/ClipPilot M1 Fixture/Src /` (path has spaces + trailing space on purpose), 6 real Portugal clips:

| Folder | File | Camera | Format |
|---|---|---|---|
| `01 Ankunft` | `C0289.MP4` | Sony A7C II | 3840×2160 25p, TC `05:32:12:00`, 13.0 s |
| `01 Ankunft` | `GH010365.MP4` | GoPro | 3840×2160 25p (avg rate wobbles), TC `13:58:58:20`, 9.4 s |
| `02 Farol Strand` | `C0361.MP4` | Sony | 3840×2160 50p, TC `05:54:26:44`, 7.2 s |
| `02 Farol Strand` | `GH010376.MP4` | GoPro | 1920×1080 50p **VFR** (avg 49.93), TC `10:11:29:08`, 28.4 s |
| `03 Delfine` | `C0562.MP4` | Sony | 1920×1080 **100p**, TC `06:37:54:72` (frames count to 99!), 4.3 s |
| `03 Delfine` | `C0382.MP4` | Sony | 1920×1080 100p, TC `05:58:51:84`, 3.8 s |

Reference timeline "M1 Fixture" — 3840×2160, 25 fps. Approximate in/out is fine; tests read exact values from the golden:

| # | Clip | Source in→out | Speed | Marker at start |
|---|---|---|---|---|
| 1 | C0289 | 2 s → 6 s | 100 % | `01 Ankunft` |
| 2 | GH010365 | 1 s → 5 s | 100 % | |
| 3 | C0361 | 1 s → 4 s | 50 % | `02 Farol Strand` |
| 4 | GH010376 | 5 s → 9 s | 100 % | |
| 5 | C0562 | 0.5 s → 3.5 s | 25 % | `03 Delfine` |
| 6 | C0562 (again) | 0.5 s → 3.5 s | 100 % | |
| 7 | C0382 | whole clip | 100 % | |

**M1.0 — Golden files ✅ 2026-11-18** — `tests/fixtures/resolve-golden/m1-fixture.fcpxml` (from Resolve's
`.fcpxmld` bundle, `Info.fcpxml`, **FCPXML 1.13**) and `m1-fixture.otio`. Deviations from the plan, all fine
because tests derive values from the golden: timeline is **1920×1080 @ 24 fps** (Resolve default), clip
lengths differ from the table, marker 3 sits on clip 6.
What Resolve actually writes (the facts M1.1/M1.2 must reproduce):
- One `<format>` per distinct source format, with `width`/`height` and `frameDuration` (`1/25s`, `1/50s`, `1/100s`);
  sequence has its own format (`1/24s`), `tcStart="3600/1s"`, `tcFormat="NDF"`. Name pattern `FFVideoFormat1080p100` /
  `FFVideoFormat3840x2160p25`.
- One `<asset>` per **timeline use** (clip used twice → two assets), `format` = source format, `start` = source TC,
  `duration` = full media, `audioSources`/`audioChannels`, `src` percent-encoded incl. trailing space (`Src%20/`).
- `<asset-clip>` has `format` = source format, `offset`/`duration` on the timeline grid, `start` in source time.
- Speed → `<timeMap frameSampling="floor">` with two linear `<timept>` spanning the asset; OTIO → `LinearTimeWarp.1`
  with `time_scalar` 0.5 / 0.25.
- **Sony 100p TC quirk:** Resolve reads ffprobe TC `06:37:54:72` as 23874.36 s and `05:58:51:84` as 21531.42 s —
  frame field ÷ 200, not ÷ 100. 25p/50p clips (Sony and GoPro) are frame field ÷ fps as expected.
  Hypothesis (2 data points, both Sony 100p): for fps > 50 the TC frame field counts at 2× fps.
- **VFR quirk:** GH010376 — Resolve asset duration 1415 frames @50 (`283/10s`), ffprobe `nb_frames` 1413.
- **Markers:** Resolve's FCPXML export contains **none**. OTIO has them as clip markers on V1 (and `Marker 1` on A1).
- OTIO has a Video and an Audio track; each clip appears on both.

**M1.1 — FCPXML matches Resolve (implementer) ✅ 2026-11-18**
- `ExportSegment` gains optional `speed` (default 1.0) and `scene_name`; `ExportOptions` gains `width`/`height`.
- `tests/unit/core/export/fcpxml-golden.test.ts` builds the 7 segments from **real ffprobe facts** (stream duration,
  nb_frames, TC strings, fps) — only source in/out + speed come from the golden's clip times — exports at
  1920×1080 @ 24 and compares to the golden as exact rationals (asset src/start/duration, formats, clip
  offset/start/duration, timeMap slope, tcFormat, sequence tcStart).
- Fixed: one `<format>` per source format with width/height; one asset per use; mixed fps allowed (FCPXML);
  100 fps in rate table; VFR average snapped (49.93 → 50); Sony fps>50 TC rule isolated in `tcFrameFieldRate`
  (hypothesis — re-check in M1.3); `timeMap` for speed; scene markers on the first clip of each scene; no more
  1-frame end trim; emits FCPXML 1.10.
- Ingest: `duration_sec` from the video stream, not the container (GoPro differs by 3 frames). Existing DBs keep
  old values until re-ingest.
- Known leftovers: no `audioSources`/`audioChannels`; DF timecode treated as NDF; EDL still rejects mixed fps;
  marker placement on retimed clips unverified.

**M1.2 — OTIO exporter (implementer)** — same golden-round-trip test against `m1-fixture.otio`, new
`src/core/export/otio.ts` + `otio` format in CLI. No OTIO library dependency unless the golden needs it.

**M1.2 — OTIO exporter ✅** — `src/core/export/otio.ts`, shared frame math in `timeline-plan.ts`, `--format otio`.

**M1.3 — Manual import in free Resolve ✅ 2026-11-18** (spike `scripts/m1-fixture-export.ts`, now deleted)
| Check | FCPXML | OTIO |
|---|---|---|
| Imports, all 7 clips online | ✅ | ✅ |
| Lengths / speeds 50 %·25 % | ✅ | ✅ |
| First frame of Sony 100p clip | — | ✅ matches hand-built timeline |
| Scene markers | ❌ dropped by Resolve | ✅ |
| Audio linked to video | ✅ | ❌ → fixed in M1.4 |

**Decision:** OTIO primary, FCPXML secondary (see ARCHITECTURE #5).

**M1.4 — OTIO audio/video link ✅** — `Resolve_OTIO` link-group + channel metadata matching the golden.

Done when: M1.1 + M1.2 green, M1.3 checklist passes for at least one format. ✅ — OTIO re-import confirmed linked audio/video.

### M2 — Understand the footage ✅ 2026-11-19
- Resumable / incremental ingest (survive interruption on a 123 GB trip); capture folder as scene hint.
- Gemini analysis of the proxy **video** → timestamped highlights table. Pilot on `03 Arrifana/Delfine`
  (33 clips, 457 s total, 9.2 GB) to judge quality + cost before running all 508.
- Project summary command ("what's in here").

Facts found while planning (2026-11-18):
- `GeminiClient.analyzeVideo` **already** sends the proxy MP4 (inline base64), not thumbnails — ARCHITECTURE was wrong.
  Inline requests cap at ~20 MB; Delfine proxies average ~4.4 MB. Long clips will need the Files API (deferred, see below).
- DB path = `<cwd>/.clippilot/clippilot.db` (`resolveDbPath(process.cwd())`), proxies/thumbnails under the same dir.
  The pilot therefore runs from a separate working dir (`~/Video/ClipPilot M2 Pilot/`); the Portugal DB is never opened.
- Resume gaps today: (a) every re-run SHA-256-hashes every file before the skip check (123 GB re-read);
  (b) `createProxy` writes in place, so an interrupted ffmpeg leaves a truncated `<hash>.mp4` that the next run
  silently reuses; (c) clips stuck in `analysis_status='analyzing'` after an interrupted analyze are never picked up again.

**M2.1 — Resumable ingest + scene hint (implementer)**
Behavior:
- Migration `007_scene_hint`: `clips.scene_hint TEXT` (nullable).
- `ingestDirectory` sets `scene_hint` = the file's parent directory relative to the ingest root, with `/` separators
  and segments kept verbatim (trailing spaces preserved). Files directly in the root get the root folder's basename.
  e.g. root `…/Import`, file `…/Import/03 Arrifana/Delfine/C0560.MP4` → `03 Arrifana/Delfine`; root `…/Delfine`,
  file `…/Delfine/C0560.MP4` → `Delfine`. Pure helper `sceneHintFor(rootDir, filePath)` in `core/ingest/`.
- Fast skip: before hashing, if a clip with the same `file_path` **and** `file_size` exists, skip it without hashing
  (counts as `skipped`). New `ClipRepository.findByPathAndSize(path, size)`. Hash-based skip stays as fallback.
- Atomic proxy: `createProxy` renders to `<hash>.partial.mp4` and renames to `<hash>.mp4` only on success; a leftover
  `.partial.mp4` is never treated as done (overwritten on retry). Existing final `<hash>.mp4` still reused.
- `analyze` recovers interrupted runs: clips in `analyzing` are treated as pending (`findPending` returns
  `pending` + `analyzing`).
Tests first:
- `tests/unit/core/ingest/scene-hint.test.ts`: the two examples above, a nested 3-level case, and a root path with a
  trailing-space segment (`/x/Src /Import`, file `/x/Src /Import/01 Flug/a.mp4` → `01 Flug`).
- `tests/unit/db/migrations.test.ts`: after migrations, `clips` has `scene_hint`.
- `tests/unit/db/repositories/clip.repository.test.ts`: `findByPathAndSize` hits on same path+size, misses on
  different size; `findPending` returns an `analyzing` clip.
- `tests/integration/ingest.test.ts`: (1) ingest a 2-folder tree (`A/x.mp4`, `B/y.mp4` generated with ffmpeg) →
  `scene_hint` `A`/`B`; (2) second ingest of the same tree reports `skipped=2` and **does not call the hasher**
  (inject/spy — e.g. optional `hashFile` dependency in `IngestDependencies`); (3) a pre-existing
  `<hash>.partial.mp4` garbage file in the proxy dir doesn't stop a valid proxy being produced (ffprobe the result
  has a video stream and duration ≈ source).
Done when: tests above red→green, `npm run typecheck && npm run test:all` green, `ingest` CLI unchanged in flags.

**M2.2 — Timestamped highlights (implementer)**
Behavior:
- Migration `008_highlights`: table `highlights(id INTEGER PK, clip_id INTEGER NOT NULL REFERENCES clips(id) ON DELETE
  CASCADE, start_sec REAL NOT NULL, end_sec REAL NOT NULL, description TEXT NOT NULL, quality INTEGER NOT NULL
  CHECK (quality BETWEEN 1 AND 10), created_at TEXT DEFAULT now)`, index on `clip_id`.
- Gemini response schema gains `highlights: [{ start_sec: number, end_sec: number, description: string (English),
  quality: int 1–10 }]` (defaults to `[]` if missing, so old-shaped responses still parse). Prompt asks for 0–5
  standout moments per clip, seconds from clip start, in English, quality = how strong as a shot in a travel montage.
- Pure `normalizeHighlights(raw, durationSec)`: clamps `start_sec` ≥ 0 and `end_sec` ≤ duration, drops entries with
  `end_sec - start_sec < 0.5` after clamping, sorts by `start_sec`, rounds to 0.01 s.
- `HighlightRepository` (`db/repositories/highlight.repository.ts`): `replaceForClip(clipId, items)` (one transaction:
  delete + insert, so re-analysis never duplicates), `findByClip(clipId)` ordered by start, `listByProject(projectId)`.
- `analyzeClips` accepts an optional injected client (`{ analyzeVideo(path): Promise<ClipAnalysisResponse> }`,
  default `new GeminiClient(config)`) and a `HighlightRepository`; on success it stores clip fields **and**
  `replaceForClip(clip.id, normalizeHighlights(resp.highlights, clip.duration_sec))`.
- JSON: `clipToJson(clip, thumbnails?, highlights?)` adds `highlights: [{id,start_sec,end_sec,description,quality}]`;
  `get-clip --json` and `search --json` include them for every clip.
Tests first:
- `tests/unit/core/analyze/schema.test.ts`: response with highlights parses; response without `highlights` parses to
  `[]`; quality 11 or 0 rejected.
- `tests/unit/core/analyze/highlights.test.ts` (`normalizeHighlights`): clamp past-end, drop zero-length, sort.
  Duration input is a literal clip duration (e.g. 13.0), never computed from the expected output.
- `tests/unit/db/repositories/highlight.repository.test.ts`: replace twice → only second set remains; cascade on clip
  delete; `listByProject` filters by project.
- `tests/unit/core/analyze/analyze-clips.test.ts`: in-memory DB, a clip inserted with `duration_sec: 4.3`, fake client
  returns a fixed literal response with one highlight `{start 3.5, end 9}` → stored highlight is `3.5–4.3`; clip
  status `done`; a second run with a different fake response replaces the highlights.
- `tests/unit/cli/json.test.ts`: `clipToJson` with highlights includes them; without → key absent.
Done when: red→green, typecheck + test:all green.

**M2.3 — Project summary command (implementer)**
Behavior: `clippilot summary [--project <name>] [--top <n>=10] --json` prints
```
{ project, clips: { total, analyzed, pending, error }, total_duration_sec,
  scene_hints: [{ scene_hint, clips, duration_sec, highlights }]   // sorted by scene_hint
  places:  [{ name, clips }]     // ai_scenes[].setting + clips.location, case-insensitive merge, desc by clips
  moments: [{ name, clips }]     // ai_scenes[].activity, same rules
  best_highlights: [{ highlight_id, clip_id, file_name, scene_hint, start_sec, end_sec, description, quality }]
                                 // desc by quality, then clip_id, start_sec; capped at --top
}
```
Without `--json`: a short human table. Logic lives in a pure `buildProjectSummary(clips, highlights, {top})` in
`src/core/summary.ts`; the command only loads rows and prints.
Tests first: `tests/unit/core/summary.test.ts` with literal clip rows (2 scene hints, `ai_scenes` JSON strings
mixing `Beach`/`beach`, one clip with `ai_scenes = null`) and literal highlights → expected counts, merge, ordering,
`--top` cap, unanalyzed clip counted in `scene_hints` but not in places.
Done when: red→green, typecheck + test:all green, `summary --json` works on the Delfine pilot DB.

**M2.2b — Prompt fixes after pilot run 1 (implementer)**
Pilot run 1 (33 clips, 0 errors, 47 highlights, q 6–9): 6/47 highlights were exactly `3.5–7.0` = the numbers in
the prompt's example JSON (anchoring), and `setting`/`activity` came back as long mixed DE/EN sentences, so
`summary` places/moments were 37 singletons. Behavior:
- The `highlights` example in `USER_PROMPT` uses placeholders, not numbers (e.g. `"start_sec": <Sekunden ab Clip-Beginn>`),
  and the instructions say timestamps must come from what is visible in the video.
- `setting` and `activity` in the scene example and instructions: short **English** lowercase tags, 1–3 words
  (e.g. `"marina"`, `"open sea"`, `"dolphin watching"`), reusable across clips. Other fields unchanged.
Tests first: `tests/unit/core/analyze/prompts.test.ts` — no `"start_sec": <digit>` / `"end_sec": <digit>` inside the
highlights example; prompt mentions English tags of 1–3 words for setting/activity.
Done when: red→green, typecheck + test:all green; pilot run 2 (`analyze --force` on Delfine) shows no repeated
example timestamps and places/moments that group.

**M2.2c — Analysis robustness after pilot run 2 (implementer)**
Pilot run 2 (prompt M2.2b): 32/33 done, 38 highlights, no anchored timestamps, places 37 → 22 (`open sea` 11,
`marina` 5). C0586 failed: Gemini returned malformed JSON (`Expected double-quoted property name…`) and the client
does not retry parse errors (message wrongly says "after 5 attempts"). Plain `analyze` skips `error` clips, and
`--force` re-runs everything. Tags still sometimes come back as lists (`marina, boat`). Behavior:
- `GeminiClient` retries a response that fails `JSON.parse` or Zod validation, up to 3 attempts total; 429/503
  backoff unchanged; the final error message states the real number of attempts made. To make this testable the
  constructor accepts an optional `generate(videoBase64) => Promise<string>` (default = the current
  `ai.models.generateContent` call returning `response.text`).
- `analyze --retry-errors`: resets `error` clips (optionally of `--project`) to `pending` before collecting pending
  clips. New `ClipRepository.resetErrors(projectId?) → number` (also clears `analysis_error`).
- `buildProjectSummary`: a `setting`/`activity`/`location` value containing commas counts as several tags
  (`"marina, boat"` → `marina` + `boat`), each trimmed; still one count per clip.
Tests first:
- `tests/unit/core/analyze/gemini-client.test.ts`: fake `generate` returns `'{"scenes": [ {'` then a valid literal
  response → `analyzeVideo` resolves, `generate` called twice; always-malformed → rejects after exactly 3 calls with
  a message containing `3 attempts`. (Use a tiny temp file as the "proxy"; no network.)
- `tests/unit/db/repositories/clip.repository.test.ts`: `resetErrors` flips only `error` clips (and only in the given
  project), clears `analysis_error`, returns the count.
- `tests/unit/core/summary.test.ts`: a clip with setting `"marina, boat"` and another with `"Marina"` → `marina` 2,
  `boat` 1.
Done when: red→green, typecheck + test:all green; `analyze --retry-errors` on the pilot re-analyzes only C0586.

**M2.1 ✅ · M2.2 ✅ · M2.2b ✅ · M2.2c ✅ · M2.3 ✅** (implementer, reviewed by planner; 352 → 392 tests)

**M2.4 — Pilot on Delfine ✅ 2026-11-19** — results:
- Pilot dir `~/Video/ClipPilot M2 Pilot/` (own DB + proxies; Portugal DB untouched). Ingest 33/33, all `scene_hint=Delfine`;
  re-ingest skips all 33 in 0.7 s (no re-hash).
- 3 Gemini passes (run 1 original prompt, run 2 after M2.2b, then C0586 only via `--retry-errors`). Final: 33/33 done,
  36 highlights, quality 6–9 (avg 7.4); places group (`open sea` 15, `marina` 8, `boat` 6); moments `boat trip` 9,
  `dolphin watching` 3. User judged the highlights useful.
- Cost ≈ US$0.30 per full pass over 33 clips / 457 s → full Portugal (508 clips) roughly US$5 per pass.
- Caveat: Gemini samples ~1 fps, so 1–2 s moments are the least reliable — run 1 and run 3 placed the C0586 dolphin
  leap at different times (14 s vs 0 s). Treat highlight in/out as a starting point to trim in the storyboard (M4).

M2 deferred (not done here):
- **Files API for proxies > ~20 MB** — largest Delfine proxy is 19.4 MB; longer Portugal clips will exceed the inline
  limit. Needed before the full 508-clip analyze.
- **Full Portugal ingest + analyze** — not run on purpose (user constraint); do it after the Files API item.
- `analyze --project` / `--force` ignore the project (pre-existing); only `--retry-errors` is project-scoped.
- Synonym tags don't merge (`boat trip` / `boat ride` / `boating`, `sea` / `open sea`).
- Highlight descriptions are not in FTS (search finds clips via summary/keywords, then returns their highlights) →
  highlight-level search belongs with M3 candidates.
- Stale highlights stay when a re-analysis errors (only replaced on success).
- No CLI-level tests for `summary` / `--retry-errors` wiring (pure logic + repo are tested).
- Pilot pass log (original plan text below kept for history).

**M2.4 plan (planner, with user)**
- Working dir `~/Video/ClipPilot M2 Pilot/`; `ingest "~/Video/Portugal/Src /Import/03 Arrifana/Delfine"`; user OK on
  cost before `analyze`; show ~8 highlights with timestamps for the user to judge; `summary --json`.
Done when: user judges highlights useful (or the prompt is tuned until they do).

**M2.5 — Highlight review page (implementer)** — user wants to review the pilot analysis in detail before the full
Portugal run. Reusable for the full trip later.
Behavior:
- New command `clippilot review-highlights [-o <path>]` (default `.clippilot/review.html` in the project dir) writes
  **one self-contained HTML file** (inline CSS/JS, no CDN, no network) and prints `{ "output": <path>, "clips": n,
  "highlights": m }` as JSON.
- Pure `buildReviewData(clips, highlights)` in `src/core/review/review-data.ts` → `{ project, generated_at, clips: [{
  clip_id, file_name, file_path, scene_hint, duration_sec, proxy_url, ai_summary, places: string[], moments: string[],
  quality_overall, highlights: [{ highlight_id, start_sec, end_sec, description, quality }] }] }`.
  - **All analyzed clips are included, also those with 0 highlights** (to spot missed moments); sorted by scene_hint, then
    file_name; highlights by start_sec.
  - `proxy_url` = `file://` URL of the proxy (percent-encoded like the FCPXML exporter's `pathToFileUri`); clips without a
    proxy get `null` (page shows "no proxy").
  - places/moments from `ai_scenes` setting/activity, split on commas, trimmed, lowercased, deduped (reuse the summary's
    tag logic rather than duplicating it).
- Pure `renderReviewHtml(data)` in `src/core/review/review-html.ts` embeds the data as JSON inside
  `<script type="application/json" id="review-data">`, escaped so `</script>` / `<!--` / U+2028 in descriptions can't
  break out.
- Page behaviour (manual check, not unit-tested): per clip card — `<video>` of the proxy with a custom bar under it showing
  each highlight as a band (click = jump + play range); playback-rate toggle 1× / 0.5×; tags + summary.
  Per highlight — "▶ play range" (seek to start, pause at end, optional loop), description, quality, verdict toggles
  `good` / `timing off` / `description off` / `quality off` (multi-select), notes field.
  Per clip — "＋ missed moment here" (records current video time, with a note), clip note field.
  Header — progress (`reviewed highlights / total`), filter (all / unreviewed / flagged), **Export** button downloading
  `review-verdicts.json` = `{ project, db_generated_at, reviewed_at, highlights: [{ highlight_id, clip_id, verdicts:[],
  note }], missed: [{ clip_id, at_sec, note }], clip_notes: [{ clip_id, note }] }`. State autosaves to `localStorage`
  (key includes project + generated_at; wrap in try/catch) so a reload keeps progress.
- Plain readable styling, light/dark via `prefers-color-scheme`. No framework.
Tests first:
- `tests/unit/core/review/review-data.test.ts` with literal clip rows + literal highlights: clip without highlights is
  included; sort order; highlight order; `proxy_url` for a path with spaces and a trailing-space folder
  (`/x/Src /a b.mp4` → `file:///x/Src%20/a%20b.mp4`); null proxy → null; tags split/dedupe (`"marina, boat"` + `"Marina"`).
- `tests/unit/core/review/review-html.test.ts`: output contains the data script tag; a description containing
  `</script><script>alert(1)</script>` does not produce a second `<script` opening after the data block; parsing the
  embedded JSON back yields the input data.
Done when: red→green, typecheck + test:all green, `review-highlights` run in `~/Video/ClipPilot M2 Pilot/` writes the page.

**M2.5 ✅** (88971b4, 49275e7) — page generated for the Delfine pilot.

**M2.5b — Review page v2 after first user look (implementer)**
User feedback: (1) with > 2 highlights the video and the highlight list don't fit on one screen; (2) wants to see
**all** clip scores, not just overall, and give feedback on each.
Behavior:
- Layout: on wide screens (≥ 1000 px) each clip card is two columns — left: video + band bar + controls, `position:
  sticky; top: <header height>` so it stays visible while scrolling that card's highlight list; right: tags, summary,
  scores, highlights, missed moments, clip note. Narrow screens stack as today. Header stays sticky.
- `buildReviewData` adds `scores` per clip: `quality: { stability, focus, exposure, composition, audio, overall }`,
  `editorial: { emotional, storytelling, uniqueness }` (numbers or null, as stored), `quality_issues: string[]` (parsed
  from the JSON-array string `ai_quality_issues`; non-JSON → `[that string]`; null → `[]`),
  `suggested_use: string | null`. Keep `quality_overall` for compatibility or replace it — your call, keep tests honest.
- Page shows all scores compactly (e.g. a small table `stability 4 · focus 5 · …`), issues as a list, suggested use.
  Per score a 3-way toggle `too low / ok / too high` (unset by default); per clip a toggle `suggested use wrong`.
  Stored in state as `clip_scores[clip_id][score_name] = 'low'|'ok'|'high'`, exported as
  `clip_scores: [{ clip_id, score, verdict }]` and `suggested_use_wrong: [clip_id]`. Progress line also shows
  `scored clips n / total` (a clip counts once any score verdict is set).
- Don't lose existing localStorage state: new fields must default when absent from a saved state.
Tests first (`review-data.test.ts`): literal clip row with all score columns → `scores` mapped; `ai_quality_issues`
as JSON array, as plain string, and null; null scores stay null.
Done when: red→green, typecheck + test:all green, page regenerated for the pilot.

**Pilot analysis — user feedback so far (2026-11-19, input to the pre-full-run prompt/analysis fixes)**
- ✅ Good at finding the moment in long clips where otherwise little happens.
- ❌ People / head shots: the user picks different highlights than Gemini (what they pick → from missed-moment markers).
- ❌ Shaky footage: segments with heavy camera shake are proposed as highlights. Likely root cause: Gemini samples
  ~1 fps, so it can't perceive shake; candidate fix = local per-segment shake metric (ffmpeg motion analysis) that
  penalises/drops highlights, rather than prompt wording alone.
- Full verdict export still pending.

**M2.5c ✅** (45dce99) — full-width layout.

### M2.6 — Taste calibration loop (user idea 2026-11-19, challenged & reshaped)
Goal: before analyzing a whole project, calibrate highlight selection to the user's taste in a few short review rounds.
Design decisions (planner, from the challenge):
- **What is learned = a per-user taste profile**, not free prompt rewriting: `~/.clippilot/taste-profile.md` (short
  explicit rules), versioned (`taste-profile.v<N>.md` kept on each change). Base prompt stays fixed; the profile is
  appended. Per user (carries across trips), not per project.
- **Who learns = Claude in chat** (CLI-as-skill): reads imported verdicts + metrics, proposes a profile diff, user approves.
  No LLM loop inside the app.
- **Only prompt-fixable issues go into the profile.** Pipeline issues (camera shake invisible at Gemini's ~1 fps; timing
  precision on 1–2 s moments) get deterministic fixes (M2.7), not prompt rounds.
- **Each round uses fresh clips** (never re-tune on what was just reviewed); round 0 = the Delfine pilot review.
- **Stop rule:** precision (highlights marked only `good` / reviewed highlights) ≥ 0.8 **and** missed moments per
  reviewed clip ≤ 0.3, or 3 rounds.

**C1 — Verdict import + metrics + taste profile in the prompt (implementer)**
Behavior:
- Migration `009_calibration`: `calibration_rounds(id PK, project_id, profile_version INT, created_at)`,
  `highlight_verdicts(round_id, highlight_id, clip_id, verdicts TEXT JSON, note TEXT)`, `missed_moments(round_id, clip_id,
  at_sec REAL, note TEXT)`, `clip_score_verdicts(round_id, clip_id, score TEXT, verdict TEXT CHECK in low/ok/high)`,
  `clip_notes(round_id, clip_id, note TEXT, suggested_use_wrong INT)`. Highlight descriptions/times are **snapshotted**
  into `highlight_verdicts` (`start_sec, end_sec, description, quality`) because re-analysis replaces highlights.
- `clippilot review import <review-verdicts.json> [--project]` → creates a round (profile_version = current), stores
  everything, prints JSON `{ round_id, metrics }`. Unknown highlight ids → error listing them (no partial import, one
  transaction).
- Pure `computeRoundMetrics(verdicts, missed, reviewedClipIds)` → `{ reviewed_highlights, good_only, precision,
  flags: { timing, description, quality }, missed_moments, reviewed_clips, missed_per_clip, score_verdicts: {
  <score>: { low, ok, high } }, stop_rule_met: boolean }`. A reviewed clip = a clip with any highlight verdict, score
  verdict, missed marker or note.
- Taste profile: pure `loadTasteProfile(dir)` → `{ version, text } | null` (highest `taste-profile.v<N>.md`, or
  `taste-profile.md` as v1); `buildUserPrompt(profile)` returns `USER_PROMPT` unchanged when null, else appends a
  section `Vorlieben dieses Editors (befolgen):\n<text>`. `GeminiClient` uses it; `clips` gains
  `analysis_profile_version INT` set on successful analysis. Profile dir overridable via `CLIPPILOT_HOME` env (tests).
- `clippilot calibrate status --json` → rounds with metrics + profile_version, newest first.
Tests first: metrics on literal verdict sets (incl. precision with mixed flags, a clip reviewed only via a missed
marker, stop rule true/false at the boundary); import round-trip into an in-memory DB incl. snapshot + unknown-id
rejection; `loadTasteProfile` picks highest version from a temp dir; `buildUserPrompt` with/without profile; analyze
stores `analysis_profile_version` (fake client).
Done when: red→green, typecheck + test:all; the user's real Delfine export imports as round 0.

**C2 — Sampling fresh, hard clips (implementer, after C1)**
`clippilot calibrate sample [--n 8] [--project]` → clip ids not reviewed in any round, stratified over scene_hint and
camera (resolution+fps), weighted towards hard: people/face tags in ai_scenes, `ai_quality_stability` ≤ 3, duration
≥ 20 s, 0 highlights. Deterministic given `--seed`. `analyze` and `review-highlights` gain `--clips <ids>`.

**C3 — Skill loop (planner)** — `.claude/skills/clippilot/SKILL.md` gets the calibration procedure: sample → analyze
`--clips --force` → review page → import → read metrics + notes → propose profile diff (only taste rules; route
shake/timing to M2.7) → user approves → write new version → next round.

### M2.7 — Pipeline fixes from pilot feedback (planned, not started)
- Local camera-shake metric per highlight range (ffmpeg motion/vidstab) → drop or down-rank shaky highlights.
- Experiment: Gemini `videoMetadata.fps` > 1 for short clips (timing precision, motion) — measure cost vs. gain.

### M3 — Storyboard model + CLI  ← NEXT
- Migration: `scenes`, cut brief, panel `intent` / `state` (filled | candidates | gap) / `speed`, panel candidates.
- Scenes seeded from source folders.
- CLI verbs for cut / brief / scene / panel; Claude drafts a Portugal storyboard in chat from a brief.
- Server routes for the same.

### M4 — Storyboard UI
- Scenes as rows, panels as cards; pick candidate (absorbs old "mark-best in UI"), trim in/out, speed,
  reorder, gap list, export button.

### M5 — Gap fillers (free) — v0.3
- Per-gap search over own library (unused clips, other projects).
- Locally rendered title/chapter cards, animated route map, photo pan/zoom → ingested as clips.

### M6 — Plugins (optional) — v0.3
- Stock (Pexels/Pixabay) and AI-video (Kling/Veo) gap fillers behind a plugin seam.

## Deferred / future
- Music-aware cutting (track per cut, length fitting, beat sync)
- Speed ramps within a segment
- VO script drafted from the storyboard
- Resolve Studio scripting adapter (open question — only if open formats can't be made reliable)
- AI model provider abstraction
- Open-source release + packaging (after v0.2 works on Portugal)

## Known gaps (non-milestone)

- **`thumbnail` repository, `gemini-client`, `proxy` modules** — production code present, no direct unit tests (proxy/thumbnail covered indirectly by the `ingest` integration test).
- **`projects` API route** — exists in `src/core/server/routes/projects.ts` but no test.
- **No packaging** — no `bin` build, no npm publish. Install via repo clone + `npm install -g tsx`.
- **No CI** — tests run only locally.
- **Story-AI** — sequence reasoning lives in Claude chat over `get-clip` results; no AI-generated sequence ordering in the app itself.

## Quality / test coverage map

`npm run test:all` runs 36 test files / 392 tests. State per module:

| Module | Source | Tests | Coverage |
|---|---|---|---|
| `core/ingest` | hasher, probe, scanner, scene-hint, proxy, thumbnail | hasher, probe, scanner, scene-hint + 3 integration | **partial** (proxy/thumbnail via integration only) |
| `core/analyze` | schema, gemini-client, prompts, highlights, index | schema, highlights, prompts, analyze-clips, gemini-client (fake `generate`) | **good** (real API call untested by design) |
| `core/summary` | buildProjectSummary | summary | **good** |
| `core/search` | engine, advanced | engine, advanced-search | **good** (advanced is used by the web server's clips route — kept) |
| `core/similarity` | union-find, engine | union-find, engine | **good** |
| `core/export` | csv, json, edl, fcpxml | all four | **good** |
| `core/contact-sheet` | layout + sharp render | layout (unit) | **partial** (sharp render is library-tested) |
| `core/server/routes` | clips, facets, projects, similarity | clips, facets, similarity | **partial** (projects untested; cut/scene routes → M3) |
| `core/config` | manager, defaults | — | **none** |
| `db/repositories` | clip, project, similarity, story, thumbnail, highlight | clip, project, similarity, story, highlight | **partial** (thumbnail untested) |
| `db/migrations` | 001–008 + runner | migrations runner | **good** (004–006 are single-column ALTERs, covered transitively) |
| `utils` | fs, timecode, concurrency, errors, logger | fs, timecode | **partial** |
| `cli/json` | clip projection | full unit | **good** |
| `cli/commands` | 13 commands (analyze, config, contact-sheet, export, get-clip, ingest, mark-best, search, similar, stats, summary, tag, ui) | — | **none** (manual smoke only) |

Type checking: `npm run typecheck` (strict TS, no errors expected).

## How to make a change

1. **Baseline green:** `npm run typecheck && npm run test:all`
2. **Scope it** in Claude Code plan mode (no separate framework needed).
3. **Acceptance criterion = a test.** Add or adjust the `vitest` test that proves the change. If the change is UI-only and not unit-testable, say so explicitly in the commit message.
4. **Commit atomically** and update the relevant section of this file if scope, coverage, or known-gaps changed. Git log + this file are the project memory.

That's the whole process. No `.planning/`, no `CHANGELOG.md`, no agent framework.
