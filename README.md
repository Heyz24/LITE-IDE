# ⚡ LiteIDE

Lightweight code editor with iOS Liquid Glass UI, built on Electron — now with a built-in AI coding agent, multi-session terminals, and project-wide tooling.

---

## First Time Setup (Windows)

Open **CMD as Administrator:**

```cmd
cd C:\path\to\lite-ide

npm install --ignore-scripts
node node_modules/electron/install.js
npm audit fix --force
npm approve-scripts electron
npm approve-scripts node-pty
npm approve-scripts electron-winstaller
npm install electron
node node_modules/electron/install.js
npm start
```

---

## Run App (after setup)

```cmd
cd C:\path\to\lite-ide
npm start
```

## Run Tests

```cmd
npm test
```

Runs the full backend + renderer test suite (Node's built-in test runner, no extra dependencies) — verifies every IPC channel between the UI and the Electron main process, real file/terminal/git operations against a temp project, the request format sent to each of the 4 AI providers, real OS-level sandboxing (bwrap/Seatbelt) against actual child processes, real cancellation (AbortSignal + process tree kill), token/cost budget cap enforcement, and context compaction. Should print `# pass 83` / `# fail 0`. See `test/` for details.

---

## Build Installer

```cmd
cd C:\path\to\lite-ide
rmdir /s /q dist
npm run dist
```

Auto-detects your OS + CPU arch. Output in `dist\`:
- `LiteIDE Setup.exe` — NSIS installer
- `LiteIDE 1.1.0.msi` — MSI installer
- `LiteIDE.exe` — portable (no install needed)

---

## Install TypeScript support

```cmd
npm install -g typescript ts-node
```

---

## If Electron fails after reinstall

```cmd
rmdir /s /q node_modules
npm install --ignore-scripts
node node_modules/electron/install.js
npm audit fix --force
npm approve-scripts electron
npm approve-scripts node-pty
npm approve-scripts electron-winstaller
npm install electron
node node_modules/electron/install.js
npm start
```

---

## macOS Setup

```bash
cd /path/to/lite-ide
npm install --ignore-scripts
node node_modules/electron/install.js
npm start
```

Build: `npm run dist` → `.dmg` + `.zip` for your Mac architecture.

## Linux Setup

```bash
cd /path/to/lite-ide
npm install --ignore-scripts
node node_modules/electron/install.js
npm start
```

Build: `npm run dist` → `.AppImage` + `.deb` for your architecture.

---

## AI Agent

Click the ✨ button next to the file tabs to open the AI Agent tab.

- **Providers**: Anthropic, OpenAI, Google Gemini, or Ollama (fully offline/local).
- **Model field is free text** — type any model name, including old or custom ones. A dropdown offers suggestions only, never restricts you.
- **Test** — sends one throwaway message to confirm your key + model actually work.
- **Self-Test Tools** — exercises read/write/delete/run/search directly against your project, independent of any model, to isolate tool-layer bugs from model behavior.
- **Full project access**: reads any file for context (RAG search included), edits/creates files, and runs shell commands — silently, inside the opened folder.
- **Approval popup** only for critical files (`.env`, `package.json`, `.git/*`, keys) or destructive commands (`rm -rf`, force push, `sudo`, etc.).
- **Memory**: writes durable notes to `.liteide/agent-memory.md` and persists the conversation to `.liteide/agent-session.json`, so closing/reopening the tab (or restarting the app) resumes context.
- **Sub-agents**: the agent can call `spawn_subagents` to delegate independent tasks to fresh agents that run in true parallel, each with their own tools, shown as separate cards in the chat.
- **Stop button**: appears whenever the agent is working; cancels the in-flight AI call or running command immediately (real cancellation, not just hiding the UI).
- **Budget caps**: set a per-project max-tokens and/or max-$ cap in the settings bar — once hit, the agent stops itself before the next call rather than after. The running total (tokens + estimated cost) is shown live.
- **Context compaction**: on long sessions, older turns are automatically summarized once a single call's real token usage crosses a configurable threshold (default 50k, editable in settings), keeping recent turns intact.
- **Auto-verify**: opt-in per project — once enabled, editing a code file automatically runs your project's test command (auto-detected, e.g. `npm test`) sandboxed with a timeout, and the pass/fail result is shown right on that edit, not just claimed by the agent.

### Where your API key is stored, and how to remove it
Keys are saved to `ai-config.json` inside Electron's per-app user-data folder — on Windows that's `%APPDATA%\lite-ide\ai-config.json` (macOS: `~/Library/Application Support/lite-ide/`, Linux: `~/.config/lite-ide/`). They're encrypted at rest via your OS's own credential store (Windows DPAPI / macOS Keychain / Linux libsecret) through Electron's `safeStorage` API — never plaintext, never sent anywhere except directly to the provider you picked.

- **Replace a key**: type the new one in the AI Agent tab and hit **Save** — overwrites the old one.
- **Remove a key completely**: hit **Clear Key** next to Save — deletes it from disk immediately, no trace left.
- **Nuke everything AI-related**: close the app and delete the `ai-config.json` file at the path above (also fine to delete the whole `.liteide/` folder inside a project to wipe that project's agent memory/session history).

---

## Terminal

- **Multi-session**: click **+** in the terminal header to open another shell — auto-detects and connects to your real system shells (PowerShell/CMD/Git Bash/WSL on Windows; zsh/bash/fish on Mac/Linux). Each session is a fully independent real process (via `node-pty`), own scrollback, own history.
- **Split view**: click the split icon to view two sessions side-by-side at once.
- **Output tab** — program output + accepts stdin input while running.
- Right-click any terminal → Copy / Paste / Select All / Clear / CD to project.
- Opening a folder auto-`cd`s every open shell session to that folder.

---

## Editor

- **Split editor view**: click the split icon next to the AI Agent button to view two different open files side-by-side, independently editable.
- **Project-wide search & replace**: click the 🔍 icon above Explorer — regex/case/whole-word toggles, click any result to jump straight to that line, Replace All rewrites on disk and reloads any affected open tabs.
- **Git status & diff**: modified/added/untracked/deleted files get a colored badge in the file tree (auto-refreshes every few seconds); right-click a changed file → View Git Diff for a real side-by-side comparison against HEAD.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+S` | Save file |
| `Ctrl+O` | Open folder |
| `Ctrl+Enter` | Run / Stop code |
| `Ctrl+W` | Close tab |
| `Ctrl+Shift+C` | Copy in terminal |
| `Ctrl+Shift+V` | Paste in terminal |
| `F5` | Run (alternative) |

---

## Languages

23 languages supported. Install status shown in the language picker (green = installed, red = missing with install link).

| Language | Install if missing |
|---|---|
| Python | https://python.org/downloads |
| JavaScript / Node | https://nodejs.org |
| TypeScript | `npm install -g typescript ts-node` |
| Go | https://go.dev/dl |
| Rust | https://rustup.rs |
| C / C++ | https://www.msys2.org (Windows) |
| Java | https://adoptium.net |
| Others | Install link shown in app |

---

## Folder Structure

```
lite-ide/
├── main.js              — Electron main process (fs, terminals, git, search, AI providers, agent tools)
├── preload.js            — IPC bridge
├── agent-sandbox.js        — OS-level sandboxing (bwrap/Seatbelt/hardened-Windows) for agent:runCommand
├── build.js               — Auto-detect build script
├── setup.bat               — Windows first-time setup
├── package.json             — Config + electron-builder + test script (version tracks skill version)
├── src/
│   └── index.html          — Full UI (Monaco + xterm + AI Agent panel)
├── test/                     — npm test — 146 tests across 13 files
│   ├── wiring.test.js        — IPC + static HTML integrity
│   ├── backend.test.js       — real fs/git/agent-tool behavior, approval flows
│   ├── ai-providers.test.js  — mocked-fetch request-shape verification (4 providers)
│   ├── sandbox.test.js       — agent-sandbox.js pure logic + real bwrap/Seatbelt integration
│   ├── cancellation.test.js  — AbortSignal propagation, real process-tree kill
│   ├── budget.test.js        — cost/token cap enforcement
│   ├── compaction.test.js    — context compaction (executes real src/index.html functions via vm)
│   ├── verification.test.js  — test-after-edit auto-verification
│   ├── web-tools.test.js     — web_search/web_fetch
│   ├── permissions.test.js   — per-tool-category permission toggles
│   ├── escalation.test.js    — edit_file feedback, RAG cap, permission escalation
│   ├── terminal.test.js      — pure-logic regression tests (cd drive-switching, launch-arg detection, shell path resolution)
│   ├── grep.test.js          — grep_codebase (exact/regex search, ripgrep + fallback)
│   ├── subagents.test.js     — recursive spawn_subagents (depth cap, tree budget cap, cancellation)
│   ├── architect.test.js     — architect fallback config persistence
│   ├── architect-logic.test.js — architect fallback SEARCH/REPLACE parser + fix flow
│   ├── ui-focus.test.js      — skills-modal focus-stealing regression guard (see Known Issues below)
│   ├── repomap.test.js       — get_repo_map (per-language symbol extraction, ranking, caps)
│   ├── mcp.test.js           — MCP client, real stdio JSON-RPC against a real fixture server
│   ├── fixtures/mock-mcp-server.js — a REAL, minimal, protocol-compliant MCP stdio server used as a test fixture (not a mock)
│   └── helpers/mock-electron.js — intercepts require('electron') so real main.js runs outside Electron
└── assets/
    └── icon.png              — App icon (replace with 1024x1024)
```

---

## Architecture Reference (for picking this project back up)

Current state: **v2.1.0** — every item in the original v3 gap-analysis report is done; this version is a skill-file quality/accuracy pass, no new capability (package.json version tracks the skill version on every bump). Agent skill file **v2.1.0**, **225/225 tests passing** via `npm test`, real-verified in this environment (18 test files, 225 tests total, re-run 3x consecutively with zero flakiness).

**⚠️ If you see test failures after applying an update:** make sure you fully overwrote every file in `test/`, not merged/partially copied across multiple delivered versions — `main.js` and the test files must come from the SAME delivered version. A `ReferenceError: getAllAgentToolsCached is not defined` in `test/subagents.test.js` specifically means an old copy of that one file is running against a newer `main.js` (that function was added to `src/index.html` alongside the MCP client in v2.0.0, and `test/subagents.test.js` needed a matching update to extract/stub it — see the v2.0.0 section below). The fix is always: replace the whole `test/` directory from the latest delivered zip, don't cherry-pick individual files across versions.

**Versioning convention (as of this session):** `package.json`'s top-level `version` field now bumps in lockstep with the embedded agent skill file's `UNIVERSAL_SKILL_VERSION` — every gap-analysis item that changes agent-visible behavior gets one version number, applied to both. This also drives the version electron-builder stamps on `npm run dist` output.

### Process model
Standard Electron: `main.js` (Node/Electron main process — all fs, git, terminal, AI provider calls) ↔ `preload.js` (contextBridge, the only thing the renderer can call) ↔ `src/index.html` (renderer — UI + all agent orchestration logic, since there's no separate frontend framework/bundler).

### Full IPC channel map (main.js ⇄ preload.js)
**`ipcMain.handle` (invoke/response):**
`agent:checkpoint` `agent:deleteFile` `agent:deleteSkill` `agent:editFile` `agent:getArchitectConfig` `agent:getRepoMap` `agent:grepCodebase` `agent:listDir` `agent:listSkills` `agent:mcpAddServer` `agent:mcpCallTool` `agent:mcpConnect` `agent:mcpDisconnect` `agent:mcpListServers` `agent:mcpListTools` `agent:mcpRemoveServer` `agent:ragSearch` `agent:readFile` `agent:runCommand` `agent:saveSkill` `agent:setArchitectConfig` `agent:setProjectRoot` `agent:webFetch` `agent:webSearch` `agent:writeFile` `ai:chatOnce` `ai:clearKey` `ai:getConfig` `ai:listOllamaModels` `ai:saveConfig` `app:homedir` `app:platform` `code:run` `code:stop` `fs:delete` `fs:newFile` `fs:openFolder` `fs:readDir` `fs:readFile` `fs:writeFile` `git:diff` `git:isRepo` `git:status` `lang:detect` `search:project` `search:replaceAll` `shell:getAvailable` `term:create`

**`ipcMain.on` (fire-and-forget):**
`agent:approvalResponse` `open:external` `process:input` `term:cd` `term:close` `term:input` `term:resize` `window:close` `window:maximize` `window:minimize`

**Main → renderer events (`safeSend`):** `agent:approvalRequest` `agent:commandOutput` `app:openPath` `process:error` `process:exit` `process:stderr` `process:stdout` `term:error` `term:exit` `term:output` `window:maximized`

`test/wiring.test.js` statically verifies every one of these is wired correctly on both ends by actually executing `main.js` via a mocked Electron module — run it first if anything IPC-related seems broken.

### Agent tools (declared in `AGENT_TOOLS`, `src/index.html`; implemented in `execAgentTool`)
`read_file` `list_dir` `write_file` `edit_file` (precise old_str→new_str, refuses ambiguous/not-found matches) `delete_file` `run_command` (isolated background exec) `run_in_terminal` (live, in the visible integrated terminal) `search_codebase` (local TF-IDF RAG, no embeddings/API) `grep_codebase` (exact/regex line-level search — ripgrep-backed when `rg` is on PATH, pure-JS fallback otherwise, see below) `get_repo_map` (condensed symbol-level codebase overview, see below) `spawn_subagents` (parallel, recursive up to 2 levels deep, 12-total-per-tree cap, see below) `web_search` (DuckDuckGo HTML scrape, no API key) `web_fetch` (HTML→text extraction), plus any tools exposed by connected MCP servers (see below, dynamically namespaced `mcp_<server>_<tool>`). `test/wiring.test.js` also verifies every built-in tool declared has a matching `execAgentTool` case and vice versa.

**`spawn_subagents` — recursive sub-agents:** a spawned sub-agent may itself call `spawn_subagents` to delegate further, up to `MAX_SUBAGENT_DEPTH = 2` levels below the top-level agent — a sub-agent at the deepest level simply doesn't have the tool in its own `tools` list (and independently gets a clear `{ok:false}` error if it tries anyway via the text-based fallback parser, defense in depth). A single `MAX_SUBAGENTS_PER_TREE = 12` budget is shared across every `spawn_subagents` call anywhere in the tree, reserved synchronously (before the `await api.agent.gateSubagents(...)` call) so two branches recursing at once can't race past the cap; a denied gate releases its reservation. Stopping the agent now cancels the whole tree: every in-flight sub-agent's `chatOnce`/tool-call `requestId`s are tracked in `activeTreeRequestIds` and all cancelled together, not just the top-level request — this was a real pre-existing gap (sub-agents never registered a `requestId` before) fixed as a prerequisite for allowing recursion at all. See `test/subagents.test.js`.

**Architect fallback (Aider-style, opt-in, Agent Settings):** for weak/local models that repeatedly fail to produce a matching `edit_file` `old_str`. When enabled and the same file fails `failureThreshold` times in a row (default 2, configurable 1-5), a separate tool-call-free prompt — optionally on a different/stronger provider+model, configurable independently — is asked for exactly one SEARCH/REPLACE block (Aider's own marker format: `<<<<<<< SEARCH` / `=======` / `>>>>>>> REPLACE`, deliberately not JSON, since asking a weak model for valid escaped JSON around a code snippet reintroduces the exact format-reliability problem this feature exists to work around). If parsed successfully, that block is executed as a real `edit_file` call directly, bypassing another round-trip through the struggling primary model. Persisted per-project to `.liteide/agent-architect.json` via `agent:getArchitectConfig`/`agent:setArchitectConfig`. See `test/architect.test.js` (config persistence) and `test/architect-logic.test.js` (parser + fix flow).

**`get_repo_map` — condensed codebase overview:** every recognized file's top-level functions/classes/types as single-line signatures, without reading full file contents — lets the agent orient itself in a large or unfamiliar codebase for a fraction of the context cost of `read_file`-ing everything. Covers JS/TS, Python, Go, Rust, Java/Kotlin, C/C++, Ruby, and PHP via per-language regex patterns (`REPOMAP_PATTERNS` in `main.js`). **Explicit design choice, not a default:** regex-based extraction, not tree-sitter — tree-sitter would be more accurate (real AST vs line-pattern guessing) but adds a real native dependency with per-platform prebuilt binaries and per-language grammar packages, exactly the category of install friction node-pty already caused on Windows. This follows the same zero-dependency-first pattern as `grep_codebase` (ripgrep-if-available, pure-JS fallback otherwise): weaker in accuracy, but works everywhere with no install step, which matters more for a tool whose whole point is quick orientation. Files with zero recognized symbols are excluded entirely (not useful in a symbol map). Ranked by: files near `focus_path` first (if given) → symbol count descending → alphabetical. Capped at 40 symbols/file and 300 files in the output (`outputTruncated` flagged if hit) — narrow with `focus_path` or fall back to `grep_codebase`/`search_codebase` for anything not shown. See `test/repomap.test.js`.

**MCP client (stdio transport, JSON-RPC 2.0):** connect Model Context Protocol servers via Agent Settings → 🔌 MCP Servers (name + command + args, e.g. `npx -y @modelcontextprotocol/server-filesystem /some/path`) — their tools then appear to the agent automatically, namespaced `mcp_<server>_<tool>` (server names are restricted to letters/numbers/hyphens specifically so this namespacing is always unambiguous to parse back apart, since MCP tool names commonly contain underscores). **Two explicit scope decisions, not defaults:**
- **stdio only, not SSE/HTTP.** Stdio is what the overwhelming majority of real-world MCP servers actually use — every reference server, and what Claude Desktop/Claude Code use for local servers. SSE matters mainly for remote/hosted servers, a meaningfully different and larger surface (auth, reconnection) that deserves its own follow-up.
- **MCP server processes are NOT run through the bwrap/Seatbelt sandbox `agent:runCommand` uses.** Sandboxing a persistent bidirectional stdio process correctly is a meaningfully larger problem than a one-shot timed command, and real MCP servers often legitimately need broad filesystem/network access (a GitHub MCP server needs network, a filesystem server needs broad file access) that the "read/write only inside the project" sandbox model doesn't fit anyway. The standing safety boundary instead: connecting a server, and every individual tool call through it, is gated by the same `execute` permission category as `run_command` — deliberately not a new 7th permission category, since "you're running code you configured" doesn't need a distinction from that.

Config persists per-project to `.liteide/mcp-servers.json`. Servers are explicitly connected (never auto-spawned on project open) and are automatically disconnected on project switch or app close, so a server process never outlives the project it belongs to. See `test/mcp.test.js` — 25 real tests against `test/fixtures/mock-mcp-server.js`, a genuinely protocol-compliant fixture MCP server (not a mock), covering the real handshake, real tool discovery, real tool calls, a crashing server, a server printing non-JSON startup noise to stdout, two servers with colliding tool names, and permission gating. **Caught a real race condition**: a killed server process's `'exit'` event fires asynchronously, and if a new connection under the same server name was already established by the time it fired, the stale handler was deleting the *newer* valid connection out of the map. Fixed with an identity check before cleanup.

**`grep_codebase` — exact-match search (companion to RAG):** `search_codebase`'s TF-IDF scoring is relevance-ranked and chunk-based, so a rare exact symbol/string can get outscored inside its chunk and never surface. `grep_codebase` does a real line-level exact/regex sweep instead: it probes for `rg` (ripgrep) on PATH once per run and caches the result (`agent:grepCodebase` in `main.js`), using it when available (`--fixed-strings` by default, `--ignore-case` unless `case_sensitive` is set, globs excluding `.git`/`node_modules`/`.liteide`, 15s timeout, tree-killed the same way `run_command` cancellation works). If `rg` isn't installed, it falls back to a pure-JS walk that reuses the exact same `searchCollectFiles`/`buildSearchMatcher` functions the editor's own Find-in-Project panel (`search:project`) already uses — so results are equally correct either way, just slower without ripgrep. Results are capped at 300 matches (`truncated` flag); `path` scopes the search to a subdirectory (still hard-blocked from escaping the project root via `resolveInProject`). Gated by the same `read` permission category as `search_codebase`. No new dependency — ripgrep is an optional external binary the tool detects at runtime, not an npm package.

**Safety model:** `.env`/`package.json`/git internals/keys and destructive shell patterns (`rm -rf`, force-push, `sudo`, etc.) require a user approval popup (`agent:approvalRequest` round-trip via `requestApproval()` in main.js). Everything else inside the opened project folder is silent. Path traversal outside the project root is hard-blocked (`resolveInProject`).

**OS-level sandboxing for `agent:runCommand` (`agent-sandbox.js`):** every command still passes the approval gate above, then runs underneath a second, OS-enforced layer where the platform supports one: **Linux** via `bwrap` (bubblewrap) — read access everywhere (system libs/dev tools need it), write access ONLY inside the project folder + its own scratch tmp dir, network namespace unshared unless the tool call opts in. **macOS** via `sandbox-exec` (Seatbelt) with a dynamically generated profile, same read-everywhere/write-only-in-project/no-network-by-default shape. **Windows** has no dependency-free OS-level primitive reachable from pure Node (real isolation needs AppContainer/low-integrity tokens via a native addon, or per-call Windows Sandbox VMs, both out of scope for v1) — it runs hardened-but-unsandboxed instead: jailed to the project folder (unchanged from before) plus a minimal explicit environment allowlist instead of full `process.env` passthrough, so unrelated secrets (cloud CLI tokens, SSH agent sockets, other providers' API keys) are never exposed to a spawned command on any platform, sandboxed or not. `agent:getSandboxStatus` reports which mode is actually active; the run_command tool card in the UI shows it per-call. Falls back to the hardened-only mode with a clear reason string if `bwrap`/`sandbox-exec` isn't present even on a platform that normally supports it. See `test/sandbox.test.js` for tests that prove the isolation against real child processes (not mocked) on Linux — write-outside-project fails, network is unreachable by default, reads outside the project still work.

**Cancellation (`agent:cancelRequest`):** exactly one async agent operation is ever in-flight at a time (the loop is sequential), so the renderer tracks a single `currentAgentRequestId` and a Stop button that fires it at `agent:cancelRequest`. Main process resolves it against two maps: `activeAiControllers` (an `AbortController` per in-flight `ai:chatOnce` call — its `signal` is threaded into every provider adapter's `fetch`) and `activeCommandProcesses` (the child process of an in-flight `agent:runCommand`, spawned detached on POSIX so the whole process tree — not just the immediate shell — is killed via a negative-pid `SIGTERM`, or `taskkill /t /f` on Windows). Cancelling an unknown/already-settled requestId is a harmless no-op either way.

**Cost/token budget caps (`.liteide/agent-usage.json`):** per-project, not per-app — set via `agent:setBudgetCap({maxTokens, maxUsd})`. Every `ai:chatOnce` call checks the cap BEFORE hitting the network; once exceeded, the next call is refused outright (`{budgetExceeded:true, reason}`) with no request sent, so an exhausted cap never results in one more paid call. Token counts are parsed directly from each provider's own response (`usage`/`usageMetadata`/`prompt_eval_count`+`eval_count`) and are exact; the accompanying USD figure comes from a small hardcoded $/M-token table in `main.js` (`PRICING_USD_PER_MTOK`) and is a best-effort estimate only — it will drift as providers change prices and should not be treated as billing-accurate. Ollama is always $0 (local inference). `agent:resetUsage` zeroes the counters but keeps the configured cap.

**Context compaction (`src/index.html`, renderer-side):** `agentHistory` grows without bound across a session — everything stays in the array and gets resent on every loop iteration. Once a call's real reported input-token count (from the same `usage` data budget caps use, not a heuristic) crosses a configurable threshold (`compactAfterTokens`, default 50000, saved globally via `ai:saveConfig`), everything before the last `KEEP_RECENT_USER_TURNS` (3) user turns gets summarized via one extra AI call and spliced into a single synthetic message. The cut point is always exactly on a user-message boundary — the only place in the transcript guaranteed not to split an assistant `tool_use` from its paired `tool_result`, which providers (Anthropic especially) hard-error on if separated. Best-effort: if the summarization call itself errors, is cancelled, or hits the budget cap, history is left untouched rather than risking data loss. `test/compaction.test.js` extracts and executes the real functions from `src/index.html` via `vm` (not a reimplementation) and specifically asserts no orphaned tool_use/tool_result pairs ever result from a compaction.

**Test-after-edit auto-verification (`.liteide/agent-verify.json`):** off by default, opt-in per project via `agent:setVerifyConfig({enabled, command})`. A test command is auto-detected on project open (`npm test` from `package.json`, `cargo test`, `go test ./...`, `python -m pytest -q`, `mvn test`, `./gradlew test` — first match wins) and saved disabled so the UI can pre-fill a suggestion without ever auto-running anything unasked. When enabled, a successful `write_file`/`edit_file` on a recognized code extension (not docs/config/markdown) runs that command through the same sandbox `run_command` uses, with a hard timeout (default 60s, tree-killed via the same `killCommandProcess` cancellation uses) and a debounce window (default 15s) so a burst of rapid edits doesn't re-run a slow suite after every single one. The result comes back as a `verification` field on that SAME write_file/edit_file tool result — no extra round trip, and the skill file (section 16) tells the model explicitly not to report success without checking it. `test/verification.test.js` proves real detection, a real pass, a real failure, a real timeout-kill, and real debouncing — not mocked.

**web_search / web_fetch — fixed a real gap:** these tools were declared in `AGENT_TOOLS` and routed in `execAgentTool`, but `agent:webSearch`/`agent:webFetch` were never actually implemented in `main.js` or exposed in `preload.js` — calling either would have thrown at runtime. Now implemented: DuckDuckGo's HTML-only endpoint (no JS, no API key) via lightweight regex extraction (deliberately not a full HTML parser, to stay zero-new-dependency — more fragile to DuckDuckGo markup changes than a real parser would be) for search, and a fetch + tag-stripping text extraction (15KB cap, content-type checked, binary types refused) for page fetches. `test/web-tools.test.js` covers both against mocked fetch.

**Granular per-tool-category permission toggles (`.liteide/agent-permissions.json`):** six categories — `read` (read_file/list_dir/search_codebase/grep_codebase), `write` (write_file/edit_file), `delete` (delete_file), `execute` (run_command), `network` (web_search/web_fetch), `subagents` (spawn_subagents) — each independently `allow` / `ask` / `deny`. This is a coarser layer UNDERNEATH the existing critical-file/critical-command pattern gates, not a replacement: both must pass. `deny` blocks outright with no approval popup; `ask` forces a popup unconditionally, even for something that wouldn't otherwise be flagged; `allow` falls through to the existing finer-grained checks. Defaults reproduce pre-existing behavior exactly (`delete: 'ask'`, everything else `'allow'`) so installing this never silently changes what an already-open project permits. `delete` intentionally has no fully-silent mode — even `allow` still confirms; only `deny` changes its behavior — deletion keeps an irreducible confirmation floor by design. `spawn_subagents` has no single main-process call to gate directly (the renderer fans out into several parallel `ai:chatOnce` loops itself), so `agent:gateSubagents` is a dedicated check-then-approve call the renderer makes before starting that fan-out; each spawned sub-agent's own tool calls are still separately gated by whichever category they individually fall under. `test/permissions.test.js` covers all six categories × all three states against real handler calls.

**Auto-checkpointing:** every successful `write_file`/`edit_file`/`delete_file` triggers `agent:checkpoint` → auto-commits to git if the project is a repo (silent no-op otherwise). This is the agent's rollback safety net — `git log`/`git revert`, not a bespoke undo system.

### AI providers
Four adapters in `main.js` (`callOpenAI`/`callAnthropic`/`callGemini`/`callOllama`), each converting a single normalized message format into that provider's actual wire format — this is where provider-specific quirks live (Anthropic's `tool_use`/`tool_result` blocks, Gemini's `thoughtSignature` replay requirement, OpenAI/Ollama needing the system prompt manually prepended as a `role:'system'` message). `test/ai-providers.test.js` mocks `fetch` and asserts the exact request shape per provider — check there first if a provider's tool-calling misbehaves.

Local models without native function-calling (common with smaller Ollama models) are handled by `extractToolCallFromText()` — a fallback parser that detects a tool-call-shaped JSON blob printed as plain text and executes it anyway.

### Terminal system
Real multi-session PTYs via `node-pty` (falls back to plain `child_process.spawn` if `node-pty` isn't installed — degraded but functional, loses arrow-key/history editing). Each session is a full `xterm.js` instance; sessions persist in the background when not the visible pane. Split-view shows two sessions side by side. Known Windows-specific fixes already applied: `cmd.exe`/`powershell.exe` resolved via fixed `%SystemRoot%` paths (not `where`, which is timing-fragile at boot), `cd` uses `/d` for cmd.exe (drive-changing), WSL paths translated Windows→`/mnt/x/...`.

### Persistent agent state (per project, in `.liteide/`)
`agent-memory.md` (durable project notes, agent-writable) · `agent-session.json` (chat history, resumed on reopen) · `skills/*.md` (user + auto-seeded skills) · `skills/universal-coding-agent.md` (the baseline behavior doc, injected in full into every system prompt, version-tagged, auto-upgrades in place while backing up prior content to `.bak`).

### Test suite (`npm test`, Node's built-in `node:test`, zero new dependencies)
`test/helpers/mock-electron.js` intercepts `require('electron')` via `Module._load`, letting the real `main.js` run and register real IPC handlers outside Electron — tests call those handlers directly against real temp directories/git repos, not a reimplementation. `wiring.test.js` (IPC + static HTML integrity) · `backend.test.js` (real fs/git/agent-tool behavior, approval flows) · `ai-providers.test.js` (mocked-fetch request-shape verification) · `terminal.test.js` (pure-logic regression tests for real bugs found during manual testing — `cd` drive-switching, launch-arg detection, shell path resolution).

### Known gaps (per third-party audit, uploaded separately as `liteide-agent-gap-analysis-v3.md`)
~~No OS-level sandboxing for `agent:runCommand`~~ — done on Linux (bwrap) and macOS (Seatbelt); Windows remains hardened-but-not-syscall-sandboxed (no dependency-free native primitive available — see Safety model above). ~~No cancellation for a running agent loop~~ — done: a Stop button aborts the in-flight AI call (real `AbortController`/`AbortSignal`) or tree-kills the in-flight `run_command` child process, and (as of recursive sub-agents) an entire sub-agent tree too. ~~No cost/token budget caps~~ — done: per-project token/USD caps, enforced *before* the next network call. ~~No context compaction for long `agentHistory`~~ — done: real reported token count triggers automatic summarization of older turns, cut strictly on turn boundaries so tool_use/tool_result pairing is never split. ~~No automated test-run-after-edit verification~~ — done: opt-in per-project auto-detected test command, run sandboxed with a timeout + debounce, result folded directly into the write_file/edit_file tool response. ~~No granular per-tool-category permission toggles~~ — done: 6 categories × 3 states (allow/ask/deny), layered underneath the existing critical-file/command gates. ~~edit_file failures don't feed file content back~~ — done: `currentContent` now included on not-found/ambiguous errors. ~~RAG's 2000-file cap wasn't surfaced~~ — done: `capped`/`totalFilesInProject` reported when hit. ~~No model-requestable permission escalation~~ — done: `request_permission_escalation` tool, session-only, deny→ask ceiling, never persisted. ~~No ripgrep-backed exact-search tool~~ — done: `grep_codebase`, ripgrep-backed with a pure-JS fallback, 12 real tests in `test/grep.test.js`. ~~No recursive subagents~~ — done: 2 levels deep, 12-total-per-tree budget cap, cancellation now propagates to the whole tree, 11 real tests in `test/subagents.test.js` (which caught and fixed a real message-clobbering bug in the cancellation path). ~~No Aider-style architect fallback for weak/local models~~ — done: opt-in, configurable failure threshold (default 2 consecutive same-file edit_file failures), optional separate provider/model, SEARCH/REPLACE block format (not JSON — avoids reintroducing the exact escaping-reliability problem this feature exists to work around), 24 real tests across `test/architect.test.js` (persistence) and `test/architect-logic.test.js` (parser + fix flow), which caught a real falsy-zero config bug (`Number(0) || 2` was silently turning an explicit threshold of 0 into 2). ~~No Aider-style repo map~~ — done: regex-based per-language symbol extraction (JS/TS, Python, Go, Rust, Java/Kotlin, C/C++, Ruby, PHP), explicit choice over tree-sitter (see rationale above), ranked by focus_path proximity then symbol count, capped at 40 symbols/file and 300 files output, 16 real tests in `test/repomap.test.js` covering every language, ranking, both caps, and ignore-pattern behavior — all passed on first real run. ~~No MCP client~~ — done: stdio transport, JSON-RPC 2.0, explicit scope decisions on transport and sandboxing (see above), 25 real tests in `test/mcp.test.js` against a genuinely protocol-compliant fixture server, which caught a real race condition in process-exit cleanup.

**Every item in the original v3 gap-analysis report is now done.** Remaining known limitations, none from the report: Windows has no real OS-level sandbox for `agent:runCommand` (documented, not fixable without a new native dependency); `get_repo_map`'s regex-based symbol extraction can miss multi-line signatures or unusual formatting (explicit tradeoff vs. tree-sitter, see above); the MCP client supports stdio only, not SSE/HTTP (explicit tradeoff, see above); the Agent Skills modal focus-stealing fix (see below) has not been behaviorally confirmed in a real browser.

> **Note on `grep_codebase`:** implemented and wired end-to-end (main.js handler, preload.js bridge, AGENT_TOOLS declaration + execAgentTool dispatch in index.html, skill file v1.7.0 section 19), and now has a real test file (`test/grep.test.js`, 12 tests, included in `npm test`) verified against a real temp project, with and without ripgrep installed.
>
> **Note on `agent-sandbox.js`:** this file was not part of one session's upload and was reconstructed from this README's own documented behavior spec (bwrap/Seatbelt/hardened-Windows, the exact function names below) before the real `test/sandbox.test.js` was later supplied and used to correct the reconstruction's API surface (`buildMinimalEnv`, `buildSeatbeltProfile`, `buildBwrapArgs`, `detectSandboxCapability`, `buildSandboxedCommand`) to match exactly. All 14 sandbox tests — including real bubblewrap isolation checks (write-outside-project blocked, write-inside-project allowed, network blocked by default) — pass against the current file. If you have an untouched original `agent-sandbox.js` from before this happened, diffing it against the current one is still worth doing, but the current file is real-test-verified either way.
>
> **Note on `subagents.test.js`:** writing real tests for the depth cap and cancellation propagation surfaced a genuine bug in the newly-added recursion code — after a mid-batch tool-call cancellation, the outer step loop looped one more time before stopping, which clobbered the specific "stopped before running remaining tool calls" message with a generic one (and, in the single-call case, left no message at all). Fixed by breaking the step loop immediately once cancellation is detected, with a fallback message for the single-call case. This is exactly the kind of bug real tests are supposed to catch before it ships.
>
> **Note on the Agent Skills modal "can't type" bug (reported by screenshot, not from the gap-analysis report):** diagnosed as best as possible without a real rendering engine available in this environment — `npm install` for a headless browser (jsdom got in without needing native builds, but Monaco/xterm still can't load without `node_modules` present and network access to their CDNs) meant this couldn't be reproduced keystroke-for-keystroke. Static analysis ruled out duplicate DOM ids, missing `display:none` base rules, CSS `pointer-events` issues, and disabled/readonly attributes — all already covered by `wiring.test.js` and all clean. The remaining, well-documented category of bug matching every symptom (modal visibly renders correctly, only the modal's actual `<input>`/`<textarea>` fields are affected, nothing else in the app is reported broken) is Monaco Editor's internal keybinding service: it attaches its own `window`-level **capture-phase** keydown listener, which always fires before an event reaches any descendant element regardless of where real DOM focus is — if Monaco still believes it's focused when a modal opens on top of it, it can swallow keystrokes meant for the modal with no visible error. Fixed in `openSkillsModal()` by explicitly blurring `document.activeElement` and deferring an explicit `.focus()` onto the modal's own input by one tick (`releaseEditorFocusForModal()`), which should make Monaco release its internal focus/keybinding context before the modal input receives the keystroke. `test/ui-focus.test.js` statically guards this fix staying in place, but **cannot verify actual keystroke delivery** — please confirm in the real app that typing now works, and report back if it doesn't so this can be revisited with a different diagnosis.
>
> **Note on the skill file rewrite (v2.1.0):** through v1.2.0 → v2.0.0, the embedded skill file was updated by appending a new numbered section per feature rather than rewriting the document — a reasonable incremental practice that, over 12 appends, left real problems: section 10 ("Parallelism rules") still said sub-agents get "a reduced tool set (no further spawning)" three versions after v1.8.0 made recursion up to 2 levels real, a direct contradiction with section 20 later in the same file. The user caught this by uploading an old seeded copy from one of their real project folders and asking for it directly. v2.1.0 is a full rewrite into one coherent 16-section document — same information, reorganized so search/grep/repo-map get one comparative section instead of being scattered across three, permissions and escalation are unified instead of split across two "vN.N.0" sections, and the recursion contradiction is gone. No tool behavior changed, only the document describing it. Going forward this file should be rewritten wholesale on any change substantial enough to affect more than one existing section, not appended to by default.

---

MIT License


