# LiteIDE Agent — Handoff Status (updated)

Upload this file + `liteide-agent-gap-analysis-v3.md` + current `main.js`/`preload.js`/`src/index.html`/`package.json`/`README.md` + the `test/` directory (all files, incl. `test/helpers/mock-electron.js`) + `agent-sandbox.js` to a new chat to continue. Everything is real and test-verified — no reconstructed files, no untested code.

## Current state
- **v1.10.0** (package.json version tracks the skill version — bump both together every time), agent skill file **v1.10.0**
- **200/200 tests passing** via `npm test`, real-verified in this environment, across 17 test files, re-run 3x consecutively with zero flakiness
- `index.html` lives at `src/index.html`
- Packaging bug fixed (earlier session): `agent-sandbox.js` is in `package.json`'s `build.files` list. **Standing rule: any new top-level required file MUST be added there, or it builds fine unpacked and crashes once installed.**

## ✅ Done — all report items except G, plus 2 real bugs found and fixed along the way
1. OS-level sandboxing (bwrap/Seatbelt/hardened-Windows)
2. Cancellation propagation (AbortSignal + process-tree kill) — covers entire sub-agent trees too
3. Cost/token budget caps
4. Context compaction
5. Test-after-edit auto-verification
6. Granular per-tool-category permission toggles (6 categories × allow/ask/deny)
7. Fixed pre-existing bug: `web_search`/`web_fetch` were declared but never implemented
8. Fixed packaging bug (`agent-sandbox.js` missing from build files)
9. `edit_file` failures now feed current file content back (`currentContent`)
10. RAG search surfaces its 2000-file scan cap (`capped`, `totalFilesInProject`)
11. Model-requestable permission escalation (`request_permission_escalation` tool)
12. Skill file kept in lockstep the whole way — now v1.10.0
13. **`grep_codebase`** (C2) — ripgrep-backed exact/regex search with a pure-JS fallback. 12 real tests.
14. **Recursive sub-agents** (E) — 2 levels deep, 12-total-per-tree budget cap, whole-tree cancellation. 11 real tests, caught a real message-clobbering bug.
15. Fixed a real latent bug in `test/backend.test.js`: a stale `/v1\.2\.0/` assertion that kept "passing" for the wrong reason through several version bumps.
16. **Architect fallback** (D) — Aider-style SEARCH/REPLACE recovery for weak/local models. 24 real tests, caught a real falsy-zero config bug.
17. **Agent Skills modal "can't type" bug fix** (reported by screenshot) — best-available diagnosis: Monaco's internal keybinding service captures keydown at the window level and can swallow keystrokes meant for an overlaid modal. Fixed via explicit blur + deferred focus. **Not behaviorally confirmed in a real browser — please verify and report back.**
18. **`get_repo_map`** (F) — Aider-style condensed codebase overview. Per-language regex symbol extraction (JS/TS, Python, Go, Rust, Java/Kotlin, C/C++, Ruby, PHP) — an explicit choice over tree-sitter, not a default (see rationale in README/skill section 22): tree-sitter would be more accurate but adds a real native dependency with per-platform binaries, the same category of install friction node-pty already caused on Windows. Ranked by `focus_path` proximity → symbol count → alphabetical; capped at 40 symbols/file and 300 files output. 16 real tests in `test/repomap.test.js`, covering every supported language, both caps, ignore-pattern behavior, and a specific check that C-family function detection doesn't false-positive on `if`/`for`/`while` control flow — **all 16 passed on the first real run**, no bugs found this time.

## 🩹 Open item from last session — please confirm
The Agent Skills modal focus fix (v1.9.0, item 17 above) has not been behaviorally confirmed. Try typing in it in the real app; report back whether it works. If not, include what devtools shows has focus when you click the field, so this can be re-diagnosed with real information instead of another guess.

## 🟡 Confirmed remaining — 1 item
| # | Item | Size (per report) | Notes / decision points |
|---|---|---|---|
| G | Minimal MCP client | Large (1-2 weeks per report) | Real protocol implementation — JSON-RPC over stdio/SSE, tool discovery, schema translation into `AGENT_TOOLS` format. This is the last item from the original gap-analysis report. |

This is genuinely the last large item from the v3 report. After this, the agent's tool surface will cover: file I/O, exact + fuzzy + structural (repo map) codebase search, sandboxed command execution, recursive multi-agent delegation, web access, weak-model recovery, and (with G) arbitrary external tool integration via MCP — a very complete agentic coding toolset by the standards of tools like Claude Code/Cursor/Aider/Cline that the original gap analysis benchmarked against.

## Ground rules that have caught real bugs every time — keep these
- Real tests only (sandbox tests actually spawn real processes and exercise real bwrap isolation; subagents/architect/repomap tests actually execute the real `src/index.html`/`main.js` code)
- New top-level file → check `package.json` `build.files` immediately
- Update README's Architecture Reference + known-gaps list every time
- Bump skill file version + package.json version together + add a numbered skill section every time
- Push back if something in the report is wrong/not worth it, or if a "default" choice (tree-sitter vs regex, JSON vs SEARCH/REPLACE) needs to be made explicit rather than assumed
- One gap at a time, full rigor, beats several done shallowly
- If something can't be verified (no real browser available, etc.), say so explicitly rather than claiming false confidence

## Suggested next step
G (MCP client) is the only report item left, and it's the largest and most architecturally different — a real protocol implementation (JSON-RPC over stdio/SSE), not an extension of existing patterns like the last several items were. Worth a dedicated session with room to think through the design (which transports to support first, how discovered MCP tools map into the existing `AGENT_TOOLS`/`execAgentTool` dispatch, how their permissions interact with the existing 6-category system) before writing code.
