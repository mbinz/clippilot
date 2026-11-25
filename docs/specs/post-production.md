# Post-production (resolve-prep) — plan + Resolve capability test

> Moved verbatim from STATUS.md (and PRD.md) on 2026-11-25. Old names ("roadmap item 2b", "M3", "below") refer to
> the former layout; the current todo list is in [STATUS.md](../STATUS.md).

### Post-production plan (decided 2026-11-23, end of session)

Workflow map (user + planner): ingest/backup → sorting ✅ → brief + storyboard + rough cut ✅ → music → sound design →
stabilization → color correction → grading → titles/animations (maps) → **fine cut (manual)** → final mix + loudness →
subtitles → feedback round → delivery (platform renders, YouTube text/chapters, thumbnail) → short versions → archive.
- **Where it lives:** ClipPilot stops at the rough-cut export. Everything after = Claude skills/tools in a separate folder
  (planned `~/dev/clippilot-post`, to be created with the first tool), consuming the export + originals. Memory:
  scope-clippilot-vs-post-tools.
- **Stays manual:** fine cut, timing (incl. cutting on beats, transition/animation timing), the mix, grading taste, the
  final music choice. Beat markers: not wanted.
- **Batch work** (stabilization, color) is the main pain: tools decide per clip (full-frame-rate analysis, not 1 fps
  snapshots; "shake" 👎 = unusable footage, a different signal from "needs light stabilization"), mark clips via OTIO clip
  colors + markers with notes, user applies in Resolve in one go (multi-select Stabilize ✅ tested; color: Shot Match /
  Auto Color per camera group + a reference-clip marker; look = one LUT/grade). Computer use (Claude driving Resolve's UI)
  is an option for repetitive applies; Resolve Studio scripting only if both prove too fragile.
- **Music:** creative choice; later Claude + external sources (own discussion, licences). First step: place a chosen file
  on its own track, lower original sound (FCPXML volume) except audio_keep moments.

**Titles (first post-tool) — decided:** opening title + one chapter title per scene, rendered by Claude as transparent
ProRes 4444 clips (4K/25, ~3 s default), placed on V2 at scene starts via OTIO; user retimes/speeds in Resolve, asks Claude
to re-render when timing is off. **Style "D teal & yellow"**: Anton (Google Font) on solid blocks sized to the measured
text width, slight −3° tilt, teal `#0E8F9A` block with white text + yellow `#FFD23F` tag with ink `#111418` text, soft
shadow; opening "PORTUGAL" + "ARRIFANA · MAY 2025", chapter "DOLPHIN" / "TRIP" + "DAY 3 · 27 MAY". Animation plan: blocks
slide in staggered (~0.15 s), hold, slide out. Previews + renderers: `~/Video/ClipPilot Arrifana/exports/resolve-test/`
(`title-styles/D-teal-yellow-*.jpg`, `render-styles-blocks.mjs`, `render-title.mjs`). Google Fonts Anton, Bebas Neue,
Archivo Black, Pacifico, Permanent Marker installed in the user's `~/Library/Fonts` (renderer = sharp/librsvg via CoreText
needs them registered). Rejected: clean/editorial/journal (too restrained), red blocks.

**Done 2026-11-24 (see clippilot-post status.md):** titles, music/sound split, stabilization + camera marking, `post build` (CLI since renamed to `resolve-prep build`).
Was open: create `~/dev/clippilot-post` + titles skill (render all chapter titles of the Arrifana cut with the
animation, extended OTIO with V2), test import in Resolve; then music/sound placement; then stabilization + camera marking;
then Q3 small fixes + full Portugal (Q4). ★ came out at 16 % on the Arrifana re-run (target ~10 %) — check on Portugal.

### Resolve capability test for post-production (2026-11-23, free Resolve, user import)

Direction (user, 2026-11-23): ClipPilot stays sorting + storyboard + rough-cut export; post-production automation
(titles, sound/music, stabilization, color) lives in separate Claude skills/tools that work on the export + originals.
Resolve stays the finishing tool (fine cut, timing, mix, grade = manual). Package: `~/Video/ClipPilot Arrifana/exports/
resolve-test/` (generators `build_resolve_tests.py`, `render-title.mjs`).

| Feature | OTIO | FCPXML |
|---|---|---|
| Transparent title clip (ProRes 4444, yuva444p, 4K/25) on V2 / lane 1; movable, speed-changeable | yes | yes |
| Music file on its own audio track / lane -1 | yes | yes |
| Cross dissolve (OTIO `Transition` SMPTE_Dissolve / FCPXML `transition`) | yes | yes |
| Markers with color + note (`Resolve_OTIO.Note`) | yes | no (M1) |
| Clip color (`Resolve_OTIO."Clip Color"`) | yes | – |
| Clip volume `adjust-volume amount="-12dB"` | – | yes |
| Volume keyframes (2 s fade-in) | – | yes |
| `adjust-stabilization` | – | **ignored** |
| CDL from EDL | **no** — free Resolve has no apply-CDL menu; importing the EDL creates a timeline | – |
| Stabilize several selected clips at once (Inspector) | yes (in Resolve) | |

- FCPXML must use rational times ("400/25s"): decimals ("16.00s") make Resolve import an **empty** timeline.
- Consequences: stabilization = tool measures jitter (full frame rate) → orange clip color + marker note → user selects
  all and clicks Stabilize once. Color = clip color per camera + reference-clip marker → Resolve "Shot Match"/Auto Color
  per group; the look is one LUT/grade. Audio levels/fades need FCPXML; markers/clip colors need OTIO.
