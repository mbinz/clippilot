---
name: clippilot
description: Use when the user wants to ingest, analyze, or chat with their video footage — point at a folder of clips, find clips by query, scan a project visually, mark best takes, build a sequence, or export to DaVinci Resolve. Triggers on mentions of clips, footage, B-roll, takes, scenes, ingesting/importing video, story building, FCPXML/EDL/CSV export, or any reference to a clippilot-ingested folder.
---

# ClipPilot — chat with the footage

ClipPilot stores ingested video clips in a local SQLite database with
Gemini-generated structured analysis (scenes, quality, editorial scores,
visual keywords, locations, people). All commands operate on the database
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
| `clippilot search "<query>" --json [--min-quality N] [--limit N]` | User asks "find me clips about X". FTS over scenes, summary, keywords, location, people. |
| `clippilot get-clip <id>` | User asks about one specific clip in detail (you already have its ID). |
| `clippilot summary [--project <name>] [--top N] --json` | Overview of a project: scene hints, places, moments, best highlights. Run after analyze, before storyboarding. |
| `clippilot similar <id>` | User asks "what other takes of this exist" or "any duplicates of clip N". |
| `clippilot mark-best <id> [--group <gid>]` | User picks the best take among similar clips. Defaults to all groups containing the clip. |
| `clippilot tag <id> [-l <location>] [-t a,b,c] [--people n,m] --json` | User adds metadata. |
| `clippilot contact-sheet [--query <q>] [--project <name>] [--ids 1,2,3] [--cols 4 --rows 6] [-o /tmp/sheet.png]` | User wants to *see* a batch of clips. Render the PNG, then `Read` it. |
| `clippilot export --clips 1,5,12 --format otio --output ./final.otio --json` | User is ready to take a selection to DaVinci. **`otio` is primary** (keeps markers, linked audio); `fcpxml` secondary; also csv, json, edl. |
| `clippilot review-highlights [--clips 1,2,3] [-o <path>]` | Writes a local HTML review page (video + highlights + score/verdict toggles + Export). Open it with `open <path>`. |
| `clippilot review import <review-verdicts.json> [--project <name>]` | Stores the user's exported verdicts as a calibration round; prints metrics. |
| `clippilot calibrate sample [--n 8] [--seed N] [--project <name>]` / `calibrate status --json` | Pick fresh, hard clips for the next calibration round / list rounds with metrics. |

All other behavior — search, contact-sheet, get-clip, similar, mark-best,
tag, export — is conversational and you should use it freely.

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

## Taste calibration (before analyzing a whole project)

Highlight selection is tuned to the user via a **taste profile**: short explicit rules in
`~/.clippilot/taste-profile.v<N>.md` (highest N wins; `CLIPPILOT_HOME` overrides the dir), appended to
the Gemini prompt. It is per user and carries across projects. Run a few rounds when the user starts a
new project or says highlights don't match their taste:

1. **Sample.** `clippilot calibrate sample --n 8` (prints JSON) → `clip_ids` (fresh, never-reviewed, biased to
   hard clips: people, low stability, long, no highlights). Tell the user which clips and why (`reasons`).
2. **Analyze with the current profile.** Confirm cost (~US$0.01/clip), then
   `clippilot analyze --clips <ids> --force`.
3. **Review.** `clippilot review-highlights --clips <ids> -o <abs path>` and `open` it. The user marks
   verdicts, score toggles, missed moments, notes, then clicks **Export verdicts**.
4. **Import.** `clippilot review import <export path>` (prints JSON) → `metrics` (precision, flags, missed per
   clip, score verdicts, `stop_rule_met`).
5. **Learn — propose, don't apply.** Read the metrics and every note / missed-moment note (and
   `get-clip` the flagged clips). Propose a **diff** to the newest profile: add, sharpen or remove
   rules. Rules must be concrete and checkable ("people: prefer genuine laughter or reactions with eyes
   visible; avoid mid-sentence talking"), and the profile stays short (≈ 15 rules max — merge, don't
   pile up). **Only taste goes into the profile.** Route these elsewhere instead of writing rules:
   camera shake (Gemini samples ~1 fps and can't see it → pipeline fix, STATUS M2.7) and sub-second
   timing precision (trim in the storyboard).
6. **On approval** write the next version `taste-profile.v<N+1>.md` (never edit an old version), and
   tell the user the new version number.
7. **Repeat** from step 1 on fresh clips. Stop when `stop_rule_met` (precision ≥ 0.8 and ≤ 0.3 missed
   moments per reviewed clip) or after 3 rounds; then offer the full `analyze` of the project.
   `clippilot calibrate status --json` shows the trend across rounds — show it to the user.

## JSON shape (read once, then trust)

`search`, `get-clip`, `similar` all return clip objects via the same
projection. Notable fields after the `ai_` prefix is dropped from
JSON-encoded text columns:

- `id`, `file_path`, `proxy_path`, `thumbnails: string[]`
- `duration_sec`, `resolution`, `fps`, `recorded_at`, `location`
- `manual_tags: string[]`, `people: string[]`
- `ai_scenes: object[]`, `ai_summary`, `ai_visual_keywords: string[]`
- `ai_quality_overall` plus per-axis (`stability`, `focus`, `exposure`, `composition`, `audio`)
- `ai_editorial_emotional`, `ai_editorial_storytelling`, `ai_editorial_uniqueness`, `ai_editorial_suggested_use`
- `ai_quality_issues: string[]`
- `scene_hint: string | null` (source-folder grouping); `get-clip` and `search --json` also carry `highlights: [{start_sec, end_sec, description, quality}]` per clip

Quality and editorial scores are 1–5. `analysis_status` of `done` means
the AI fields are populated; `pending`/`error` means they aren't yet.

## Constraints

- **Always pass `--json`** on read commands. The non-JSON path is for humans.
- **Use absolute paths** for `--output` so you can `Read` the file.
- **`contact-sheet` defaults to 4×6 = 24 cells.** Bump with `--cols`/`--rows`
  for bigger projects. The grid is fixed-size, smaller result sets just
  leave empty cells.
- **Originals are never touched.** Exports reference original file paths.
  Proxies and thumbnails live under `.clippilot/`.
- **No story builder yet (M3).** "Propose a sequence" means *you* reason about
  ordering using `get-clip` data, then call `export --clips <id,id,...>`
  in your chosen order. Persistent cuts/scenes/panels arrive with M3.

## Notes on slow / side-effecty commands

- **`ingest`** copies original files into 720p proxies under `.clippilot/`.
  GB-scale on large folders. Always confirm the input path with the user.
  Originals are read-only — never modified.
- **`analyze`** sends each proxy to Gemini. Costs API credits and takes
  minutes for medium projects (100–1000 clips). Resumes idempotently —
  re-running only picks up `pending` clips unless `--force` is passed.
- Before `analyze`, `pending` clips have empty `ai_*` fields, so search
  results will be sparse and `--min-quality` filters won't match anything.
