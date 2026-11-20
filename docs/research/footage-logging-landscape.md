# Footage logging / moment detection landscape (as of 2026-11-20)

Method: web search plus page fetches, one session. Primary sources were used where reachable (vendor pages, GitHub, PyPI, Blackmagic/Adobe/Apple docs). Many figures come from press or aggregators and are marked **[unverified]**. Several fetches were truncated, so some "not stated" items may be stated elsewhere on the same page. Prices change; re-check before relying on them.

Target user: solo travel/vlog creator, 100-500 GB per trip, mixed cameras (phone, GoPro, Sony A7C II; 25/50/100 fps), **free** DaVinci Resolve, 10-20 min montage. Needs moment-level detection, tags (shot type, content, people, place, shake/blur), slow-motion suitability hints, fast review UI, Resolve import, local-first, affordable or open source.

## 1. Summary

1. No tool found does the whole job for this user. The market splits into search tools (find a clip by describing it) and rough-cut assemblers (build a sequence from dialogue). Few log non-dialogue B-roll as time ranges with quality and suitability tags.
2. Moment-level output (start/end ranges) is rare. Jumper, Peakto, Resolve 21 IntelliSearch and Premiere Media Intelligence mostly return whole clips with a hit position. Final Cut Pro 12's Visual Search is described as finding "moments". Selects and Eddie AI work on ranges, but their focus is interview and dialogue rough cuts.
3. Quality problems (shake, blur, exposure) and slow-motion suitability are not offered as first-class tags by any commercial tool I found. The closest are quality scores in the open-source `resolve-assistant` and camera-movement fields in its sidecar JSON. Nothing found checks high-fps source, shutter, or stabilisation-vs-slowmo fit.
4. Free Resolve is the biggest constraint. Resolve 21 IntelliSearch is reported Studio-only (secondary source; Blackmagic's page does not say). Resolve 21.1 (Sep 2026) moved Python scripting to Studio, per the release notes quoted by No Film School and Puget. Plugin- and script-based integrations (Jumper's Resolve plugin, Eddie's script extension, `resolve-assistant`) are therefore at risk or unusable on free Resolve.
5. File-based handoff (FCPXML, FCP7 XML, EDL, markers) still works on free Resolve. Resolve's own import-timeline path does not need scripting. So the viable pattern is: external tool analyses, writes a timeline or XML, user imports it.
6. Local-first is available but patchy. Jumper, Peakto, Premiere Media Intelligence and Resolve IntelliSearch analyse locally. Selects, Eddie (some paths), Strada, Twelve Labs and Gemini-based open-source tools upload footage or proxies. Uploading proxies, rather than 500 GB of originals, is the usual compromise.
7. Price: Resolve Studio costs $295 one-time ($236 on a sale page). Jumper is a paid one-time licence (amount not verified). Peakto is roughly EUR 10-25 per month on 2-year plans, or EUR 270 lifetime. Eddie is credit-based, $10 per 1,000 credits. Selects is $16-20 per month for 10 hours of analysis. Gemini-based DIY would cost cents to a few dollars per hour of footage (estimate, not sourced here).
8. Camera-ecosystem auto-edit (GoPro Quik, Insta360, DJI) is single-brand and cloud/app oriented. GoPro's auto highlights are tied to a $59.99/yr subscription and cloud upload. None export markers to Resolve.
9. Open source is thin and early. `resolve-assistant` (MIT, Feb 2026) and Montai (46 stars) are the closest to an LLM-logs-then-exports pipeline. ButterCut (626 stars) is non-commercial licensed and built for Claude Code. Immich and PhotoPrism are photo-first, with no verified moment-level video search.
10. Answer: no, not well for this user. The closest combination is Jumper or Peakto for search, plus manual markers and subclips in Kyno or Resolve. It misses automatic moment ranges, quality and slow-mo tags, and a fast curation UI. That is the white space.

## 2. Comparison table

Legend: M = moment/range-level, C = clip-level. "Free Resolve" = works without Studio.

| Tool | Level | Analysis | Tagging depth | Review UX | Export / NLE | Free Resolve? | Pricing | Platform | Main gap vs target |
|---|---|---|---|---|---|---|---|---|---|
| Jumper | C (hit within clip) | Local, offline | Visual and speech search, faces (Pro); no stored tags | Search results in NLE panel or standalone | Plugin for Premiere, FCP, Resolve, Avid | Plugin reportedly needs Studio (secondary source) | Lifetime or Pro sub; amounts not on pages fetched [unverified] | Mac, Win | Search not logging; no quality/slow-mo tags |
| Eddie AI | M (rough cuts, B-roll logging) | Mixed: Resolve extension local; B-roll logging uploads clips | Up to 5 topics per clip (CineD) | Chat + app | FCPXML, Premiere, Resolve; comments export as Resolve markers | FCPXML yes; script extension probably Studio | Credits: $10/1,000, $45/5,000; ~500 credits per hour of source | Mac, Win, iPhone | Dialogue/interview oriented; credits add up; upload |
| Selects (Cutback) | M | Cloud analysis (upload not stated on pricing page) | Transcripts, bins, markers | Editor + chat | Premiere, FCP, Resolve, Avid | Handoff on all plans; method not stated | Free; $16-20/mo (10 h); ~$80-100/mo (40 h) | Desktop | Interview/long-form focus; 1 credit per 10 s |
| Quickture | M (dialogue rough cuts) | Not verified | Dialogue-based | n/a | Resolve export not found | Unknown | 14-day trial, price not found | Mac/Win | Needs dialogue |
| Peakto (Cyme) | C (shows hit bar) | Local | Search, albums, MCP in v3 | Catalog browser | Bins to Premiere, FCP; Resolve claimed (check) | Unclear | EUR 10/25 per month on 2-yr plans; EUR 270 lifetime | Mac | Not moment ranges; no quality tags |
| Kyno | M (manual) | None (no AI) | Manual markers, subclips, metadata | Fast browser | Send to Resolve, FCP, Premiere (subclips and markers) | Resolve integration works without scripting per Kyno 1.9 notes [unverified for free] | Not verified | Mac, Win | No AI |
| Resolve 21 IntelliSearch | C | Local | Objects, speech keywords, faces; Slate ID | Media Pool, smart bin | Native | **Studio only** (secondary sources) | Studio $295 (sale $236) | Mac, Win, Linux | Not on free; clip-level; no compositional queries |
| Premiere Media Intelligence | C/M [unverified] | Local, .prmi sidecar | Visual semantic, transcript | Search panel | Native; "New Sequence from Selection" | Not applicable (Premiere) | Adobe CC sub | Mac, Win | Wrong NLE for target |
| Final Cut Pro 12 | M ("moments") | Local, Apple silicon | Visual search, transcript search, beat detection | Native browser | Native; FCPXML | N/A | One-time purchase (price not verified) | Mac | Wrong NLE; Resolve import loses analysis |
| Strada | C/M | Cloud | Auto-tags locations, characters | Cloud app | Premiere/Resolve (not verified) | Unknown | Standard $200/mo (10 h logging) | Web | Pivoted away from AI per competitor post; expensive |
| Twelve Labs | M (video segments) | Cloud API | Embeddings, search | None (API) | None | n/a | ~$2.50/h index + storage; search $4/1k [aggregator] | API | Build-it-yourself; upload |
| Moments Lab, iconik, axle, Reduct | C/M | Cloud/enterprise | Rich | Enterprise MAM | MAM-style | Not target | Enterprise; Moments Lab $3-$12 per unit on AWS (unit unclear) | Web | Enterprise priced |
| GoPro Quik | M (auto highlights) | Cloud upload | Highlights, HiLights | Mobile app | None to Resolve | No | Premium $59.99/yr; Premium+ $99.99/yr (Dec 2025 page) | iOS/Android/desktop | GoPro-centric; cloud |
| Insta360 / DJI | M (auto edit) | Insta360 on-device/cloud mix; LightCut retired Sep 2026 | Templates | Phone app | None to Resolve | No | Studio free | Phone/desktop | Single-brand |
| `resolve-assistant` | M | Gemini cloud (proxy upload) | Type, description, camera movement, quality score, tags | MCP/chat | Resolve timeline plus FCP7 XML | Needs Resolve scripting; free-edition status in doubt after 21.1 | MIT; Gemini cost | Python | Early (Feb 2026); no review UI |
| Montai | M | Gemini cloud | Storylines | CLI chat | FCPXML 1.11 | Yes via FCPXML | Free; Gemini cost; licence not stated | Node CLI | Generates edits, not a log; 46 stars |
| ButterCut | M | Local transcription (WhisperX) | Selects/scenes | Claude Code | XML to FCP, Premiere, Resolve | Via XML | PolyForm Noncommercial; 626 stars | Mac | Dialogue first; licence |
| Immich / PhotoPrism | C | Local | CLIP search | Web gallery | None | N/A | Free | Self-host | Photo-first; no moment output verified |
| LosslessCut | M (manual) | None | None | Fast cutter | Segment CSV/EDL-style | N/A | Free (v3.70.2) | All | No AI |

## 3. Per-tool notes

**Jumper** ([getjumper.io](https://getjumper.io), fetched 2026-11-20). Visual and speech search in 111 languages, face recognition and agentic editing (Pro), watch folders. Runs on-device and offline; footage never leaves the machine. Supports Premiere, FCP, Resolve and Avid, plus a standalone app. Active: v2026.11.20 shipped today, with several releases in Oct-Nov. Pricing page shows structure (lifetime with 1 year updates; Pro monthly/yearly/lifetime) but no amounts. A secondary page ([docs mirror](https://docs-pjj.pages.dev/how-to-use/resolve)) says the Resolve plugin needs Studio; could not confirm on the official docs. Compared with others in [ProVideo Coalition, Feb 2026](https://www.provideocoalition.com/visual-search-tools-compared/): finds clips, can add all hits to a timeline for culling. Gap: search, not automatic logging.

**Eddie AI** ([CineD, Aug 2026](https://www.cined.com/eddie-ai-overhauled-pay-as-you-go-pricing-editing-from-claude-and-chatgpt-and-an-iphone-app/)). Subscriptions replaced by credits: $10/1,000, $45/5,000, $120/15,000, $350/50,000; 1,000 free; about 500 credits per source hour, so roughly $5 per hour. Exports Resolve FCXML ([help](https://intercom.help/ed-9a7825885c52/en/articles/9944875-export-edit-sequences-into-davinci-resolve)). Resolve extension processes locally ([CineD, May 2025](https://www.cined.com/eddie-ai-extension-for-davinci-resolve-released-virtual-editing-assistant/)) but B-roll logging uploads up to 50 clips at a time (help center). Runs as an MCP server too ([No Film School](https://nofilmschool.com/eddie-ai-updates-pricing)). Gap: oriented to talking footage; upload for logging; per-hour cost.

**Selects by Cutback** ([pricing](https://tryselects.com/pricing/)). Free tier; Starter $20/mo ($16 yearly) for 10 h; $100/mo tier ($80 yearly) for 40 h. Analysis costs 1 credit per 10 s (360 per hour). Handoff to Premiere, FCP, Resolve, Avid on all plans. Upload requirement not stated on the pricing page. Gap: multicam/interview emphasis; unclear for B-roll.

**Quickture** ([pricing](https://quickture.com/pricing-stripe)). Dialogue-based rough cuts, 14-day trial. Could not verify price or Resolve export. Poor fit for silent B-roll.

**Peakto / Cyme** ([pricing](https://cyme.io/pricing)). Local AI search across catalogs; v3 adds MCP ([Fstoppers](https://fstoppers.com/apps/peakto-launches-version-30-media-manager-can-handle-millions-assets-905455)). Pricing page: Standard EUR 10 and Professional EUR 25 on 2-year plans (EUR 240 and EUR 600 totals); lifetime EUR 270 with 1 year updates. Premiere and FCP integrations confirmed on pricing page; Resolve integration only in CYME's blog, treat as unverified. Returns whole clips with a bar for the hit; "doesn't select parts of clips" ([PVC](https://www.provideocoalition.com/visual-search-tools-compared/)).

**Kyno** ([release notes](https://lesspain.freshdesk.com/support/solutions/articles/12000016005-release-notes-for-kyno)). v1.9.0, Sep 2025. Manual markers and subclips with Send-to Resolve/FCP/Premiere. No AI. Still the fastest manual log-and-send tool; price not verified.

**DaVinci Resolve 21 / 21.1** ([Blackmagic](https://www.blackmagicdesign.com/products/davinciresolve), [PVC](https://www.provideocoalition.com/davinci-resolve-21-announced-with-new-ai-features-and-a-new-photo-page/), [CineD NAB hands-on](https://www.cined.com/davinci-resolve-21-hands-on-at-nab-2026-photo-page-intellisearch-and-cinefocus-in-action/)). IntelliSearch indexes objects, speech keywords and faces locally; results are clips in the Media Pool and can go to a smart bin; no compositional queries such as "wide shot". Studio-only according to [DaVinci Resolve Club](https://davinciresolveclub.com/davinci-resolve-21-ai-tools/) (secondary). Studio $295; Blackmagic's page showed $236 on 2026-11-20. Resolve 21.1 note: "We have moved the ability to script in Python to the Studio version" ([No Film School](https://nofilmschool.com/davinci-resolve-update-21-1); impact on free users per [Puget Systems](https://www.pugetsystems.com/blog/2026/09/10/how-davinci-resolve-free-v21-1-scripting-changes-affect-puget-bench/)). Whether the free edition's console still runs basic scripts: conflicting, unverified. Studio 21.1 adds an MCP server (secondary source).

**Premiere Pro Media Intelligence** ([Adobe help](https://helpx.adobe.com/premiere-pro/using/media-intelligence-and-search-panel.html)). On-device visual and transcript search; Media Encoder can pre-analyse into `.prmi` sidecars (Adobe community post, Jan 2026). Not applicable to free Resolve.

**Final Cut Pro 12** ([No Film School](https://nofilmschool.com/final-cut-pro-update-12-0), [PVC](https://www.provideocoalition.com/whats-new-in-final-cut-pro-12-and-more/)). Jan 2026: Transcript Search, Visual Search (finds "moments, objects and actions"), Beat Detection; Apple silicon; transcript search US English only. Native only; not a Resolve source.

**Strada.** Enterprise page shows Standard $200/mo with 10 credit hours of logging ([strada.tech](https://strada.tech/enterprise)). A competitor's blog claims Strada moved focus to remote editing; treat as biased. Cloud. **Shade:** nothing verifiable found.

**Twelve Labs** ([pricing](https://twelvelabs.io/pricing)). Cloud video-understanding API (Marengo/Pegasus). Aggregators quote $0.042/min (about $2.50/h) indexing plus storage fee and $4 per 1,000 searches; newer token billing described in [Marengo 3.5 post](https://www.twelvelabs.io/blog/marengo-3.5). Returns time-ranged segments, but requires upload and has no UI or export.

**Moments Lab, iconik, axle ai, Reduct.** Enterprise MAM/indexing. Moments Lab shows $3 (Lite) and $12 (full) per unit on [AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-js7zwbki7px5e); unit unclear. iconik: free tier claimed by an aggregator, unverified. axle: no pricing found. Reduct: per-seat, amounts not found. Frame.io AI, Postlab, Simon Says, AutoCut, FireCut, Shade, Hedge/OffShoot: not researched in depth in this pass; AutoCut and FireCut are Premiere-centric silence/podcast cutters, so not a fit.

**GoPro Quik** ([GoPro subscriptions](https://gopro.com/en/ai/shop/subscriptions)). Premium $59.99/yr, Premium+ $99.99/yr (page dated Dec 15, 2025); auto highlight videos built from cloud-uploaded footage. Non-GoPro cameras partially supported (100-500 GB cloud tiers). No Resolve export.

**Insta360 / DJI.** Insta360 X6 AI Director runs after cloud upload ([manual](https://onlinemanual.insta360.com/x6/en-us/operating-tutorials/highlight-features/ai-director)); Studio desktop says it does not currently support AI editing. DJI LightCut updates ended Sep 2026 per [DJI page](https://www.dji.com/lightcut). CapCut auto edit: not researched. None produce Resolve-importable markers.

**resolve-assistant** ([PyPI](https://pypi.org/project/resolve-assistant/)). MIT. Gemini analyses footage and writes per-segment sidecar JSON with type (A/B-roll), description, camera movement, quality score, tags; builds a Resolve timeline and an FCP7 XML backup. Says "Resolve (Free or Studio)" with external scripting on; release 0.1.5 is Feb 26, 2026, before the 21.1 scripting change, so that claim needs re-testing. Closest existing open-source analogue to this project.

**Montai** ([GitHub](https://github.com/jysperm/Montai)). Gemini analysis (uploads transcoded media), FCPXML 1.11 for FCP and Resolve, Remotion render. 46 stars, 157 commits, no releases, licence not shown.

**ButterCut** ([GitHub](https://github.com/barefootford/buttercut)). Claude Code agent with WhisperX; XML for FCP, Premiere, Resolve; 626 stars; PolyForm Noncommercial with commercial-output exception.

**Others from search (not evaluated):** VideoHighlighter (Ollama, local), video-editing-mcp (OTIO for Resolve), Immich Memories generator (docs page 404 at fetch time). **Immich** smart search is CLIP-based; I could not confirm how videos are sampled ([docs](https://immich.app/docs/features/searching)). **LosslessCut** v3.70.2 is a manual lossless cutter.

## 4. Gaps / white space

- Automatic moment detection for non-dialogue B-roll with start/end ranges, not just "find clips about X".
- Quality defect tags (shake, blur, exposure, lens covered) and a "usable" flag per range.
- Slow-motion suitability: source fps vs project fps (25/50/100), motion level, shutter and stabilisation fit. No tool found does this.
- Fast curation UI (keyboard-first accept/reject over ranges) tied to the analysis, rather than a search box.
- Mixed-camera normalisation (phone VFR, GoPro, Sony S&Q) and consistent timecode in exports.
- Handoff that works with free Resolve after 21.1: FCPXML/EDL/XML import, with markers or subclips. Competitors rely on plugins or scripting, which free users no longer have.
- Local-first with optional proxy-only cloud analysis and cost cap (rather than credit meters per hour).
- Affordable for a solo creator: commercial options are $16-100/month or credit-based; the open-source ones are early and have no review UI.

## 5. Closest alternatives to try instead of building

1. **Jumper (standalone app) plus Kyno or Resolve markers.** Local, one-time licence, searches by visual description and speech. Still missing: automatic moment ranges, quality and slow-mo tags, a curate-and-export queue; Resolve plugin probably needs Studio, so use the standalone app and add markers by hand or via Kyno.
2. **Selects (free tier) or Eddie AI (credits) for range-level logging and FCPXML/marker export.** Both reach free Resolve through file import. Still missing: B-roll-specific quality and slow-mo tags, local-only analysis (uploads), and predictable cost on 500 GB; both tuned to dialogue.
3. **`resolve-assistant` or Montai (open source, Gemini).** Closest to the intended pipeline: per-segment tags, quality scores, camera movement, FCPXML/XML. Still missing: review UI, slow-mo/fps logic, hardened mixed-camera handling, and (for resolve-assistant) a verified free-Resolve path after 21.1. Both upload proxies to Google.

Also worth a look if the user buys Resolve Studio ($295): built-in IntelliSearch plus smart bins. It would still lack moment ranges, quality tags and slow-mo hints.

## Unverified items to check before acting

- Jumper price and whether its Resolve integration works on free Resolve.
- Whether IntelliSearch is Studio-only (secondary sources agree; Blackmagic page silent).
- What free Resolve 21.1 still allows for scripting.
- Peakto Resolve integration status; Kyno current price.
- Selects/Quickture upload behaviour; Quickture price.
- Strada, Shade, Frame.io AI, Simon Says, AutoCut, FireCut, CapCut, Postlab, Hedge, PhotoPrism details: not researched or not verified.
