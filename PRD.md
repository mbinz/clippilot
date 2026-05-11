# ClipPilot — PRD

## Problem
Reviewing personal video footage (hundreds to low-thousands of clips per project) is slow: scrubbing, naming takes, finding the best version of a moment, and getting a starting timeline into DaVinci Resolve are all manual. Existing one-stop-shop apps either bury the workflow or don't talk to Resolve.

## Users
Solo creators editing their own footage in DaVinci Resolve. Comfortable with a terminal. Already use Claude Code or Claude Desktop and want to "chat with the material" instead of clicking through bins.

## v1 scope (the bet)
ClipPilot is **a data pipeline + a CLI that Claude can drive.** Claude is the primary interface; DaVinci Resolve is the visual finishing tool. The web UI's only remaining job — exploratory grid scrolling on medium (100–1000) projects — is replaced by a `contact-sheet` CLI that writes a labeled composite PNG that Claude reads as an image.

### In scope
- Local ingest: recursive scan, ffprobe metadata, 720p proxies, thumbnails, content-hash dedupe → SQLite.
- Structured analysis via Gemini 2.5 Flash (scene, quality, editorial, keywords) — Zod-validated.
- Query/search via FTS over the analysis output.
- Similarity clustering (location/time/keywords/scene) for near-duplicate handling.
- DaVinci handoff: CSV, JSON, EDL, FCPXML exports. Originals never mutated.
- A skill at `.claude/skills/clippilot/SKILL.md` so Claude knows which verbs to call.

### Out of scope (v1)
- Server/MCP. CLI-as-skill is the only surface.
- Story-AI / persisted sequence reasoning. Claude composes sequences in chat from `get-clip` output; no DB state for it.
- Packaging / distribution. Run via `tsx`, no compiled binary.
- CI. Tests run locally only.

## Why CLI, not MCP (yet)
An earlier plan went straight to MCP. On review: MCP only earns its keep if **per-clip inline thumbnails at scale** become the dominant interaction. The contact-sheet bet pushes the opposite direction. CLI-as-skill matches the project's values:

- One surface for human + AI (no drift between CLI and MCP server).
- No new SDK dependency, no server lifecycle.
- Adding a feature = a flag on a CLI command, not a new tool file.
- Works in any shell-capable agent, not only MCP-aware clients.
- `Read` already renders PNG/JPG visually in Claude Code — so contact sheets and individual thumbnails work today via plain file paths.

Upgrade to MCP **only** if the v1 decision gate (below) hits a concrete wall.

## Surface — CLI subcommands + a skill

All read commands accept `--json`. Write commands print confirmation JSON.

| Command | Kind | Output |
|---|---|---|
| `clippilot search <query> [--filter k=v] [--limit N]` | read | JSON: clip metadata + thumbnail paths |
| `clippilot contact-sheet [--filter k=v] [-n 24] [--page N] -o <path>` | read | writes composite PNG; prints path |
| `clippilot get-clip <id>` | read | JSON: full metadata + thumbnail + proxy paths |
| `clippilot similar <id>` | read | JSON: cluster members + thumbnail paths |
| `clippilot mark-best <id>` | write | confirmation JSON |
| `clippilot tag <id> <tag>...` | write | confirmation JSON |
| `clippilot export <id>... --format <fmt> -o <path>` | write | path to written file |

Plus the existing pipeline commands: `ingest`, `analyze`, `config`, `stats`.

Sequence reasoning ("propose an order for these clips") is **not** a CLI command. Claude does it in chat using `get-clip` results.

## Roadmap (implementation order)

1. **Phase A — done.** Removed `004_story_ai.ts`. Baseline: `npm run typecheck && npm run test:all` green.
2. **Add `--json` to read commands** — `search`, `stats`. Update `tag` to accept structured args and print confirmation JSON. Tests round-trip parse the output.
3. **`contact-sheet` command** — composite PNG generator. Default n=24, deterministic 4×6 grid, clip-ID label per cell. Test: deterministic layout for a fixture.
4. **`get-clip` and `similar` commands** — thin wrappers over existing repos/engines, JSON output. Shape tests per fixture.
5. **`mark-best` write command** — wraps existing repo. Round-trip test.
6. **`export` already exists** — verify it accepts a clip-ID list, emits a path, supports `--json` confirmation. Reuse existing exporter tests.
7. **Write the skill** — `.claude/skills/clippilot/SKILL.md`: verbs, when-to-use, examples. ~80 lines. References `STATUS.md`.
8. **Use it on one real project** for at least a session. Friction notes go in `STATUS.md` under known issues.
9. **Decision gate** — three questions:
   - Did per-clip-thumbnail browsing feel slow because Claude had to `Read` many files?
   - Did shell-quoting on multi-clip writes hurt?
   - Did discoverability fail (forgot which verbs exist)?

   Any clear yes → plan Phase D: MCP server with the same surface.
   All no → CLI-as-skill stands. Execute Phase B + C deletions.
10. Update `STATUS.md`.

## Deletion phases (target state)

**Phase B — when CLI-as-skill works on a real project:**
- `src/core/search/advanced.ts` (Claude composes filters)
- `src/cli/formatters/` (no human-facing pretty-printing once `--json` is default)

**Phase C — when `contact-sheet` proves to replace exploratory grid:**
- `web/` (entire frontend)
- `src/core/server/` and `src/core/server/routes/`
- npm scripts: `web:dev`, `web:build`, `ui`
- deps: `hono`, `@hono/node-server`, `open`
- `src/cli/commands/ui.ts`

If `contact-sheet` doesn't feel right after a real project, web stays; accept the dual-surface cost and document it in `STATUS.md`.

## Keep (architectural commitments)
- `src/core/ingest/*` — proxies, thumbnails, ffprobe, scanner, hasher
- `src/core/analyze/*` — Gemini structured analysis
- `src/core/similarity/*` — clustering
- `src/core/export/*` — csv, json, edl, fcpxml (DaVinci handoff)
- `src/db/*` — schema, repos, migration runner
- `src/core/search/engine.ts` — basic search (advanced.ts is a Phase B deletion candidate)
- Pipeline CLI commands: `ingest`, `analyze`, `config`, `stats`, `export`

## Open questions (decide during build)

- **`sharp` vs `ffmpeg tile`** for contact sheets. `ffmpeg` already a dep; `sharp` adds binary install pain on some platforms but cleaner labels. Lean `ffmpeg` first; switch if labels are ugly. (Resolved during v0.2: shipped with `sharp`.)
- **Thumbnail surfacing in `search --json`.** Paths only, or a `?images=true` flag that emits a quick contact-sheet for the result set? Decide after first real use.
- **Skill location.** Repo-local `.claude/skills/` (versioned with code) vs user-global `~/.claude/skills/`. Repo-local is the default; the skill is project-specific.

## What this buys
- Surface area shrinks ~40% after Phase B+C: no web, no server, no advanced search, no formatters, no story-AI scaffold, no MCP server.
- Adding a feature later = one new CLI subcommand file + one line in the skill.
- MCP stays a real option, only paid for when there's a concrete reason.
