# ClipPilot — Architecture

One-pager. Source of truth for code structure and the small set of decisions that shape it. Update when a decision changes.

## Shape

```
bin/clippilot.ts           # entry — defers to src/cli
instructions/              # every agent instruction (Gemini prompts + Claude skills), see "Pipeline: who does what"
src/
  cli/
    index.ts               # Commander setup, registers commands
    commands/              # 13 subcommands (ingest, analyze, search,
                           #   contact-sheet, get-clip, similar, mark-best,
                           #   tag, export, stats, summary, config, ui)
    json.ts                # shared clip-projection for --json output
    formatters/            # human-facing pretty print
  core/
    ingest/                # scanner, probe (ffprobe), proxy (ffmpeg),
                           #   thumbnail, hasher, scene-hint
    analyze/               # gemini-client + schema (Zod) + prompts + highlights (normalize, fps-gated slow-mo speed)
    review/                # review-data + self-contained review page (moment 👍/👎; superseded by the scene board in M4)
    calibration/           # verdict import + round metrics + sampling (taste-profile learning dropped 2026-11-21; removal in M2.7)
    tiers.ts               # hero/solid/filler ranking helpers
    search/                # engine (FTS) + advanced (filtered search for web)
    similarity/            # union-find clustering
    export/                # otio (primary), fcpxml, csv, json, edl; timeline-plan (shared frame/TC math), fcpxml-rates
    contact-sheet.ts       # labeled grid PNG via sharp
    summary.ts             # buildProjectSummary ("what's in here")
    server/                # Hono routes backing the web UI
    config/                # manager + defaults
  db/
    connection.ts          # better-sqlite3 handle
    index.ts               # public DB surface
    migrations/            # 001..018 + runner
    repositories/          # clip, project, similarity, story, thumbnail, highlight
  types/, utils/, constants.ts
tests/{unit,integration,fixtures}
web/                       # React 19 + Tailwind + Vite — primary UI (kept; storyboard view lands here in M4)
```

## Data flow

1. **Ingest** — `scanner` walks a folder → fast skip if `file_path`+`file_size` already known (resume without re-hashing) → `probe` (ffprobe) reads metadata → `hasher` content-hashes (fallback dedupe) → `proxy` renders 720p MP4 to `<hash>.partial.mp4`, renamed on success → `thumbnail` extracts stills. One row per clip, committed per clip, with `scene_hint` = parent folder relative to the ingest root. Originals never mutated.
2. **Analyze** — `gemini-client` sends each clip's 720p **proxy video** inline (base64, ~20 MB request cap) to Gemini 2.5 Flash with a Zod-typed `schema` → structured fields (scene, quality, editorial, keywords) on the clip row + 0–5 **highlights** (start/end sec, English description, tier hero/solid/filler, shot, role, issues, slow-mo + fps-gated suggested speed) clamped to the clip duration and stored in `highlights` (replaced per clip on re-analysis). Malformed JSON is retried; `analyzing` clips from an interrupted run count as pending.
3. **Query** — `search/engine.ts` runs FTS over analysis output; `similarity/` clusters via union-find over location/time/keywords/scene.
4. **Export** — `export/{csv,json,edl,fcpxml}` writes a DaVinci-importable file from a clip-ID list. `fcpxml-rates` handles frame-rate quirks for Resolve.
5. **Chat surface** — Claude calls CLI commands with `--json`, reads thumbnails/contact-sheets as images, decides which clips to mark or export.

### Target flow (2026-11-21 re-plan — see PRD "Workflow")

```
ingest (resumable) → analyze proxy video → moments (tagged, no scores)
  → events (deepest folder | recording-time groups) → brief (Claude proposes, user adjusts)
  → storyboard: Cut → Scene → Panel {filled | candidates | gap}, source ai | user  (Claude drafts in chat)
  → scene board in web UI (moment pool; place = confirm, 👎 = reject, hide clip) → browser preview
  → gap fillers (library → local render → plugins) → ingest as normal clips
  → export one timeline per cut (+ scene markers) → free Resolve
```

### Pipeline: who does what (2026-11-25, target after L0)

The PRD "Workflow" and the flow above say *what* happens; this table says *who* does it and *which instructions* they
follow. Every learnable instruction is listed here; the learning step (L3) uses this table to decide where a lesson
belongs. Keep it current with every pipeline change.

| # | Step | Actor | Instructions (learnable) | Input → output |
|---|---|---|---|---|
| 1 | Ingest, proxies | code | — | folder → clips, proxies |
| 2 | Transcribe | whisper.cpp | — | audio → words with times |
| 3 | Measure jitter + shakes | code | thresholds in project config (proposal only) | proxy → jitter band, shakes |
| 4 | Analyze | Gemini Flash | `instructions/analyze.md`; normaliser rules in code (proposal only) | proxy + measured context → moments |
| 5 | Shake verify | Gemini Flash | `instructions/shake-verify.md` | moment around a shake → keep / trim / split |
| 6 | Events | code + Claude | `instructions/clippilot.md` (Events) | folders / times → events |
| 7 | Brief | Claude | `instructions/brief.md` | events + moments → brief (user confirms) |
| 8 | Draft | Claude | `instructions/draft.md` + `instructions/edit.md` | brief + moments → cut |
| 9 | Cut critic | Claude (sonnet subagent) | `instructions/cut-critic.md` (reads `edit.md` for possible fixes) | cut context + stills → findings |
| 10 | Story critic | Gemini 2.5 Pro | `instructions/story-critic.md` | 480p preview + brief → findings |
| 11 | Review loop (runs critics, applies findings) | Claude | `instructions/review-loop.md` + `instructions/edit.md` | findings → AI edits |
| 12 | Steering | the user, on the board | — | AI cut → final cut |
| 13 | Learning | Claude (Opus) | `instructions/learn.md` | AI cut vs final cut + findings → instruction diffs + project proposals |
| 14 | Export | code | — | cut → OTIO / FCPXML |
| 15 | resolve-prep (other repo) | Claude | `~/dev/clippilot-post` skill | export → Resolve package |

`instructions/clippilot.md` = CLI reference + cold start, shared by every Claude role.


- **Events** = footage side (objective, shared by cuts); **Scenes** = story side (per cut). Events table + `clips.event_id` (M2.8).
- **Moment status** `proposed | confirmed | rejected`; **panel source** `ai | user` (M3). Clips get a `hidden` flag. Originals never touched.

- **Highlights (moments)** are the unit the storyboard reasons about (clip_id + start/end + description + tags), not whole clips. `highlights` table since M2 (migration 008). Timestamps are ~1 s precise (Gemini samples ~1 fps) — a starting point to trim, not frame-accurate.
- **Panels** = `story_segments` with `scene_id`, `intent`, `state`, `source`; candidates are a child table of panel → highlight (M3).
  Since v0.3 a filled panel only points at a moment (`moment_id`, `clip_id`) — in/out and speed live on the moment (decision 11).
- **Fillers** are files on disk ingested like any clip, tagged with a source (`library | generated | stock | ai`). Exporters never special-case.

### Export facts learned in M1 (keep — they explain the code)

- One `<format>`/asset per source format and per timeline use; assets at the source rate, clips on the timeline grid.
- Asset extent = **video stream** duration (not container; GoPro differs by ~3 frames). VFR averages snap (49.93 → 50).
- Sony fps > 50: Resolve reads the TC frame field at 2×fps (`06:37:54:72` @100p → .36 s). `tcFrameFieldRate` — confirmed by import spot check on 100p; 60p is extrapolated.
- Speed: FCPXML `timeMap`, OTIO `LinearTimeWarp`.
- Resolve drops FCPXML clip markers on import; OTIO clip markers survive.
- Paths with spaces / trailing spaces work (percent-encoded in FCPXML, plain in OTIO).
- Still open: drop-frame TC (treated as NDF), audio channel count assumed stereo, EDL rejects mixed fps (EDL to be dropped).

## Persistence

- SQLite via `better-sqlite3`, single file per project at `<cwd>/.clippilot/clippilot.db` (`resolveDbPath` in `utils/fs`) — the working directory picks the project DB.
- One repository per entity. No ORM.
- Migrations are forward-only TS files (`001_initial.ts` … `012_moment_tags.ts`) run by `migrations/runner.ts` at startup.

## Key decisions

1. **CLI-as-skill over MCP for the AI; web UI for the human.** v1: Claude drafts via CLI JSON in chat; the UI shows and steers. Roadmap: the UI starts AI actions itself via the Claude Agent SDK in the local server, acting through the same CLI verbs.
2. **SQLite as single source of truth; originals immutable.** All derived assets (proxies, thumbnails, sheets) live under a project-scoped cache dir.
3. **Structured Gemini output (Zod) over free-text.** Makes the analysis queryable; rejects model drift at parse time.
4. **ffmpeg/ffprobe shelled out.** No native AV bindings beyond `better-sqlite3` and `sharp`. Keeps install simple; matches Resolve's own toolchain.
5. **Vendor-neutral handoff — OTIO primary, FCPXML secondary** (decided 2026-11-18 by the M1 import test in free Resolve). Both import with every clip online, correct lengths, speeds and frames; only OTIO keeps scene markers (Resolve drops clip `<marker>`s from FCPXML). OTIO carries Resolve-specific `Resolve_OTIO` metadata (link groups, audio channels) — ignored by other OTIO consumers. One timeline per cut with scene markers. Resolve Studio scripting not needed. Both exporters share frame/TC math in `export/timeline-plan.ts`; tests compare against Resolve-written golden files in `tests/fixtures/resolve-golden/`.
6. **No build step.** Run via `tsx`. Type-checking is the compile gate.
8. **Categorical tags, not absolute scores** (2026-11-19/21). Gemini's 1–5 clip scores and 1–10 moment scores were flat (2.8–3.8; 33 of 36 at 7–8) → dropped incl. DB columns. Moments carry tier/shot/role/issues/slow-mo/audio; measurable things (jitter, shakes, fps, duration) are computed in code; Gemini's `shake` issue was dropped in J1 (2026-11-25).
9. **No automatic taste profile; human-approved instruction learning instead** (2026-11-21, revised 2026-11-25). Profile
   rules learned automatically from ~29 rated moments in one folder overfit → dropped. Instead, the user starts a learning
   step after a project: Claude compares the AI's cut with the user's final cut and proposes changes to the **agent
   instructions** (`instructions/`, any step of the pipeline below) and **project proposals** (tools, step order, coded
   rules). The user accepts, edits or rejects each one; nothing changes on its own. One project is enough evidence when the
   user accepts. Learning happens at the level of the finished cut (critics, drafter), not by making analysis smarter alone.
10. **Undo/redo lives on the server** (2026-11-22). Every storyboard mutation — from the board, the CLI or Claude — runs
   through `StoryboardService.command(cutId, label, fn)`, which stores a before/after snapshot of the cut (scenes, panels,
   candidates, brief) and of the project's moment statuses / hidden clips in `operations`. Undo/redo restore snapshots
   with original row ids, so the UI selection survives and a whole Claude draft is one undo step. Snapshots are small
   (a cut is ≲ 100 panels); per-op inverses aren't worth the bug surface. Moment reject / clip hide are project-wide but
   are logged on the cut they were done from.
11. **The moment is the edit** (2026-11-23, v0.3). A moment (`highlights` row) is a micro edit: in/out (`start_sec`,
   `end_sec`) and `speed` are the values every panel, the preview, the totals and the exporters use. A panel stores
   no range of its own. The analysis' original in/out is kept (`ai_start_sec`, `ai_end_sec`) so "changed by you" and a
   reset are possible. Trim or speed on a moment confirms it and makes every panel using it `source = user`. Why: one
   place to edit, no drift between what you reviewed and what is in the cut; two pieces of one clip = two moments.
   Consequence: re-analysing a clip must not replace moments that are edited or used in a cut.
13. **All agent instructions live in `instructions/`** (2026-11-25). Every prompt or skill text an AI follows (Gemini prompts
   and Claude skills alike) is one markdown file there; code loads the Gemini prompts from it, and `.claude/skills/*/SKILL.md`
   / `.claude/agents/*.md` are thin pointers (frontmatter + "read `instructions/<name>.md`"). Why: the learning step edits
   markdown only, and one folder shows every learnable instruction. Each file belongs to exactly one step in the
   "Pipeline: who does what" table.
12. **Board state that isn't an edit stays out of undo** (2026-11-23). "Seen" (`highlights.seen_at`) and the board
   selection (for `clippilot board context`) are stored, not logged in `operations`.
7. **Paid / vendor-specific sources are plugins.** Stock and AI-video gap fillers sit behind a plugin seam (M6); the core stays free and offline-capable except for Gemini analysis.

## Testing

- `vitest`, layout `tests/{unit,integration,fixtures}`.
- Unit covers pure modules (search engine, similarity union-find, exporters, schema, hasher, probe, scanner, JSON projection, contact-sheet layout, migration runner).
- Integration covers ingest end-to-end against fixture media.
- Module-by-module coverage map lives in `STATUS.md`. `gemini-client` is tested through an injected `generate` function; the real API call is deliberately untested.

## What's external
- Gemini API (`@google/genai`) — analysis.
- `ffmpeg`/`ffprobe` on PATH — proxies + metadata.
- DaVinci Resolve — consumer of export files; not invoked.
