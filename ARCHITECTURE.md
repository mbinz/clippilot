# ClipPilot — Architecture

One-pager. Source of truth for code structure and the small set of decisions that shape it. Update when a decision changes.

## Shape

```
bin/clippilot.ts           # entry — defers to src/cli
src/
  cli/
    index.ts               # Commander setup, registers commands
    commands/              # 12 subcommands (ingest, analyze, search,
                           #   contact-sheet, get-clip, similar, mark-best,
                           #   tag, export, stats, config, ui)
    json.ts                # shared clip-projection for --json output
    formatters/            # human-facing pretty print
  core/
    ingest/                # scanner, probe (ffprobe), proxy (ffmpeg),
                           #   thumbnail, hasher
    analyze/               # gemini-client + schema (Zod) + prompts
    search/                # engine (FTS) + advanced (filtered search for web)
    similarity/            # union-find clustering
    export/                # otio (primary), fcpxml, csv, json, edl; timeline-plan (shared frame/TC math), fcpxml-rates
    contact-sheet.ts       # labeled grid PNG via sharp
    server/                # Hono routes backing the web UI
    config/                # manager + defaults
  db/
    connection.ts          # better-sqlite3 handle
    index.ts               # public DB surface
    migrations/            # 001..006 + runner
    repositories/          # clip, project, similarity, story, thumbnail
  types/, utils/, constants.ts
tests/{unit,integration,fixtures}
web/                       # React 19 + Tailwind + Vite — primary UI (kept; storyboard view lands here in M4)
```

## Data flow

1. **Ingest** — `scanner` walks a folder → `probe` (ffprobe) reads metadata → `hasher` content-hashes → `proxy` renders 720p MP4 → `thumbnail` extracts stills. All rows land in SQLite via `clip.repository`. Originals never mutated.
2. **Analyze** — `gemini-client` sends each clip's thumbnails + metadata to Gemini 2.5 Flash with a Zod-typed `schema` → structured fields (scene, quality, editorial, keywords) stored on the clip row.
3. **Query** — `search/engine.ts` runs FTS over analysis output; `similarity/` clusters via union-find over location/time/keywords/scene.
4. **Export** — `export/{csv,json,edl,fcpxml}` writes a DaVinci-importable file from a clip-ID list. `fcpxml-rates` handles frame-rate quirks for Resolve.
5. **Chat surface** — Claude calls CLI commands with `--json`, reads thumbnails/contact-sheets as images, decides which clips to mark or export.

### Target flow (2026-11-18 re-plan — see PRD "Workflow")

```
ingest (resumable) → analyze proxy video → highlights (timestamped moments)
  → brief (per cut) → storyboard: Cut → Scene → Panel {filled | candidates | gap}
  → gap fillers (library → local render → plugins) → ingest as normal clips
  → export one timeline per cut (+ scene markers) → free Resolve
```

- **Highlights** are the unit the storyboard reasons about (clip_id + start/end + description + quality), not whole clips. New table in M2.
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

- SQLite via `better-sqlite3`, single file per project (path resolved by `config/manager`).
- One repository per entity. No ORM.
- Migrations are forward-only TS files (`001_initial.ts` … `006_has_audio_video.ts`) run by `migrations/runner.ts` at startup.

## Key decisions

1. **CLI-as-skill over MCP for the AI; web UI for the human.** Claude drafts via CLI `--json`; the UI reviews and steers. No AI inside the UI for now.
2. **SQLite as single source of truth; originals immutable.** All derived assets (proxies, thumbnails, sheets) live under a project-scoped cache dir.
3. **Structured Gemini output (Zod) over free-text.** Makes the analysis queryable; rejects model drift at parse time.
4. **ffmpeg/ffprobe shelled out.** No native AV bindings beyond `better-sqlite3` and `sharp`. Keeps install simple; matches Resolve's own toolchain.
5. **Vendor-neutral handoff — OTIO primary, FCPXML secondary** (decided 2026-11-18 by the M1 import test in free Resolve). Both import with every clip online, correct lengths, speeds and frames; only OTIO keeps scene markers (Resolve drops clip `<marker>`s from FCPXML). OTIO carries Resolve-specific `Resolve_OTIO` metadata (link groups, audio channels) — ignored by other OTIO consumers. One timeline per cut with scene markers. Resolve Studio scripting not needed. Both exporters share frame/TC math in `export/timeline-plan.ts`; tests compare against Resolve-written golden files in `tests/fixtures/resolve-golden/`.
6. **No build step.** Run via `tsx`. Type-checking is the compile gate.
7. **Paid / vendor-specific sources are plugins.** Stock and AI-video gap fillers sit behind a plugin seam (M6); the core stays free and offline-capable except for Gemini analysis.

## Testing

- `vitest`, layout `tests/{unit,integration,fixtures}`.
- Unit covers pure modules (search engine, similarity union-find, exporters, schema, hasher, probe, scanner, JSON projection, contact-sheet layout, migration runner).
- Integration covers ingest end-to-end against fixture media.
- Module-by-module coverage map lives in `STATUS.md`. Network-touching code (`gemini-client`) is deliberately untested.

## What's external
- Gemini API (`@google/genai`) — analysis.
- `ffmpeg`/`ffprobe` on PATH — proxies + metadata.
- DaVinci Resolve — consumer of export files; not invoked.
