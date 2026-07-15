# LiteIDE Agent — Gap Analysis vs. Production-Grade Coding Agents (v3, Final)

**Evidence tracks:**
- **[CODE]** — read directly from your uploaded `main.js`, `index.html`, `preload.js`, `README.md`, `package.json` using file-reading tools. Function/line-referenced.
- **[WEB:n]** — verified this session via web search/fetch against **official vendor docs where available** (Anthropic, OpenAI/developers.openai.com, Cursor.com, GitHub, Cline's own repo/docs) and credible third-party technical analyses where no first-party doc existed. Footnoted at the bottom.
- Unmarked text is my own synthesis connecting the two — labeled as judgment, not fact.

**Comparators, chosen for actual market usage, not obscurity:** Claude Code (re-verified against Anthropic's own current docs, correcting an error from v2), Cursor Agent, OpenAI Codex CLI, GitHub Copilot (CLI + Agent/cloud), Aider, Cline, and Devin.

**What I explicitly could not verify:** your `test/` suite (not uploaded — the "pass 32/fail 0" README claim is unconfirmed) and the exact current npm-registry versions of `node-pty`, `monaco-editor`, `xterm` (I checked Electron directly; see §9). Flagged inline rather than guessed at.

---

## 1. Verdict

LiteIDE [CODE] is a working, reasonably disciplined tool-calling agent — exact-match editing with ambiguity rejection, per-file git checkpoints, OS-keychain key storage, true-parallel non-recursive subagents, real multi-provider + local model support. Against seven of the most-used production agents on the market today, its **permission/sandboxing model is now the clear outlier**: every comparator studied here — including the one architecturally closest to LiteIDE (Cline, also an editor-embedded, permission-gated, multi-provider agent with no VC funding forcing a cloud model) — has either shipped OS-level sandboxing or, in Cline's case, a materially more granular auto-approve system than LiteIDE's binary regex gate. LiteIDE is not behind on *capability breadth* so much as it's behind on the *safety infrastructure* every one of these tools converged on independently in 2026.

---

## 2. Sandboxing & permissions — re-verified against official docs

**[CODE] LiteIDE:** `agent:runCommand` spawns a real shell with full `process.env`/user privileges, gated only by regex blocklists (`CRITICAL_CMD_PATTERNS`) and a separate regex file-allowlist (`CRITICAL_NAME_PATTERNS`). File writes are scoped to the project root (`resolveInProject`); shell commands are not scoped at all.

**[WEB:1] Claude Code (official Anthropic docs, re-checked this round — corrects a v2 error):** ships **six** permission modes, not five as a third-party source previously suggested: `default` (approval callback gates anything not explicitly allowed), `acceptEdits` (auto-approves file edits + safe filesystem commands like `mkdir`/`touch`/`mv`/`cp`, still gates other Bash), `plan` (read-only, no edits auto-approved ever), `dontAsk` (never prompts; only pre-approved rules run), **`auto`** (a model classifier approves/denies each call — the mode the earlier third-party source missed), and `bypassPermissions` (runs everything, explicitly documented as for isolated CI/containers only, and blocked from running as root on Unix). Separately, `allowed_tools`/`disallowed_tools` let you allow/deny by tool name or scoped rule (e.g. `"Bash(npm *)"`), and **hooks** (`PreToolUse`, `PostToolUse`, etc.) let you programmatically intercept every tool call before it runs, without consuming context (hooks run in your application process, not the model's context window) [WEB:1].

**[WEB:2] OpenAI Codex CLI**, per OpenAI's own developer docs, implements a genuinely two-layer model: **sandbox policy** (what a command can technically touch: filesystem paths as read/write/deny, network destinations) is fully orthogonal to **approval policy** (when the user must confirm). Three built-in permission profiles ship out of the box — `:read-only`, `:workspace` (write inside active workspace roots + temp), `:danger-full-access` — and organizations can define custom named profiles with precise per-path rules (e.g., deny all `.env` files while the workspace root stays writable), enforced via real OS primitives: Seatbelt on macOS, `bubblewrap` on Linux/WSL2, a native sandbox on Windows [WEB:2,3]. Codex also ships a `request_permissions` tool letting the *model itself* formally request elevated access mid-session rather than silently failing [WEB:4].

**[WEB:5,6] Cursor** deliberately moved away from regex/allowlist gating (their own writeup calls out that "seemingly benign commands like `find`" gave agents more effective permission than intended) toward Seatbelt/Landlock-based sandboxing, reporting sandboxed agents stop 40% less often than unsandboxed ones. Cursor 3.6's "Auto-review" mode adds a three-stage filter (allowlist → sandbox → risk-classifier subagent) but is explicit that the classifier is "best-effort convenience, not a security boundary" [WEB:7] — i.e., even Cursor doesn't treat classification as a substitute for the sandbox underneath it.

**[WEB:8,9] GitHub Copilot** is the most directly relevant cautionary parallel to LiteIDE: as of a March 2026 third-party security analysis, **Copilot CLI had no OS-level sandboxing at all** — "all file and network operations run with full user privileges," relying entirely on an application-level permission model (trusted directories, per-tool approval, allow/deny lists, hooks) [WEB:9]. GitHub shipped local + cloud sandboxes into public preview on **June 2, 2026**, built on Microsoft MXC technology, specifically to close this gap — their own changelog frames it as necessary infrastructure "as Copilot takes more actions" [WEB:8]. **This is effectively LiteIDE's current position, several months behind where GitHub started from and has since moved past.**

**[WEB:10,11,12] Cline** — the architecturally closest comparator (VS Code-embedded, multi-provider, no forced cloud dependency) — does **not** appear to implement OS-level sandboxing either, based on available documentation; it relies on a granular **permission/auto-approve system**: separate toggles for read-only file ops, file writes, terminal commands, browser actions, and MCP tool calls, each independently switchable, plus a documented "YOLO mode" that disables all of them at once with an explicit in-product warning [WEB:11]. Community guidance is blunt: *"Auto-approve toggles are a foot-gun, not a feature... treat them like a permission system, not preferences"* [WEB:12]. Notably, even Cline's own auto-approve system has had real bugs — a filed issue documents MCP tool calls executing without approval even when the per-tool auto-approve checkbox was unchecked [WEB:13], underscoring that permission logic implemented purely in application code (not enforced by the OS) is exactly as reliable as its own bug surface, which is the same structural risk LiteIDE's regex gate carries.

**[WEB:14] Devin** runs entirely inside Cognition's own cloud sandbox (shell, editor, browser) — the isolation question doesn't apply the same way since code execution never touches the user's machine at all.

**Synthesis:** the field has split into two legitimate strategies — (a) real OS-level sandboxing (Claude Code, Codex CLI, Cursor, now Copilot) or (b) fully cloud-hosted execution where the isolation question is moot (Devin). Nobody still shipping local execution without (a) is treating it as a stable end-state — Copilot's public preview launch in June 2026 is direct evidence that "granular application-level permissions, no OS sandbox" is being actively phased out industry-wide, not treated as sufficient. LiteIDE is currently on the losing side of that consolidation, and its regex-only version is a *weaker* instance of the pattern (b)-without-sandbox tools use, since Cline/pre-sandbox-Copilot at least offer granular per-category toggles rather than a fixed hardcoded pattern list.

---

## 3. Editing strategy

**[CODE]** One strategy: exact `old_str`/`new_str` replace, ambiguity-rejected (`agent:editFile`).

**[WEB:15,16] Aider** auto-selects among whole-file, `diff` (search/replace blocks), and `udiff` (universal diff) formats per model capability, with an `--architect` mode where a reasoning model proposes changes and a second, format-specialized model performs the edit — built explicitly because weaker models struggle to reliably follow any single edit-format's instructions.

**Judgment, unchanged from v2:** LiteIDE's single format is defensible and close in spirit to Aider's `diff` mode; the actual gap is graceful degradation for weak/local models, not the format itself.

---

## 4. Context & retrieval

**[CODE]** TF-IDF-style keyword scoring, 2,000-file cap, no compaction of the in-memory `agentHistory`.

**[WEB:1] Claude Code's official docs (checked this round)** describe **automatic compaction**: when the context window approaches its limit, the SDK summarizes older history automatically, preserving recent exchanges and key decisions, emitting a `compact_boundary` event — and note explicitly that persistent rules belong in a project memory file (CLAUDE.md) rather than the initial prompt, because compaction can lose early-conversation specifics. This directly confirms the v2 concern about LiteIDE's unbounded `agentHistory`: it's a solved problem elsewhere, not a hypothetical risk.

**[WEB:15,17] Aider's** repo map (tree-sitter parsing → reference graph → PageRank ranking → token-budgeted output) remains the standout approach for large-codebase context without dumping full file contents.

---

## 5. Verification / test-after-edit

**[CODE]** Nothing automatic.

**[WEB:15] Aider** runs a configured test/lint command automatically after edits and feeds failures back for an automatic fix attempt — unchanged from v2, still the clearest actionable model to copy.

---

## 6. MCP / extensibility

**[CODE]** Hardcoded tool list, no MCP.

**Updated standing:** MCP support is now essentially universal among the widely-used comparators — Cursor [WEB:6], Codex CLI (`[mcp_servers.*]` config, shared between CLI and IDE extension) [WEB:3], Copilot CLI (built-in GitHub MCP server, `/mcp add`) [WEB:18], and Cline (uncapped MCP tool count, built-in marketplace, MCP-native since 2024) [WEB:11,19] all ship it as first-class. **Aider remains the one major exception** — still unshipped as of v0.86.x, open RFC only [WEB:15]. LiteIDE's lack of MCP now puts it behind six of seven comparators, ahead of only Aider.

---

## 7. Multi-agent / subagents

**[CODE]** `spawn_subagents`: 4 tasks max, `Promise.all` true parallel, 8-step cap, explicitly non-recursive, no cancellation propagation.

**[WEB:6] Cursor** subagents moved from synchronous to asynchronous, and from non-recursive to **recursive** — but only after building explicit cancellation propagation (a documented changelog fix: "stopping the parent agent will always stop the child subagents").

**[WEB:11] Cline** supports a coordinator-agent-delegates-to-specialists team pattern with state persisting across sessions, plus scheduled/cron-triggered autonomous runs — a materially more advanced orchestration model than LiteIDE's fixed fan-out, though not directly comparable since Cline's is opt-in CLI functionality, not the default IDE experience.

**Unchanged synthesis from v2:** LiteIDE's conservative, non-recursive design remains defensible; add cancellation before adding recursion, per Cursor's own sequencing.

---

## 8. Updated feature matrix (7 comparators, all re-verified this session)

Legend: ✅ solid/documented · ⚠️ partial/basic · ❌ absent · — not applicable

| Feature | LiteIDE | Claude Code | Cursor | Codex CLI | Copilot | Aider | Cline | Devin |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| OS-level sandbox | ❌ | ✅ [1] | ✅ [5,6] | ✅ [2,3] | ✅ (Jun 2026) [8] | ❌ [15] | ❌ [11] | ✅ (cloud) [14] |
| Granular permission modes | ⚠️ binary | ✅ 6 modes [1] | ✅ [7] | ✅ 3 profiles+custom [2] | ⚠️ app-level only [9] | ❌ | ✅ per-category toggles [11] | — |
| Model-requestable permission escalation | ❌ | ⚠️ (via hooks) [1] | ⚠️ | ✅ `request_permissions` [4] | — | — | — | — |
| Context compaction | ❌ | ✅ automatic [1] | ⚠️ | ⚠️ | ⚠️ | ✅ (repo map avoids need) [17] | ❌ documented gap [11] | ⚠️ |
| Repo-map/symbol-aware context | ❌ | ❌ (deliberate, grep-based) | — | — | — | ✅ tree-sitter+PageRank [17] | — | — |
| Multiple edit-format strategies | ❌ | — | ⚠️ | — | — | ✅ [15,16] | — | — |
| Auto test-after-edit | ❌ | ⚠️ | ⚠️ | — | ⚠️ (ephemeral CI env) [18] | ✅ [15] | ⚠️ | ✅ implied [14] |
| MCP client | ❌ | ✅ [1] | ✅ (40-tool cap) [6] | ✅ [3] | ✅ [18] | ❌ [15] | ✅ (uncapped) [11] | — |
| Recursive subagents | ❌ | ✅ (via Task tool) [1] | ✅ (w/ cancellation) [6] | — | ⚠️ | ❌ | ✅ team pattern [11] | ⚠️ async sessions |
| Cancellation propagation (parent→child) | ❌ | ✅ [1] | ✅ [6] | — | — | — | — | — |
| Cost/budget cap | ❌ | ✅ `max_budget_usd` [1] | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ (spend limits) [11] | ✅ ACU-based [14] |
| Local/offline model support | ✅ | ❌ | ❌ | ⚠️ (Ollama provider id reserved) [4] | ❌ | ✅ [15] | ✅ [11] | ❌ [14] |
| Git auto-commit safety net | ✅ | ⚠️ | ⚠️ | ⚠️ (patch-workflow preferred) [3] | ✅ (PR-based) | ✅ [15] | ⚠️ | ✅ (PR-based) |
| OS-keychain credential storage | ✅ | N/A | ⚠️ | ✅ (configurable) [4] | ⚠️ | ⚠️ | — | N/A |

---

## 9. Dependency / packaging audit — `package.json`

**[CODE/WEB, cross-checked]**

- **Electron `^42.5.0`:** genuinely current. Electron 42 shipped **May 7, 2026** [WEB:20]; as of early July 2026 the officially supported window is the latest three majors (43, 42, 41) [WEB:21], and the `^42.5.0` semver range would resolve to the latest 42.x patch (42.6.1 existed by July 7, 2026, per the project's own release list) [WEB:22]. **This is not a stale dependency** — it's a reasonable, actively-patched choice, and Electron 42 specifically backported fixes for ten CVEs in its point releases [WEB:22,23]. No action needed here; this was worth checking but the earlier hypothesis of staleness doesn't hold.
- **`node-pty ^1.1.0`, `monaco-editor ^0.45.0`, `xterm ^5.3.0`:** **not independently re-verified against current upstream releases this session** — I did not repeat the Electron-style version-currency check for these three. Recommend running `npm outdated` directly rather than trusting an unverified claim here; this is a 10-minute task, not a research gap worth extrapolating on.
- **`allowScripts` block:** pins `electron-winstaller@5.4.0`, `nslog@3.2.0`, `node-gyp@12.4.0` as explicitly trusted for script execution — reasonable practice given Electron 42's own postinstall-script security note [WEB:20] (Electron itself moved away from postinstall-script binary downloads specifically because of npm supply-chain attacks using that vector) — your existing `--ignore-scripts` + explicit `npm approve-scripts` setup flow in the README is actually already aligned with that same industry direction, which is worth knowing is a genuine strength, not just adequate.
- **Test suite (`npm test` → `wiring.test.js`, `backend.test.js`, `ai-providers.test.js`, `terminal.test.js`):** referenced in `package.json` but the test files themselves were not uploaded, so the README's "pass 32/fail 0" claim remains **unverified** — I have not run it and cannot confirm test coverage or pass rate.

---

## 10. Final prioritized backlog, with rough effort sizing

Sizing is rough engineering-days for one developer familiar with the codebase, not a formal estimate.

**Critical:**
1. **OS-level sandboxing for `agent:runCommand`** — largest single gap, confirmed against all 7 comparators. *Effort: large (1–3 weeks)* — this is a real platform-specific undertaking (Seatbelt on macOS, bubblewrap/Landlock on Linux, a Windows equivalent), not a config change. Consider scoping v1 to "restrict working directory + strip env" as an interim step before full syscall-level sandboxing.
2. **Cancellation** (main loop + subagent propagation if recursion is ever added) — *Effort: small–medium (2–4 days)*.
3. **Cost/token budget cap**, matching the `max_budget_usd` pattern Claude Code exposes — *Effort: small (1–2 days)*, you already have per-call cost data available from at least the Anthropic/OpenAI response metadata.

**High:**
4. Test-after-edit orchestration, Aider-style — *Effort: small–medium (2–3 days)*, no new low-level tools needed.
5. Context compaction for `agentHistory` — *Effort: medium (3–5 days)*, needs a token-estimate function plus a summarization call.
6. Feed file content back into `edit_file`'s failure result — *Effort: trivial (a few hours)*.

**Medium:**
7. Tiered/granular permission toggles (per-category, Cline-style) rather than binary regex — *Effort: medium (3–5 days)* including UI.
8. Aider-style `architect` fallback for weak/local models — *Effort: medium (3–5 days)*.
9. Surface the 2,000-file RAG cap; consider a real ripgrep-backed exact-search tool alongside fuzzy RAG — *Effort: small (1–2 days)* for the cap warning, *medium* for the ripgrep tool.

**Lower priority / longer-term:**
10. Minimal MCP client (stdio, tools primitive only) — *Effort: large (1–2 weeks)*, but puts you ahead of Aider and roughly at parity with the other six.
11. Recursive subagents — only after #2 is solid — *Effort: medium (3–5 days)*.
12. Run `npm outdated` and confirm `node-pty`/`monaco-editor`/`xterm` currency — *Effort: trivial (under an hour)*, just hasn't been done yet.
13. Actually run your `npm test` suite and confirm the README's pass/fail claim — *Effort: trivial*, just requires the test files, which weren't part of this review.

---

## References

[^1]: Anthropic, *How the agent loop works* — Claude Code Docs (fetched directly, this session), https://code.claude.com/docs/en/agent-sdk/agent-loop
[^2]: OpenAI, *Sandbox* — ChatGPT/Codex Developer Docs, https://developers.openai.com/codex/concepts/sandboxing
[^3]: OpenAI, *Config basics* — Codex Developer Docs, https://developers.openai.com/codex/config-basic
[^4]: OpenAI, *Permissions* — Codex Developer Docs, https://developers.openai.com/codex/permissions ; *Developer commands*, https://developers.openai.com/codex/cli/reference
[^5]: Cursor, *Implementing a secure sandbox for local agents*, https://cursor.com/blog/agent-sandboxing
[^6]: Cursor, *Plugins, Sandbox Access Controls, and Async Subagents* (changelog 2.5), https://cursor.com/changelog/2-5
[^7]: Totalum Blog, *Cursor Auto-review Run Mode in 2026*, https://www.totalum.app/blog/cursor-auto-review-totalum
[^8]: GitHub Changelog, *Cloud and local sandboxes for GitHub Copilot now in public preview*, https://github.blog/changelog/2026-06-02-cloud-and-local-sandboxes-for-github-copilot-now-in-public-preview/
[^9]: Agent Safehouse, *GitHub Copilot CLI — Sandbox Analysis Report*, https://agent-safehouse.dev/docs/agent-investigations/copilot-cli
[^10]: DeployHQ, *Cline for VS Code: Free AI Coding Agent — 2026 Setup Guide*, https://www.deployhq.com/guides/cline
[^11]: GitHub, *cline/cline* repository README, https://github.com/cline/cline
[^12]: SurePrompts, *Cline Prompting Guide*, https://sureprompts.com/blog/cline-prompting-guide
[^13]: GitHub Issue, *Cline executes MCP server commands without asking for approval*, https://github.com/cline/cline/issues/9357
[^14]: Augment Code, *Devin vs Codex Desktop App (2026)*, https://www.augmentcode.com/tools/devin-vs-codex-desktop-app ; 4Geeks, *Devin — AI Coding Agent Features & Capabilities*, https://agents.4geeks.com/agent/devin-ai
[^15]: DeployHQ, *How to Use Aider in 2026*, https://www.deployhq.com/guides/aider
[^16]: Aider, *File editing problems*, https://aider.chat/docs/troubleshooting/edit-errors.html
[^17]: DeepWiki, *Repository Mapping System — Aider-AI/aider*, https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping-system ; Aider, *Repository map*, https://aider.chat/docs/repomap.html
[^18]: GitHub Docs, *About GitHub Copilot cloud agent*, https://docs.github.com/copilot/concepts/agents/coding-agent/about-coding-agent
[^19]: EvoMap Blog, *Cline MCP Servers: Setup Guide & Best Extensions (2026)*, https://evomap.ai/blog/cline-mcp-servers-setup-guide-2026
[^20]: Electron, *Electron 42* release blog, https://www.electronjs.org/blog/electron-42-0
[^21]: endoflife.date, *Electron*, https://endoflife.date/electron
[^22]: GitHub, *electron/electron* releases, https://github.com/electron/electron/releases ; *v42.0.0 release notes*, https://releases.electronjs.org/release/v42.0.0
[^23]: GitHub, *electron/electron v42.4.0 release notes*, https://github.com/electron/electron/releases/tag/v42.4.0

**Not used / deliberately excluded (unchanged from v2):** one Devin-focused source describing a "Planner/Coder/Critic model swarm" with a literal placeholder URL was excluded as unreliable/speculative.

**Explicitly unverified, stated plainly:** your `npm test` pass/fail claim, and current-version status of `node-pty`/`monaco-editor`/`xterm`. Both are cheap to check yourself and shouldn't be taken as confirmed by this report.
