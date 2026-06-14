# ClipPilot — Status

Single source of truth for what works, what doesn't, and how to make a change.
Update this file whenever the answer to any of those questions shifts.

## Version & state

`v0.1.0` — usable for browse/search/analyze; export to Resolve not yet hardened.
Solo project, MIT. Run via `tsx`, no compiled binary.

**Direction:** data pipeline + web UI (primary interactive surface) + CLI skill (AI/scripting surface).
Web UI is committed — Phase C deletion plan cancelled. See [PRD.md](PRD.md) for full scope.

## Implemented

- **Ingest** — recursive scan, ffprobe metadata, ffmpeg 720p proxies, thumbnails, content hashing → SQLite
- **Analyze** — Gemini 2.5 Flash structured analysis (scene, quality, editorial) via `@google/genai`, Zod-validated
- **Search** — FTS engine (`src/core/search/`); CLI `search --json`
- **Similarity** — duplicate/near-dup detection via union-find on location/time/keywords/scene
- **Export** — CSV, JSON, EDL, FCPXML. CLI `export --story <id>` or `--clips <ids>`. Cut points (`start_sec`/`end_sec`), same clip multiple times, and timecode handling are all implemented in the data layer and exporters. Per-scene output + end-to-end Resolve import not yet done (see Backlog #2).
- **Contact sheet** — `clippilot contact-sheet` renders a labeled grid PNG (default 4×6) for visual scanning by humans or Claude. Uses `sharp`.
- **Skill surface** — `.claude/skills/clippilot/SKILL.md` documents the verbs Claude should use (`search`, `get-clip`, `similar`, `mark-best`, `tag`, `contact-sheet`, `export`, `stats`) — all emit JSON.
- **Story data layer** — `stories` + `story_segments` tables (migration 002), `StoryRepository` with full CRUD. Currently flat (no scene layer). Cut points (`start_sec`/`end_sec`) and multiple instances of the same clip are supported. Scene layer, server routes, and UI not done yet (Backlog #1, #3, #4).
- **Web UI** — Hono server (`clippilot ui`), Vite frontend in `web/`. Primary interactive surface (browse, filters, clip detail with proxy playback, similarity clusters). Sequence builder not built yet (Backlog #4).
- **Tag / Stats / Config** — CLI with `--json`
- **DB migrations** — runner with versioning, migrations 001–006 applied: `001_initial`, `002_stories`, `003_similarity`, `004_timecode` (clips.start_timecode), `005_nb_frames` (clips.nb_frames), `006_has_audio_video` (clips.has_video/has_audio)

## Backlog (priority order)

Model decided 2026-06-14: **Project → Cut → Scene → Segment**. Schema keeps `stories` (= a Cut)
and `story_segments`; a new `scenes` table is inserted between, and segments gain `scene_id`.
Scenes live inside a cut (no cross-cut sharing). Export = one timeline file per scene.
See [PRD.md](PRD.md) "Data model" and "Export to DaVinci Resolve" for full rationale.

### 1. Scene schema
Add the scene layer to the data model.
- New migration (007): `scenes` table (id, story_id, name, position) + `story_segments.scene_id`.
  Existing segments backfill into one default scene per story.
- `StoryRepository` → Cut/Scene/Segment shape: create/rename/reorder scenes; add/reorder segments within a scene.
- Round-trip tests for the new repo methods.

### 2. Per-scene export hardening — BLOCKER
DaVinci Resolve import is unverified end-to-end. This is what makes ClipPilot useful.
(Per-scene output depends on #1; the fps/drop-frame fixes are independent and can land first.)
- **Per-scene output** — export a cut as one timeline file per scene, numeric-prefixed by scene order
  (`01_Rome.fcpxml`, …). Quick `--clips` export stays a single flat timeline.
  Note: a single multi-timeline FCPXML does NOT work — Resolve imports only the last `<project>`.
- **Mixed source frame rates** — currently hard-rejects if clips in a scene don't share one fps.
  Must conform to the chosen timeline fps instead (resample timecodes; warn per mismatched clip).
- **Drop-frame timecode** — `tcFormat="NDF"` and `FCM: NON-DROP FRAME` are hardcoded. DF support
  needed for 29.97/59.94 footage.
- **Round-trip verification** — actually import the per-scene files into Resolve, assemble a master,
  and confirm offsets/durations/relink are correct. No automated coverage today.
- **Export from UI** — currently CLI-only; needs a `/export` server route + download.

### 3. Cut/scene server routes
No HTTP API for cuts/scenes/segments exists. Need CRUD for:
- Cuts (list by project, create, rename, delete)
- Scenes (list by cut, create, rename, reorder, delete)
- Segments (add to scene, reorder within scene, set in/out, remove)
- Export endpoint (per-scene files for a cut)

### 4. Sequence builder UI
Depends on #1 (schema) and #3 (routes). Missing entirely today.
- Manage cuts within a project; manage/reorder scenes within a cut
- Add clips into a scene from search results or clip detail panel
- Drag-and-drop segment reorder
- Per-segment in/out cut point setter (scrub or type timecode)
- Same clip multiple times at different cut points — supported by data model
- Per-scene export download

### 5. Mark-best in UI
`mark-best` CLI and `/similarity/groups/:id/best` route exist. Missing: button in `ClipDetail`
(and optionally `ClusterCard`).

### 6. Cut/scene CLI commands
Lower priority once UI covers it, but useful for scripting/Claude-driven workflows:
create cut, add scene, add-clip with `--in`/`--out`, export cut.

## Known gaps (non-backlog)

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
| `core/server/routes` | clips, facets, projects, similarity | clips, facets, similarity | **partial** (projects untested; cut/scene routes not built yet — Backlog #3) |
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
