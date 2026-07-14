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

Runs the backend test suite (Node's built-in test runner, no extra dependencies) — verifies every IPC channel between the UI and the Electron main process, real file/terminal/git operations against a temp project, and the request format sent to each of the 4 AI providers. Should print `# pass 32` / `# fail 0`. See `test/` for details.

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
├── main.js              — Electron main process (fs, terminals, git, search, AI providers)
├── preload.js            — IPC bridge
├── build.js               — Auto-detect build script
├── setup.bat               — Windows first-time setup
├── package.json             — Config + electron-builder + test script
├── src/
│   └── index.html          — Full UI (Monaco + xterm + AI Agent panel)
├── test/                     — npm test — backend/wiring/AI-provider test suite
│   ├── wiring.test.js
│   ├── backend.test.js
│   ├── ai-providers.test.js
│   └── helpers/mock-electron.js
└── assets/
    └── icon.png              — App icon (replace with 1024x1024)
```

---

## Architecture Reference (for picking this project back up)

Current state: **v1.1.0**, agent skill file **v1.2.0**, **58/58 tests passing** via `npm test`.

### Process model
Standard Electron: `main.js` (Node/Electron main process — all fs, git, terminal, AI provider calls) ↔ `preload.js` (contextBridge, the only thing the renderer can call) ↔ `src/index.html` (renderer — UI + all agent orchestration logic, since there's no separate frontend framework/bundler).

### Full IPC channel map (main.js ⇄ preload.js)
**`ipcMain.handle` (invoke/response):**
`agent:checkpoint` `agent:deleteFile` `agent:deleteSkill` `agent:editFile` `agent:listDir` `agent:listSkills` `agent:ragSearch` `agent:readFile` `agent:runCommand` `agent:saveSkill` `agent:setProjectRoot` `agent:webFetch` `agent:webSearch` `agent:writeFile` `ai:chatOnce` `ai:clearKey` `ai:getConfig` `ai:listOllamaModels` `ai:saveConfig` `app:homedir` `app:platform` `code:run` `code:stop` `fs:delete` `fs:newFile` `fs:openFolder` `fs:readDir` `fs:readFile` `fs:writeFile` `git:diff` `git:isRepo` `git:status` `lang:detect` `search:project` `search:replaceAll` `shell:getAvailable` `term:create`

**`ipcMain.on` (fire-and-forget):**
`agent:approvalResponse` `open:external` `process:input` `term:cd` `term:close` `term:input` `term:resize` `window:close` `window:maximize` `window:minimize`

**Main → renderer events (`safeSend`):** `agent:approvalRequest` `agent:commandOutput` `app:openPath` `process:error` `process:exit` `process:stderr` `process:stdout` `term:error` `term:exit` `term:output` `window:maximized`

`test/wiring.test.js` statically verifies every one of these is wired correctly on both ends by actually executing `main.js` via a mocked Electron module — run it first if anything IPC-related seems broken.

### Agent tools (declared in `AGENT_TOOLS`, `src/index.html`; implemented in `execAgentTool`)
`read_file` `list_dir` `write_file` `edit_file` (precise old_str→new_str, refuses ambiguous/not-found matches) `delete_file` `run_command` (isolated background exec) `run_in_terminal` (live, in the visible integrated terminal) `search_codebase` (local TF-IDF RAG, no embeddings/API) `spawn_subagents` (parallel, non-recursive, capped) `web_search` (DuckDuckGo HTML scrape, no API key) `web_fetch` (HTML→text extraction). `test/wiring.test.js` also verifies every declared tool has a matching `execAgentTool` case and vice versa.

**Safety model:** `.env`/`package.json`/git internals/keys and destructive shell patterns (`rm -rf`, force-push, `sudo`, etc.) require a user approval popup (`agent:approvalRequest` round-trip via `requestApproval()` in main.js). Everything else inside the opened project folder is silent. Path traversal outside the project root is hard-blocked (`resolveInProject`).

**OS-level sandboxing for `agent:runCommand` (`agent-sandbox.js`):** every command still passes the approval gate above, then runs underneath a second, OS-enforced layer where the platform supports one: **Linux** via `bwrap` (bubblewrap) — read access everywhere (system libs/dev tools need it), write access ONLY inside the project folder + its own scratch tmp dir, network namespace unshared unless the tool call opts in. **macOS** via `sandbox-exec` (Seatbelt) with a dynamically generated profile, same read-everywhere/write-only-in-project/no-network-by-default shape. **Windows** has no dependency-free OS-level primitive reachable from pure Node (real isolation needs AppContainer/low-integrity tokens via a native addon, or per-call Windows Sandbox VMs, both out of scope for v1) — it runs hardened-but-unsandboxed instead: jailed to the project folder (unchanged from before) plus a minimal explicit environment allowlist instead of full `process.env` passthrough, so unrelated secrets (cloud CLI tokens, SSH agent sockets, other providers' API keys) are never exposed to a spawned command on any platform, sandboxed or not. `agent:getSandboxStatus` reports which mode is actually active; the run_command tool card in the UI shows it per-call. Falls back to the hardened-only mode with a clear reason string if `bwrap`/`sandbox-exec` isn't present even on a platform that normally supports it. See `test/sandbox.test.js` for tests that prove the isolation against real child processes (not mocked) on Linux — write-outside-project fails, network is unreachable by default, reads outside the project still work.

**Cancellation (`agent:cancelRequest`):** exactly one async agent operation is ever in-flight at a time (the loop is sequential), so the renderer tracks a single `currentAgentRequestId` and a Stop button that fires it at `agent:cancelRequest`. Main process resolves it against two maps: `activeAiControllers` (an `AbortController` per in-flight `ai:chatOnce` call — its `signal` is threaded into every provider adapter's `fetch`) and `activeCommandProcesses` (the child process of an in-flight `agent:runCommand`, spawned detached on POSIX so the whole process tree — not just the immediate shell — is killed via a negative-pid `SIGTERM`, or `taskkill /t /f` on Windows). Cancelling an unknown/already-settled requestId is a harmless no-op either way.

**Cost/token budget caps (`.liteide/agent-usage.json`):** per-project, not per-app — set via `agent:setBudgetCap({maxTokens, maxUsd})`. Every `ai:chatOnce` call checks the cap BEFORE hitting the network; once exceeded, the next call is refused outright (`{budgetExceeded:true, reason}`) with no request sent, so an exhausted cap never results in one more paid call. Token counts are parsed directly from each provider's own response (`usage`/`usageMetadata`/`prompt_eval_count`+`eval_count`) and are exact; the accompanying USD figure comes from a small hardcoded $/M-token table in `main.js` (`PRICING_USD_PER_MTOK`) and is a best-effort estimate only — it will drift as providers change prices and should not be treated as billing-accurate. Ollama is always $0 (local inference). `agent:resetUsage` zeroes the counters but keeps the configured cap.

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
~~No OS-level sandboxing for `agent:runCommand`~~ — done on Linux (bwrap) and macOS (Seatbelt); Windows remains hardened-but-not-syscall-sandboxed (no dependency-free native primitive available — see Safety model above). ~~No cancellation for a running agent loop~~ — done: a Stop button aborts the in-flight AI call (real `AbortController`/`AbortSignal`) or tree-kills the in-flight `run_command` child process. ~~No cost/token budget caps~~ — done: per-project token/USD caps in `.liteide/agent-usage.json`, enforced *before* the next network call so an exceeded cap never results in one more paid request; see Safety model below for the important caveat that dollar figures are a best-effort price-table estimate, not billing-accurate. Remaining, in priority order: no context compaction for long `agentHistory` · no automated test-run-after-edit verification · no granular per-tool-category permission toggles · no Aider-style repo map · no MCP client.

---

MIT License


