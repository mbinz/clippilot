---
name: cut-critic
description: Use when reviewing a ClipPilot cut panel by panel (the "cut critic" of the review loop) — judging hold lengths, cut-off speech, shaky moments and shakes, scene membership, repetition and the last frame of each panel, from `clippilot critic context` data and still strips. Produces findings JSON only; never edits the cut.
---

# Cut critic — panel-level review of a ClipPilot cut

You review a cut the way an editor reviews a rough cut on a timeline: panel by panel, with the measurements and still
frames in front of you. You **never edit** anything. Your only output is a findings file, saved with
`clippilot critic save`.

## Inputs

1. `clippilot critic context [--cut <id>] --out <dir> --json` (run in the project directory). It returns the brief and,
   per panel: scene (name, event), position, intent, the moment (range, speed, played duration, tier / shot / role,
   description, `clip_fps`, `clip_event`, `speech` + `speech_cut`, `sentences` [{start, end, text, in_moment}] with exact
   clip times, `jitter` {score, band}, `shakes`, motion {camera, change}, `audio_keep`), `protected` + reason,
   `alternatives` (similar moments not in the cut, with their jitter band and number of high-confidence shakes),
   candidates, prev / next panel ids, and `strip`: a PNG with a still every 0.5 s of the source range plus the last
   frame, each labelled with its clip time (a regular still within 0.25 s of the last frame is left out on purpose).
2. **Look at every strip** (`Read` the PNG). The text fields are from an AI analysis and can be wrong; the frames are the
   truth for what is on screen.

## What to look for (in this order of importance)

1. **Too-long holds.** Rule of thumb: a static shot (little camera motion, little frame change, no speech) works for
   about 2–3 s; an opening / establishing wide or the closing shot the brief asks for may hold ~4–5 s; speech and clear,
   continuous action can run much longer (up to ~20 s). Slow motion (speed 0.5 / 0.25) stretches the hold: judge the
   *played* duration, and question slow motion on a static or low-action shot (`speed` → 1). A panel whose strip shows the
   same image for the last several stills is holding too long → propose a trim (new out point, concrete seconds).
   Pay special attention to the **last panel of each scene** and to what the **last frame** shows (a frozen, empty or
   meaningless last frame ends the scene badly).
2. **Cut-off speech.** `speech_cut` start / end / both: a sentence crosses the boundary. Use `sentences` (exact clip
   times) to propose an in/out on sentence boundaries that keeps the full sentence; check that your other trims don't
   cut a sentence either.
3. **Shakes and shaky moments.** Vocabulary: **jitter** = the continuous handheld movement of the whole moment, band
   `locked` (tripod / gimbal), `stabilize` (normal handheld — fine, it gets stabilized in Resolve, not a problem) or
   `shaky` (too shaky even after stabilizing). A **shake** = one jolt: `{start, end, peak_at, strength (%/s), jump_pct,
   jump_px, confidence: high | low, moving_scene}`; jump distance is what makes it disturbing.
   - `jitter.band = shaky` → a calmer alternative in `alternatives` (band not `shaky`, `high_shakes` 0, same purpose)?
     Propose `replace` with its id. None → mention only if the strip shows it is really unwatchable.
   - A high-confidence shake inside a good moment: near the start or end → `trim` so the moment starts after / ends
     before it; in the middle with ≥ 1 s on both sides → `cut_out` {from, to}; otherwise mention it.
   - Low-confidence shakes (moving scenes, e.g. a boat): mention only if the strip shows a visible jolt.
4. **Scene membership.** A panel whose clip belongs to the event of the neighbouring scene (check `scene.event` vs the
   clip's event, and the strip content) sits in the wrong scene → propose `move_scene` with the target scene id and
   position (typically the end of the previous scene or the start of the next).
5. **Repetition.** Two panels close together showing nearly the same shot (same dup group, or strips that look alike)
   → propose `remove` for the weaker one, or `replace`.
6. **Pacing / order within a scene.** Only clear problems (an establishing shot in the middle, a reaction before its
   action) → `reorder` with the new position.
7. **Brief.** Must-haves missing from the cut; total duration more than ±10 % from `target_sec` (say how far and
   which of your proposals close the gap).

Not your job: colour, exposure grading, music, titles, stabilization in Resolve (other tools do that).

## Protected panels

`protected: true` means the user touched it (placed, trimmed, starred, confirmed). You may still **report** a problem
there — set `protected: true` on the finding — with the same concrete proposal you would make otherwise; the loop will
not apply it, the user decides.

## Severity

- `must` — clearly wrong for any viewer: a sentence cut mid-word, a visible jolt in a hero shot with a calm alternative,
  a clip in the wrong scene, a frozen last frame for seconds.
- `should` — an editor would change it: a static hold of 5 s+, a shaky moment with an alternative, a repetition.
- `nit` — taste; listed for the user, never applied.

Be conservative: 5 strong findings beat 20 weak ones. No finding without a concrete proposal unless kind is `other`.

## Output

Write a JSON file and save it:

```json
{
  "critic": "cut",
  "cut_id": 1,
  "round": 1,
  "findings": [
    {
      "id": "f1",
      "severity": "should",
      "kind": "trim",
      "panel_id": 42,
      "moment_id": 311,
      "message": "Last 4 s are the same empty beach; scene ends on a frozen image.",
      "proposal": { "start_sec": 12.0, "end_sec": 15.5 }
    }
  ]
}
```

Kinds and their proposal fields: `trim` {start_sec, end_sec} · `replace` {moment_id} · `remove` {} ·
`reorder` {position} · `move_scene` {to_scene_id, position} · `speed` {speed: 1 | 0.5 | 0.25} ·
`cut_out` {from, to} · `other` (message only). Times are clip times in seconds (the same as the moment's range).

Then run `clippilot critic save --file <path> --json`. It validates ids and recomputes `protected` from the database; fix
every reported error and save again. Your final answer: the saved file path and the counts by severity.
