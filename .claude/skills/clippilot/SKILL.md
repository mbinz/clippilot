---
name: clippilot
description: Use when the user wants to ingest, analyze, or chat with their video footage — point at a folder of clips, find clips by query, scan a project visually, mark best takes, build a sequence, or export to DaVinci Resolve. Triggers on mentions of clips, footage, B-roll, takes, scenes, ingesting/importing video, story building, FCPXML/EDL/CSV export, or any reference to a clippilot-ingested folder.
---

# ClipPilot — chat with the footage

ClipPilot stores ingested video clips in a local SQLite database with
Gemini-generated structured analysis (scenes, summary, visual keywords, per-moment
tier/shot/role/issues tags, locations, people). All commands operate on the database
in the current working directory (`.clippilot/`). The skill exposes that
data to you so the user can converse with their material instead of
clicking through a UI.

**You are the UI.** Pick the right command, parse the JSON, and either
answer in prose or surface thumbnails by reading them as images.

## Cold-start flow (always check this first)

Run `clippilot stats --json` before anything else. The output tells you
where the user is in the pipeline:

1. **`projects: []`** → DB is empty. Ask the user where their footage is, then
   run `clippilot ingest <absolute-path> [--project <name>]`. **Confirm the
   path with them before running** — ingest creates `.clippilot/` and copies
   720p proxies (slow, GB-scale on large folders). Don't run on a folder of
   unknown size without confirmation. Ingest auto-runs `analyze` afterwards
   unless the user passes `--skip-analysis`.
2. **`projects` non-empty, `pending > 0`** → some clips need analysis. Before
   running `clippilot analyze`, check `clippilot config show` — if
   `gemini_api_key` is `(not set)`, the user must set it first via
   `clippilot config set gemini_api_key <key>` or the `GEMINI_API_KEY` env
   var. Get a key at https://aistudio.google.com/apikey.
3. **`projects` non-empty, `pending: 0`, `analyzed > 0`** → ready for
   conversational use. Proceed to the verbs below.
4. **`error > 0`** → some clips failed analysis. They're skipped from search
   results. The user can re-run `clippilot analyze --force` to retry.

When ingest or analyze is running, expect minutes-scale duration. Keep the
user informed; both commands stream progress.

## Verbs

All read commands support `--json`. Write commands emit JSON confirmation
on success. Always pass `--json` so output is parseable.

| Verb | Use when |
|---|---|
| `clippilot stats --json` | **Always run first.** See "Cold-start flow" above. |
| `clippilot ingest <path> [--project <name>] [--location <l>] [--no-proxy] [--skip-analysis]` | Import a folder of video files. Confirm the path with the user first. |
| `clippilot analyze [--project <name>] [--force] [--retry-errors]` | Run Gemini analysis on pending clips. Requires a Gemini key. `--retry-errors` re-queues clips that previously failed. |
| `clippilot config show` / `clippilot config set gemini_api_key <key>` | Inspect or set the Gemini API key. |
| `clippilot search "<query>" --json [--min-tier hero|solid|filler] [--limit N]` | User asks "find me clips about X". FTS over scenes, summary, keywords, location, people. `--min-tier` keeps clips with at least one moment at or above that tier. |
| `clippilot get-clip <id>` | User asks about one specific clip in detail (you already have its ID). |
| `clippilot summary [--project <name>] [--top N] --json` | Overview of a project: scene hints, places, moments, best highlights. Run after analyze, before storyboarding. |
| `clippilot events list [--project <name>] --json` | Events: clips grouped by folder (deepest folder) or by recording time (gap > 45 min). See "Events" below. |
| `clippilot cut show --json` / `cut brief` / `cut apply --file f.json` / `moments list --json` | The storyboard: brief, draft, read back. See "Storyboard" below. |
| `clippilot similar <id>` | User asks "what other takes of this exist" or "any duplicates of clip N". |
| `clippilot mark-best <id> [--group <gid>]` | User picks the best take among similar clips. Defaults to all groups containing the clip. |
| `clippilot tag <id> [-l <location>] [-t a,b,c] [--people n,m] --json` | User adds metadata. |
| `clippilot contact-sheet [--query <q>] [--project <name>] [--ids 1,2,3] [--cols 4 --rows 6] [-o /tmp/sheet.png]` | User wants to *see* a batch of clips. Render the PNG, then `Read` it. |
| `clippilot export --cut [id] --format otio --output <abs path> --json` | Export the storyboard (no id: cut "Main"; `--story` is an alias). Filled panels export their moment's clip/in/out/speed, candidate panels their first candidate's, gaps are skipped; JSON reports `exported` and `skipped_gaps`. |
| `clippilot export --clips 1,5,12 --format otio --output ./final.otio --json` | User is ready to take a selection to DaVinci. **`otio` is primary** (keeps markers, linked audio); `fcpxml` secondary; also csv, json, edl. |
| `clippilot review-highlights [--clips 1,2,3] [-o <path>]` | Writes a local HTML review page (video + highlights with tier/shot/role/issues + verdict toggles + Export). Open it with `open <path>`. |
| `clippilot review import <review-verdicts.json> [--project <name>]` | Stores the user's exported verdicts as a calibration round; prints metrics. |
| `clippilot calibrate sample [--n 8] [--seed N] [--project <name>]` / `calibrate status --json` | Pick fresh, hard clips for the next calibration round / list rounds with metrics. |

All other behavior — search, contact-sheet, get-clip, similar, mark-best,
tag, export — is conversational and you should use it freely.

## Events

An **event** groups clips that were shot together: one per deepest source folder, or, for flat folders and loose
files, a run of recordings less than 45 minutes apart (named like `Tue 27 May, 08:34`). Every clip has an `event_id`
and `summary --json` lists `events: [{id, name, clips, duration_sec, highlights}]` in time order.

- `clippilot events list --json` returns `[{id, name, source, folder_path, clip_count, start, end}]`.
- `clippilot events rename <id> "<name>"`, `events merge <targetId> <otherId...>`, `events split <id> --at-clip <clipId>` (that clip and all later ones move to a new event) print the resulting event(s) as JSON.
- `clippilot events rebuild [--project <name>] [--reset]` assigns events to clips that have none (ingest does this automatically); `--reset` throws away existing events and edits first.
- Events are the user's naming. **Propose renames, merges and splits in chat; don't apply them without the user's go-ahead.**

## Storyboard

A project's film is a **Cut** made of **Scenes** (usually one per event) made of **Panels** (one shot each). A panel is
`filled` (points at one moment), `candidates` (2-5 moments, the user picks) or `gap` (nothing fits yet).
**The moment is the edit:** in/out and speed live on the moment (`start_sec`, `end_sec`, `speed`), not on the panel, so
every panel using a moment plays it the same way. A panel plays its whole moment; trim to shorten it.
Commands without a cut id work on the project's cut "Main" (created on first use).

Workflow:
1. `clippilot moments list --json [--event <id>] [--min-tier solid]` for compact drafting rows (hidden clips and rejected
   moments are left out).
2. **Brief first.** Write `{target_sec, audience, mood, must_have:[{moment_id?, text}], ending, notes?}` to a file and run
   `clippilot cut brief --set-file brief.json` (state `proposed`). Show it to the user and **wait for their ok**; only then
   `clippilot cut brief --confirm`. Do not draft before the brief is confirmed.
3. Draft JSON `{scenes:[{name, event_id?, notes?, panels:[{intent, moment_id? | candidates?: [2-5 ids], start_sec?, end_sec?, speed?}]}]}`
   and run `clippilot cut apply --file draft.json` (add `--append` to add scenes instead of replacing). All ids are
   validated at once; fix every reported error and re-run. Replace keeps panels the user placed.
4. `clippilot cut show --json` to read the result back; summarise it for the user (totals, gaps).
5. Hand off: `clippilot export --cut <id> --format otio --output <abs path>` (see the verbs table).

Edit verbs: `scene add|rename|move|delete|set-event`, `panel add|move|delete|intent|place|pick`,
`moment reject|unreject <id>`, `moment trim <id> <in> <out>`, `moment speed <id> <1|0.5|0.25>` (needs enough source fps),
`moment star|unstar <id>`, `moment reset <id>` (back to the analysis range and default speed), `clip hide|unhide <id>`.
`panel place` and `panel pick` confirm the moment; so do `moment trim` and `moment speed` (and every panel using the
moment becomes the user's). There is no `panel trim` / `panel speed` any more: edit the moment. In a draft,
`start_sec` / `end_sec` / `speed` on a panel are written to its moment (without confirming it).

Rules when drafting:
- At most one member of a `dup_group` per cut.
- Prefer `hero` and `solid` moments; use `filler` only to bridge.
- Respect `audio_keep`: do not slow down or replace a moment whose audio matters.
- Use `candidates` when two or three moments fit equally; leave a `gap` rather than forcing a poor shot.
- Moments the user marked `confirmed` or placed themselves are decisions: do not move them without asking.

## How to "chat with material"

For most conversational requests:

1. **Search.** `clippilot search "<query>" --json --limit 12`. The result
   includes `clips[].thumbnails` (paths). For each clip you intend to discuss,
   `Read` the first thumbnail so the user sees what you're talking about.
2. **Visual batch.** When the user wants to scan many clips ("show me
   everything from the morning"), prefer `contact-sheet` over reading 24
   thumbnails individually. One `Read` of the resulting PNG, plus the JSON
   mapping of grid position → clip_id.
3. **Drill in.** When the user picks a clip ("tell me more about #42"), use
   `get-clip 42` for the full record. `similar 42` if duplicates matter.
4. **Curate.** `mark-best`, `tag` to record decisions in the DB. These
   persist; the user gets credit on the next session.
5. **Hand off.** When the user is done picking, build the export:
   `clippilot export --clips <ids> --format fcpxml --output <path> --json`
   then tell them the path. DaVinci Resolve is where the visual edit
   actually happens.

## Reviewing moments

`clippilot review-highlights --clips <ids> -o <abs path>` renders a review page for the given clips (thumbs up/down
per moment, missed moments); open it for the user. `clippilot review import <export path>` stores the exported
verdicts as history only. There is no taste profile.

## JSON shape (read once, then trust)

`search`, `get-clip`, `similar` all return clip objects via the same
projection. Notable fields after the `ai_` prefix is dropped from
JSON-encoded text columns:

- `id`, `file_path`, `proxy_path`, `thumbnails: string[]`
- `duration_sec`, `resolution`, `fps`, `recorded_at`, `location`
- `manual_tags: string[]`, `people: string[]`
- `ai_scenes: object[]`, `ai_summary`, `ai_visual_keywords: string[]`
- `scene_hint: string | null` (source-folder grouping)
- There are no clip-level scores (no overall/quality/editorial numbers, no suggested use): they did not discriminate.
  Judge a clip by its moments instead.
- `get-clip` and `search --json` carry `highlights` per clip (the moments):
  `[{id, start_sec, end_sec, description, tier, shot, role, issues, slowmo, slowmo_reason, suggested_speed, audio_keep, audio_type}]`
  - `tier`: `hero` (would open or anchor a scene) | `solid` (good usable shot) | `filler` (only to fill a gap)
  - `shot`: `wide` | `medium` | `close` | `detail`
  - `role`: `establishing` | `action` | `reaction` | `detail` | `transition`
  - `issues`: array of `shake` | `blur` | `obstructed` | `overexposed` | `underexposed` (empty when clean)
  - `slowmo` / `suggested_speed`: whether slow motion suits the moment and the playback speed derived from fps

`analysis_status` of `done` means
the AI fields and moments are populated; `pending`/`error` means they aren't yet.

## Constraints

- **Always pass `--json`** on read commands. The non-JSON path is for humans.
- **Use absolute paths** for `--output` so you can `Read` the file.
- **`contact-sheet` defaults to 4×6 = 24 cells.** Bump with `--cols`/`--rows`
  for bigger projects. The grid is fixed-size, smaller result sets just
  leave empty cells.
- **Originals are never touched.** Exports reference original file paths.
  Proxies and thumbnails live under `.clippilot/`.
- **Sequences live in the Storyboard** (see above): build them with `cut apply`, not by ad-hoc `export --clips` lists.
  `export --clips <id,id,...>` still exports whole clips in the order given.

## Notes on slow / side-effecty commands

- **`ingest`** copies original files into 720p proxies under `.clippilot/`.
  GB-scale on large folders. Always confirm the input path with the user.
  Originals are read-only — never modified.
- **`analyze`** sends each proxy to Gemini. Costs API credits and takes
  minutes for medium projects (100–1000 clips). Resumes idempotently —
  re-running only picks up `pending` clips unless `--force` is passed.
- Before `analyze`, `pending` clips have empty `ai_*` fields, so search
  results will be sparse and `--min-tier` filters won't match anything.
