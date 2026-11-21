# ClipPilot — PRD

> Re-planned 2026-11-21 after a second grilling session (events + scene board). Builds on the 2026-11-18 re-plan
> (storyboard workflow, Resolve export fixed in M1).
> Key learnings that triggered it: absolute AI scores (clip and moment) don't discriminate; a learned "taste profile"
> overfit to one folder; a separate "review every moment" pass recreates the time problem. Market research
> (`docs/research/footage-logging-landscape.md`) found no tool that logs B-roll *moments* with tags and hands off to
> free Resolve — so we build it, inside the storyboard workflow, not as a separate sort step.

## Goal (north star)

**Take a trip's raw footage to a first rough cut you'd rather start from than an empty timeline** — through an iterative loop:

```
ingest → analyze (moments + tags) → events → brief → Claude drafts the storyboard
   → steer on the scene board → preview in the browser → export → DaVinci Resolve
```

The main pain is **time**: nobody watches hundreds of clips. ClipPilot finds the moments, groups the footage, drafts
the story, and lets the user review *only what the story needs*. The editor (Resolve) does fine cut, music, color,
finishing.

## Users

- **Now:** the author — travel footage from phone, action cams (GoPro), and a Sony A7C II; mixed 25/50/100 fps; edits in free DaVinci Resolve.
- **Later:** travel & vlog creators shooting mixed cameras; possibly professionals down the road (they have other solutions, so it would have to be very good). Personal tool first; open source / product decided later.
- **Typical output:** a 10–20 min montage of scenes, set to music; voice-over sometimes recorded afterwards. No talking-head / A-roll. Single video layer.

## Principles

- **Vendor-neutral and free to run.** Works with free Resolve via file import (OTIO / FCPXML) — no Resolve scripting (moved to Studio in Resolve 21.1). Paid or vendor-specific integrations are optional plugins. Gemini stays the analysis model (no provider abstraction yet).
- **Local-first; originals are never touched.** No moving, renaming or deleting source files — "hide" / "reject" are DB flags only. All derived assets live in `<project>/.clippilot/`.
- **AI proposes, human confirms — and confirmation is optional.** Everything the AI proposes is usable as-is; human choices are marked as such. As AI gets better, approval can drop away without a redesign.
- **Categorical tags over absolute scores.** The model is asked for checkable categories (tier, shot, role, issues), not 1–5 numbers. What can be measured (shake, frame rate, duration) is computed in code, not asked of the model.
- **One path into the timeline.** Everything on a timeline — own clips, generated cards, stock, AI video — is a real file that goes through normal ingest.
- **v1: Claude drafts in chat, the UI shows and steers.** Long-term the UI becomes the main workspace and starts AI actions itself (roadmap, below).

## Workflow (the product)

1. **Ingest** — point at the trip folder. Resumable / incremental (a 123 GB trip must survive interruptions). Runs from terminal / chat.
2. **Analyze** — Gemini analyzes the 720p proxy **video** and returns per-clip summary/scenes/keywords plus **moments**
   (timestamped highlights), each tagged:
   - **tier** `hero | solid | filler`
   - **shot** `wide | medium | close | detail`
   - **role** `establishing | action | reaction | detail | transition`
   - **issues** `shake | blur | obstructed | overexposed | underexposed` (shake also measured in code)
   - **slow-mo** suggestion (`none | light | strong` + reason) → suggested speed gated by source fps in code
   - **audio worth keeping** yes/no + type `ambient | speech | music | noise`
   - **duplicate group** — the same moment in another clip / take
   Moments are ≥ ~3 s (enforced in code). No clip-level scores. Runs from terminal / chat.
3. **Events** — group the footage by *what was shot*:
   - Folders present → the **deepest folder is an event**; parent folders are kept only as context for Claude.
   - Flat files / loose files → grouped by recording time (new event after a gap of ~45 min), provisional names; loose files next to folders join the nearest event by time (no flag).
   - Claude renames / merges / splits events in chat; the user can do the same in the UI. Optional, ~5 min per trip; nothing waits for it.
4. **Brief** — per cut: target length, mood, must-have moments, ending. **Claude proposes a brief** from the events and their best moments; the user adjusts it in a UI form or in chat. Drives the draft and defines what counts as a gap.
5. **Storyboard draft** — Claude drafts scenes and panels in chat from the brief. Each scene starts from one event but may use moments from any event. Each **panel** (one shot slot) has an intent and is:
   - **filled** — a moment with in/out and speed
   - **candidates** — 2–5 moments to choose from
   - **gap** — intent only, nothing suitable found yet
6. **Scene board (web UI)** — the user opens an already-filled board and steers. Sorting happens here, as a side effect:
   - **Moment pool** per scene: grouped by role, hero first, filler collapsed, duplicates stacked, rejected / hidden behind a "hidden: n" link.
   - **Placing** a moment (drag onto a panel, or picking a candidate) = confirmed. **👎** rejects a moment (optional reason). **Hide clip** hides a whole clip. Untouched moments stay "proposed".
   - **AI picks and human picks are visually distinct**; both are usable and exportable any time.
   - Edit: scenes add / rename / delete / reorder; panels add / delete / reorder; trim in/out; speed 100 / 50 / 25 % (within the clip's fps).
   - **Preview** a scene or the whole cut in the browser (panels played in order, at their speed).
7. **Fill gaps** (M5) — reshape the story around what exists, or find a filler for that gap: own library → locally generated (title cards, route map, photo pan/zoom) → stock (plugin) → AI video (plugin).
8. **Export** — "Export to Resolve" button: one OTIO timeline per cut with scene markers (FCPXML secondary), into free Resolve, every clip online, correct speed.

## Data model

```
Project (the trip — "Portugal")
  ├─ Event          ← what was shot; from deepest folder or recording-time grouping; renamable / mergeable / splittable
  │    └─ Clip → Moment (tier, shot, role, issues, slow-mo, audio, duplicate group; status proposed | confirmed | rejected)
  └─ Cut            ← one edit; has a brief (Claude-proposed, user-adjusted)
       └─ Scene      ← story unit; ordered, named; starts from an event
            └─ Panel  ← one shot slot; ordered; intent + state (filled | candidates | gap); source ai | user
                         filled: moment/clip, in/out (start_sec/end_sec), speed (default 100 %)
```

- Event = footage side (objective, shared by all cuts). Scene = story side (per cut).
- Same clip may appear in several panels ("only part slowed down" = same clip twice: 100 % then 50 %).
- Clips can be hidden (flag); originals untouched.
- Model allows several cuts per project; the UI shows one cut for now.
- Schema keeps `stories` (= Cut) / `story_segments` (= Panel) names; product vocabulary is Event / Cut / Scene / Panel / Moment.

## Export / handoff

- One timeline per cut, scene markers. **OTIO primary** (keeps markers, linked audio), FCPXML secondary — both verified in free Resolve (M1).
- Handles per-asset formats, mixed 25/50/100 fps, per-panel speed, embedded TC (Sony, incl. >50 fps frame-field quirk) vs none, VFR, paths with spaces.
- No bins / keyword / "selects" export for now — the handoff is the rough cut.

## Surfaces

- **CLI (AI + scripting):** ingest, analyze, events, brief, cut/scene/panel verbs, search, summary, export… All read commands emit JSON. Claude drafts through these in chat.
- **Web UI (React + Vite):** events view, brief form, **scene board**, browser preview, export button. Browse/search stays.

## Milestones

| | Milestone | Done when |
|---|---|---|
| **M0** ✅ | Docs reset | — |
| **M1** ✅ | Export that works | Verified in free Resolve; OTIO primary |
| **M2** ✅ | Understand the footage | Resumable ingest, proxy-video analysis with moments, summary (piloted on Delfine) |
| **M2.6** ✅ | Review page + moment tags | Moment tags/tier/slow-mo, clip scores dropped; taste-profile learning tried and dropped |
| **M2.7** | Analysis groundwork | Files API upload, prompt cleanup, ≥ 3 s moments, shake metric, audio tag, duplicate groups, taste-profile code removed |
| **M2.8** | Events | Folders → events, flat files → time grouping, CLI rename/merge/split, simple events view in UI; `03 Arrifana` (104 clips) ingested + analyzed |
| **M3** | Storyboard model + CLI | Events/brief/scene/panel schema (panel source ai/user, moment status); Claude proposes a brief and drafts the Arrifana cut in chat |
| **M4** | Scene board UI | Mockup first; pool + board + placing/👎/hide, trim, speed, preview, export button |
| **M5** | Gap fillers (free) | Per-gap library search; local title cards, route map, photo pan/zoom — ingested as clips |
| **M6** | Plugins (optional) | Stock and AI-video gap fillers behind a plugin seam |

**v0.2 = M0–M4.** Acceptance: `03 Arrifana` goes ingest → events → brief → storyboard → export, imports cleanly into
free Resolve, and the author would rather start from it than from an empty timeline. Full Portugal follows once that holds.
**v0.3:** M5–M6.

## Roadmap (after v0.2)

- **AI actions from the UI** — UI becomes the main workspace: buttons tied to context ("Draft cut", "Redraft scene", "Alternatives for this panel", "Find filler for gap") with a text hint; local server runs Claude via the Agent SDK with the user's login, acting through the same CLI verbs; background progress, one undo per action. Later maybe a chat panel.
- Ingest / analyze from the UI (with cost shown first).
- Full Portugal; library across trips.

## Out of scope for v0.2

- Music awareness (track selection, length fitting, beat sync)
- Voice-over and VO-script drafting
- Speed ramps (only constant per-panel speed)
- Talking-head / A-roll layering; multi-track timelines
- Effects, transitions, audio mixing
- Touching originals (delete / move / rename)
- Bins / keywords / selects export
- Learned taste profiles
- AI model provider abstraction; packaging, CI, MCP surface; Resolve scripting

## Future / wishlist

- Music-aware cutting; speed ramps; VO script from the storyboard
- Multi-NLE polish (Final Cut, Premiere, Kdenlive via OTIO)
- Short social cuts derived from the main cut
- Standalone "sort & tag footage" mode (the moment pool without the story)
- Open-source release & productization
