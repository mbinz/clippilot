# ClipPilot — PRD

> 2026-11-25 (later): roadmap reorganised into named **themes** (no more M-numbers / "item 2b"); **similar moments**
> by look planned. Todo list in STATUS.md, specs in `docs/specs/`, history in `docs/history.md`.
>
> 2026-11-25: **learning from human choices** planned (roadmap 2c) after three grilling rounds: all agent instructions
> move to `instructions/`, the user's final cut vs the AI's cut drives approved instruction changes and project proposals.
>
> 2026-11-23: v0.2 accepted (Arrifana rough cut preferred over an empty timeline, export clean). v0.3 planned after a
> grilling round + three mockup rounds (`mockups/scene-board-v3.html`): **the moment is the edit**, two drawers
> (panel = choose, moment = review), similar moments + alternatives, "seen". Prioritized roadmap below.
>
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
- **Human changes are protected.** No tool (draft, critics, normalisers, resolve-prep) changes what the user touched: moments trimmed / sped / confirmed / ★'d / rejected, panels the user placed, scenes the user made or changed. Tools may *point at* them; the user decides. (2026-11-24)
- **Reviewers don't edit.** Critics and resolve-prep only report or mark; only Claude (the drafter) changes the cut, and only what isn't protected. (2026-11-24)
- **The system learns from the user, through approved instruction changes.** After a project the user can start a
  learning step: Claude compares the AI's cut with the final cut and proposes changes to agent instructions (any step:
  analyze, brief, draft, critics, review loop) and to the project (missing tools, step order, coded rules). The user
  approves each one; nothing learns on its own. (2026-11-25)
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
   - **issues** `blur | obstructed | overexposed | underexposed` (shake/jitter are measured in code, not asked — J1)
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
   - **filled** — points at a moment (the moment carries in/out and speed — see Data model)
   - **candidates** — 2–5 moments to choose from
   - **gap** — intent only, nothing suitable found yet
6. **Scene board (web UI)** — the user opens an already-filled board and steers. Sorting happens here, as a side effect.
   Goal: *"I didn't look at everything, but I have a good feeling these are the right choices."* (v3, 2026-11-23)
   - **Moment pool** per scene: all ★ first; below, **similar moments side by side** (same event + same kind of shot =
     role + framing), groups ordered by time, a small gap between groups, no labels; nothing collapsed except
     rejected / hidden behind a link. **Seen** moments (hovered ≥ 2 s or opened) fade into the background in place
     (faded, black-and-white); moments in the story never fade. In-story marks are bold: thick solid green ✓ = yours,
     thick dashed violet = AI's pick, with the panel number.
   - **Panel drawer — "choose the shot for this slot"** (amber = your edit): the panel's place in the story
     (neighbours), its intent, the shot playing, **one decision** ("Use this in panel N" instead of the current one),
     options = the shot in the story first, then similar moments; clicking an option only previews it.
   - **Moment drawer — "review this clip"** (neutral): the whole clip, all its moments (click to select), ★ on/off,
     👎 with reason, hide clip, Show in Finder; similar moments collapsed; one link into the story ("In panel N",
     "Compare in panel N" when a similar shot is used, or "Add to scene").
   - **Playback:** the moment loops; click the bar outside it and the whole clip plays on; click back inside to loop.
   - **The moment is the edit:** in/out and speed (100 / 50 / 25 % within the clip's fps) are set on the moment, in
     either drawer; every panel using it plays it like that. Touching a moment confirms it.
   - **Placing** a moment = confirmed. **👎** rejects a moment. **Hide clip** hides a whole clip. Untouched moments stay
     "proposed". AI picks and human picks are visually distinct; both are exportable any time. Undo for every edit.
   - Edit: scenes add / rename / delete / reorder; panels add / delete / reorder / intent.
   - **Preview** a scene or the whole cut in the browser (panels played in order, at their moment's speed).
7. **Fill gaps** (theme "Gap fillers + plugins") — reshape the story around what exists, or find a filler for that gap: own library → locally generated (title cards, route map, photo pan/zoom) → stock (plugin) → AI video (plugin).
8. **Export** — "Export to Resolve" button: one OTIO timeline per cut with scene markers (FCPXML secondary), into free Resolve, every clip online, correct speed.

## Data model

```
Project (the trip — "Portugal")
  ├─ Event          ← what was shot; from deepest folder or recording-time grouping; renamable / mergeable / splittable
  │    └─ Clip → Moment (tier, shot, role, issues, slow-mo, audio, duplicate group; status proposed | confirmed | rejected;
  │                      in/out + speed = the edit (v0.3); ★ override by the user; seen)
  └─ Cut            ← one edit; has a brief (Claude-proposed, user-adjusted)
       └─ Scene      ← story unit; ordered, named; starts from an event
            └─ Panel  ← one shot slot; ordered; intent + state (filled | candidates | gap); source ai | user
                         filled: points at a moment — no own in/out or speed (v0.3)
```

- Event = footage side (objective, shared by all cuts). Scene = story side (per cut).
- **The moment is the edit** (2026-11-23): a moment is a micro edit (in/out + speed); a panel only points at it, so
  changing a moment changes every panel that uses it. Two different pieces of one clip = two moments.
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

## Roadmap

Themes in order (2026-11-25). The todo list with slice codes and spec links is in [STATUS.md](STATUS.md#todo); the
former milestone table (M0–M8) and numbered roadmap are kept in [docs/history.md](docs/history.md).

**Scope:** ClipPilot = sorting + storyboard drafting + rough-cut export. Post-production (titles, music + sound,
stabilization, color) lives in separate Claude skills/tools (`~/dev/clippilot-post`, `resolve-prep`). Resolve (free)
stays the finishing tool; fine cut, timing, mix and grade taste stay manual.

**Done:** Export to free Resolve (OTIO primary) · Understand the footage · Events · Storyboard model + CLI · Scene board
(v0.2 ✅ 2026-11-23) · Board v3 + assistant link (v0.3 ✅ 2026-11-23) · Analysis polish · Post-production tools v0.1 ·
Draft quality (transcript, jitter + shakes, draft rules, cut + story critic, review loop).

**Now**
1. **Similar moments** — similar = same setup / retake, measured from the frames (local look fingerprint), nearest
   first; replaces the role/shot label match.

**Next**
2. **Board fixes** — cut picker, `ingest` runs `analyze`, critic findings on the board.
3. **Learning from edits** — all agent instructions in `instructions/`; the edit history records AI vs user; the user's
   final cut vs the AI's cut drives approved instruction changes and project proposals. Part 1 (L0, L1) before full
   Portugal, part 2 (L2, L3) after the Odeceixe run.
4. **Odeceixe end to end** — first from-scratch project through brief → draft → review loop → learning.
5. **Full Portugal** — the acceptance project (508 videos).

**Later**
6. **Mac app** — Electron shell around the server + web UI, project picker, ingest/analyze from the UI; CI with packaging.
7. **Assistant in the board** — chat panel (Claude via the Agent SDK with the user's login, acting through the CLI
   verbs, one undo step per action). Replaces hard-wired "AI action" buttons.
8. **Gap fillers + plugins** — per-gap library search, local title cards / route map / photo pan; stock and AI-video
   behind a plugin seam.
9. **Phone review** — Mac as server via Tailscale + access key; review-first.


## Out of scope for v0.2 / v0.3

- Music awareness (track selection, length fitting, beat sync)
- Voice-over and VO-script drafting
- Speed ramps (only constant speed per moment)
- Talking-head / A-roll layering; multi-track timelines
- Effects, transitions, audio mixing
- Touching originals (delete / move / rename)
- Bins / keywords / selects export
- Automatically learned taste profiles (learning only through user-approved instruction changes, "Learning from edits")
- AI model provider abstraction; packaging, CI, MCP surface; Resolve scripting

## Future / wishlist

- Music-aware cutting; speed ramps; VO script from the storyboard
- Multi-NLE polish (Final Cut, Premiere, Kdenlive via OTIO)
- Short social cuts derived from the main cut
- Standalone "sort & tag footage" mode (the moment pool without the story)
- Open-source release & productization
