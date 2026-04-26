# ClipPilot — Status

Single source of truth for what works, what doesn't, and how to make a change.
Update this file whenever the answer to any of those questions shifts.

## Version & state

`v0.1.0` — usable for personal video-review workflow. Not packaged for distribution.
Solo project, MIT. Run via `tsx`, no compiled binary.

**Direction in flight:** transitioning from one-stop-shop CLI/Web app to
**data pipeline + Claude skill** ("chat with the material"). See [PLAN.md](PLAN.md)
for the active plan; web UI fate decides after first real-project use.

## Implemented

- **Ingest** — recursive scan, ffprobe metadata, ffmpeg 720p proxies, thumbnails, content hashing → SQLite
- **Analyze** — Gemini 2.5 Flash structured analysis (scene, quality, editorial) via `@google/genai`, Zod-validated
- **Search** — FTS engine (`src/core/search/`); CLI `search --json`
- **Similarity** — duplicate/near-dup detection via union-find on location/time/keywords/scene
- **Export** — CSV, JSON, EDL, FCPXML (DaVinci-ready), originals never touched. CLI `export --json` writes file + emits confirmation.
- **Contact sheet** — `clippilot contact-sheet` renders a labeled grid PNG (default 4×6) for visual scanning by humans or Claude. Uses `sharp`.
- **Skill surface** — `.claude/skills/clippilot/SKILL.md` documents the verbs Claude should use (`search`, `get-clip`, `similar`, `mark-best`, `tag`, `contact-sheet`, `export`, `stats`) — all emit JSON.
- **Web UI (legacy)** — Hono server (`clippilot ui`), Vite frontend in `web/`. Frozen for features; deletion candidate after the contact-sheet flow is validated on a real project.
- **Tag / Stats / Config** — CLI with `--json`
- **DB migrations** — runner with versioning, migrations 001–003 applied

## Not implemented / known gaps

- **No story-AI feature.** Earlier scaffolding (migration `004_story_ai.ts`) was deleted — sequence reasoning is now expected to live in the chat (Claude reasons over `get-clip` results), with no persisted state.
- **`thumbnail` repository, `gemini-client`, `proxy` modules** — production code present, no direct unit tests (proxy/thumbnail covered indirectly by the `ingest` integration test).
- **`projects` API route** — exists in `src/core/server/routes/projects.ts` but no test. Likely deleted in Phase C with the rest of `web/`.
- **No packaging** — no `bin` build, no npm publish. Install via repo clone + `npm install -g tsx`.
- **No CI** — tests run only locally.

## Quality / test coverage map

`npm run test:all` runs 25 test files / 191 tests. State per module:

| Module | Source | Tests | Coverage |
|---|---|---|---|
| `core/ingest` | hasher, probe, scanner, proxy, thumbnail | hasher, probe, scanner + 1 integration | **partial** (proxy/thumbnail via integration only) |
| `core/analyze` | schema, gemini-client, prompts | schema | **partial** (Gemini client untested — network) |
| `core/search` | engine, advanced | engine, advanced-search | **good** (advanced is a Phase B deletion candidate) |
| `core/similarity` | union-find, engine | union-find, engine | **good** |
| `core/export` | csv, json, edl, fcpxml | all four | **good** |
| `core/contact-sheet` | layout + sharp render | layout (unit) | **partial** (sharp render is library-tested) |
| `core/server/routes` | clips, facets, projects, similarity | clips, facets, similarity | **partial** (projects untested; whole module deleted in Phase C if web goes) |
| `core/config` | manager, defaults | — | **none** |
| `db/repositories` | clip, project, similarity, story, thumbnail | clip, project, similarity, story | **partial** (thumbnail untested) |
| `db/migrations` | 001–003 + runner | migrations runner | **good** |
| `utils` | fs, timecode, concurrency, errors, logger | fs, timecode | **partial** |
| `cli/json` | clip projection | full unit | **good** |
| `cli/commands` | 11 commands | — | **none** (manual smoke only) |

Type checking: `npm run typecheck` (strict TS, no errors expected).

## How to make a change

1. **Baseline green:** `npm run typecheck && npm run test:all`
2. **Scope it** in Claude Code plan mode (no separate framework needed).
3. **Acceptance criterion = a test.** Add or adjust the `vitest` test that proves the change. If the change is UI-only and not unit-testable, say so explicitly in the commit message.
4. **Commit atomically** and update the relevant section of this file if scope, coverage, or known-gaps changed. Git log + this file are the project memory.

That's the whole process. No `.planning/`, no `CHANGELOG.md`, no agent framework.
