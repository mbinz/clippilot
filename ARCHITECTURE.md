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
    export/                # csv, json, edl, fcpxml (+ fcpxml-rates)
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

### Known export defects (input to M1)

Found 2026-11-18 reading `fcpxml.ts` against the Portugal project (25/50/100 fps, Sony TC + GoPro):
- every asset references the single timeline `<format>` (`r0`) → clips at other rates get interpreted on the wrong frame grid
- `<format>` has no `width`/`height`
- mixed fps throws instead of conforming; no retime (`timeMap`) support
- timecode hardcoded NDF; TC base computed via float seconds × fps
- VFR phone footage: `nb_frames` vs `duration` disagree → asset extent off
- source paths contain trailing-space folders (`Src /`) — URI encoding unverified in Resolve
- never verified against a real Resolve import

## Persistence

- SQLite via `better-sqlite3`, single file per project (path resolved by `config/manager`).
- One repository per entity. No ORM.
- Migrations are forward-only TS files (`001_initial.ts` … `006_has_audio_video.ts`) run by `migrations/runner.ts` at startup.

## Key decisions

1. **CLI-as-skill over MCP for the AI; web UI for the human.** Claude drafts via CLI `--json`; the UI reviews and steers. No AI inside the UI for now.
2. **SQLite as single source of truth; originals immutable.** All derived assets (proxies, thumbnails, sheets) live under a project-scoped cache dir.
3. **Structured Gemini output (Zod) over free-text.** Makes the analysis queryable; rejects model drift at parse time.
4. **ffmpeg/ffprobe shelled out.** No native AV bindings beyond `better-sqlite3` and `sharp`. Keeps install simple; matches Resolve's own toolchain.
5. **Vendor-neutral handoff — open formats are the boundary.** Must work with free Resolve. FCPXML vs OTIO decided by the M1 spike; one timeline per cut with scene markers. Resolve Studio scripting is an open question, never a requirement.
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
