# LiteIDE Agent — Handoff Status (updated)

Upload this file + `liteide-agent-gap-analysis-v3.md` + current `main.js`/`preload.js`/`index.html`/`package.json`/`README.md` to a new chat to continue.

## Current state
- v1.1.0, agent skill file **v1.6.0**, **125/125 tests passing** (`npm test`)
- Packaging bug fixed: `agent-sandbox.js` is now in `package.json`'s `build.files` list. **Standing rule: any new top-level required file MUST be added there, or it builds fine unpacked and crashes once installed** — this already happened once, don't repeat it.

## ✅ Done (12 items)
1. OS-level sandboxing (bwrap/Seatbelt/hardened-Windows)
2. Cancellation propagation (AbortSignal + process-tree kill)
3. Cost/token budget caps
4. Context compaction
5. Test-after-edit auto-verification
6. Granular per-tool-category permission toggles (6 categories × allow/ask/deny)
7. Fixed pre-existing bug: `web_search`/`web_fetch` were declared but never implemented
8. Fixed packaging bug (`agent-sandbox.js` missing from build files)
9. `edit_file` failures now feed current file content back (`currentContent`) — saves a round-trip
10. RAG search surfaces its 2000-file scan cap (`capped`, `totalFilesInProject`) instead of silently truncating
11. Model-requestable permission escalation (`request_permission_escalation` tool — session-only, deny→ask ceiling only, never persisted to disk)
12. Skill file kept in lockstep the whole way — now v1.6.0, model knows about all of the above

## 🟡 Confirmed remaining — 5 items, all from the report, nothing else outstanding
| # | Item | Size (per report) | Notes / decision points |
|---|---|---|---|
| C2 | Ripgrep-backed exact-search tool (companion to existing fuzzy RAG) | Medium | TF-IDF RAG can miss exact symbol/string matches; add a `grep_codebase` tool wrapping ripgrep (fallback to plain grep if rg isn't installed) |
| D | Aider-style architect fallback for weak/local models | Medium (3-5 days per report) | For models without reliable structured tool-calling — likely builds on the existing `extractToolCallFromText` fallback parser |
| E | Recursive subagents | Medium (3-5 days per report) | Currently non-recursive, max 4 parallel. Report says only do this once cancellation is solid — it now is. Needs a hard depth/fanout cap to bound cost |
| F | Aider-style repo map | Large | Real decision point: regex/AST-lite per language (zero-dep, weaker) vs adding tree-sitter (real new dependency, stronger) — needs an explicit choice, not a default |
| G | Minimal MCP client | Large (1-2 weeks per report) | Real protocol implementation — JSON-RPC over stdio/SSE, tool discovery, schema translation into `AGENT_TOOLS` format |

(`npm outdated` check from the earlier handoff — that's a manual one-time task on your machine, not a code change, drop it from tracking here.)

## Ground rules that have caught real bugs every time — keep these
- Real tests only (sandbox tests actually spawn processes; escalation tests actually check the on-disk config is untouched)
- New top-level file → check `package.json` `build.files` immediately
- Update README's Architecture Reference + known-gaps list every time
- Bump skill file version + add a numbered section every time
- Push back if something in the report is wrong/not worth it
- One gap at a time, full rigor, beats several done shallowly — this is what caught the Windows nested-quoting bug, the exit-code cancellation bug, and the packaging bug

## Suggested next step
C2 (ripgrep tool) is the natural next one — smallest of the 5, and directly useful (it's what the user asked about wanting the agent to "learn from other files" more precisely). E (recursive subagents) is the next-most standalone after that. F and G are each big enough to deserve their own dedicated session.
