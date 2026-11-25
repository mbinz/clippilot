# ClipPilot

AI-assisted ingest + structured analysis of video footage, driven by a CLI that Claude Code can call as a skill. Hands off to DaVinci Resolve via FCPXML/EDL.

## Commands
- Dev: `npm run dev`
- Test: `npm test` (unit) · `npm run test:all` (unit + integration)
- Typecheck: `npm run typecheck`
- Lint: (none configured)

## Stack
- TypeScript + tsx (no build step); SQLite via `better-sqlite3`.
- Gemini 2.5 Flash for structured clip analysis (`@google/genai`, Zod-validated).
- ffmpeg/ffprobe for proxies + metadata; `sharp` for contact-sheet composites.

## Tracking
- PRD: ./PRD.md
- Architecture: ./ARCHITECTURE.md
- Status (todo list): ./STATUS.md
- Specs per theme: ./docs/specs/ · history: ./docs/history.md

## Project-specific notes
- Surface is CLI-as-skill, not MCP. Every read command emits `--json`.
- `web/` is the primary human UI (kept). The storyboard view (M4) lands there.
- Product vocabulary: Project → Cut → Scene → Panel (`stories` = Cut, `story_segments` = Panel in the schema).
- Motion vocabulary: **jitter** = continuous handheld micro-movement (band locked / stabilize / shaky); **shake** = a single jolt in the footage (never "Wackler").
- Export must work with **free** DaVinci Resolve and open formats; acceptance project is `~/Video/Portugal`.
- DaVinci handoff format quirks live in `src/core/export/{edl,fcpxml}`.
