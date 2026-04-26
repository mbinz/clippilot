# ClipPilot v0.2 — CLI-as-skill, MCP only if earned

Living plan for the next major change. Delete this file when v0.2 ships and
fold the relevant facts into [STATUS.md](STATUS.md).

## Thesis

Stop building a one-stop-shop app. Become a **data pipeline + a CLI Claude
can drive.** Claude (Code or Desktop) is the primary interface — "chat with
the material." DaVinci Resolve remains the visual finishing tool.

The web UI's only remaining job — exploratory grid scrolling on medium
(100–1000) projects — is replaced by a `contact-sheet` CLI command that
writes a labeled composite PNG; Claude reads it as an image. If that proves
out, `web/` gets deleted.

## Why CLI, not MCP (yet)

The earlier draft of this plan went straight to MCP. Reviewing it: MCP only
earns its keep if **per-clip inline thumbnails at scale** become the dominant
interaction. We don't know that yet, and the contact-sheet bet pushes the
opposite direction. CLI-as-skill matches the project's stated values better:

- One surface for human + AI (no drift between CLI and MCP server).
- No new SDK dependency, no server lifecycle.
- Adding a feature = a flag on a CLI command, not a new tool file.
- Works in any shell-capable agent, not only MCP-aware clients.
- `Read` already renders PNG/JPG visually in Claude Code — so contact sheets
  and individual thumbnails work today via plain file paths.

We upgrade to MCP **only** if Phase 0 (below) hits a concrete wall:
per-clip-thumbnail latency from many `Read` calls, shell-quoting friction on
multi-clip writes, or skill discoverability problems. Not before.

## Surface (v0.2): CLI subcommands + a skill

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

Plus the existing pipeline commands kept as-is: `ingest`, `analyze`, `config`, `stats`.

Sequence reasoning ("propose an order for these clips") is **not** a CLI
command. Claude does it in chat using `get-clip` to load metadata. No tool
needed for what is fundamentally a prompt pattern.

The skill lives at `~/.claude/skills/clippilot/SKILL.md` (or repo-local
`.claude/skills/clippilot/SKILL.md`) — a short markdown document listing the
verbs, when to use each, and example invocations. ~80 lines.

## Deletions

**Phase A — done:**
- ~~`src/db/migrations/004_story_ai.ts`~~ (deleted)

**Phase B — when CLI-as-skill works on a real project:**
- `src/core/search/advanced.ts` (Claude composes filters)
- `src/cli/formatters/` (no human-facing pretty-printing once `--json` is the default)

**Phase C — when `contact-sheet` proves to replace exploratory grid:**
- `web/` (entire frontend)
- `src/core/server/` and `src/core/server/routes/`
- npm scripts: `web:dev`, `web:build`, `ui`
- deps: `hono`, `@hono/node-server`, `open`
- `src/cli/commands/ui.ts`

If `contact-sheet` does not feel right after a real project, web stays;
accept the dual-surface cost and document it in `STATUS.md`.

## Keep

- `src/core/ingest/*` — proxies, thumbnails, ffprobe, scanner, hasher
- `src/core/analyze/*` — Gemini structured analysis (required for any querying)
- `src/core/similarity/*` — clustering
- `src/core/export/*` — csv, json, edl, fcpxml (DaVinci handoff)
- `src/db/*` — schema, repos, runner
- `src/core/search/engine.ts` — basic search; drop `advanced.ts`
- Pipeline CLI commands: `ingest`, `analyze`, `config`, `stats`, `export`

## Implementation order

1. **Phase A complete** — `004_story_ai.ts` removed. Confirm green: `npm run typecheck && npm run test:all`.
2. **Add `--json` to existing read commands** — `search`, `stats`. Update `tag` to accept structured args and print confirmation JSON. Tests: round-trip parse the JSON output.
3. **`contact-sheet` command** — composite PNG generator. Likely `sharp` (cleanest) or `ffmpeg tile` filter (no new dep). Default n=24, deterministic 4×6 grid, clip ID label per cell. Test: deterministic layout for known input fixture.
4. **`get-clip` and `similar` commands** — thin wrappers over existing repos/engines, JSON output. Tests: shape per fixture.
5. **`mark-best` write command** — wraps existing repo. Test: round-trip.
6. **`export` already exists** — verify it accepts a clip-ID list and emits a path; add `--json` confirmation. Reuse existing exporter tests.
7. **Write the skill** — `.claude/skills/clippilot/SKILL.md` listing verbs, when-to-use, examples. Reference `STATUS.md` for project state.
8. **Use it on one real project** for at least a session. Notes go in `STATUS.md` under "Known issues" if anything friction-y comes up.
9. **Decision gate.** Three questions:
   - Did per-clip-thumbnail browsing feel slow because Claude had to `Read` many files?
   - Did shell-quoting on multi-clip writes hurt?
   - Did discoverability fail (you forgot what verbs exist)?

   If any clear yes → plan a Phase D for an MCP server with the same surface.
   If all no → CLI-as-skill stands. Do **Phase B + C deletions**.
10. Update `STATUS.md`, delete this file.

## Critical files (new + modified)

- **New:**
  - `src/cli/commands/contact-sheet.ts`
  - `src/cli/commands/get-clip.ts`
  - `src/cli/commands/similar.ts`
  - `src/cli/commands/mark-best.ts`
  - `.claude/skills/clippilot/SKILL.md`
- **Modified:**
  - `src/cli/commands/search.ts`, `stats.ts`, `tag.ts`, `export.ts` — add `--json`
  - `src/cli/index.ts` — register new subcommands
- **Reused as-is:**
  - all `src/db/repositories/*`
  - all `src/core/{ingest,analyze,similarity,export}/*`
  - `src/core/search/engine.ts` (basic, not advanced)

## Verification per command

Each new/modified command ships with:
- A `vitest` test asserting `--json` output shape on a fixture project.
- Manual end-to-end: in a project that has run `clippilot ingest && clippilot analyze`, run the command, confirm output.

For the skill: open Claude Code in a real project, ask Claude to find clips
matching some criterion. It should pick the right verb, parse the JSON, and
either show a contact sheet or `Read` thumbnails as appropriate. If Claude
struggles, the skill markdown needs more examples — not an MCP server.

## Open questions (decide during build)

- **`sharp` vs `ffmpeg tile`** for contact sheets. `ffmpeg` is already a
  dependency; `sharp` adds binary install pain on some platforms but produces
  cleaner labeled output. Lean toward `ffmpeg` first; switch if labeling is
  ugly.
- **Thumbnail surfacing in `search --json`.** Return paths only, or a small
  `?images=true` flag that emits a quick contact-sheet for the result set?
  Decide after first real use.
- **Skill location.** Repo-local `.claude/skills/` (versioned with code,
  travels with the project) vs user-global `~/.claude/skills/` (works from
  anywhere). Repo-local is the right default; the skill is project-specific.

## What this buys

- Surface area shrinks ~40% after Phase B+C: no web, no server, no advanced
  search, no formatters, no story-AI scaffold, no MCP server.
- Adding a feature later = one new CLI subcommand file + one line in the
  skill. That's the "few changes, easy when needed" goal.
- MCP stays a real option, but only paid for when there's a concrete reason.
