# LiteIDE Agent — Handoff Status (updated)

Upload this file + current `main.js`/`preload.js`/`src/index.html`/`package.json`/`README.md` + the `test/` directory (all files, incl. `test/helpers/mock-electron.js` and `test/fixtures/mock-mcp-server.js`) + `agent-sandbox.js` to a new chat to continue.

**⚠️ CRITICAL: replace the entire `test/` directory wholesale, every time. Do not merge or cherry-pick individual test files across delivered versions.** `main.js`/`src/index.html` and the test files that verify them are a matched set — a test file from an older delivery run against a newer `main.js` will produce confusing failures that look like real bugs but aren't. This exact thing happened between v1.9.0 and v2.0.0 (see below) — worth reading even though it's now fixed, because it will happen again with any future partial update.

## Current state: v2.1.0
- **v2.1.0** (package.json version tracks the skill version — bump both together every time), agent skill file **v2.1.0**
- **225/225 tests passing** via `npm test`, real-verified in this environment, across 18 test files, re-run 3x consecutively with zero flakiness
- Every item in the original v3 gap-analysis report is done (completed at v2.0.0) — v2.1.0 is a skill-file quality/accuracy rewrite, no new capability

## 🩹 Diagnosed this session: a real user-reported test failure, traced to a stale file (not a code bug)
User ran `npm test` on their real machine and got 143/157 passing with 9 failures, all `ReferenceError: getAllAgentToolsCached is not defined` in `test/subagents.test.js`. Root cause: their `main.js` was current (v2.0.0+, includes the MCP client and `getAllAgentToolsCached`), but their `test/subagents.test.js` was an OLDER copy from before that function existed — it doesn't extract or stub it, so the `vm` sandbox throws the moment `runSubagentOrchestration` (which now calls `getAllAgentToolsCached` to merge in MCP tools) executes.

**This is not a bug in anything delivered.** The current `test/subagents.test.js` (confirmed in this session, 11/11 passing standalone) already extracts `getAllAgentToolsCached` and stubs `api.agent.mcpListTools`. The user's local copy of that one file predates the v2.0.0 MCP merge. Their `package.json` test script was already updated to v2.0.0 (their own paste showed the full command including `mcp.test.js`), so this was a partial-update artifact — some files replaced, others not — not a deliberate action.

**If this shape of failure ever recurs** (a `ReferenceError` for a function that clearly exists in `src/index.html` when you grep it, inside a `test/*.test.js` file that uses `vm` extraction): the test file's extraction list is out of sync with the source it's extracting from. Fix is always the same — get the matching test file from the same delivery as the source it tests.

## 🩹 Fixed this session: skill file had an internal contradiction
Through v1.2.0 → v2.0.0, the embedded skill file grew by appending a new numbered section per feature rather than being rewritten as a whole document each time. After 12 appends this had a real, live contradiction: section 10 ("Parallelism rules") still said sub-agents run with "a reduced tool set (no further spawning)" — true before v1.8.0, **false** after it, since v1.8.0 added recursion up to 2 levels deep. Section 20, later in the same file, correctly described the recursion — so the model was reading two directly contradictory instructions in the same document, and section 20 happened to win only because it appeared later, which is not a reliable way for a document to be correct.

The user caught this by uploading an old seeded copy from one of their real project folders (the skill file gets auto-seeded per-project, so stale copies genuinely accumulate across a user's various projects if the source document itself was ever wrong).

**Fixed with a full rewrite, not another append**: v2.1.0 is one coherent 16-section document. Same information, reorganized (search/grep/repo-map now get one comparative section — "which of these three tools for which job" — instead of being scattered across three separately-appended sections; permissions and escalation are unified instead of split across two "vN.N.0"-tagged sections), contradiction removed. No tool behavior changed, only the document describing it to the model.

**Going forward: rewrite this file wholesale on any change substantial enough to touch more than one existing section's meaning, not append-only by default.** Appending was fine for the first several additions because each one was genuinely additive; it stopped being fine once a later addition (recursion) changed the truth of something an earlier section asserted.

## ✅ Complete feature list (all real, all tested — see README's Architecture Reference for full detail on each)
Core file I/O, three-mode codebase search (RAG/exact-match/structural map), OS-level sandboxed command execution (Linux/macOS), real multi-session terminals, recursive multi-agent delegation with hard cost caps, per-project token/USD budget caps, context compaction, test-after-edit auto-verification, six-category permission system with session-scoped escalation, git auto-checkpointing, weak-model recovery (architect fallback), and MCP client for external tool integration.

## Known limitations (explicit scope decisions, not oversights)
- Windows has no real OS-level sandbox for `agent:runCommand` (no dependency-free native primitive exists)
- `get_repo_map` is regex-based, not a real parser (explicit tradeoff vs. tree-sitter's native-dependency cost)
- MCP client is stdio-only, not SSE/HTTP (explicit tradeoff — SSE is a materially different, larger feature)
- MCP servers run outside the sandbox that wraps `run_command` (persistent bidirectional stdio sandboxing is a much bigger problem than one-shot commands, and MCP servers often legitimately need broad FS/network access anyway)
- The Agent Skills modal focus-stealing fix (v1.9.0) has not been behaviorally confirmed in a real browser — **please verify and report back**

## Ground rules that have caught real bugs every time — keep these
- Real tests only, including real subprocesses where the feature involves them
- New top-level file → check `package.json` `build.files` immediately
- Update README's Architecture Reference + known-gaps list every time
- Bump skill file version + package.json version together
- **Rewrite the skill file wholesale when a change affects more than one existing section's truth — don't append a section that contradicts an earlier one**
- Push back if something in the report is wrong/not worth it, or if a "default" choice needs to be made explicit rather than assumed
- One gap at a time, full rigor, beats several done shallowly
- If something can't be verified (no real browser, etc.), say so explicitly rather than claiming false confidence
- **When applying an update, replace whole directories, don't cherry-pick files across versions**

## Suggested next step
With the original report fully closed out and the skill file now internally consistent, next steps are open-ended: verify the skills-modal fix in a real browser, decide whether SSE/HTTP MCP transport or tree-sitter-based repo mapping is worth its added complexity, or address whatever friction actual daily use surfaces. Worth asking directly rather than guessing at what matters most.
