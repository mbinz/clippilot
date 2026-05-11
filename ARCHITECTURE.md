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
    formatters/            # human-facing pretty print (Phase-B deletion)
  core/
    ingest/                # scanner, probe (ffprobe), proxy (ffmpeg),
                           #   thumbnail, hasher
    analyze/               # gemini-client + schema (Zod) + prompts
    search/                # engine (FTS) + advanced (Phase-B deletion)
    similarity/            # union-find clustering
    export/                # csv, json, edl, fcpxml (+ fcpxml-rates)
    contact-sheet.ts       # labeled grid PNG via sharp
    server/                # Hono routes (Phase-C deletion)
    config/                # manager + defaults
  db/
    connection.ts          # better-sqlite3 handle
    index.ts               # public DB surface
    migrations/            # 001..006 + runner
    repositories/          # clip, project, similarity, story, thumbnail
  types/, utils/, constants.ts
tests/{unit,integration,fixtures}
web/                       # legacy Vite frontend (Phase-C deletion)
```

## Data flow

1. **Ingest** — `scanner` walks a folder → `probe` (ffprobe) reads metadata → `hasher` content-hashes → `proxy` renders 720p MP4 → `thumbnail` extracts stills. All rows land in SQLite via `clip.repository`. Originals never mutated.
2. **Analyze** — `gemini-client` sends each clip's thumbnails + metadata to Gemini 2.5 Flash with a Zod-typed `schema` → structured fields (scene, quality, editorial, keywords) stored on the clip row.
3. **Query** — `search/engine.ts` runs FTS over analysis output; `similarity/` clusters via union-find over location/time/keywords/scene.
4. **Export** — `export/{csv,json,edl,fcpxml}` writes a DaVinci-importable file from a clip-ID list. `fcpxml-rates` handles frame-rate quirks for Resolve.
5. **Chat surface** — Claude calls CLI commands with `--json`, reads thumbnails/contact-sheets as images, decides which clips to mark or export.

## Persistence

- SQLite via `better-sqlite3`, single file per project (path resolved by `config/manager`).
- One repository per entity. No ORM.
- Migrations are forward-only TS files (`001_initial.ts` … `006_has_audio_video.ts`) run by `migrations/runner.ts` at startup.

## Key decisions

1. **CLI-as-skill over MCP.** One surface for human + AI. Reconsidered only if v0.2 decision gate fails (see PRD).
2. **SQLite as single source of truth; originals immutable.** All derived assets (proxies, thumbnails, sheets) live under a project-scoped cache dir.
3. **Structured Gemini output (Zod) over free-text.** Makes the analysis queryable; rejects model drift at parse time.
4. **ffmpeg/ffprobe shelled out.** No native AV bindings beyond `better-sqlite3` and `sharp`. Keeps install simple; matches Resolve's own toolchain.
5. **DaVinci as the finishing tool — export formats are the boundary.** No Resolve API coupling; FCPXML/EDL is the contract.
6. **No build step.** Run via `tsx`. Type-checking is the compile gate.

## Testing

- `vitest`, layout `tests/{unit,integration,fixtures}`.
- Unit covers pure modules (search engine, similarity union-find, exporters, schema, hasher, probe, scanner, JSON projection, contact-sheet layout, migration runner).
- Integration covers ingest end-to-end against fixture media.
- Module-by-module coverage map lives in `STATUS.md`. Network-touching code (`gemini-client`) is deliberately untested.

## What's external
- Gemini API (`@google/genai`) — analysis.
- `ffmpeg`/`ffprobe` on PATH — proxies + metadata.
- DaVinci Resolve — consumer of export files; not invoked.
