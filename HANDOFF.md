# LiteIDE Agent — Handoff Status (updated)

Upload this file + `liteide-agent-gap-analysis-v3.md` + current `main.js`/`preload.js`/`src/index.html`/`package.json`/`README.md` + the `test/` directory (all files, incl. `test/helpers/mock-electron.js`) + `agent-sandbox.js` to a new chat to continue. Everything is real and test-verified — no reconstructed files, no untested code.

## Current state
- **v1.9.0** (package.json version tracks the skill version — bump both together every time), agent skill file **v1.9.0**
- **184/184 tests passing** via `npm test`, real-verified in this environment, across 16 test files, re-run 3x consecutively with zero flakiness
- `index.html` lives at `src/index.html`
- Packaging bug fixed (earlier session): `agent-sandbox.js` is in `package.json`'s `build.files` list. **Standing rule: any new top-level required file MUST be added there, or it builds fine unpacked and crashes once installed.** (Note: this session's new config files — `.liteide/agent-architect.json` — are per-project runtime data, not build-time source files, so `build.files` does not need to change for them.)

## ✅ Done (16 items)
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
12. Skill file kept in lockstep the whole way — now v1.9.0
13. **`grep_codebase`** (C2) — ripgrep-backed exact/regex search with a pure-JS fallback. 12 real tests.
14. **Recursive sub-agents** (E) — 2 levels deep, 12-total-per-tree budget cap, whole-tree cancellation. 11 real tests, caught a real message-clobbering bug.
15. Fixed a real latent bug in `test/backend.test.js`: a stale `/v1\.2\.0/` assertion that kept "passing" for the wrong reason through several version bumps. Fixed to check the real exported `UNIVERSAL_SKILL_VERSION`.
16. **Architect fallback** (D) — Aider-style two-pass recovery for weak/local models. Opt-in, off by default. If `edit_file` fails on the same path `failureThreshold` times in a row (default 2, configurable 1-5), a separate tool-call-free prompt (optionally a different/stronger provider+model, both independently configurable) is asked for exactly one SEARCH/REPLACE block — Aider's own marker format, deliberately not JSON, since asking a weak model for correctly-escaped JSON around a code snippet reintroduces the exact format-reliability problem this feature exists to solve. Persisted per-project (`agent:getArchitectConfig`/`setArchitectConfig` → `.liteide/agent-architect.json`), with a minimal Agent Settings UI row. 24 real tests across `test/architect.test.js` (persistence) and `test/architect-logic.test.js` (parser + fix flow via `vm`), which caught a real bug: `Math.max(1, Math.min(5, Number(partial.failureThreshold) || 2))` silently turned an explicit threshold of `0` into `2`, because `0` is falsy in JS and got swallowed by `|| 2`. Fixed with an explicit `Number.isFinite` check instead of a falsy-OR fallback.

## 🩹 Bug fix (reported by screenshot, not from the gap-analysis report)
**"Can't type in the Agent Skills modal"** — the name/content fields visually rendered fine but keystrokes did nothing. Couldn't be reproduced keystroke-for-keystroke in this environment (no real browser available — network restrictions block downloading Chromium/Playwright binaries, and Monaco/xterm can't load headlessly without their own CDN/node_modules access). Static analysis ruled out duplicate DOM ids, missing `display:none` overlay rules, CSS `pointer-events` blocking, and disabled/readonly attributes (`wiring.test.js` already covers all of these and stayed green). Best available diagnosis, consistent with every symptom (modal renders correctly; only its actual text inputs are affected; nothing else reported broken): Monaco Editor's internal keybinding service attaches a `window`-level **capture-phase** keydown listener, which fires before an event reaches any descendant regardless of real DOM focus — if Monaco still believes it's focused when a modal opens on top of it, it can silently swallow keystrokes meant for that modal.

**Fix:** `openSkillsModal()` now calls a new `releaseEditorFocusForModal()` helper that blurs `document.activeElement` and defers an explicit `.focus()` onto the modal's own input by one tick, so Monaco releases its internal focus/keybinding context before the modal input gets the keystroke. `test/ui-focus.test.js` statically guards this fix staying in place but **cannot verify actual keystroke delivery** in a real renderer.

**⚠️ Please confirm in the real app that typing now works.** If it doesn't, say so explicitly next session (ideally with browser devtools console output, or which element has focus per devtools when you click into the field) — this diagnosis was reasoned from static code review only, not confirmed against a real Electron/Chromium render, and a different root cause is possible.

## 🟡 Confirmed remaining — 2 items, both from the report
| # | Item | Size (per report) | Notes / decision points |
|---|---|---|---|
| F | Aider-style repo map | Large | Real decision point: regex/AST-lite per language (zero-dep, weaker) vs adding tree-sitter (real new dependency, stronger) — needs an explicit choice, not a default |
| G | Minimal MCP client | Large (1-2 weeks per report) | Real protocol implementation — JSON-RPC over stdio/SSE, tool discovery, schema translation into `AGENT_TOOLS` format |

Each is large enough to deserve its own dedicated, focused session.

## Ground rules that have caught real bugs every time — keep these
- Real tests only (sandbox tests actually spawn real processes and exercise real bwrap isolation; subagents/architect tests actually execute the real `src/index.html` code via `vm`)
- New top-level file → check `package.json` `build.files` immediately
- Update README's Architecture Reference + known-gaps list every time
- Bump skill file version + package.json version together + add a numbered skill section every time
- Push back if something in the report is wrong/not worth it
- One gap at a time, full rigor, beats several done shallowly
- If required files for full rigor (tests, harness, a real browser) aren't available, say so explicitly instead of guessing or claiming false confidence — this session's skills-modal fix note is the example of doing that correctly

## Suggested next step
F and G are the only report items left, both large — pick whichever matters more for your actual workflow first. Separately: please verify the skills-modal fix actually works in the real app before the next session, so it can be marked confirmed (or re-diagnosed) rather than left as a best-guess.
