# ⚡ LiteIDE

Lightweight code editor with iOS Liquid Glass UI built on Electron.

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

---

## Build Installer

```cmd
cd C:\path\to\lite-ide
rmdir /s /q dist
npm run dist
```

Auto-detects your OS + CPU arch. Output in `dist\`:
- `LiteIDE Setup.exe` — NSIS installer
- `LiteIDE 1.0.0.msi` — MSI installer
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

Build:
```bash
npm run dist
```
Gives `.dmg` + `.zip` for your Mac architecture (x64 or arm64).

---

## Linux Setup

```bash
cd /path/to/lite-ide
npm install --ignore-scripts
node node_modules/electron/install.js
npm start
```

Build:
```bash
npm run dist
```
Gives `.AppImage` + `.deb` for your architecture.

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

## Terminal

- **Shell tab** — full interactive shell (PowerShell / CMD / Git Bash / zsh / bash / fish)
- **Output tab** — program output + accepts stdin input while running
- Right-click terminal → Copy / Paste / Select All / Clear / CD to project
- Opening a folder auto-`cd`s the shell to that folder

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
├── main.js         — Electron main process
├── preload.js      — IPC bridge
├── build.js        — Auto-detect build script
├── setup.bat       — Windows first-time setup
├── package.json    — Config + electron-builder
├── src/
│   └── index.html  — Full UI (Monaco + xterm)
└── assets/
    └── icon.png    — App icon (replace with 1024x1024)
```

---

MIT License
