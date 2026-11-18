# ClipPilot — Status

Single source of truth for what works, what doesn't, and how to make a change.
Update this file whenever the answer to any of those questions shifts.

## Version & state

`v0.1.0` — usable for browse/search/analyze; export to Resolve unreliable (see M1). No story/storyboard workflow yet.
Solo project, MIT. Run via `tsx`, no compiled binary.

**Direction:** data pipeline + web UI (primary interactive surface) + CLI skill (AI/scripting surface).
Web UI is committed — Phase C deletion plan cancelled. See [PRD.md](PRD.md) for full scope.

## Implemented

- **Ingest** — recursive scan, ffprobe metadata, ffmpeg 720p proxies, thumbnails, content hashing → SQLite
- **Analyze** — Gemini 2.5 Flash structured analysis (scene, quality, editorial) via `@google/genai`, Zod-validated
- **Search** — FTS engine (`src/core/search/`); CLI `search --json`
- **Similarity** — duplicate/near-dup detection via union-find on location/time/keywords/scene
- **Export** — CSV, JSON, EDL, FCPXML. CLI `export --story <id>` or `--clips <ids>`. Cut points (`start_sec`/`end_sec`), same clip multiple times, and timecode handling are all implemented in the data layer and exporters. Known defects with mixed fps / formats / TC; never verified in Resolve (see M1).
- **Contact sheet** — `clippilot contact-sheet` renders a labeled grid PNG (default 4×6) for visual scanning by humans or Claude. Uses `sharp`.
- **Skill surface** — `.claude/skills/clippilot/SKILL.md` documents the verbs Claude should use (`search`, `get-clip`, `similar`, `mark-best`, `tag`, `contact-sheet`, `export`, `stats`) — all emit JSON.
- **Story data layer** — `stories` + `story_segments` tables (migration 002), `StoryRepository` with full CRUD. Currently flat (no scene layer). Cut points (`start_sec`/`end_sec`) and multiple instances of the same clip are supported. Scene layer, routes, UI → M3/M4.
- **Web UI** — Hono server (`clippilot ui`), Vite frontend in `web/`. Primary interactive surface (browse, filters, clip detail with proxy playback, similarity clusters). Storyboard view not built yet (M4).
- **Tag / Stats / Config** — CLI with `--json`
- **DB migrations** — runner with versioning, migrations 001–006 applied: `001_initial`, `002_stories`, `003_similarity`, `004_timecode` (clips.start_timecode), `005_nb_frames` (clips.nb_frames), `006_has_audio_video` (clips.has_video/has_audio)

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

### M1 — Export that works  ← IN PROGRESS
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

**M1.3 — Fixture export + manual import (planner + user)** — ingest the fixture folder, export the reference
timeline from ClipPilot in both formats, user imports both into free Resolve with this checklist:
every clip online · offsets/durations match the hand-built timeline · 50 %/25 % speed correct · markers present ·
no import warnings. Winner becomes primary; decision goes into ARCHITECTURE. EDL dropped unless there's a reason.

Done when: M1.1 + M1.2 green, M1.3 checklist passes for at least one format.

### M2 — Understand the footage
- Resumable / incremental ingest (survive interruption on a 123 GB trip); capture folder as scene hint.
- Gemini analysis of the proxy **video** → timestamped highlights table. Pilot on `03 Arrifana/Delfine`
  (33 clips already ingested) to judge quality + cost before running all 508.
- Project summary command ("what's in here").

### M3 — Storyboard model + CLI
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

`npm run test:all` runs 26 test files / 213 tests. State per module:

| Module | Source | Tests | Coverage |
|---|---|---|---|
| `core/ingest` | hasher, probe, scanner, proxy, thumbnail | hasher, probe, scanner + 1 integration | **partial** (proxy/thumbnail via integration only) |
| `core/analyze` | schema, gemini-client, prompts | schema | **partial** (Gemini client untested — network) |
| `core/search` | engine, advanced | engine, advanced-search | **good** (advanced is used by the web server's clips route — kept) |
| `core/similarity` | union-find, engine | union-find, engine | **good** |
| `core/export` | csv, json, edl, fcpxml | all four | **good** |
| `core/contact-sheet` | layout + sharp render | layout (unit) | **partial** (sharp render is library-tested) |
| `core/server/routes` | clips, facets, projects, similarity | clips, facets, similarity | **partial** (projects untested; cut/scene routes → M3) |
| `core/config` | manager, defaults | — | **none** |
| `db/repositories` | clip, project, similarity, story, thumbnail | clip, project, similarity, story | **partial** (thumbnail untested) |
| `db/migrations` | 001–006 + runner | migrations runner | **good** (004–006 are single-column ALTERs, covered transitively) |
| `utils` | fs, timecode, concurrency, errors, logger | fs, timecode | **partial** |
| `cli/json` | clip projection | full unit | **good** |
| `cli/commands` | 12 commands (analyze, config, contact-sheet, export, get-clip, ingest, mark-best, search, similar, stats, tag, ui) | — | **none** (manual smoke only) |

Type checking: `npm run typecheck` (strict TS, no errors expected).

## How to make a change

1. **Baseline green:** `npm run typecheck && npm run test:all`
2. **Scope it** in Claude Code plan mode (no separate framework needed).
3. **Acceptance criterion = a test.** Add or adjust the `vitest` test that proves the change. If the change is UI-only and not unit-testable, say so explicitly in the commit message.
4. **Commit atomically** and update the relevant section of this file if scope, coverage, or known-gaps changed. Git log + this file are the project memory.

That's the whole process. No `.planning/`, no `CHANGELOG.md`, no agent framework.
