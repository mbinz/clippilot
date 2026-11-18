# ClipPilot — PRD

> Re-planned 2026-11-18 after a grilling session. Supersedes the 2026-06-14 "selects + assembly → per-scene FCPXML" plan.
> Key learnings that triggered it: the Resolve handoff was unreliable (timelines failed to load, clips showed as missing), and the first real test (Portugal) only ever ingested 33 of 508 clips — the actual workflow (story → gaps → rough cut) was never there.

## Goal (north star)

**Take a trip's raw footage to a first rough cut you'd rather start from than an empty timeline** — through an iterative loop:

```
understand footage → write a brief → draft a storyboard → reshape around what exists
   → fill the gaps → rough cut → timeline in your editor (DaVinci Resolve first)
```

Claude is the collaborator at every step (drafts, proposes candidates, finds fillers). The web UI is where the user sees and steers. The editor (Resolve) does fine cut, music, color, and finishing.

## Users

- **Now:** the author — travel footage from phone, action cams (GoPro), and a Sony A7C II; mixed 25/50/100 fps; edits in free DaVinci Resolve.
- **Target persona (later, for open source / productizing):** travel & vlog creators shooting mixed cameras, editing in Resolve / Final Cut / Premiere.
- **Typical output:** a 10–20 min montage of scenes, set to music; voice-over sometimes recorded afterwards. No talking-head / A-roll. Single video layer.

## Principles

- **Vendor-neutral and free to run.** The core must work with free Resolve and open formats (FCPXML / OTIO). Paid or vendor-specific integrations (Resolve Studio scripting, stock, AI video) are optional plugins, never required. Gemini stays the analysis model for now (no provider abstraction yet).
- **Local-first.** Originals never mutated; all derived assets live in `<project>/.clippilot/`.
- **One path into the timeline.** Everything that lands on a timeline — own clips, stock, generated cards, AI video — is a real file that goes through normal ingest. Exporters never special-case a source.
- **Claude drafts, the UI steers.** Story reasoning happens in chat via the CLI (`--json`); results persist as normal DB rows; the UI shows and edits them. No AI built into the UI for now.

## Workflow (the product)

1. **Ingest** — point at the trip folder. Resumable / incremental (a 123 GB trip must survive interruptions). Folder structure (`01 Flug`, `02 Cacela Velha`, …) is captured as a scene hint.
2. **Understand** — Gemini analyzes the 720p proxy **video** (not just stills) and returns per-clip metadata **plus timestamped highlights** ("dolphin jumps, 01:12–01:16, quality 8/10"). Highlights — not whole clips — are the unit the storyboard works with. A project-level summary answers "what's in here".
3. **Brief** — the user states intent per cut: target length, mood, must-have moments, ending ("15 min, relaxed, surf + Lisbon city life, end on Lisbon sunset"). Stored on the cut; drives drafting and defines what counts as a gap.
4. **Storyboard draft** — Claude drafts scenes (seeded from folders, then renamed/split/merged/reordered) and panels. Each panel has an intent and is in one of three states:
   - **filled** — a clip with in/out and speed
   - **candidates** — 2–5 highlight options to choose from
   - **gap** — intent only, nothing suitable found yet
5. **Reshape & fill** — two moves on gaps: (a) reshape the story around what exists, (b) find a filler for *that specific gap*, searching sources in order:
   1. own library (unused clips in this project, then other projects)
   2. locally generated: title/chapter cards, animated route map, photos with pan/zoom (ffmpeg, free, offline)
   3. stock (Pexels/Pixabay) — plugin
   4. AI-generated video (Kling, Veo, …) — plugin
6. **Rough cut export** — one timeline per cut with scene markers, into free Resolve, every clip online, correct speed.

## Data model — Project → Cut → Scene → Panel

```
Project (the trip — "Portugal")
  └─ Cut            ← an edit; has a brief (length, mood, must-haves)
       └─ Scene      ← ordered, named; seeded from source folders, then edited
            └─ Panel (segment)  ← ordered; intent + state (filled | candidates | gap)
                                   filled: clip_id, in/out (start_sec/end_sec), speed (default 100%)
```

- Scenes live inside a cut (no cross-cut sharing).
- Same clip may appear multiple times. "Only part slowed down" = same clip placed twice: one segment at 100 %, the next at e.g. 25 %.
- Speed is per panel, user-decided; Claude may *suggest* slow-mo for 50/100 fps action shots.
- Single video layer. No effects, transitions, audio mixing. Music is added in the editor.
- Schema keeps `stories` (= Cut) / `story_segments` (= Panel) names to avoid churn; product vocabulary is Cut / Scene / Panel.

## Export / handoff

- **One timeline per cut, scene markers** — replaces the old one-file-per-scene plan (that was a workaround for Resolve importing only the last `<project>` of a multi-timeline FCPXML; a single timeline per file avoids it).
- **Format chosen by spike (M1):** FCPXML vs OTIO, both tested against free Resolve with a 3-camera fixture. Winner is primary; the other may stay as secondary. EDL to be dropped unless the spike shows a reason to keep it. CSV/JSON stay as data exports.
- **Must handle:** per-asset formats with resolution; mixed 25/50/100 fps on one timeline; per-segment speed (retime); embedded timecode (Sony) vs none (phone); VFR phone footage; paths with spaces / trailing spaces (Portugal has `Src /`).
- **Open question:** Resolve Studio scripting API as an optional "pro" adapter — revisit only if open formats can't be made reliable.

## Surfaces

- **CLI (AI + scripting):** existing verbs (`ingest`, `analyze`, `search`, `get-clip`, `similar`, `mark-best`, `tag`, `contact-sheet`, `export`, `stats`, `config`, `ui`) plus cut/brief/scene/panel verbs (M3). All read commands emit `--json`.
- **Web UI (React + Vite, kept):** browse/search (exists) + **storyboard view** — scenes as rows, panels as cards, candidate picker, in/out + speed, gap list, export button.

## Milestones

| | Milestone | Done when |
|---|---|---|
| **M0** | Docs reset | PRD / ARCHITECTURE / STATUS reflect this plan |
| **M1** | Export that works | 3-camera fixture (25/50/100 fps, TC + no TC, VFR phone, path with spaces, one retimed segment) imports into free Resolve with every clip online, right offsets and speed; FCPXML-vs-OTIO decided; checklist + automated structural tests |
| **M2** | Understand the footage | Resumable full ingest of Portugal; proxy-video analysis with timestamped highlights (piloted on `Arrifana/Delfine` for quality + cost first); project summary command |
| **M3** | Storyboard model + CLI | Migration for scenes, brief, panel state/intent/speed, candidates; CLI verbs; Claude can draft a storyboard for Portugal in chat from a brief |
| **M4** | Storyboard UI | Review, pick candidate, trim, set speed, reorder, see gaps, export from UI |
| **M5** | Gap fillers (free) | Per-gap library search; locally rendered title cards, route map, photo pan/zoom — ingested as clips |
| **M6** | Plugins (optional) | Stock and AI-video gap fillers behind a plugin seam |

**v0.2 = M0–M4.** Acceptance: the full Portugal trip goes ingest → brief → storyboard → export, imports cleanly into free Resolve, and the author would rather start from it than from an empty timeline.
**v0.3:** M5–M6, then open-source release (README, packaging, docs for others).

## Out of scope for v0.2

- Music awareness of any kind (track selection, length fitting, beat sync)
- Voice-over and VO-script drafting
- Speed ramps (only constant per-segment speed)
- Talking-head / A-roll + B-roll layering; multi-track timelines
- Effects, transitions, audio mixing
- AI model provider abstraction
- Packaging / distribution, CI, MCP server surface
- Resolve Studio scripting (open question)

## Future / wishlist

- **Music-aware cutting** — pick a track per cut, plan scene lengths to fit, beat-synced cut points
- **Speed ramps** within a segment
- **VO script** drafted from the storyboard, one line per scene
- Multi-NLE polish (Final Cut, Premiere, Kdenlive via OTIO)
- Short social cuts derived from the main cut
- Open-source release & productization
