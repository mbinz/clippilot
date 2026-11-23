# ClipPilot — Status

Single source of truth for what works, what doesn't, and how to make a change.
Update this file whenever the answer to any of those questions shifts.

## Version & state

**2026-11-21:** re-planned around events + scene board (see "Re-plan 2026-11-21"). M2.7 ✅ and M2.8 ✅ (576 tests).
2026-11-22: global config (K1); `03 Arrifana` ingested into `~/Video/ClipPilot Arrifana/` (104 clips, 0 errors,
4 folder events: Arrifana 48, Delfine 33, Arrifana Haus 10, Praia do Odeceixe 13) and analyzed: 104/104 (1 retry
after Gemini omitted `description`), 2 proxies > 18 MB went through the Files API ✅. M3 code ✅ (665 tests).
Next: Claude proposes the Arrifana brief → user confirms → draft via `cut apply` → Resolve import; M4 mockup feedback.
**2026-11-23: v0.2 accepted** — the user imported the Arrifana cut into free Resolve and prefers it over an empty
timeline; export seamless. v0.3 planned (board v3 + assistant link), roadmap re-prioritized in PRD. Mockup v3
approved after three rounds. **Next: M7 slices B1 → B4, then M8 (A1)** — specs under "v0.3" below.

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

## Re-plan 2026-11-21 — events + scene board

Second grilling session (after calibration rounds 0–2 and market research `docs/research/footage-logging-landscape.md`).
Decisions — full picture in [PRD.md](PRD.md):
- **No learned taste profile.** v1 rules from ~29 rated moments in one folder were circumstantial → profile disabled
  (`~/.clippilot/disabled-taste-profile-v1.md`), code removal in M2.7. Calibration rounds stay as history only.
- **No separate sort pass.** Sorting happens on the scene board while storyboarding (place = confirm, 👎 = reject,
  hide clip). Untouched moments stay "proposed"; AI picks vs user picks are visually distinct, both exportable.
- **Events** (footage side) vs **Scenes** (story side, per cut). Deepest folder = event; flat / loose files → recording-time
  groups. Claude proposes the **brief**; user adjusts.
- **v1: Claude drafts in chat, UI steers.** AI actions from the UI (Agent SDK) are the first roadmap item after v0.2.
- **Originals never touched** (no delete/move). Next test set: `03 Arrifana` (104 clips), not full Portugal.
- Vocabulary stays Panel (one shot slot).

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

### M2.6 — Taste calibration loop (user idea 2026-11-19, challenged & reshaped) — C1 ✅ a4e8b13 · C2 ✅ 34be4e0 · C3 ✅ (SKILL.md) · C4 ✅ 7f8379a (review page v2) · round 0 ✅ (P 0.89, missed 0.5/clip) · C5 ✅ e39aa1a (moments + slow-mo; 481 tests) · round 1 ✅ (P 0.50, missed 0.125/clip) · C6 ✅ c3fdd12 (moment tags + tier, clip scores dropped incl. columns; 498 tests; pilot DB migrated, backup `clippilot.pre-012.db`) · then profile v1 → round 2
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

#### C4 — Review page v2: fast thumbs review (user feedback 2026-11-19, mockup `mockups/review-v2.html` approved) — ✅ 4ed5e84, 7f8379a; 454 tests; checked in browser (layout, 👍 auto-advance, 👎 reasons). Deferred: clickable progress segments; v1 `places`/`moments` fields unused by the page
User: the v1 page is confusing, too many toggles. Goal: fast, intuitive pass through ~8 clips.
Rebuild `src/core/review/review-html.ts` (inline script, same data from `review-data.ts`) to match the mockup:
- **One clip at a time.** Header: "clip i of N", segmented progress bar (done = green, current = accent), Export verdicts.
  Prev / Next clip buttons; opens on the first clip not yet done. No all/unreviewed/flagged filter, no clip notes box.
- **Left:** big video; timeline strip under it (highlights as blocks, green/red once voted, missed markers ★, playhead);
  clicking a block selects + plays that highlight looping; clicking elsewhere seeks. "★ Missed a moment here" button.
- **Right (440px):** clip card — name, folder · duration, summary; overall-quality ring (1–5, colour green ≥4 / amber ≥3 / red);
  5-step bars for stability, focus, exposure, composition, audio; editorial bars for emotional, storytelling, uniqueness;
  pills for suggested use and quality issues. "Scores look right? 👍 👎".
  Then highlight cards: time range, quality as 10 dots + "n/10", description, 👍 👎.
- **Highlight vote:** 👍 → `verdicts: ["good"]`, then auto-select + play the next highlight. 👎 → `["bad"]` and reveals reason
  chips (multi-select) + optional note: `not_highlight` "Not a highlight", `timing` "Timing off", `description` "Description
  wrong", `quality` "Shaky / poor quality" → `["bad", ...reasons]`. Clicking the active thumb again clears the vote.
- **Score vote:** 👍 → every shown score gets `ok`. 👎 → bars become editable: user clicks the step where the score *should*
  be; AI too high → `high`, AI too low → `low`, scores not touched → `ok`. In 👎 mode tapping the suggested-use pill toggles
  `suggested_use_wrong`. (Existing `clip_scores` / `suggested_use_wrong` export fields, no schema change for these.)
- **Missed:** button or `M` adds `{clip_id, at_sec: video.currentTime}`, listed as a card with optional note and ✕ remove.
- **Keys** (ignored while typing in an input): ↑/↓ select highlight, `Y` 👍, `N` 👎, `1`–`4` toggle reasons on a 👎'd
  highlight, `M` missed, Space play/pause, Enter next clip. Shown as a key hint row under the video.
- **Clip done:** leaving a clip with Next/Enter marks it done. Zero-highlight clips show an empty state ("No highlights —
  press M for anything it missed, then ⏎"). Export gains `reviewed_clips: number[]` = done or touched clips.
- localStorage key prefix `clippilot-review-v2:` (no migration of v1 state). Narrow screens (<1000px) stack to one column.
- **Import / metrics:** `reviewed_clips` optional (default `[]`) in `verdict-schema.ts`; migration `010` adds
  `calibration_reviewed_clips(round_id, clip_id, PK)`; `importRound` stores it; `metricsFor` and `reviewedClipIds` include
  it (so a clip viewed with nothing to flag counts as reviewed with 0 missed). `metrics.flags` gains `not_highlight`.
  Precision unchanged (good_only / voted). Old exports still import.
Tests first: metrics (`not_highlight` flag; `["bad"]` not good), schema (`reviewed_clips` default), repository (reviewed
clips counted + excluded from sampling), and the page behaviour in jsdom (dev dep OK): run the rendered HTML with
scripts, drive clicks/keys, assert on the export object (expose it via `window.clippilotReview.buildExport()`):
👍 → good + next selected; 👎 + reasons; score 👍 all ok; score 👎 + clicked step → low/high; missed via M; Next marks
clip done → in `reviewed_clips`; state survives reload via localStorage. Keep the existing self-contained/escaping tests.
Done when: typecheck + test:all green, page regenerated for the pilot opens in a browser and matches the mockup.

#### C5 — Moments first: slow-mo suggestion + moment-only review (user feedback 2026-11-19 after round 0) — ✅ df2ee04, 1ebbf39, e39aa1a. Deferred: 25 fps timeline assumption in the speed gate (re-derive per cut in M3); 1× toggle not persisted
User: fast footage (landscape, action) should be *seen* slowed down when that suits the moment — but not blindly for every
high-fps clip (no slow-mo for talking). And: do clip-level scores make sense, or move entirely to moment scoring?
Decision: **the moment (highlight) is the unit.** Clip scores stay as background data (search/filters, summary) but are no
longer reviewed. Each highlight gets a slow-mo suggestion; its 1–10 `quality` stays the one number per moment.
Round 0 (round_id 1, 4 clips): precision 0.89, missed/clip 0.5, quality scores all ok, uniqueness 2× too low → consistent
with dropping clip-score review (uniqueness is project-relative; compute later, not per clip).

**Analysis (Gemini schema + prompt)**
- `HighlightSchema` gains `slowmo: "none" | "light" | "strong"` (default `"none"` when absent, so old responses parse) and
  `slowmo_reason: string` (default `""`, short English). Prompt (German, existing style): judge per moment whether slowing
  it down would look better in a travel montage — yes for flowing/fast motion with visual payoff (water, waves, splashes,
  animals, hair/fabric in wind, sport/action, smooth pans over landscape); `none` for speech, people talking to camera,
  moments that depend on sound or on real-time comedic timing, static shots. `strong` only for short, fast action peaks.
- Deterministic gate in code, not the model: `suggestedSpeed(slowmo, fps)` → 1 if `slowmo = none` or `fps < 48`;
  `light` → 0.5; `strong` → 0.25 if fps ≥ 90, else 0.5. (Assumes a 25 fps timeline; M3 may re-derive from the cut's rate.)
  `normalizeHighlights(raw, durationSec, fps)` adds `suggested_speed`.
- Migration `011`: `highlights` + `slowmo TEXT NOT NULL DEFAULT 'none'`, `slowmo_reason TEXT NOT NULL DEFAULT ''`,
  `suggested_speed REAL NOT NULL DEFAULT 1`; `highlight_verdicts` + `suggested_speed REAL` snapshot (filled by `importRound`).
  `highlight.repository` reads/writes the new fields; `get-clip` / `search --json` highlight objects include them.

**Review page (v2 → keep look, simplify)**
- Remove the "Scores look right? 👍 👎" row, score-editing mode and suggested-use toggle. Keep the clip card read-only
  (ring + bars + pills), visually a bit more compact. Export no longer emits `clip_scores` / `suggested_use_wrong` entries
  (fields stay as empty arrays; schema/import unchanged).
- Highlight card: if `suggested_speed < 1`, a badge "🐢 50 %" (or 25 %) with `slowmo_reason` as tooltip/sub-line; selecting
  that highlight plays its loop at `playbackRate = suggested_speed`. A small "1×" toggle on the card (key `S`) flips that
  loop between suggested speed and 100 % to compare. Proxies keep source fps (verified: 100 fps clip → 100 fps proxy).
- New 👎 reason chip `speed` "Speed wrong" (key `5`), always offered (also when no slow-mo was suggested but should be).
- `metrics.flags` gains `speed`. Precision unchanged.
- `review-data.ts` passes `slowmo`, `slowmo_reason`, `suggested_speed` per highlight.
Tests first: schema defaults (old response without slowmo parses); `suggestedSpeed` table (none/light/strong × 25/50/100 fps,
talking→none stays 1); normalize carries speed; migration 011 + repository round-trip; import snapshots speed; metrics
`speed` flag; page (jsdom): no score vote UI, badge only when speed < 1, selected slow-mo highlight plays at 0.5/0.25,
`S` toggles 1×, chip `5` → `["bad","speed"]`; `get-clip --json` includes the new fields; prompt text mentions slowmo.
Manual after merge-ready: user re-analyzes the 33 pilot clips (`analyze --force`, ~US$0.33, user's terminal) → regenerate
page → round 1. Done when: typecheck + test:all green; regenerated page shows slow-mo badges on a 50/100 fps action clip.

#### C6 — Moment tags + tier, no clip scores (user decision 2026-11-19 after round 1) — ✅ 0ec54a8…c3fdd12. Deferred: unused `quality_weights` config; move `highlightsToJson` out of cli/ (server imports it)
Evidence: clip `overall` spans only 2.8–3.8 over 33 pilot clips (avg 3.5; the poor no-highlight clip #30 = 3.6 like 👍
clips); `suggested_use` = "B-Roll" for every clip in round 1; moment `quality` 1–10 is flat too (33 of 36 are 7 or 8).
Absolute numbers from Gemini don't discriminate → replace with categorical, checkable facts per moment. User: remove clip
scores entirely, **including DB columns** (no real data yet; pilot is re-analyzed after this slice).
Round 1 (round_id 2, no profile): precision 0.50 (3 of 4 👎 = speed on kids' faces, clip 33), missed 0.125/clip.

**Analysis schema + prompt**
- Drop `technical_quality` and `editorial_value` from `ClipAnalysisResponseSchema` and the prompt. Keep `scenes`,
  `clip_summary`, keywords etc.
- `HighlightSchema`: replace `quality` (1–10) with `tier: "hero" | "solid" | "filler"`; add `shot: "wide" | "medium" |
  "close" | "detail"`, `role: "establishing" | "action" | "reaction" | "detail" | "transition"`, `issues: ("shake" | "blur" |
  "obstructed" | "overexposed" | "underexposed")[]` (default `[]`). Keep `slowmo` / `slowmo_reason`. Prompt (German, same
  style): define each value in one line; tier = hero (would open or anchor a scene), solid (good usable shot), filler
  (usable only to fill a gap); say explicitly to use the whole range and not default to "solid".
- Migration `012`: drop `clips.ai_quality_*` (stability, focus, exposure, composition, audio, overall, issues) and
  `clips.ai_editorial_*` (emotional, storytelling, uniqueness, suggested_use). `ai_editorial_suggested_use` is in `clips_fts`
  and its triggers → recreate `clips_fts` + the 3 triggers without it and rebuild the index. `highlights`: drop `quality`,
  add `tier TEXT NOT NULL DEFAULT 'solid'` (CHECK), `shot TEXT`, `role TEXT`, `issues TEXT NOT NULL DEFAULT '[]'` (JSON).
  `highlight_verdicts`: keep its old `quality` snapshot (nullable) and add `tier`, `shot`, `role` snapshots.
  Calibration score tables/fields (`clip_score_verdicts`, `clip_scores`, `suggested_use_wrong` in the export schema) stay so
  old exports import — just nothing writes them any more.
- Remove clip-score fields everywhere they're read: types (`src/types/clip.ts`, `web/src/api/types.ts`), clip repository,
  `cli/json.ts` projection, table formatter, `search` (`--min-quality` → `--min-tier hero|solid|filler`: clip has ≥ 1 moment at
  or above that tier), `search/advanced.ts` + server routes + facets (quality range / suggested-use filters and sorts →
  `min_tier` filter; sort options for quality/emotional removed), similarity (best-take order → best moment tier, then
  duration), csv/json exporters (drop score columns; add nothing), `summary.ts` (rank highlights by tier, then length),
  sampling (`low_stability` reason → `shaky`: any moment with `shake` issue), web `ClipCard`/`ClipDetail`/`ClusterCard`/
  filters (remove score UI; show moment tiers where scores were, keep it minimal).
- Review page: clip card becomes one line (file · folder · duration · fps) + summary; no ring/bars/pills. Highlight card
  shows tier pill, shot · role, issue tags, 🐢 badge — no quality dots. 👎 reasons unchanged. `review-data.ts` follows.
- SKILL.md JSON-shape section + verb table: remove score fields, document tier/shot/role/issues and `--min-tier`.
Tests first for each behavior (schema parse/reject, migration 012 incl. FTS still finds by summary/keywords after rebuild and
columns gone, repository round-trip, `--min-tier` search, similarity order, summary order, sampling `shaky`, exporters'
columns, review page jsdom, web type-check). Update/remove tests that encode clip scores and list them in the report.
Done when: typecheck (incl. web) + test:all green; `grep -rn "ai_quality_\|ai_editorial_" src web/src` only hits migration
001/012; then user re-analyzes the pilot (~US$0.33) and the page shows tiers.

Round 2 (round_id 3, taste profile v1): precision 0.75, missed 0.125/clip, speed flags 0 (v1 fixed slow-mo on faces);
2× not_highlight on plain sea surface, 1× too short. Calibration closed 2026-11-21 (3 rounds) — see re-plan.

### M2.7 — Analysis groundwork ✅ 2026-11-21 (b282c87…54f41b9, spike a2b0f2b)
Slices (each test-first, implementer; one commit per behavior):
- **G1 Remove taste-profile learning.** Delete `core/calibration/taste-profile.ts`, profile loading in `gemini-client`,
  `buildUserPrompt(profile)` → plain prompt, `clips.analysis_profile_version` writes (column may stay), SKILL.md "Taste
  calibration" section → replaced by a 3-line "Review page" note. Keep verdict import / metrics / sampling (history).
- **G2 Prompt cleanup.** System prompt: travel footage, not "Familien- und Urlaubsvideos". Example JSON lists all values
  (`"slowmo": "none | light | strong"`). Slow-mo text: drop "Haare oder Stoff im Wind"; water only *with an event* (wave,
  splash, animal, boat). Replace "herausragende Momente" with "brauchbare Momente für einen Reise-Montage-Film; 0 wenn
  nichts taugt". Drop `description_de` from scenes (schema + prompt + any reader). Tests: prompt text assertions.
- **G3 Minimum moment length.** `normalizeHighlights`: moments < 3 s are widened symmetrically to 3 s, clamped to
  [0, duration] (shift if at an edge); clips < 3 s keep the full clip. Tests: table of cases.
- **G4 Audio tag.** Moment gains `audio_keep: boolean` (default false) + `audio_type: ambient | speech | music | noise`
  (default `noise`); prompt defines them (keep = sound worth hearing under/instead of music). Migration 013; repo,
  JSON projection, review page pill. Tests as in C5/C6.
- **G5 Files API upload.** Proxies above the inline cap (~20 MB) go through `ai.files.upload` → wait until ACTIVE →
  `fileData` part → delete the remote file after the response (also on error). Small proxies stay inline. Injected
  uploader for tests; real API untested (as today). Done when a > 20 MB proxy analyzes (user runs it).
- **G6 Shake metric (spike first).** Our ffmpeg has no vidstab; candidates: `deshake`/`mestimate` motion vectors,
  frame-difference via `signalstats`, `blurdetect`. Spike: compute per-moment score on the pilot, compare against known
  shaky clips (#26, #30, #16 quality 👎) and steady ones; pick a method + threshold → `issues += "shake"` (measured) on
  the moment. Spike result documented here before building.
- **G7 Duplicate groups.** Moments from different clips whose wall-clock ranges (`recorded_at` + start/end) overlap, or
  whose mid-frame thumbnails are near-identical (perceptual hash) within the same day → same `dup_group`. Pool shows
  one stack. Migration + repo + JSON. Tests with synthetic clips.

#### M2.7 implementation specs (planner, 2026-11-21)
Branch: the M2.7 worktree branch. Order: A = G1→G4, B = G5 + G7, C = G6 spike (report only, no production code).
Every slice: failing test first, `npm run typecheck && npm run test:all` green, one commit per slice.

**G1 — remove taste profile**
- Delete `src/core/calibration/taste-profile.ts` and `tests/unit/core/calibration/taste-profile.test.ts`.
- `prompts.ts`: delete `PromptProfile` + `buildUserPrompt`; `gemini-client.ts` sends `USER_PROMPT` directly; drop the
  `profile` ctor param and `profileVersion`. Keep the injected `generate` param.
- `analyze/index.ts`: no longer writes `analysis_profile_version` (column stays, left NULL; `ClipRepository` keeps
  accepting it as optional). Update `analyze-clips.test.ts` "stores analysis_profile_version" → asserts it is NULL.
- `review-import.ts`: profile version argument becomes constant `0`.
- SKILL.md: replace the whole "Taste calibration" section with ≤ 4 lines: `review-highlights` renders a review page for
  given clips (👍/👎 per moment, missed moments); `review import` stores the verdicts as history only. No profile.
- Test first: `gemini-client.test.ts` — the prompt part sent is exactly `USER_PROMPT` (capture via injected generate or a
  spy on the parts builder; if the injected seam can't see the prompt, extract `buildRequest(base64)` and test that).
- Done when: `grep -rn "taste-profile\|buildUserPrompt\|profileVersion" src tests .claude/skills` is empty.

**G2 — prompt cleanup** (tests in `prompts.test.ts`, assert on `SYSTEM_PROMPT` / `USER_PROMPT` text)
- SYSTEM_PROMPT: "Video-Analyse-Assistent für Reisevideos" (no "Familien-").
- Example JSON lists every enum value: `"slowmo": "none | light | strong"` (others already do).
- Slow-mo paragraph: remove "Haare oder Stoff im Wind"; "Wasser, Wellen" → "Wasser nur mit einem Ereignis (Welle bricht,
  Spritzer, Tier, Boot)"; keep the rest.
- "0 bis 5 herausragende Momente des Clips (leeres Array, wenn es keine gibt)" → "0 bis 5 brauchbare Momente für einen
  Reise-Montage-Film (leeres Array, wenn nichts taugt)".
- Drop `description_de`: prompt example, `SceneSchema`, `sampling.ts` parts list, `web/src/api/types.ts`,
  `ClipDetail.tsx` (show `description_en` only), fixtures in schema/gemini-client/analyze-clips tests. Old DB rows that
  still contain it in JSON are harmless (zod strips unknown keys on parse; readers just ignore it).
- Assertions: prompt does not contain "Familien", "Haare", "herausragende", "description_de"; contains
  `"none | light | strong"` and "brauchbare Momente".

**G3 — minimum moment length 3 s** (`highlights.ts`, `highlights.test.ts`)
- Pipeline: clamp to [0, duration] → drop if < 0.5 s (junk, as today) → if length < 3 s widen around the midpoint to 3 s;
  if that crosses 0 or duration, shift to stay inside; if duration < 3 s the moment becomes [0, duration] → sort → round.
- Table test cases (duration, in → out): (13, [1,2] → [0,3]); (13, [5,6] → [4,7]); (13, [12,12.9] → [10,13]);
  (13, [4,8] → [4,8] unchanged); (2.4, [0.5,1.5] → [0,2.4]); (13, [5,5.3] → dropped).
- The existing "drops zero-length and too-short entries" test expects `[[1,2]]` → becomes `[[0,3]]` (spec change, say so).

**G4 — audio tag** (migration 013)
- Schema: `audio_keep: z.boolean().default(false)`, `audio_type: z.enum(['ambient','speech','music','noise']).default('noise')`.
- Prompt: example JSON gets `"audio_keep": false` and `"audio_type": "ambient | speech | music | noise"`; one German
  paragraph: audio_keep = true, wenn der Originalton es wert ist, unter oder statt Musik gehört zu werden (Lachen,
  Wellenrauschen mit Ereignis, Ansage, Live-Musik); audio_type = was hauptsächlich zu hören ist.
- Migration `013_moment_audio.ts`: `highlights.audio_keep INTEGER NOT NULL DEFAULT 0`, `audio_type TEXT NOT NULL DEFAULT 'noise'`.
  Register in runner. Test like `migration-012.test.ts` (columns exist, defaults on old rows).
- `normalizeHighlights` passes both through; `HighlightRepository` insert/record; `highlightsToJson` emits
  `audio_keep` as boolean; `review-data.ts` carries both; review page shows a pill `🔊 <type>` only when `audio_keep`.
- Tests: schema defaults, normalize pass-through, repo round-trip (boolean ↔ 0/1), JSON projection, review-data field.

**G5 — Files API for large proxies** (`gemini-client.ts`)
- Threshold constant `INLINE_MAX_BYTES = 18 * 1024 * 1024` (headroom under the ~20 MB request cap; base64 grows 33 %, so
  compare against raw file size × 4/3 — i.e. inline only if `Math.ceil(size/3)*4 <= INLINE_MAX_BYTES`).
- Introduce a `VideoTransport` seam: `{ upload(path): Promise<{name, uri, mimeType}>, waitActive(name): Promise<void>,
  remove(name): Promise<void> }`, default backed by `ai.files.upload / ai.files.get (poll every 2 s, max 120 s, throw on
  FAILED) / ai.files.delete`. `generate` receives a part (`inlineData` or `fileData {fileUri, mimeType}`) instead of base64.
- Large path: upload once per `analyzeVideo` call (not per retry), retries reuse the uri, `remove` in `finally`
  (also on error; a failing remove is swallowed).
- Tests (fake transport + fake generate): small file → inline, no upload; large file (temp file > threshold, or inject a
  size function) → upload, waitActive, fileData part, remove called once; generate throws → remove still called;
  waitActive throws → no generate, remove called, GeminiApiError surfaces.
- Done when green; real-API check is the user's (note in STATUS).

**G7 — duplicate groups** (migration 014, pure function + recompute after analyze)
- Migration `014_dup_groups.ts`: `highlights.dup_group INTEGER NULL` + index.
- Pure `assignDupGroups(moments: {id, clip_id, start_sec, end_sec, recorded_at: string|null, hash: bigint|null}[]): Map<id, group>`
  in `src/core/similarity/dup-groups.ts`, using the existing `UnionFind`. Two moments of **different clips** join when
  (a) both clips have `recorded_at` and the wall-clock ranges `[recorded_at+start, recorded_at+end]` overlap by ≥ 1 s, or
  (b) both hashes exist, same local calendar day of `recorded_at`, and Hamming distance ≤ 6 (of 64). Singletons get NULL;
  groups numbered 1..n in order of their lowest moment id.
- Hash: 64-bit dHash (sharp: grayscale, resize 9×8, compare adjacent pixels) of the clip thumbnail whose
  `timestamp_sec` is nearest the moment midpoint; no thumbnail → NULL. `src/core/similarity/dhash.ts`.
- `HighlightRepository.setDupGroups(projectId, map)` (clears the project's groups first). `analyze` command recomputes for
  the project after a run. `highlightsToJson` emits `dup_group`.
- Tests: dup-groups table (overlap, 0.5 s overlap → no, same clip never groups, hash near/far, different day, transitive
  chain A~B~C → one group, missing data → no group); dhash on two generated sharp images (same → 0, inverted → large);
  repo round-trip; JSON field. Assumption to note: `recorded_at` = clip start.

**G6 — shake spike (C, report only)**
- Pilot: `~/Video/ClipPilot M2 Pilot/` (DB `.clippilot/clippilot.db`, open **read-only**; never write the DB, never touch originals).
- For every pilot moment compute on the proxy, over [start,end]: (1) mean |motion vector| from `mestimate`
  (via `-vf mestimate,metadata` or the `codecview`-free route that works with our build), (2) `signalstats` YDIF mean,
  (3) `blurdetect` mean. Script under `scripts/spikes/shake-spike.ts` (committed, not wired into the CLI).
- Label set: shaky = clips #26, #30, #16 (and any moment with a 👎 reason `shake` in calibration verdicts); steady =
  moments with 👍 and no shake reason. Report a table per metric (shaky vs steady distribution) and which metric +
  threshold separates them best, with misclassifications. Planner decides before any production code.

### M2.8 — Events ✅ 2026-11-21 (d8b65de…462665a; code done, Arrifana run pending)
- Migration: `events` (id, project_id, name, source `folder | time`, folder_path, sort order) + `clips.event_id`.
- Ingest/backfill: deepest folder → event; files without a folder event (flat list, or loose next to folders) → recording-time
  groups (gap > 45 min = new event, name "Tue 27 May, 08:34"); loose files next to folder events join the nearest event by time.
- CLI: `events list --json`, `events rename|merge|split` (split at a clip/time). Summary groups by event.
- Web: simple events view (name, time range, clip count, thumbnail strip; rename / merge / split).
- Then: ingest + analyze `03 Arrifana` (104 clips, ~US$1, user runs analyze).

#### M2.7 / M2.8 results (2026-11-21)
- G1–G5, G7 built by the implementer, reviewed by the planner. G5 real-API path untested — **user check:** analyze a
  proxy > 18 MB. G7 assumes `recorded_at` = clip start; groups recompute only when `analyze` processed clips.
- **G6 decision: no automatic `shake` issue.** Spike (`npx tsx scripts/spikes/shake-spike.ts`, pilot, read-only):
  deshake motion/jitter/jerk overlap fully between shaky and steady (pans jitter as much as shake); YDIF tracks content;
  only `blurdetect` mean > 9.5 had 0 false positives (recall 4/9) but sits exactly at the steady max (overfit, n=29) and
  measures blur, not shake. Labels were weak: no verdict carried a shake reason. → Deferred: collect 5–10 explicit
  "shake" 👎 on the M4 board, then re-test deshake jitter; maybe a provisional `blurry` flag.
- M2.8 verified on a pilot DB copy: flat Delfine folder → one time event (33 clips, max gap 27 min); browser check of
  the Events tab: split, rename, merge all work, no console errors.
- Deferred from these slices: event names/times use the machine's timezone, not the footage's (Delfine shows 10:34,
  local Portugal time was 09:34); rename field should select its text on open; incremental `assignEvents` may create a
  second "Undated" event; `createDb` doesn't await `ensureDir` (race on a fresh dir); `calibrate sample|status` commands
  remain but are undocumented; web UI doesn't show the audio tag or dup groups yet (M4).

#### Arrifana analysis findings (2026-11-22, 104 clips, 177 moments)
- Tiers: hero 46 / solid 123 / filler 5 (before retry) — hero ~26 %, fairly generous; filler barely used.
- **audio_keep is far too generous:** 135 of 174 moments (78 %; ambient 75, speech 60). The prompt makes "worth hearing"
  too easy → tighten in a later prompt pass (e.g. "nur wenn der Ton den Moment trägt; im Zweifel false"), check on a sample.
- Duplicate groups: 0 — genuine. No overlapping recordings; nearest cross-clip thumbnail dHash distance is 9 (threshold 6).
- One clip failed 3× because Gemini omitted `description` on moments; `--retry-errors` fixed it. Possible hardening:
  default `description` to "" instead of failing the whole clip (deferred).
- Event name "Praia do Odeceixe " keeps the folder's trailing space → trim names in `deriveEvents` (deferred).

#### K1 — Global config (planner, 2026-11-22; replaces the launchctl fallback) — ✅ a10aa2c, d00bf81 (589 tests)
Key now in `~/.clippilot/config.json` (0600); verified a fresh dir finds it. Deferred: project-level `config set`
writes the whole merged config (incl. global values / env key) into the project file — should write only the changed key.
The key was only in `~/Video/Portugal/.clippilot/config.json` (per working dir), so a new working dir had no key. A
launchctl fallback (6543cc7) was built first but is useless — the key isn't in launchctl (`launchctl getenv` exits 0
even when unset) — so it is **reverted** (`git revert 6543cc7`, keep its test file's env save/restore pattern).
- Global config file: `$CLIPPILOT_HOME/config.json`, else `~/.clippilot/config.json`. `globalConfigPath()` exported.
- `loadConfig(basePath, globalPath = globalConfigPath())` merge order (later wins): DEFAULT_CONFIG → global file →
  project `.clippilot/config.json` → `GEMINI_API_KEY` env. Nested `proxy` / `quality_weights` merged the same way.
  Missing files are fine; a broken JSON file throws a clear error naming the file (as today for the project file).
  Edge: if `basePath` resolves to the home dir, project and global path are the same file — read it once.
- `clippilot config set <key> <value>` gains `--global` (writes the global file, creates the dir, file mode 0600);
  without it, behavior unchanged. `config get`/list unchanged.
- Never print key values in tests or output.
- Tests (`tests/unit/core/config/manager.test.ts`, temp dirs for both paths): global only → used; project overrides
  global per key (key and an unrelated field); env overrides both; nested proxy merge across all three; broken global
  JSON → error names the file; `saveConfig` global write creates dir + 0600. Plus a CLI test for `config set --global`.
- Done when: the key moved to the global file (planner does that) and `analyze` from a fresh dir finds it.

#### M2.8 implementation specs (planner, 2026-11-21)
Slices E1→E5, test-first, one commit each. Migration 015 (013/014 are taken by G4/G7).

**E1 — schema + pure derivation**
- Migration `015_events.ts`: `events (id PK, project_id FK NOT NULL, name TEXT NOT NULL, source TEXT NOT NULL CHECK
  (source IN ('folder','time')), folder_path TEXT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at)` +
  `clips.event_id INTEGER NULL REFERENCES events(id) ON DELETE SET NULL` + index on `clips(event_id)`.
- Pure `deriveEvents(clips: {id, file_path, recorded_at: string|null}[]): DerivedEvent[]` in `src/core/events/derive.ts`,
  `DerivedEvent = {name, source, folder_path|null, clip_ids}`; folder of a clip = `path.dirname(file_path)`.
  1. **Flat:** all clips share one folder → time mode for everything.
  2. **Leaf folders:** a folder is a leaf if no other clip's folder lies strictly under it. Each leaf → one `folder` event,
     name = folder basename, `folder_path` = the folder.
  3. **Loose files** (folder is not a leaf) with `recorded_at` → join the folder event whose [min,max] recorded_at range
     is nearest (distance 0 if inside; tie → earlier event). If no folder event has any dated clip → time mode for them.
  4. **Time mode:** sort by recorded_at; gap > 45 min between consecutive clips starts a new event; name = first clip's
     local time formatted `Tue 27 May, 08:34` (en-GB weekday/day/month, 24 h). `source='time'`, `folder_path` NULL.
     Clips without `recorded_at` in time mode or loose → one event "Undated" (source time).
  5. Output sorted by earliest recorded_at (undated last); clips within an event by recorded_at then file_path.
- Tests: table of synthetic clip sets for each rule (flat→time groups with 44 vs 46 min gaps; two leaf folders; loose
  file nearest-by-time incl. inside-range and tie; nested `A/` with files + `A/B/` leaf; undated; name formatting —
  pin TZ via `process.env.TZ='Europe/Lisbon'` in the test).

**E2 — repository + assignment on ingest**
- `EventRepository`: `listByProject` (with clip_count, start/end recorded_at, sorted by sort_order), `create`, `rename`,
  `merge(targetId, otherIds)` (move clips, delete others), `split(eventId, atClipId)` (clips at/after the clip in event
  order move to a new event "<name> (2)", same source, folder_path NULL), `clipsOf(eventId)`, `resort(projectId)` (sort_order
  by earliest recorded_at).
- `assignEvents(db, projectId)` in `src/core/events/index.ts`: project has no events → `deriveEvents` over all clips and
  persist. Otherwise only clips with `event_id IS NULL`: join an existing `folder` event with equal folder_path, else the
  nearest event by time (rule 3), else a new derived event. Never renames/merges/splits existing events (user edits stick).
- `ingestDirectory` calls nothing new; the **ingest CLI command** calls `assignEvents` after the run (keeps the pure
  pipeline testable). Backfill for existing projects = `clippilot events rebuild` (E3).
- Tests: repo ops on an in-memory DB (merge moves clips, split boundary inclusive, resort); `assignEvents` first-run vs
  incremental (new clip in an existing folder joins it; user-renamed event keeps its name).

**E3 — CLI** (`src/cli/commands/events.ts`, all read commands support `--json`)
- `events list [--project] [--json]` → `[{id, name, source, folder_path, clip_count, start, end}]`.
- `events rename <id> <name>`, `events merge <targetId> <otherId...>`, `events split <id> --at-clip <clipId>`,
  `events rebuild [--project]` (= `assignEvents`; only fills unassigned clips; `--reset` deletes the project's events first).
  Mutations print the resulting event(s) as JSON.
- `summary --json` gains `events: [{id, name, clips, duration_sec, highlights}]` in event order; existing fields unchanged.
- SKILL.md: short "Events" section (what they are, the verbs, "propose renames, don't apply without the user").
- Tests: command-level like existing CLI tests (list JSON shape, split/merge output, summary field).

**E4 — server routes**
- `GET /api/projects/:id/events` (list incl. up to 8 thumbnail URLs per event, one per clip, earliest first),
  `PATCH /api/events/:id {name}`, `POST /api/events/:id/merge {other_ids}`, `POST /api/events/:id/split {at_clip_id}`.
  Tests via Hono `app.request` like the other route tests.

**E5 — web events view**
- New header tab "Events" (next to browse / similarity), `EventsView.tsx` + `useEvents` hook: one row per event — name
  (inline rename on click, Enter saves), time range, clip count, thumbnail strip; checkbox select + "Merge selected";
  "Split…" opens the event's clips, click a clip = split there. Needs a selected project (else hint text).
- No unit tests for React (none exist today); verify in the browser pane against the pilot DB copy. Planner verifies.

Done when: `events rebuild` on a copy of the pilot DB gives sensible events; then the user-facing step is ingesting
`03 Arrifana` + the user running analyze.

### M3 — Storyboard model + CLI — code ✅ 2026-11-22 (7d3b8cb…583ec69, 665 tests); brief ✅ draft ✅; Resolve import ✅ 2026-11-23 (v0.2 accepted)
2026-11-22: brief proposed by Claude, confirmed by the user (2:45, family & grandparents, chronological, 5 must-haves,
Odeceixe ending). Draft applied via `cut apply` in `~/Video/ClipPilot Arrifana`: 5 scenes, 42 panels (40 filled, 2
candidates, 0 gaps), ~2:39, 3 slowed panels (50 fps only). Exported `exports/03 Arrifana – Main.otio` (25 fps, 42 clips,
5 scene markers, all media paths exist). **Done when:** user imports it into free Resolve and judges the rough cut.
- Migration: `scenes` (per cut, start event), cut brief, panel `intent` / `state` (filled | candidates | gap) / `speed` /
  `source` (ai | user), panel candidates; moment `status` (proposed | confirmed | rejected); `clips.hidden`.
- CLI verbs for brief (Claude proposes, user adjusts) / cut / scene / panel; Claude drafts the Arrifana cut in chat.
- Server routes for the same.

#### M3 results (2026-11-22)
- S1–S7 built by the implementer, reviewed. Smoke test on a copy of the Arrifana DB: `cut apply` (2 scenes, 6 panels)
  → `cut show` totals → `export --cut --format otio`: 5 clips, 2 scene markers, gap skipped, 0.5× time warp only on the
  50 fps clips (a `light` slow-mo moment on 25 fps footage correctly stays 100 %); invalid draft → exit 1 with error list.
- Rulings on implementer interpretations: `getOrCreateMainCut` creates "Main" if no cut has that name; append adds scenes
  at the end; replace uses fresh scene ids; brief validates shape only.
- Deferred: zod shape errors short-circuit id validation (a draft with both kinds reports only the shape errors first);
  non-JSON `export --cut` doesn't mention skipped gaps; no HTTP route for `cut apply` (CLI only, fine for v1).
- **M4 mockup** `mockups/scene-board.html` (41d3e66) on real Arrifana data, hand-drafted 5-scene cut; data in gitignored
  `mockups/scene-board.data.js` (regenerate: `scripts/mockups/extract-mockup-data.ts`). Serve the folder over HTTP to view.
  Waiting for user feedback before M4 build.

#### M4 mockup — feedback round 1 → v2 (2026-11-22)
User feedback on v1: too busy (drop text from the pool); thumbnails must show motion (play on hover); details only on
click; colour must mean one thing each; the right panel was mostly empty; preview must show more than one frame.
Plus: **undo/redo for every user action, built in from the start.**
v2 (`mockups/scene-board-v2.html`, serve with `scripts/mockups/serve.ts` so proxies play):
- Pool = image-only grid; ★ hero, ⚠ issue, small dot = in the cut. Hover plays the moment from the 720p proxy at 2×.
- No permanent inspector: clicking a panel or moment opens a drawer (video player looping the range, clip timeline with
  all moments + trim handles, speed, intent, actions; 👎 reasons inline).
- Colours: neutral white = selection/primary · violet = AI proposed · green = mine/confirmed · amber = needs your
  decision ("N to choose", over length) · red = rejected/problem/destructive. Hero is a ★, not a colour.
- Preview plays the real proxies in order at panel speed (1×/2×), click the track to jump.
- Undo/redo: every action is a labelled history step (⌘Z / ⇧⌘Z, header buttons, toast "Undo").
- **Architecture decision (for M4 build): undo/redo is server-side.** Every board mutation goes through one command
  endpoint that records an operation (label + inverse, or before/after snapshot of the touched rows) in an
  `operations` table per cut; `POST /cuts/:id/undo|redo` replays. CLI/Claude edits go through the same log, so a
  Claude draft can be undone from the UI as one step. Spec + ARCHITECTURE.md update before M4 S1.

#### M3 implementation specs (planner, 2026-11-22) — Q1–Q3 answered by the user
Facts: `stories` / `story_segments` are empty in every DB (pilot, Portugal) → reshape freely. Export already supports
per-segment `speed` and `scene_name` markers (OTIO + FCPXML), but `export --story` passes neither. `analyze --force`
calls `highlights.replaceForClip` (delete + insert) → would wipe moment status and break panel links.
Design rules: a panel stores its own `clip_id` + in/out + speed (moment_id is provenance only, `ON DELETE SET NULL`),
so the timeline survives re-analysis. All storyboard logic lives in `src/core/storyboard/` (service over repos);
CLI and server routes are thin wrappers over it. Slices S1→S7, test-first, one commit each. Migration 016.

**S1 — schema (migration 016)**
- `stories` += `brief TEXT NULL` (JSON, see S3), `brief_state TEXT NOT NULL DEFAULT 'none'` (`none|proposed|confirmed`).
- New `scenes (id, story_id FK CASCADE, position, name, event_id FK SET NULL, notes, created_at, UNIQUE(story_id, position))`.
- `story_segments` recreated (empty table): `id, story_id FK CASCADE, scene_id FK CASCADE NOT NULL, position,
  intent TEXT NOT NULL DEFAULT '', state TEXT CHECK (filled|candidates|gap), source TEXT CHECK (ai|user) DEFAULT 'ai',
  clip_id FK NULL, moment_id FK highlights SET NULL, start_sec REAL NULL, end_sec REAL NULL, speed REAL NOT NULL DEFAULT 1,
  notes, created_at, UNIQUE(scene_id, position)`. CHECK: filled ⇒ clip_id, start_sec, end_sec not null.
- New `panel_candidates (panel_id FK CASCADE, moment_id FK highlights CASCADE, position, PRIMARY KEY(panel_id, moment_id))`.
- `highlights` += `status TEXT NOT NULL DEFAULT 'proposed'` (`proposed|confirmed|rejected`), `reject_reason TEXT NULL`.
- `clips` += `hidden INTEGER NOT NULL DEFAULT 0`.
- Types in `src/types/story.ts` (Cut/Scene/Panel names in TS, table names unchanged). Tests: migration test like 012–015.

**S2 — storyboard service, reads + edits** (`src/core/storyboard/service.ts`, in-memory DB tests)
- `getCut(id)` → tree `{cut, brief, scenes:[{…, event, panels:[{…, clip, moment, candidates:[moment…]}]}], totals:{panels,
  filled, candidates, gaps, duration_sec}}` (duration = Σ filled (end−start)/speed).
- Cut: create, rename, delete, list. Scene: add (at position or end), rename, delete, move, set event.
  Panel: add (state gap / with candidates / filled), delete, move (within or across scenes), set intent, trim (clamped to
  clip duration, min 0.5 s), set speed (1 | 0.5 | 0.25, rejected if clip fps < 48 for 0.5 / < 90 for 0.25 — reuse
  `suggestedSpeed` thresholds), positions stay dense 0..n−1 after every op.
- **Place** moment on a panel → state filled, clip/in/out from the moment, speed = moment `suggested_speed`, source user,
  moment status confirmed, candidates cleared. **Pick candidate** = place. **Reject** moment (reason optional) → status
  rejected; removed from any candidate list; a filled panel using it becomes gap (source stays). **Hide clip** → `clips.hidden=1`,
  same treatment for its moments' panels/candidates. Unhide reverses only the flag.
- Tests per op incl. position density, cross-scene move, speed gating, reject cascading.

**S3 — brief + draft apply** (zod schemas in `src/core/storyboard/schema.ts`)
- Brief: `{target_sec: number, audience: string, mood: string, must_have: [{moment_id?: number, text: string}], ending: string,
  notes?: string}` (audience e.g. "family", "friends / social" — steers tone and length).
  `setBrief(cutId, brief, state)` validates; `state` proposed (Claude) or confirmed (user said ok).
- Draft: `{scenes:[{name, event_id?, notes?, panels:[{intent, moment_id?, candidates?: number[], start_sec?, end_sec?, speed?}]}]}`.
  Panel with `moment_id` → filled (in/out default to the moment's, overridable), with `candidates` (2–5) → candidates,
  neither → gap. `applyDraft(cutId, draft, {mode: 'replace'|'append'})` in one transaction: validates every id
  (moment exists, belongs to the project, not rejected, clip not hidden) and reports all errors at once; `replace`
  keeps panels with source user (they are re-appended to their scene by name; scene missing → kept in a "Kept" scene).
  Draft-applied panels are source ai; their moments stay proposed.
- Tests: valid draft tree, every validation error collected, replace keeps user panels, append.

**S4 — CLI + skill** (`src/cli/commands/cut.ts`; all reads `--json`)
- `cut list|create <name>|show <id>|rename|delete`, `cut brief <id> [--set-file f.json] [--confirm]` (no flags = print),
  `cut apply <id> --file draft.json [--append]`, `scene add|rename|move|delete|set-event`, `panel add|move|delete|intent|
  trim|speed|place <panelId> <momentId>|pick`, `moment reject <id> [--reason]`, `clip hide|unhide <id>`.
- `moments list [--event <id>] [--min-tier] [--include-rejected] --json` → compact rows for drafting (id, clip, event,
  start/end, tier/shot/role/issues, slowmo/suggested_speed, audio, dup_group, status, description), hidden clips excluded.
- SKILL.md: "Storyboard" section — workflow brief → draft JSON → `cut apply` → `cut show`; rules: propose the brief and
  wait for the user's ok before drafting; one dup_group member per cut; prefer hero/solid; respect audio_keep.
- Tests: command-level like `events.test.ts` (show JSON shape, apply errors exit 1, place via CLI).

**S5 — export a cut**
- `export --cut <id>` (keep `--story` as alias): panels in scene/panel order; filled → its clip/in/out/speed;
  candidates → **first candidate** (see Q1); gap → skipped. Every exported segment carries `speed` and `scene_name`
  (first segment per scene gets the marker). JSON confirmation adds `{exported, skipped_gaps}`.
- Tests: cut → ExportSegment list (order, speed, scene_name, gap skipped, candidate fallback); OTIO output of a 2-scene
  cut has 2 markers and a LinearTimeWarp on the slowed panel. Resolve golden files untouched; manual Resolve import at
  v0.2 acceptance.

**S6 — re-analysis keeps decisions**
- `analyze --force` on a clip: new moments replace old ones, but old moments that are confirmed/rejected or referenced by
  a panel/candidate are **kept** (not deleted); other old moments are deleted. Panels keep working regardless (S1 rule).
- Tests on `replaceForClip`-successor: kept vs dropped sets, candidates survive.

**S7 — server routes** (Hono, like `events.ts`; thin over the service)
- `GET /api/projects/:id/cuts`, `GET /api/cuts/:id` (tree + clip thumbnail/proxy URLs), `PUT /api/cuts/:id/brief`,
  and POST/PATCH/DELETE for scene/panel ops, place, pick, reject, hide. Errors → 400 with message. Tests via `app.request`.

**Then (planner + user, in chat):** Claude proposes the Arrifana brief → user adjusts/confirms → Claude drafts via
`moments list` + `cut apply` → `export --cut` → user imports into free Resolve. That is the M3 "done when".

**Decisions (user, 2026-11-22):**
- Q1: candidates panel exports its **first candidate** (AI pick usable as-is).
- Q2: brief = PRD fields + **audience**.
- Q3: **auto-create cut "Main"**: any cut-scoped command without a cut id (`cut show`, `cut brief`, `cut apply`,
  `export --cut` without value) uses the project's cut "Main", creating it if the project has no cut yet. More cuts via
  explicit `cut create`. Service: `getOrCreateMainCut(projectId)`; tested in S2 and S4.

### M4 — Scene board UI (mockup first) — board ✅ 2026-11-22 (d2b5d77…753d18e, 721 tests); in use on the real Arrifana cut
2026-11-22: server undo log (U1–U3), web board ported from mockup v2 (W1–W3), fixes F1/F2 after the planner's browser
check. Verified on a DB copy: real cut loads (5 scenes / 42 panels), hover + drawer + preview play proxies, pick →
logged, ⌘Z/⇧⌘Z via server, place of a 21 s moment → 4 s default window (gated slow-mo), 👎 / Undo 👎 logged, 6 undos
restore the cut exactly, project auto-selects. Then pointed `clippilot ui` at `~/Video/ClipPilot Arrifana` (real DB).
Deferred: CLI `scene add --event`; web `defaultRange` duplicates the server one (web can't import src/); no optimistic
updates (every action waits for API + refetch); no pruning of `operations`; reject/hide undo is project-wide.
- Moment pool per scene (by role, hero first, filler collapsed, duplicates stacked, hidden behind a link) + panel row.
- Place (drag / pick candidate) = confirm; 👎 with reasons; hide clip; AI vs user picks visually distinct.
- Edit scenes and panels, trim, speed 100/50/25 %; brief form; browser preview of scene / cut; export button (OTIO).
- Replaces the standalone review page.

#### M4 implementation specs (planner, 2026-11-22) — design = `mockups/scene-board-v2.html` (approved by "wire it")
Two implementer runs: **A = U1–U3 (server)**, then **B = W1–W3 (web)**. Test-first where there is logic; one commit each.

**U1 — operation log + undo/redo (migration 017, `src/core/storyboard/history.ts`)**
- Table `operations (id PK, story_id FK CASCADE, label TEXT, before TEXT, after TEXT, undone INTEGER DEFAULT 0, created_at)`.
- `snapshot(db, cutId)` → JSON of everything a board/CLI edit can change: the cut row (name, brief, brief_state), its
  scenes, panels, panel_candidates (all with ids), plus for the cut's project: `highlights.status/reject_reason` of
  non-proposed moments and the ids of hidden clips. `restore(db, cutId, snap)` rewrites exactly that (delete the cut's
  scenes → cascade; re-insert scenes/panels/candidates **with their original ids**; reset statuses/hidden to the snapshot)
  in one transaction.
- `StoryboardService.command(cutId, label, fn)`: snapshot before → fn → snapshot after → insert operation; first deletes
  the cut's `undone=1` operations (new action clears redo). `undo(cutId)` restores the newest not-undone op's `before` and
  marks it undone; `redo(cutId)` restores the oldest undone op's `after` and clears the flag. Both return
  `{label, can_undo, can_redo}`; nothing to undo/redo → error. `history(cutId)` → last 50 `{id, label, undone, created_at}`.
- **Every** mutating service method used by routes/CLI goes through `command` with a human label ("Place moment in
  panel 3", "Trim panel", "Apply draft (42 panels)", "👎 shake", "Hide clip C0519.MP4", "Confirm brief" …).
  `applyDraft` = one operation. Clip hide/reject affect all cuts of the project but are logged on the cut they were
  done from (fine for v1; note in ARCHITECTURE).
- Tests: undo/redo round-trip for place, trim, reject (status + candidates), hide, delete scene (ids come back), draft
  apply as one step; redo cleared by a new action; restore keeps panel ids; empty-history errors.

**U2 — routes + CLI for history**
- `POST /api/cuts/:id/undo`, `POST /api/cuts/:id/redo`, `GET /api/cuts/:id/history`. Every mutating cut/scene/panel/
  moment/clip route response gains `history: {can_undo, can_redo, undo_label, redo_label}` for that cut (moment/clip
  routes take `cut_id` in the body to know which cut to log on; required).
- CLI: `cut undo|redo|history [id] --json`; CLI mutations log like the routes.

**U3 — moments route + media**
- `GET /api/projects/:id/moments?event_id&include_rejected=1&include_hidden=1` → `listMoments` rows plus
  `thumbnail` (URL of the clip thumbnail nearest the moment midpoint), `clip: {id, file_name, duration_sec, fps,
  proxy_url, hidden}`. Default excludes rejected + hidden (as the CLI).
- `GET /api/cuts/:id` panels/candidates already carry thumbnail/proxy_url — make sure clip `fps` and `duration_sec`
  are included (drawer timeline + speed gating). Test that `/media/proxies/*` answers a `Range` request with 206.

**W1 — board data layer (web/src/board/)**
- `api.ts` (typed calls for tree, moments, all mutations, undo/redo/history), `useBoard(cutId)` hook: loads tree +
  moments, exposes actions that call the API then refetch the tree (simple; no optimistic updates), holds `history`.
- Pure helpers in `web/src/board/logic.ts`: panel timeline length, first-candidate range, scene/cut totals, speed
  gating, "to choose" list. Tests in `tests/unit/web/board-logic.test.ts` (root vitest imports the file).
- Cut selection: project's "Main" cut (create on first open via POST if none).

**W2 — board UI (web/src/components/board/)** — port the v2 mockup faithfully into React + Tailwind:
- New header tab "Board". Scene nav (rename inline, add/move/delete), panel strip, image-only moment pool by role
  (★ hero, ⚠ issue, dot = in cut; filler collapsed; rejected/hidden behind a link; This event / All), drawer for panel
  (player looping range, clip timeline with moments + trim handles, speed 100/50/25 gated by fps, intent, move/delete,
  candidates to pick) and for moment (player, whole-clip toggle, facts, Place / Add to scene, 👎 reason chips, Hide clip /
  restore), hover playback from proxies (muted, 2×, loop range; one live video), drag a moment onto a panel or "+".
- Colour tokens exactly as the mockup: neutral = selection/primary, violet = AI, green = mine, amber = needs decision,
  red = rejected/destructive. Nothing else coloured.
- Undo/redo: header buttons with labels in the tooltip, ⌘Z / ⇧⌘Z (not while typing), toast with "Undo" after actions.

**W3 — brief, preview, export**
- Brief modal (fields incl. audience, must-haves with thumbnails, Confirm → `PUT brief` state confirmed, logged).
- Preview cut / scene: real proxy playback in order at panel speed, 1×/2×, click the track to jump, scene title overlay.
- Export button → server route `POST /api/cuts/:id/export {format:'otio'}` writing to `<project>/exports/<project> – <cut>.otio`
  (add the route in W3 with a test; reuse `cutToSegments` + OTIO writer) → toast with the path.

**F1/F2 — fixes after the planner's browser check (2026-11-22)** (one run; F1 server test-first, F2 web)
- F1a `defaultRange(moment, clip)` in `src/core/storyboard/`: speed = `suggested_speed` if `speedAllowed` for the clip's
  fps else 1; source window = min(moment length, `PANEL_DEFAULT_SEC`=4 × speed), centred on the moment, clamped to it.
  Used by `placeMoment` / pick, `addPanel` with a moment, draft panels without explicit in/out/speed, and the export /
  tree fallback for candidate panels (so preview, totals and export agree). Today place stores the full moment (up to
  21 s) and an un-gated 0.5 on 25 fps clips.
- F1b `addPanel` with a moment marks it confirmed (like place).
- F1c trim or speed change on a filled panel makes it `source='user'` and confirms its moment (user touched it);
  intent edits don't.
- F1d `unrejectMoment` (status back to proposed, reason cleared) + `POST /api/moments/:id/unreject {cut_id}` + CLI
  `moment unreject`, all logged ("Undo 👎" label).
- F1e `addScene` accepts `event_id` (if not already) — web passes the current scene's event.
- F2 web: Board auto-selects the project when exactly one exists; selecting a panel (incl. via "N to choose") scrolls it
  into view in the strip; "Undo 👎" / restore in the moment drawer uses unreject (enabled always); new scene inherits the
  current scene's event; AI panel copy back to "trimming, speed or placing makes it yours".
- Tests: defaultRange table (long moment → 4 s centred; slow-mo on 50 fps → 2 s source at 0.5; 0.5 suggested on 25 fps →
  speed 1, 4 s; short moment → whole); place/addPanel/trim/speed effects; unreject route + undo; draft default range.

Verification (planner): run `clippilot ui` in `~/Video/ClipPilot Arrifana` (dist built) against a **copy** first, then the real
cut; check every interaction incl. undo/redo in the browser.

### v0.3 — M7 Board v3 + M8 Assistant link (planned 2026-11-23)

Design = `mockups/scene-board-v3.html` (approved; data via `scripts/mockups/extract-mockup-data.ts`, which now also
exports the real cut). Decisions from the grilling + mockup rounds (2026-11-22/23):
- **The moment is the edit.** In/out + speed live on the moment; a panel only points at it. Touching a moment (trim /
  speed) confirms it and makes every panel using it `source = user`. The 4 s `defaultRange` window goes away — a panel
  plays its whole moment (long AI moments get trimmed once; tighter moments = roadmap item 2).
- **Two drawers, two jobs.** Panel drawer = choose the shot for this slot (amber = your edit; one decision "Use this in
  panel N"; options = in the story now + similar; clicking an option previews only). Moment drawer = review the clip
  (neutral; whole clip, all its moments, ★, 👎, hide, Show in Finder; similar collapsed; one link into the story).
  Clicking a panel opens the panel drawer, clicking a pool moment the moment drawer. The drawer pushes the board aside;
  < 900 px it is a full-screen sheet.
- **Playback:** the moment loops; seeking outside it plays the clip on; seeking back inside loops again.
- **Similar = same event + same role + same shot.** Pool: all ★ first, then groups side by side (group order = earliest
  recording time; inside = recording time), small gap between groups, no labels, nothing collapsed but rejected/hidden.
  Alternatives = same rule, ★ first. Large groups (Arrifana wide establishing = 29) accepted for now.
- **Seen** = hovered ≥ 2 s or opened → faded + black-and-white in place; in-story moments never fade; hovered/selected
  tiles full brightness; "Mark unseen"; stored server-side, not undoable.
- **★ editable per moment** (user override of the tier; "yours" shown in the drawer only).
- **Assistant route, not hard-wired AI buttons** — v0.3 only links Claude Code to the board (M8); the in-app chat is
  roadmap item 4. Phone moved back (roadmap item 6).

**B1 — server: the moment is the edit** (test-first; migration + service + export + CLI)
- Migration 018: `highlights` + `speed REAL NOT NULL DEFAULT 1`, `ai_start_sec REAL`, `ai_end_sec REAL` (backfilled
  from start/end), `user_tier TEXT NULL CHECK (user_tier IN ('hero','solid','filler'))`, `seen_at TEXT NULL`. Set
  `speed` = suggested_speed when `speedAllowed` for the clip's fps, else 1. Then for every filled panel copy its
  `start_sec/end_sec/speed` into its moment (first panel by cut/scene/position wins if a moment is used twice — none in
  Arrifana today; 29 of 44 panels differ from their moment and get copied); rebuild `story_segments` without
  `start_sec`, `end_sec`, `speed` (keep the filled CHECK on `clip_id`/`moment_id`). Test on a fixture DB: ranges and
  speeds survive, totals unchanged.
- Service: `trimMoment(id, start, end)` (clamped to clip, ≥ `MIN_PANEL_SEC`), `setMomentSpeed(id, speed)` (gated by
  fps), both `touch` (status confirmed + panels using it `source='user'`); `setMomentTier(id, tier | null)`;
  `resetMoment(id)` (back to ai_start/ai_end + default speed). Drop `trimPanel` / `setSpeed` / `defaultRange` /
  `PANEL_DEFAULT_SEC` (and the web duplicate). `addPanel`/`placeMoment`/`pickCandidate`/draft apply just point at the
  moment; a draft panel's explicit in/out/speed is written to the moment (no confirm).
- Tree, totals, preview data and both exporters read range + speed from the moment (`cutToSegments`). Export test:
  same OTIO for the migrated fixture as before the migration.
- Undo snapshot: include every moment of the project that differs from default (status ≠ proposed, range ≠ ai range,
  speed ≠ default, user_tier set); restore resets the others. Tests: trim/speed/★ undo round-trips.
- Re-analysis (`replaceForClip`) also keeps edited moments (range/speed/user_tier changed).
- Routes: `PATCH /moments/:id {cut_id, start_sec?, end_sec?, speed?, tier?}` (logged, labels "Trim moment", "Speed
  50 %", "★" / "Remove ★"), `POST /moments/:id/reset {cut_id}`; `PATCH /panels/:id` keeps intent only (400 on
  start/end/speed). CLI: `moment trim <id> <in> <out>`, `moment speed <id> <s>`, `moment star|unstar <id>`,
  `moment reset <id>`; remove `panel trim|speed`; update SKILL.md.

**B1 result (implementer, 2026-11-23)** - done; tests 721 -> 749 (+28 net; typecheck, `test:all`, `web:build` green).
- Built: migration 018 (`src/db/migrations/018_moment_edit.ts`); `trimMoment` / `setMomentSpeed` / `setMomentTier` /
  `starMoment` / `resetMoment` in the service; `defaultSpeed` replaces `defaultRange` (`range.ts`); tree panels expose
  derived `start_sec` / `end_sec` / `speed` from their moment (so web and CLI output keep their shape); `cutToSegments`,
  totals, undo snapshot (every moment that differs from default), `replaceForClip`, routes
  (`PATCH /moments/:id`, `POST /moments/:id/reset`, `PATCH /panels/:id` intent only), CLI `moment trim|speed|star|unstar|reset`,
  SKILL.md. Web: `panelRange` reads the candidate's moment range/speed, web `defaultRange` removed, drawer trim/speed call
  `PATCH /moments/:id` (no UI redesign). `scripts/mockups/extract-mockup-data.ts` joins the moment for range/speed.
- Interpretations: (1) panels with `state='filled'` but `moment_id NULL` (link lost) get a synthetic confirmed moment
  carrying the panel's range; (2) migration 018 clears the `operations` undo log (snapshots hold panel ranges); (3) a
  `highlights_ai_range` trigger fills `ai_start_sec/ai_end_sec` on insert so direct inserts stay valid; (4) trim/speed on a
  *rejected* moment edits it but keeps it rejected; (5) `touch` sets `source='user'` on panels using the moment in *all*
  cuts, while undo snapshots only restore the logged cut's panels; (6) `unstar` = back to the AI tier, or `solid` when the AI
  tier is hero (`starMoment`); star = `hero`; route labels: hero -> "★", null/solid -> "Remove ★"; (7) a lone `start_sec`
  or `end_sec` in `PATCH /moments/:id` keeps the other bound; (8) a draft's explicit in/out/speed overwrites the moment even
  if the user already edited it; (9) the filled CHECK is now `clip_id` + `moment_id` NOT NULL, so deleting a moment that a
  filled panel uses fails (CHECK) instead of nulling the link; (10) `migration-016.test.ts` now builds the schema as of 016
  (migrations 1-16) because later migrations reshape `story_segments`.
- Deferred: `GET /projects/:id/moments` rows do not yet carry `speed`/`ai_*`/`user_tier` (B2); web drawers still show
  panel-centric trim/speed copy (B4); a draft cannot yet report that it overwrote an edited moment.

**B2 — server: seen, Show in Finder, moment data for the drawers**
- `POST /moments/:id/seen {seen: boolean}` sets/clears `seen_at` (not logged). `POST /clips/:id/reveal` runs
  `open -R <file_path>` via an injectable opener (test with a fake; 404 for unknown clip, 409 if the file is missing).
- `/projects/:id/moments` rows gain `speed`, `ai_start_sec`, `ai_end_sec`, `user_tier`, effective `tier`, `seen`, and
  `clip.recorded_at`, `clip.event_id`. The board loads with `include_rejected=1&include_hidden=1` and filters itself.

**B3 — web logic (pure, tested in `tests/unit/web/board-logic.test.ts`)**
- `similarKey(m)`, `poolOrder(moments)` → `{ heroes: Moment[][], rest: Moment[][] }` (groups; ★ by effective tier),
  `alternatives(m, moments)`, `slotFor(m, tree)` (own panel → panel with a similar moment in this scene → any scene →
  null), `fades(m, used, seen)`, loop/play-on rules `loopStep(t, a, b, free)` + `seekState(t, a, b)`. Port from the mockup.
- **B3 result (2026-11-23):** done in `web/src/board/pool.ts` + `tests/unit/web/board-pool.test.ts` (new files, so B1 can
  edit `logic.ts`/`types.ts` freely). API: `effectiveTier`, `isHero`, `similarKey`, `recTime`, `poolOrder` (+`out`),
  `alternatives(m, moments)`, `slotFor(m, tree, moments, currentSceneId?)`, `usage(tree)`, `fades(m, {inStory, seen,
  hovered, selected})`, `loopStep(t, a, b, free)`, `seekState(t, a, b)`. B4 wires these in and may re-export from logic.ts.

**B4 — web UI (port the mockup faithfully)**
- Panel drawer + moment drawer as in the mockup (amber tokens for the panel drawer + selected strip panel; neutral
  moment drawer), playback rule, trim handles + speed on the moment in both drawers, options/alternatives grid,
  moment list for the clip, ★ / 👎 / hide / mark unseen / Show in Finder, "Compare in panel N" / "Add to scene".
- Pool: ★ section + groups, bold in-story marks with panel number (scene·panel when in another scene), seen fade after
  2 s hover or open (calls B2), hovered/selected full brightness. Drag stays but is not advertised.
- Small screens (< 900 px): scene tabs, drawer as full-screen sheet. Remove the old drawers' trim/speed on panels.
- Planner browser check on a **copy** of the Arrifana DB first, then the real one.

**A1 — M8 assistant link**
- The board writes its selection (`cut_id`, `scene_id`, `panel_id`, `moment_id`, `drawer`) to
  `.clippilot/board-selection.json` via `PUT /board/selection` on every change. `clippilot board context --json` prints
  it resolved (scene name, panel intent + its moment, moment details, alternatives ids) — Claude reads "this panel".
- Live refresh: the board polls `GET /cuts/:id/history` (latest op id) every 2 s and refetches the tree + moments when it
  changes (CLI/Claude edits). Toast "Updated by Claude: <label>" when the change didn't come from this tab.
- SKILL.md: "when the user says this / that panel, run `clippilot board context --json` first".

Deferred (v0.3): new moment from a clip range (two pieces of one clip); splitting large similarity groups (by place
or time gap); event-level "unseen ★" count; seen per device; touch press-and-hold preview.

### M5 — Gap fillers (free) — roadmap item 5
- Per-gap search over own library (unused clips, other projects).
- Locally rendered title/chapter cards, animated route map, photo pan/zoom → ingested as clips.

### M6 — Plugins (optional) — roadmap item 5
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

`npm run test:all` runs 54 test files / 576 tests (2026-11-21; per-module table below predates M2.7). State per module:

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
