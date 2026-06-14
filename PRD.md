# ClipPilot — PRD

## Problem
Reviewing personal video footage (hundreds to low-thousands of clips per project) is slow: scrubbing, naming takes, finding the best version of a moment, and getting a starting timeline into DaVinci Resolve are all manual. Existing one-stop-shop apps either bury the workflow or don't talk to Resolve.

## Users
Solo creators editing their own footage in DaVinci Resolve. Comfortable with a terminal. Already use Claude Code or Claude Desktop and want to "chat with the material" instead of clicking through bins.

## Product vision
ClipPilot is **a data pipeline + web UI + CLI skill**. The web UI is the primary interactive surface for browsing, marking, and building sequences. The CLI is the scripting and AI-agent surface (Claude drives it). DaVinci Resolve is the visual finishing tool — ClipPilot hands off clean per-scene timelines, then gets out of the way.

### Where ClipPilot sits in the editorial pipeline
The professional editing pipeline is **selects → assembly → rough cut → fine cut**. The assembly stage is "lay out usable footage organized by scene, build sequences in order, goal = flow." **ClipPilot owns selects + assembly.** It produces the organized per-scene starting timelines. Resolve owns rough cut, fine cut, and final assembly. We are not trying to be the final editor — we hand off a clean *starting point*.

## Surfaces

### Web UI (primary interactive surface)
- Browse clips: grid, search, filters, facets
- Clip detail: proxy playback, thumbnails, AI metadata, editable tags/location/people
- Similarity clusters: pick the best take from near-duplicates
- Sequence builder: organize clips into scenes, set in/out cut points, export per-scene timelines to Resolve

### CLI (pipeline + AI skill surface)
All read commands emit `--json`. Write commands print confirmation JSON.

| Command | Kind | Output |
|---|---|---|
| `clippilot ingest [path]` | write | progress + summary JSON |
| `clippilot analyze [--limit N]` | write | progress + summary JSON |
| `clippilot search <query> [--filter k=v] [--limit N]` | read | JSON: clip metadata + thumbnail paths |
| `clippilot get-clip <id>` | read | JSON: full metadata + thumbnail + proxy paths |
| `clippilot similar <id>` | read | JSON: cluster members + thumbnail paths |
| `clippilot mark-best <id>` | write | confirmation JSON |
| `clippilot tag <id> <tag>...` | write | confirmation JSON |
| `clippilot export --cut <id> --format <fmt> -o <dir>` | write | one file per scene; prints paths *(planned; today the flag is `--story`, single-file)* |
| `clippilot export --clips <ids> --format <fmt> -o <path>` | write | ad-hoc clip-list → single flat timeline (quick export) |
| `clippilot contact-sheet [--filter k=v] [-n 24] -o <path>` | read | writes composite PNG |
| `clippilot stats` | read | JSON |
| `clippilot config` | read/write | JSON |

Sequence reasoning ("propose an order for these clips") is **not** a CLI command. Claude does it in chat using `get-clip` results; the resulting cuts/scenes/segments are persisted in the DB.

## Data model — Project → Cut → Scene → Segment

```
Project (the trip — e.g. "Italy 2025")
  └─ Cut          ← multiple per project: a 3-min cut, a 15-min cut (an "edit")
       └─ Scene    ← ordered, named: Rome, Cooking class, Beach day
            └─ Segment  ← ordered: clip_id + in/out (start_sec/end_sec)
```

Decisions (settled 2026-06-14):
- **Scenes are first-class, deliberate edit constructs** — named and reorderable, not auto-derived from source folders. This matches the editorial "assembly by scene" stage.
- **Scenes live inside a cut.** No cross-cut sharing — if two cuts both want Rome, it's built in each. Simple schema, no surprise side-effects.
- **A segment** = one clip reference with in/out points. The same clip may appear multiple times (in one scene or across scenes) at different cut points.
- **No effects, transitions, or audio mixing** — segment placement only.

Schema mapping: the existing `stories` table = a **Cut**. A new `scenes` table (id, story_id, name, position) sits between; `story_segments` gains a `scene_id` and orders within its scene. (Schema keeps the `stories`/`story_segments` names to avoid churn; product vocabulary is Cut/Scene/Segment.)

## Export to DaVinci Resolve — per-scene timelines

**One timeline file per scene** (e.g. `01_Rome.fcpxml`, `02_Cooking.fcpxml`), numeric-prefixed by scene order so they sort correctly in Resolve's media pool. The user imports them, then assembles a master timeline in Resolve by dragging the scene-timelines together (Resolve nests them automatically) or using stacked timelines.

Rationale / hard constraint: **Resolve only imports the *last* timeline from a multi-timeline FCPXML** — a single file with N `<project>` elements silently drops all but one. So one-file-per-scene is the only robust handoff. ClipPilot records scene order but does **not** emit the master file; final assembly is Resolve's job (its native scene workflow is bin-per-scene → timeline-per-scene → assemble).

No single flat "everything" timeline export for a cut — its scenes are never concatenated into one file. (The separate `--clips` quick export is unrelated: it takes an ad-hoc clip list, not a cut, and writes one flat timeline.)

## In scope

### Pipeline
- Local ingest: recursive scan, ffprobe metadata, 720p proxies, thumbnails, content-hash dedupe → SQLite
- Structured analysis via Gemini 2.5 Flash (scene, quality, editorial, keywords) — Zod-validated

### Browse & annotate (UI)
- Grid + search + filters + facets + pagination
- Clip detail panel: proxy playback, thumbnail strip, AI metadata
- Editable metadata: tags, location, people
- Mark-best within similarity cluster

### Sequence builder (UI + data layer)
- Create/rename/delete cuts within a project
- Create/rename/reorder scenes within a cut
- Add clips to a scene; reorder segments via drag-and-drop
- Per-segment in/out cut points (start_sec / end_sec)
- Same clip can appear multiple times at different cut points
- No effects, transitions, or audio mixing — segment placement only
- Export a cut → one FCPXML/EDL file per scene

### Export hardening (top priority)
- Per-scene export: one timeline file per scene, ordered numeric prefix
- Mixed source frame rates: conform to chosen timeline fps instead of rejecting
- Drop-frame timecode support (in addition to NDF)
- End-to-end verified against real DaVinci Resolve import (import scene files → assemble master)
- Export available from UI (not just CLI)

### DaVinci handoff formats
- FCPXML (primary), EDL, CSV, JSON

## Out of scope (v1)
- Story-AI / AI-generated sequence ordering (Claude reasons over `get-clip` in chat; no AI-specific tables — its proposals persist as normal cuts/scenes/segments)
- MCP server surface
- Effects, transitions, audio mixing in the sequence builder
- Packaging / distribution (run via `tsx`, no compiled binary)
- CI (tests run locally only)

## Roadmap (priority order)

1. **Scene schema** — migration adding a `scenes` table + `story_segments.scene_id`; update `StoryRepository` to the Cut→Scene→Segment shape
2. **Per-scene export hardening** — export a cut as one file per scene; mixed-fps conforming; drop-frame TC; verified against a real Resolve import + master assembly
3. **Cut/scene server routes** — CRUD for cuts, scenes, and segments
4. **Sequence builder UI** — manage cuts/scenes, drag clips into scenes, set in/out per segment, per-scene export download
5. **Mark-best in UI** — button in ClipDetail calling existing `/similarity/groups/:id/best` route
6. **Cut/scene CLI commands** — create cut, add scene, add-clip with in/out, export (lower priority if UI covers it)

## Keep (architectural commitments)
- `src/core/ingest/*` — proxies, thumbnails, ffprobe, scanner, hasher
- `src/core/analyze/*` — Gemini structured analysis
- `src/core/similarity/*` — clustering
- `src/core/export/*` — csv, json, edl, fcpxml
- `src/db/*` — schema, repos, migration runner
- `src/core/search/` — `engine.ts` (FTS) and `advanced.ts` (filtered search used by the web server's clips route)
- `web/` — primary UI surface (kept; Phase C deletion plan cancelled)
- `src/core/server/` — Hono backend serving the UI

## What this buys
- One source of truth: browse, annotate, sequence, and export from the same UI, driven by the same SQLite data the CLI uses.
- AI chat (Claude) drives the CLI for discovery and bulk operations; the UI handles the visual and interactive parts.
- Scene-structured output matches both the editorial assembly stage and Resolve's native bin/timeline-per-scene workflow.
- DaVinci Resolve gets clean per-scene FCPXMLs that open correctly without manual relinking, ready to assemble into a master.
