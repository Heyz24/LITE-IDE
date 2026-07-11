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

MIT License
