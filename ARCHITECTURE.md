# ClipPilot — Architecture

One-pager. Source of truth for code structure and the small set of decisions that shape it. Update when a decision changes.

## Shape

```
bin/clippilot.ts           # entry — defers to src/cli
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
    migrations/            # 001..012 + runner
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

- **Events** = footage side (objective, shared by cuts); **Scenes** = story side (per cut). Events table + `clips.event_id` (M2.8).
- **Moment status** `proposed | confirmed | rejected`; **panel source** `ai | user` (M3). Clips get a `hidden` flag. Originals never touched.

- **Highlights (moments)** are the unit the storyboard reasons about (clip_id + start/end + description + tags), not whole clips. `highlights` table since M2 (migration 008). Timestamps are ~1 s precise (Gemini samples ~1 fps) — a starting point to trim, not frame-accurate.
- **Panels** = `story_segments` gaining `scene_id`, `intent`, `state`, `speed`; candidates are a child table of panel → highlight. M3.
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
8. **Categorical tags, not absolute scores** (2026-11-19/21). Gemini's 1–5 clip scores and 1–10 moment scores were flat (2.8–3.8; 33 of 36 at 7–8) → dropped incl. DB columns. Moments carry tier/shot/role/issues/slow-mo/audio; measurable things (shake, fps, duration) are computed in code.
9. **No learned taste profile** (2026-11-21). Profile rules learned from ~29 rated moments in one folder overfit; preference lives in the per-cut brief and in the user's choices on the board.
10. **Undo/redo lives on the server** (2026-11-22). Every storyboard mutation — from the board, the CLI or Claude — runs
   through `StoryboardService.command(cutId, label, fn)`, which stores a before/after snapshot of the cut (scenes, panels,
   candidates, brief) and of the project's moment statuses / hidden clips in `operations`. Undo/redo restore snapshots
   with original row ids, so the UI selection survives and a whole Claude draft is one undo step. Snapshots are small
   (a cut is ≲ 100 panels); per-op inverses aren't worth the bug surface. Moment reject / clip hide are project-wide but
   are logged on the cut they were done from.
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
