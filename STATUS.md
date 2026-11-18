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

### M1 — Export that works  ← NEXT
- Build a 3-camera fixture from real Portugal clips: 25 + 50 + 100 fps, Sony TC + GoPro, a VFR phone clip,
  a path with spaces/trailing space, one segment at 25 % speed, same clip used twice.
- Spike: FCPXML (fixed: per-asset `<format>` with width/height, conform to timeline fps, `timeMap` retime,
  DF/NDF TC) vs OTIO. Import both into **free** Resolve. Pick primary; record the decision in ARCHITECTURE.
- One timeline per cut with scene markers.
- Manual Resolve import checklist + automated structural tests (golden files) for the winner.
- See ARCHITECTURE "Known export defects" for the concrete bug list.

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
