# LiteIDE Agent — Handoff Status (updated)

Upload this file + `liteide-agent-gap-analysis-v3.md` + current `main.js`/`preload.js`/`src/index.html`/`package.json`/`README.md` + the `test/` directory (all files, incl. `test/helpers/mock-electron.js`) + `agent-sandbox.js` to a new chat to continue. Everything is now real and test-verified — no reconstructed files, no untested code.

## Current state
- **v1.8.0** (package.json version now tracks the skill version — bump both together every time), agent skill file **v1.8.0**
- **157/157 tests passing** via `npm test`, real-verified in this environment, across 13 test files
- `index.html` lives at `src/index.html` (matches `main.js`'s own `loadFile` path and every test file's hardcoded path)
- Packaging bug fixed (earlier session): `agent-sandbox.js` is in `package.json`'s `build.files` list. **Standing rule: any new top-level required file MUST be added there, or it builds fine unpacked and crashes once installed.**

## ✅ Done (15 items)
1. OS-level sandboxing (bwrap/Seatbelt/hardened-Windows)
2. Cancellation propagation (AbortSignal + process-tree kill) — now also covers entire sub-agent trees (see #14)
3. Cost/token budget caps
4. Context compaction
5. Test-after-edit auto-verification
6. Granular per-tool-category permission toggles (6 categories × allow/ask/deny)
7. Fixed pre-existing bug: `web_search`/`web_fetch` were declared but never implemented
8. Fixed packaging bug (`agent-sandbox.js` missing from build files)
9. `edit_file` failures now feed current file content back (`currentContent`)
10. RAG search surfaces its 2000-file scan cap (`capped`, `totalFilesInProject`)
11. Model-requestable permission escalation (`request_permission_escalation` tool — session-only, deny→ask ceiling only, never persisted)
12. Skill file kept in lockstep the whole way — now v1.8.0
13. **`grep_codebase`** (item C2) — ripgrep-backed exact/regex line-level search, companion to `search_codebase`. Falls back to a pure-JS scan (reuses the editor's own `search:project` matcher/file-walker) when `rg` isn't on PATH. 12 real tests in `test/grep.test.js`, run with AND without ripgrep actually installed.
14. **Recursive sub-agents** (item E) — `spawn_subagents` can now delegate up to `MAX_SUBAGENT_DEPTH = 2` levels deep, with a single `MAX_SUBAGENTS_PER_TREE = 12` budget shared across the whole tree (reserved synchronously before the async permission gate, so parallel branches can't race past it; a denied gate releases its reservation). Cancellation (Stop button) now propagates into the whole tree via `activeTreeRequestIds`, which sub-agents genuinely never registered into before this — that gap had to be fixed as a prerequisite for allowing recursion at all, per the gap-analysis report's own caution. 11 real tests in `test/subagents.test.js` (executes the actual `src/index.html` orchestration code via `vm`, same technique `compaction.test.js` uses), which caught and led to fixing a real bug: after a mid-batch tool-call cancellation, the step loop iterated once more before stopping, clobbering the specific "stopped before running remaining tool calls" message with a generic one.
15. Fixed a real latent bug in `test/backend.test.js` found while re-running the suite: an assertion checking the seeded skill file's version used `/v1\.2\.0/`, which kept "passing" through several real version bumps for the wrong reason — v1.2.0 also happens to be an unrelated historical section-header marker (auto-checkpointing) further down the same file, so the regex kept matching after the actual top-of-file version moved on. Fixed to check against the real exported `UNIVERSAL_SKILL_VERSION` constant (now exported from `main.js` for exactly this purpose) — verified by deliberately desyncing the version and confirming the test now actually fails.

## 🟡 Confirmed remaining — 3 items, all from the report
| # | Item | Size (per report) | Notes / decision points |
|---|---|---|---|
| D | Aider-style architect fallback for weak/local models | Medium (3-5 days per report) | For models without reliable structured tool-calling — likely builds on the existing `extractToolCallFromText` fallback parser |
| F | Aider-style repo map | Large | Real decision point: regex/AST-lite per language (zero-dep, weaker) vs adding tree-sitter (real new dependency, stronger) — needs an explicit choice, not a default |
| G | Minimal MCP client | Large (1-2 weeks per report) | Real protocol implementation — JSON-RPC over stdio/SSE, tool discovery, schema translation into `AGENT_TOOLS` format |

Each of these is large enough to deserve its own dedicated, focused session rather than being rushed alongside others — consistent with the "one gap at a time, full rigor" rule below, which is exactly what caught real bugs in both C2 and E above.

## Ground rules that have caught real bugs every time — keep these
- Real tests only (sandbox tests actually spawn real processes and, on Linux, actually exercise real bwrap isolation; escalation tests actually check the on-disk config is untouched; subagents tests actually execute the real orchestration code via `vm`)
- New top-level file → check `package.json` `build.files` immediately
- Update README's Architecture Reference + known-gaps list every time
- Bump skill file version + package.json version together + add a numbered skill section every time
- Push back if something in the report is wrong/not worth it
- One gap at a time, full rigor, beats several done shallowly
- If required files for full rigor (tests, harness) aren't in the upload, say so explicitly instead of guessing or fabricating passing results

## Suggested next step
D (architect fallback) is the smallest of the 3 remaining and the next-most standalone. F and G each deserve their own dedicated session — F has a real up-front decision (tree-sitter dependency or not) worth discussing before writing code, and G is a genuine protocol implementation, not a small addition.
