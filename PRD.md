# ClipPilot — PRD

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
7. **Fill gaps** (M5) — reshape the story around what exists, or find a filler for that gap: own library → locally generated (title cards, route map, photo pan/zoom) → stock (plugin) → AI video (plugin).
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
| **M7** ✅ | Board v3 | Moment = edit; panel drawer (choose) vs moment drawer (review); ★ first + similar side by side; alternatives; seen; ★ editable; Show in Finder — mockup `scene-board-v3.html` |
| **M8** ✅ | Assistant link | Claude Code knows the board selection (`clippilot board context --json`); the board refreshes itself after any edit (CLI / Claude) |
| **M5** | Gap fillers (free) | Per-gap library search; local title cards, route map, photo pan/zoom — ingested as clips |
| **M6** | Plugins (optional) | Stock and AI-video gap fillers behind a plugin seam |

**v0.2 = M0–M4 ✅ 2026-11-23.** Acceptance met: `03 Arrifana` went ingest → events → brief → storyboard → export,
imported cleanly into free Resolve, and the author prefers it over an empty timeline.
**v0.3 = M7 + M8 ✅ 2026-11-23** (board v3 + assistant link). Done when: on the real Arrifana cut the author can review a scene's
★ moments, compare and swap shots, trim/speed moments, and ask Claude Code about "this panel" — and leaves with
"I didn't see everything, but these are the right choices".

## Roadmap (prioritized 2026-11-23, updated end of day)

**Scope decision (2026-11-23):** ClipPilot = sorting + storyboard drafting + rough-cut export. Post-production
automation (titles/animations, music + sound, stabilization, color) lives in **separate Claude skills/tools** next to
ClipPilot (`~/dev/clippilot-post`, CLI/skill `resolve-prep`, v0.1 built 2026-11-24), working on the OTIO/FCPXML export + originals. Resolve (free) stays the
finishing tool; fine cut, timing, mix and grade taste stay manual. Full workflow map + who-does-what: STATUS.md
"Post-production plan".

1. **v0.3 — Board v3 + assistant link** (M7, M8) ✅.
2. **Analysis polish** ✅ (prompt v3: 2–8 s moments, ★ ~10 %, strict audio; Q1/Q1b; Arrifana re-run). Small fixes (Q3)
   and **full Portugal** (Q4) follow after the first post-tools.
2a. ✅ 2026-11-24 **Post-tools (Claude skills, outside ClipPilot):** titles first (style chosen), then music + sound track placement,
   stabilization + camera marking. Based on the Resolve capability test (STATUS.md).
2b. **Draft quality (decided 2026-11-24, grilling Q1–Q23):** before full Portugal.
   1. **Transcript** — local whisper.cpp (`large-v3-turbo`, word timestamps), all clips with audio; spoken text per moment
      in `moments list`, cut-off sentences flagged; AI moments snap to sentence boundaries; **no length cap for speech
      moments**; drawer shows it, search finds spoken words.
   2. **Motion measurement** — per moment, local: shake (locked < 0.02 / stabilize / shaky ≥ 0.4 % of width, project
      config) + stillness; `cut.json` carries the band; resolve-prep reads it instead of measuring.
      2026-11-24: ✅ per-moment shake/stillness (S1). Next: **per-clip motion curve + single Wackler (jolts)** — marked
      only, AI-moment boundaries moved out of a Wackler, drafter decides keep / cut out, B-roll cover = suggestion +
      Resolve marker (no second track yet). Light-jitter ("locked") calibration deferred.
   3. **Draft rules + board** — shaky moments stay out of drafts unless must-have/★ without a calmer alternative in the
      similar group (named in the draft summary); subtle tile icon, details in the drawer, no auto-reject. Continuous
      action moments may run to ~20 s, silent/static ones keep the 8 s cap.
   4. **Cut critic** (own agent + skill) — measurements, transcript, stills every 0.5 s + last frame; rule of thumb:
      static ~2–3 s, speech/clear action much longer; proposes concrete trims, calmer alternatives, cut-off sentences.
   5. **Story critic** (own agent + skill) — 480p preview of the cut from proxies (original sound: keep loud, bed low,
      no music) watched by Gemini 2.5 Pro with the brief; cost shown before each run.
   6. **Loop** — findings as validated JSON (must / should / nit) in `.clippilot/reviews/`; Claude applies must+should,
      max 3 rounds; result on the board (undoable history) + short change list in chat.
   7. **Acceptance** — ~10 seeded faults in a copy of the Arrifana cut + the user's 2 real cases (+ notes later); ≥ 8/10
      found, few false alarms.
3. **Mac app + ingest/analyze from the UI** — Electron shell around the server + web UI, project picker, CLI keeps
   working on the same DB; no terminal for a new trip. CI comes with packaging.
4. **Assistant in the app** — chat panel in the board (Claude via the Agent SDK with the user's login, acting through
   the CLI verbs, one undo step per action, suggestion chips by context). Replaces hard-wired "AI action" buttons
   (decided 2026-11-23: assistant route, not fixed buttons).
5. **M5 gap fillers**, then **M6 plugins**.
6. **Phone review** (moved back 2026-11-23) — Mac as server via Tailscale + access key; review-first (preview, swap,
   👎, ★, reorder); cloud sync only if "Mac must be awake" proves to be the blocker.
7. Wishlist (below), as it becomes relevant.

## Out of scope for v0.2 / v0.3

- Music awareness (track selection, length fitting, beat sync)
- Voice-over and VO-script drafting
- Speed ramps (only constant speed per moment)
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
