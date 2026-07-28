# LiteIDE Agent — Handoff Status (updated)

Upload this file + current `main.js`/`preload.js`/`src/index.html`/`package.json`/`README.md` + the full `test/` directory (incl. `test/helpers/mock-electron.js`, `test/fixtures/mock-mcp-server.js`) + `agent-sandbox.js` to a new chat to continue.

**⚠️ Replace the entire `test/` directory wholesale, every time — never mix files across versions.** As of v2.2.0, `npm test` will now catch this loudly and immediately if you slip — see below — but the right habit is to never let it happen in the first place.

## Current state: v2.2.0
- **v2.2.0** (package.json version tracks the skill version — bump both together every time), agent skill file **v2.2.0**
- **226/226 tests passing** via `npm test`, real-verified, 18 test files, re-run 3x consecutively with zero flakiness

## 🩹 Fixed this version: a real bug from live use
User hit `Role 'function' is not supported` from the Gemini API on every tool-using turn. Real bug: the Gemini adapter sent tool results with `role: 'function'` in `contents` — the live API only accepts `user`/`model`. Fixed: tool results now go in a `role: 'user'` turn with a `functionResponse` part. Regression test added. **This was caught from a real screenshot of the app actually failing in use — exactly the kind of bug that 226 passing synthetic tests cannot catch on their own, because none of them call the real Gemini API.** See "Path to A" below — this is the central lesson driving item 1.

## 🔧 Fixed this version: the update-application failure mode itself
Added a version-consistency guard to `test/helpers/mock-electron.js`: it now checks `main.js`'s `UNIVERSAL_SKILL_VERSION` against an `EXPECTED_LITEIDE_VERSION` constant in the harness, and throws one clear, actionable error immediately if they don't match, instead of letting a stale file surface as a confusing `ReferenceError` three test files later. Verified working (deliberately desynced it, confirmed the clear error fires, restored it).

**Checklist addition: bump `EXPECTED_LITEIDE_VERSION` in `test/helpers/mock-electron.js` every time `UNIVERSAL_SKILL_VERSION` bumps in `main.js`.** This is now as mandatory as bumping package.json's version.

---

## Path to a genuine, unqualified A

The last assessment landed on B+/A- with two honest drags: an unverified UI fix, and — the bigger one — an update/delivery process that had already caused one real confusing failure. This version fixes the second problem structurally (the version guard) and the first bug class showed up for real (Gemini). Here's what closing the remaining gap actually requires, in priority order, with what's already done vs. still open.

### 1. Real-model integration testing (highest priority — this is what caught the Gemini bug, and it was luck that it surfaced at all)
**Problem:** all 226 tests mock `fetch` — none of them call a real provider API. The Gemini bug shipped because nothing in the suite exercises the real wire format against the real endpoint. Synthetic tests prove internal consistency, not that the bytes sent over the wire are what the API actually wants.
**Status: not started.**
**Concrete next step:** an opt-in, network-gated test tier — e.g. `npm run test:live` (separate from `npm test`, since it needs real API keys and costs real money) that makes one minimal real call per provider (OpenAI, Anthropic, Gemini, a local Ollama if running) with a trivial tool-calling round-trip, and asserts it doesn't error. Skipped automatically when no key is present, so it never blocks a normal `npm test` run, but gives a real way to catch the next Gemini-shaped bug before a user does. This is the single highest-leverage thing left to build.

### 2. Confirm the two "diagnosed but not verified" fixes
- Agent Skills modal focus-stealing fix (v1.9.0) — still not behaviorally confirmed in a real browser. **Action: try it, report back.**
- Now that a real screenshot caught a real bug once, the same channel (screenshot + exact error text, as happened here) is clearly a working feedback loop — keep using it for anything that looks wrong in actual use, not just UI issues.

### 3. Dogfood against a real weak/local model
Architect fallback is only synthetically tested against a scripted "model" that behaves exactly as specified. It has never been run against an actual small Ollama model failing in its own idiosyncratic ways. **Action:** a real session with a small local model (something known to struggle with structured tool calls) on a real multi-file task, with architect fallback enabled, watching whether it actually recovers well in practice — not just whether the code path executes correctly in isolation.

### 4. The two explicit scope decisions, revisit only if they start actually costing something
- Windows sandboxing gap (no dependency-free native primitive exists) — leave as documented until either a native-addon approach becomes worth the investment, or Windows usage reveals it's actually a problem, not just a theoretical asymmetry with Linux/macOS.
- MCP SSE/HTTP transport — leave stdio-only until a specific remote MCP server someone actually wants to use requires it. Building transport support speculatively, before a concrete need, is exactly the kind of unforced complexity this project has otherwise avoided.

### What does NOT need more work
Everything covered by the 226 real tests — file I/O, all three search modes, sandboxed execution, recursive delegation with real caps, budget enforcement, compaction, verification, permissions, escalation, the MCP client's protocol handling, checkpointing — is solid. The gap to A was never "more features," it was "has this actually been run against the real, messy outside world" (real provider APIs, real weak models, a real browser, a real multi-version update). Item 1 above is that gap's biggest single piece.

## Ground rules — keep these, now including the two added this version
- Real tests only, including real subprocesses where the feature involves them
- New top-level file → check `package.json` `build.files` immediately
- Update README's Architecture Reference + known-gaps list every time
- Bump skill file version + package.json version + `EXPECTED_LITEIDE_VERSION` in the test harness, all together, every time
- Rewrite the skill file wholesale when a change affects more than one existing section's truth — don't append a section that contradicts an earlier one
- When applying an update, replace whole directories, never cherry-pick files across versions — and as of v2.2.0, doing this wrong now fails loudly and immediately instead of confusingly
- Push back if something in the report is wrong, or a "default" needs to be made explicit
- One gap at a time, full rigor
- If something can't be verified, say so explicitly — this is exactly how the skills-modal fix and the "path to A" above stay honest instead of overclaimed

## Suggested next step
Item 1 (real-model integration test tier) is the highest-leverage remaining work and the direct lesson from this session's bug. Worth a dedicated session: which providers to cover, how to keep API costs near zero (one trivial call per provider, not a full suite), and how to structure it so it never blocks a normal contributor without API keys.
