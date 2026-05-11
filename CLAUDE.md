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
- Status: ./STATUS.md

## Project-specific notes
- Surface is CLI-as-skill, not MCP. Every read command emits `--json`.
- `web/` is a deletion candidate once the contact-sheet flow proves out.
- DaVinci handoff format quirks live in `src/core/export/{edl,fcpxml}`.
