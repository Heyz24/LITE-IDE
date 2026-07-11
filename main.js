const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const os = require('os');
const crypto = require('crypto');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_DEV = process.argv.includes('--dev');

let mainWindow, runProcess = null;

// Every pty/process event handler below fires asynchronously and can outlive
// the window (e.g. buffered pty output still arriving right as the app
// quits). Sending to a destroyed webContents throws "Object has been
// destroyed" and crashes the main process — this guards every send site.
function safeSend(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// ─── Language Registry ───────────────────────────────────────────────────────
// type:'direct' → spawn interpreter directly (no shell, no quoting bugs)
// type:'shell'  → needs compile+run pipeline via cmd/bash
const LANGUAGES = {
  'Python':     { cmds: IS_WIN ? ['python','python3'] : ['python3','python'], type:'direct', args:(f,c)=>[c,[f]] },
  'JavaScript': { cmds: ['node'],                  type:'direct',  args:(f,c)=>[c,[f]] },
  'TypeScript': { cmds: ['ts-node','tsc'],              type:'direct',  args:(f,c)=>[IS_WIN?'npx.cmd':'npx',['ts-node',f]] },
  'Go':         { cmds: ['go'],                    type:'direct',  args:(f,c)=>[c,['run',f]] },
  'Ruby':       { cmds: ['ruby'],                  type:'direct',  args:(f,c)=>[c,[f]] },
  'PHP':        { cmds: ['php'],                   type:'direct',  args:(f,c)=>[c,[f]] },
  'Dart':       { cmds: ['dart'],                  type:'direct',  args:(f,c)=>[c,['run',f]] },
  'R':          { cmds: ['Rscript'],               type:'direct',  args:(f,c)=>[c,[f]] },
  'Lua':        { cmds: ['lua','lua5.4','lua5.3'], type:'direct',  args:(f,c)=>[c,[f]] },
  'Perl':       { cmds: ['perl'],                  type:'direct',  args:(f,c)=>[c,[f]] },
  'Bash':       { cmds: ['bash'],                  type:'direct',  args:(f,c)=>[c,[f]] },
  'Elixir':     { cmds: ['elixir'],                type:'direct',  args:(f,c)=>[c,[f]] },
  'Julia':      { cmds: ['julia'],                 type:'direct',  args:(f,c)=>[c,[f]] },
  'Haskell':    { cmds: ['runghc','runhaskell'],   type:'direct',  args:(f,c)=>[c,[f]] },
  'Zig':        { cmds: ['zig'],                   type:'direct',  args:(f,c)=>[c,['run',f]] },
  'Nim':        { cmds: ['nim'],                   type:'direct',  args:(f,c)=>[c,['r',f]] },
  'PowerShell': { cmds: ['pwsh','powershell'],     type:'direct',  args:(f,c)=>[c,['-File',f]] },
  'Batch':      { cmds: ['cmd'],                   type:'direct',  args:(f,c)=>[c,['/c',f]] },
  // Compiled — need shell pipeline
  'Rust':   { cmds:['rustc'],          type:'shell', run:(f,c)=> `${c} "${f}" -o "${f}.out" && "${f}.out"` },
  'C++':    { cmds:['g++','clang++'],  type:'shell', run:(f,c)=> `${c} "${f}" -o "${f}.out" && "${f}.out"` },
  'C':      { cmds:['gcc','clang'],    type:'shell', run:(f,c)=> `${c} "${f}" -o "${f}.out" && "${f}.out"` },
  'Java':   { cmds:['javac'],          type:'shell', run:(f,c)=> `${c} "${f}" && java -cp "${path.dirname(f)}" "${path.basename(f,'.java')}"` },
  'Swift':  { cmds:['swift'],          type:'shell', run:(f,c)=> `${c} "${f}"` },
  'Kotlin': { cmds:['kotlinc'],        type:'shell', run:(f,c)=> `${c} "${f}" -include-runtime -d "${f}.jar" && java -jar "${f}.jar"` },
  'C#':     { cmds:['dotnet'],         type:'direct', args:(f,c)=>[c,['run','--project',path.dirname(f)]] },
  'F#':     { cmds:['dotnet'],         type:'direct', args:(f,c)=>[c,['run','--project',path.dirname(f)]] },
  'Deno':   { cmds:['deno'],           type:'direct', args:(f,c)=>[c,['run',f]] },
  'HTML':   { cmds: [],                type:'browser', url:(f)=>f },
  'Markdown':{ cmds:[],               type:'browser', url:(f)=>f },
  // Hardware description / embedded
  'VHDL':          { cmds:['ghdl'],       type:'shell', run:(f,c)=>{ const u=path.basename(f).replace(/\.(vhd|vhdl)$/i,''); return `${c} -a --std=08 "${f}" && ${c} -e --std=08 ${u} && ${c} -r --std=08 ${u}`; } },
  'SystemVerilog': { cmds:['iverilog'],   type:'shell', run:(f,c)=> `${c} -g2012 -o "${f}.out" "${f}" && vvp "${f}.out"` },
  'Arduino':       { cmds:['arduino-cli'],type:'shell', run:(f,c)=> `${c} compile --fqbn arduino:avr:uno "${path.dirname(f)}"` },
  'GTKWave':       { cmds:['gtkwave'],    type:'external' },
};

const INSTALL_LINKS = {
  'Python':     { win:'https://python.org/downloads',              mac:'https://python.org/downloads',              linux:'https://python.org/downloads' },
  'JavaScript': { win:'https://nodejs.org',                        mac:'https://nodejs.org',                        linux:'https://nodejs.org' },
  'TypeScript': { win:'https://www.typescriptlang.org/download',              mac:'https://www.typescriptlang.org/download',              linux:'https://www.typescriptlang.org/download' },
  'Go':         { win:'https://go.dev/dl/',                        mac:'https://go.dev/dl/',                        linux:'https://go.dev/dl/' },
  'Rust':       { win:'https://rustup.rs/',                        mac:'https://rustup.rs/',                        linux:'https://rustup.rs/' },
  'C++':        { win:'https://www.msys2.org/',                    mac:'https://developer.apple.com/xcode/',        linux:'https://gcc.gnu.org/' },
  'C':          { win:'https://www.msys2.org/',                    mac:'https://developer.apple.com/xcode/',        linux:'https://gcc.gnu.org/' },
  'Java':       { win:'https://adoptium.net/',                     mac:'https://adoptium.net/',                     linux:'https://adoptium.net/' },
  'Ruby':       { win:'https://rubyinstaller.org/',                mac:'https://ruby-lang.org/',                    linux:'https://ruby-lang.org/' },
  'PHP':        { win:'https://www.php.net/downloads',             mac:'https://www.php.net/downloads',             linux:'https://www.php.net/downloads' },
  'Swift':      { win:'https://swift.org/download/',               mac:'https://developer.apple.com/xcode/',        linux:'https://swift.org/download/' },
  'Kotlin':     { win:'https://kotlinlang.org/',                   mac:'https://kotlinlang.org/',                   linux:'https://kotlinlang.org/' },
  'Dart':       { win:'https://dart.dev/get-dart',                 mac:'https://dart.dev/get-dart',                 linux:'https://dart.dev/get-dart' },
  'R':          { win:'https://cran.r-project.org/',               mac:'https://cran.r-project.org/',               linux:'https://cran.r-project.org/' },
  'Perl':       { win:'https://strawberryperl.com/',               mac:'https://perl.org/',                         linux:'https://perl.org/' },
  'Bash':       { win:'https://git-scm.com/downloads',             mac:null,                                        linux:null },
  'PowerShell': { win:null,                                        mac:'https://github.com/PowerShell/PowerShell',  linux:'https://github.com/PowerShell/PowerShell' },
  'Batch':      { win:null,                                        mac:null,                                        linux:null },
  'Lua':        { win:'https://lua.org/download.html',             mac:'https://lua.org/download.html',             linux:'https://lua.org/download.html' },
  'Elixir':     { win:'https://elixir-lang.org/install.html',      mac:'https://elixir-lang.org/install.html',      linux:'https://elixir-lang.org/install.html' },
  'Haskell':    { win:'https://www.haskell.org/ghcup/',            mac:'https://www.haskell.org/ghcup/',            linux:'https://www.haskell.org/ghcup/' },
  'Zig':        { win:'https://ziglang.org/download/',             mac:'https://ziglang.org/download/',             linux:'https://ziglang.org/download/' },
  'Julia':      { win:'https://julialang.org/downloads/',          mac:'https://julialang.org/downloads/',          linux:'https://julialang.org/downloads/' },
  'Nim':        { win:'https://nim-lang.org/install.html',         mac:'https://nim-lang.org/install.html',         linux:'https://nim-lang.org/install.html' },
  'C#':         { win:'https://dotnet.microsoft.com/download',         mac:'https://dotnet.microsoft.com/download',         linux:'https://dotnet.microsoft.com/download' },
  'F#':         { win:'https://dotnet.microsoft.com/download',         mac:'https://dotnet.microsoft.com/download',         linux:'https://dotnet.microsoft.com/download' },
  'Deno':       { win:'https://deno.com/',                             mac:'https://deno.com/',                             linux:'https://deno.com/' },
  'VHDL':          { win:'https://ghdl.github.io/ghdl/',                  mac:'https://ghdl.github.io/ghdl/',                  linux:'https://ghdl.github.io/ghdl/' },
  'SystemVerilog': { win:'https://bleyer.org/icarus/',                    mac:'https://formulae.brew.sh/formula/icarus-verilog',linux:'http://iverilog.icarus.com/' },
  'Arduino':       { win:'https://arduino.github.io/arduino-cli/latest/installation/', mac:'https://arduino.github.io/arduino-cli/latest/installation/', linux:'https://arduino.github.io/arduino-cli/latest/installation/' },
  'GTKWave':       { win:'https://gtkwave.sourceforge.net/',              mac:'https://formulae.brew.sh/formula/gtkwave',      linux:'https://gtkwave.sourceforge.net/' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function findCmd(cmds) {
  const check = IS_WIN ? 'where' : 'which';
  return new Promise(resolve => {
    let i = 0;
    const next = () => {
      if (i >= cmds.length) return resolve(null);
      const cmd = cmds[i++];
      exec(`${check} ${cmd}`, err => err ? next() : resolve(cmd));
    };
    next();
  });
}

// ─── Window ──────────────────────────────────────────────────────────────────
// ─── Open-with-LiteIDE launch handling ──────────────────────────────────────
// Windows/Linux pass the double-clicked file as a CLI arg; macOS fires a
// separate 'open-file' event instead. Whichever file arrives, we open its
// parent folder as the project (so Explorer/search/git/agent all work) and
// the file itself in a tab.
function extractLaunchFilePath(argv) {
  for (const arg of argv.slice(1)) { // argv[0] is always the exe itself (dev or packaged) — never a launched file
    if (!arg || arg.startsWith('-') || arg === '.' || /electron(\.exe)?$/i.test(arg) || arg.endsWith('main.js')) continue;
    try { if (fs.existsSync(arg) && fs.statSync(arg).isFile()) return path.resolve(arg); } catch {}
  }
  return null;
}
let pendingOpenPath = extractLaunchFilePath(process.argv);

function deliverOpenPath(filePath) {
  if (!filePath || !mainWindow) return;
  projectRoot = path.dirname(filePath); // so Explorer/search/git/agent are scoped to it too
  safeSend('app:openPath', filePath);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // User double-clicked another file while LiteIDE was already running —
    // focus the existing window and open it there instead of a new instance.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      deliverOpenPath(extractLaunchFilePath(argv));
    }
  });
}
app.on('open-file', (event, filePath) => { // macOS
  event.preventDefault();
  if (mainWindow) deliverOpenPath(filePath); else pendingOpenPath = filePath;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    frame: false,
    transparent: IS_MAC,
    vibrancy: IS_MAC ? 'ultra-dark' : undefined,
    visualEffectState: IS_MAC ? 'active' : undefined,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
    },
    backgroundColor: IS_MAC ? '#00000000' : '#08080f',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
    trafficLightPosition: IS_MAC ? { x: 16, y: 18 } : undefined,
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingOpenPath) { deliverOpenPath(pendingOpenPath); pendingOpenPath = null; }
  });
  mainWindow.on('maximize',   () => safeSend('window:maximized', true));
  mainWindow.on('unmaximize', () => safeSend('window:maximized', false));
  mainWindow.on('close', () => {
    // Kill pty/shell sessions while the window still exists, so their exit
    // events (if any) have nowhere unsafe to fire — shrinks the shutdown race.
    for (const s of termSessions.values()) { try { s.proc.kill(); } catch {} }
    termSessions.clear();
    if (runProcess) { try { runProcess.kill(); } catch {} runProcess = null; }
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  for (const s of termSessions.values()) { try { s.proc.kill(); } catch {} } // safety net, in case a session was created after close()
  termSessions.clear();
  if (!IS_MAC) app.quit();
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ─── Window controls ─────────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('window:close',    () => mainWindow.close());

// ─── File System ─────────────────────────────────────────────────────────────
ipcMain.handle('fs:openFolder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (r.canceled) return null;
  projectRoot = r.filePaths[0]; // AI agent's sandbox root follows the opened folder
  return projectRoot;
});

ipcMain.handle('fs:readDir', async (_, dirPath) => {
  const IGNORE = new Set(['.git','node_modules','__pycache__','.DS_Store','dist','build','.cache','.next','target']);
  function walk(p, depth = 0) {
    if (depth > 6) return [];
    try {
      return fs.readdirSync(p, { withFileTypes: true })
        .filter(e => !e.name.startsWith('.') && !IGNORE.has(e.name))
        .sort((a, b) => (a.isDirectory() !== b.isDirectory()) ? (a.isDirectory() ? -1 : 1) : a.name.localeCompare(b.name))
        .map(e => ({ name: e.name, path: path.join(p, e.name), isDir: e.isDirectory(),
          children: e.isDirectory() ? walk(path.join(p, e.name), depth + 1) : undefined }));
    } catch { return []; }
  }
  return walk(dirPath);
});

ipcMain.handle('fs:readFile',  async (_, p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } });
ipcMain.handle('fs:writeFile', async (_, p, c) => { try { fs.writeFileSync(p, c, 'utf8'); return true; } catch { return false; } });

ipcMain.handle('fs:newFile', async (_, dirPath) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(dirPath, 'untitled.py'),
    filters: [{ name: 'All Files', extensions: ['*'] }],
  });
  if (!r.canceled) { fs.writeFileSync(r.filePath, '', 'utf8'); return r.filePath; }
  return null;
});

ipcMain.handle('fs:delete', async (_, filePath) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question', message: `Delete "${path.basename(filePath)}"?`,
    detail: 'This cannot be undone.', buttons: ['Delete', 'Cancel'], defaultId: 1,
  });
  if (response === 0) { try { fs.unlinkSync(filePath); return true; } catch { return false; } }
  return false;
});

// ─── Language Detection ───────────────────────────────────────────────────────
ipcMain.handle('lang:detect', async (_, langName) => {
  const lang = LANGUAGES[langName];
  // No runtime needed (browser/syntax-only) → always available
  if (!lang || !lang.cmds || lang.cmds.length === 0) return { installed: true };
  const cmd = await findCmd(lang.cmds);
  if (cmd) return { installed: true, command: cmd };
  const p = IS_WIN ? 'win' : IS_MAC ? 'mac' : 'linux';
  const links = INSTALL_LINKS[langName];
  return { installed: false, installLink: links ? (links.all || links[p]) : null };
});

// ─── Run Code ─────────────────────────────────────────────────────────────────
ipcMain.handle('code:run', async (_, filePath, langName) => {
  if (runProcess) { try { runProcess.kill(); } catch {} runProcess = null; }

  const lang = LANGUAGES[langName];
  if (!lang) return false;

  // Find which command is actually installed
  // Browser-open type (HTML, Markdown, CSS etc.) — no runtime needed
  if (lang.type === 'browser') {
    const url = 'file:///' + filePath.replace(/\\/g, '/').replace(/^\//, '');
    shell.openExternal(url);
    safeSend('process:stdout', `🌐 Opening in browser: ${filePath}\n`);
    safeSend('process:exit', 0);
    return true;
  }

  const cmd = await findCmd(lang.cmds);
  if (!cmd) {
    safeSend('process:error',
      `${langName} is not installed. Visit ${(INSTALL_LINKS[langName]||{})[(IS_WIN?'win':IS_MAC?'mac':'linux')] || 'the official website'} to install it.`);
    return false;
  }

  if (lang.type === 'external') {
    try {
      const child = spawn(cmd, [filePath], { detached: true, stdio: 'ignore' });
      child.unref();
      safeSend('process:stdout', `🔌 Launched ${langName}: ${filePath}\n`);
      safeSend('process:exit', 0);
    } catch (e) {
      safeSend('process:error', e.message);
      return false;
    }
    return true;
  }

  const cwd = path.dirname(filePath);

  // Per-language unbuffered env — ensures prompts print BEFORE waiting for input
  const langEnv = { ...process.env,
    PYTHONIOENCODING: 'utf-8',  // fix emoji/unicode in Python output on Windows
    PYTHONUTF8: '1',
    PYTHONUNBUFFERED: '1',
  };
  if (langName === 'Python')     langEnv.PYTHONUNBUFFERED = '1';
  if (langName === 'Ruby')       langEnv.RUBYOPT = '-W0'; // ruby flushes by default
  if (langName === 'Java' || langName === 'Kotlin') langEnv.JAVA_TOOL_OPTIONS = '-Dfile.encoding=UTF-8';
  // Node, PHP, Perl, Elixir, Julia flush stdout by default — no change needed
  // Go, Rust, C, C++ — user must use println/flush in their code (no env override possible)

  if (lang.type === 'direct') {
    const [exe, args] = lang.args(filePath, cmd);
    // On Windows .cmd/.bat files need shell:true to spawn (otherwise EINVAL)
    const needsShell = IS_WIN && /\.(cmd|bat)$/i.test(exe);
    runProcess = spawn(exe, args, { cwd, env: langEnv, shell: needsShell });
  } else {
    const cmdStr = lang.run(filePath, cmd);
    const sh = IS_WIN ? 'cmd' : 'bash';
    const flag = IS_WIN ? '/c' : '-c';
    runProcess = spawn(sh, [flag, cmdStr], { cwd, env: langEnv });
  }

  runProcess.stdout.on('data', d => safeSend('process:stdout', d.toString()));
  runProcess.stderr.on('data', d => safeSend('process:stderr', d.toString()));
  runProcess.on('close', code => { safeSend('process:exit', code); runProcess = null; });
  runProcess.on('error', err => { safeSend('process:error', err.message); runProcess = null; });
  return true;
});

ipcMain.handle('code:stop', async () => {
  if (runProcess) { try { runProcess.kill(); } catch {} runProcess = null; return true; }
  return false;
});

// ─── Terminal Sessions (multi-session PTY — auto-detects & connects to real system shells) ─────
let pty;
try { pty = require('node-pty'); } catch(e) { pty = null; }

const termSessions = new Map(); // id -> { proc, isPty, shellCmd }

async function listAvailableShells() {
  const shells = [];
  if (IS_WIN) {
    const candidates = [
      { name: 'PowerShell 7',   cmd: 'pwsh.exe' },
      { name: 'PowerShell',     cmd: 'powershell.exe' },
      { name: 'Command Prompt', cmd: 'cmd.exe' },
      { name: 'Git Bash',       cmd: path.join('C:','Program Files','Git','bin','bash.exe') },
      { name: 'Git Bash (x86)', cmd: path.join('C:','Program Files (x86)','Git','bin','bash.exe') },
      { name: 'WSL',            cmd: 'wsl.exe' },
    ];
    for (const s of candidates) {
      if (s.cmd.includes(path.sep)) {
        if (fs.existsSync(s.cmd)) shells.push(s);
        continue;
      }
      // ConPTY needs an absolute path — a bare command name like "cmd.exe"
      // can fail to launch even though `where` finds it, because pty.spawn's
      // process creation doesn't always search PATH the way a shell would.
      const resolved = await new Promise(r => exec(`where ${s.cmd}`, (err, stdout) => {
        r(err ? null : (stdout || '').split(/\r?\n/)[0].trim());
      }));
      if (resolved) shells.push({ name: s.name, cmd: resolved });
    }
  } else {
    const defaultShell = process.env.SHELL || '';
    const seen = new Set();
    const candidates = [
      ...(defaultShell ? [{ name: path.basename(defaultShell) + ' (default)', cmd: defaultShell }] : []),
      { name: 'zsh',   cmd: '/bin/zsh'                     },
      { name: 'bash',  cmd: '/bin/bash'                    },
      { name: 'sh',    cmd: '/bin/sh'                      },
      { name: 'zsh (Homebrew)',  cmd: '/opt/homebrew/bin/zsh'  },
      { name: 'bash (Homebrew)', cmd: '/opt/homebrew/bin/bash' },
      { name: 'fish (Homebrew)', cmd: '/opt/homebrew/bin/fish' },
      { name: 'zsh (Homebrew)',  cmd: '/usr/local/bin/zsh'     },
      { name: 'bash (Homebrew)', cmd: '/usr/local/bin/bash'    },
      { name: 'fish (Homebrew)', cmd: '/usr/local/bin/fish'    },
      { name: 'zsh',   cmd: '/usr/bin/zsh'                 },
      { name: 'bash',  cmd: '/usr/bin/bash'                },
      { name: 'fish',  cmd: '/usr/bin/fish'                },
      { name: 'fish',  cmd: '/usr/local/bin/fish'          },
      { name: 'dash',  cmd: '/usr/bin/dash'                },
      { name: 'ksh',   cmd: '/usr/bin/ksh'                 },
    ];
    for (const s of candidates) {
      if (!seen.has(s.cmd) && fs.existsSync(s.cmd)) { seen.add(s.cmd); shells.push(s); }
    }
  }
  return shells;
}

ipcMain.handle('shell:getAvailable', async () => listAvailableShells());

// Create a new terminal session. If shellCmd is falsy, auto-detects and
// connects to the system's default/first-available shell.
// A bare "cmd.exe" can fail to launch under ConPTY ("File not found") even
// though `where` finds it — pty.spawn's process creation doesn't reliably
// search PATH. COMSPEC is guaranteed set by Windows itself to an absolute path.
function resolveShellCmd(rawCmd, isWin, comspec) {
  if (isWin && rawCmd && !rawCmd.includes(path.sep) && /^cmd(\.exe)?$/i.test(rawCmd)) {
    return comspec || 'C:\\Windows\\System32\\cmd.exe';
  }
  return rawCmd;
}
ipcMain.handle('term:create', async (_, sessionId, shellCmd) => {
  if (termSessions.has(sessionId)) { try { termSessions.get(sessionId).proc.kill(); } catch {} termSessions.delete(sessionId); }

  let resolvedCmd = shellCmd;
  if (!resolvedCmd) {
    const shells = await listAvailableShells();
    if (!shells.length) return { ok: false, error: 'No shell found on this system' };
    resolvedCmd = shells[0].cmd; // auto-connect to best-detected system shell
  }
  resolvedCmd = resolveShellCmd(resolvedCmd, IS_WIN, process.env.COMSPEC);

  let proc, isPty = !!pty;
  const cwd = fs.existsSync(projectRoot || '') ? projectRoot : os.homedir(); // never spawn with a stale/missing cwd
  try {
    if (pty) {
      const shellArgs = IS_WIN ? [] : ['--login'];
      proc = pty.spawn(resolvedCmd, shellArgs, {
        name: 'xterm-256color', cols: 120, rows: 30, cwd,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      proc.onData(data => safeSend('term:output', { id: sessionId, data }));
      proc.onExit(({ exitCode, signal }) => {
        safeSend('term:exit', { id: sessionId, exitCode, signal });
        termSessions.delete(sessionId);
      });
    } else {
      const shellArgs = IS_WIN ? [] : ['--login'];
      proc = spawn(resolvedCmd, shellArgs, { env: { ...process.env, TERM: 'dumb' }, cwd });
      proc.stdout.on('data', d => safeSend('term:output', { id: sessionId, data: d.toString() }));
      proc.stderr.on('data', d => safeSend('term:output', { id: sessionId, data: d.toString() }));
      proc.on('close', () => { safeSend('term:exit', { id: sessionId }); termSessions.delete(sessionId); });
      proc.on('error', e => { safeSend('term:error', { id: sessionId, msg: e.message }); termSessions.delete(sessionId); });
    }
  } catch (e) {
    // This is the fix: pty.spawn() can throw SYNCHRONOUSLY (bad shell path, WSL
    // not installed/no default distro, ConPTY init failure, etc). Previously
    // this was uncaught — the tab appeared but nothing ever loaded, silently.
    return { ok: false, error: `Could not start "${resolvedCmd}": ${e.message}` };
  }
  termSessions.set(sessionId, { proc, isPty, shellCmd: resolvedCmd });
  return { ok: true, hasPty: isPty, shellCmd: resolvedCmd };
});

ipcMain.on('term:input', (_, sessionId, data) => {
  const s = termSessions.get(sessionId);
  if (!s) return;
  if (s.isPty && typeof s.proc.write === 'function') s.proc.write(data);
  else if (s.proc.stdin) s.proc.stdin.write(data);
});
function winPathToWslPath(winPath) {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(winPath || '');
  if (!m) return (winPath || '').replace(/\\/g, '/'); // already unix-like or unrecognized — best effort
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
}
function buildCdCommand(shellCmd, dir) {
  if (/wsl(\.exe)?$/i.test(shellCmd || '')) return `cd "${winPathToWslPath(dir)}"\r`;
  const isCmd = /(^|[\\/])cmd(\.exe)?$/i.test(shellCmd || '');
  return isCmd ? `cd /d "${dir}"\r` : `cd "${dir}"\r`;
}
ipcMain.on('term:cd', (_, sessionId, dir) => {
  const s = termSessions.get(sessionId);
  if (!s) return;
  const cmd = buildCdCommand(s.shellCmd, dir);
  if (s.isPty && typeof s.proc.write === 'function') s.proc.write(cmd);
  else if (s.proc.stdin) s.proc.stdin.write(cmd);
});
ipcMain.on('term:resize', (_, sessionId, cols, rows) => {
  const s = termSessions.get(sessionId);
  if (s && s.isPty && typeof s.proc.resize === 'function') { try { s.proc.resize(cols, rows); } catch {} }
});
ipcMain.on('term:close', (_, sessionId) => {
  const s = termSessions.get(sessionId);
  if (s) { try { s.proc.kill(); } catch {} termSessions.delete(sessionId); }
});

ipcMain.on('process:input', (_, data) => { if (runProcess?.stdin) runProcess.stdin.write(data); });

// ═══════════════════════════════════════════════════════════════════════════
// ─── AI AGENT ─────────────────────────────────────────────────────────────────
// Config (API keys) are AES-encrypted on disk via Electron's OS-level
// safeStorage (DPAPI / Keychain / libsecret). Nothing is ever sent to the
// renderer in plaintext.
// ═══════════════════════════════════════════════════════════════════════════

const AI_CONFIG_PATH = path.join(app.getPath('userData'), 'ai-config.json');
let projectRoot = null; // set by renderer whenever a folder is opened

function loadAiConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(AI_CONFIG_PATH, 'utf8'));
    const keys = {};
    for (const provider of Object.keys(raw.keys || {})) {
      try {
        keys[provider] = safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(Buffer.from(raw.keys[provider], 'base64'))
          : Buffer.from(raw.keys[provider], 'base64').toString('utf8');
      } catch { /* corrupted/undecryptable entry, skip */ }
    }
    return { provider: raw.provider || 'anthropic', model: raw.model || '', ollamaUrl: raw.ollamaUrl || 'http://localhost:11434', keys };
  } catch {
    return { provider: 'anthropic', model: '', ollamaUrl: 'http://localhost:11434', keys: {} };
  }
}

function saveAiConfig(cfg) {
  const out = { provider: cfg.provider, model: cfg.model, ollamaUrl: cfg.ollamaUrl, keys: {} };
  for (const provider of Object.keys(cfg.keys || {})) {
    const val = cfg.keys[provider];
    if (!val) continue;
    out.keys[provider] = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(val).toString('base64')
      : Buffer.from(val, 'utf8').toString('base64');
  }
  fs.writeFileSync(AI_CONFIG_PATH, JSON.stringify(out, null, 2), 'utf8');
}

ipcMain.handle('ai:getConfig', async () => {
  const cfg = loadAiConfig();
  // Never leak raw keys to renderer — just booleans of which are set
  return {
    provider: cfg.provider, model: cfg.model, ollamaUrl: cfg.ollamaUrl,
    hasKey: Object.fromEntries(Object.keys(cfg.keys).map(k => [k, !!cfg.keys[k]])),
  };
});

ipcMain.handle('ai:saveConfig', async (_, partial) => {
  const cfg = loadAiConfig();
  if (partial.provider) cfg.provider = partial.provider;
  if (partial.model !== undefined) cfg.model = partial.model;
  if (partial.ollamaUrl) cfg.ollamaUrl = partial.ollamaUrl;
  if (partial.keys) Object.assign(cfg.keys, partial.keys);
  saveAiConfig(cfg);
  return true;
});

ipcMain.handle('ai:clearKey', async (_, provider) => {
  const cfg = loadAiConfig();
  delete cfg.keys[provider];
  saveAiConfig(cfg);
  return true;
});

ipcMain.handle('ai:listOllamaModels', async () => {
  const cfg = loadAiConfig();
  try {
    const res = await fetch(`${cfg.ollamaUrl}/api/tags`);
    const data = await res.json();
    return (data.models || []).map(m => m.name);
  } catch (e) {
    return [];
  }
});

// ── Provider adapters ── each returns { text, toolCalls: [{id,name,args}] }
// `messages` arrives from the renderer in ONE normalized shape regardless of provider:
//   {role:'user', content:string}
//   {role:'assistant', content:string, toolCalls?:[{id,name,args}]}
//   {role:'tool', tool_call_id, name, content:string}   (a tool's result)
// Each adapter converts that into whatever wire format its API actually wants.

async function callOpenAI(apiKey, model, messages, tools, systemPrompt) {
  const wire = messages.map(m => {
    if (m.role === 'assistant') {
      const out = { role:'assistant', content: m.content || null };
      if (m.toolCalls?.length) out.tool_calls = m.toolCalls.map(tc => ({ id: tc.id, type:'function', function:{ name: tc.name, arguments: JSON.stringify(tc.args || {}) } }));
      return out;
    }
    if (m.role === 'tool') return { role:'tool', tool_call_id: m.tool_call_id, content: m.content };
    return { role: m.role, content: m.content };
  });
  if (systemPrompt) wire.unshift({ role: 'system', content: systemPrompt });
  const body = {
    model, messages: wire,
    ...(tools?.length ? { tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'OpenAI error');
  const msg = data.choices[0].message;
  const toolCalls = (msg.tool_calls || []).map(tc => ({ id: tc.id, name: tc.function.name, args: JSON.parse(tc.function.arguments || '{}') }));
  return { text: msg.content || '', toolCalls };
}

async function callAnthropic(apiKey, model, messages, tools, systemPrompt) {
  const wire = messages.map(m => {
    if (m.role === 'assistant') {
      const blocks = [];
      if (m.content) blocks.push({ type:'text', text: m.content });
      for (const tc of (m.toolCalls || [])) blocks.push({ type:'tool_use', id: tc.id, name: tc.name, input: tc.args || {} });
      return { role:'assistant', content: blocks };
    }
    if (m.role === 'tool') return { role:'user', content: [{ type:'tool_result', tool_use_id: m.tool_call_id, content: m.content }] };
    return { role:'user', content: m.content };
  });
  const body = {
    model, max_tokens: 4096, system: systemPrompt,
    messages: wire,
    ...(tools?.length ? { tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Anthropic error');
  let text = '';
  const toolCalls = [];
  for (const block of data.content || []) {
    if (block.type === 'text') text += block.text;
    if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, args: block.input });
  }
  return { text, toolCalls };
}

async function callGemini(apiKey, model, messages, tools, systemPrompt) {
  // Best-effort mapping — Google has churned this format across API versions,
  // so double-check against current docs if function calling misbehaves.
  const contents = messages.map(m => {
    if (m.role === 'assistant') {
      const parts = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of (m.toolCalls || [])) {
        const part = { functionCall: { name: tc.name, args: tc.args || {} } };
        // Thinking-enabled models (2.5+) require the exact signature they issued
        // to be echoed back on this part, or they warn/degrade on the next turn.
        if (tc.thoughtSignature) part.thoughtSignature = tc.thoughtSignature;
        parts.push(part);
      }
      return { role:'model', parts };
    }
    if (m.role === 'tool') return { role:'function', parts: [{ functionResponse: { name: m.name, response: { result: m.content } } }] };
    return { role:'user', parts: [{ text: m.content }] };
  });
  const body = {
    contents,
    ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
    ...(tools?.length ? { tools: [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }] } : {}),
  };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Gemini error');
  const parts = data.candidates?.[0]?.content?.parts || [];
  let text = '';
  const toolCalls = [];
  for (const p of parts) {
    if (p.text) text += p.text;
    if (p.functionCall) {
      toolCalls.push({
        id: crypto.randomUUID(), name: p.functionCall.name, args: p.functionCall.args || {},
        thoughtSignature: p.thoughtSignature || p.thought_signature || undefined,
      });
    }
  }
  return { text, toolCalls };
}

async function callOllama(baseUrl, model, messages, tools, systemPrompt) {
  const wire = messages.map(m => {
    if (m.role === 'assistant') {
      const out = { role:'assistant', content: m.content || '' };
      if (m.toolCalls?.length) out.tool_calls = m.toolCalls.map(tc => ({ function: { name: tc.name, arguments: tc.args || {} } }));
      return out;
    }
    if (m.role === 'tool') return { role:'tool', content: m.content };
    return { role: m.role, content: m.content };
  });
  if (systemPrompt) wire.unshift({ role: 'system', content: systemPrompt });
  const body = {
    model, stream: false, messages: wire,
    ...(tools?.length ? { tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
  };
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  const msg = data.message || {};
  const toolCalls = (msg.tool_calls || []).map(tc => ({ id: crypto.randomUUID(), name: tc.function.name, args: tc.function.arguments || {} }));
  return { text: msg.content || '', toolCalls };
}

// Single normalized entry point used by the renderer's agent loop.
// `messages`: [{role:'user'|'assistant'|'tool', content, tool_call_id?, name?}]
ipcMain.handle('ai:chatOnce', async (_, { provider, model, messages, tools, systemPrompt }) => {
  const cfg = loadAiConfig();
  try {
    if (provider === 'openai')     return await callOpenAI(cfg.keys.openai, model, messages, tools, systemPrompt);
    if (provider === 'anthropic')  return await callAnthropic(cfg.keys.anthropic, model, messages, tools, systemPrompt);
    if (provider === 'gemini')     return await callGemini(cfg.keys.gemini, model, messages, tools, systemPrompt);
    if (provider === 'ollama')     return await callOllama(cfg.ollamaUrl, model, messages, tools, systemPrompt);
    throw new Error('Unknown provider: ' + provider);
  } catch (e) {
    return { error: e.message || String(e) };
  }
});

// ── Permission gate ──────────────────────────────────────────────────────────
// Reads/RAG/normal edits inside the open project folder are silent.
// Only "critical" files/paths and dangerous shell commands trigger a popup.
const CRITICAL_NAME_PATTERNS = [
  /^\.env(\..*)?$/i, /^package(-lock)?\.json$/i, /^\.git\b/, /^\.ssh\b/,
  /id_rsa|id_ed25519/i, /\.pem$|\.key$|\.pfx$|\.crt$/i, /credentials|secrets/i,
  /^\.liteide[\\/]agent-permissions\.json$/i,
];
const CRITICAL_CMD_PATTERNS = [
  /\brm\s+-rf\b/i, /\bdel\s+\/f\s+\/s\s+\/q\b/i, /\bformat\b/i, /\bshutdown\b/i,
  /\bsudo\b/i, /\bmkfs\b/i, /git\s+push\s+--force/i, />\s*\/dev\/sd/i, /\bdd\s+if=/i,
];

function isCriticalFile(relPath) {
  const parts = relPath.replace(/\\/g, '/').split('/');
  return parts.some(p => CRITICAL_NAME_PATTERNS.some(rx => rx.test(p)));
}
function isCriticalCommand(cmd) {
  return CRITICAL_CMD_PATTERNS.some(rx => rx.test(cmd));
}
function resolveInProject(relPath) {
  if (!projectRoot) throw new Error('No project folder open');
  const abs = path.resolve(projectRoot, relPath);
  if (!abs.startsWith(path.resolve(projectRoot))) throw new Error('Path escapes project folder — blocked');
  return abs;
}

// Approval round-trip: main asks renderer to show a glass popup, waits for the click.
const pendingApprovals = new Map();
ipcMain.on('agent:approvalResponse', (_, { id, approved }) => {
  const resolver = pendingApprovals.get(id);
  if (resolver) { resolver(approved); pendingApprovals.delete(id); }
});
function requestApproval(action, detail) {
  return new Promise(resolve => {
    const id = crypto.randomUUID();
    pendingApprovals.set(id, resolve);
    safeSend('agent:approvalRequest', { id, action, detail });
  });
}


// ── Universal Coding Agent skill — seeded into every project, provider-agnostic ──
const UNIVERSAL_SKILL_NAME = 'universal-coding-agent.md';
const UNIVERSAL_SKILL_VERSION = '1.1.0';
const UNIVERSAL_SKILL_CONTENT = `<!-- LiteIDE Universal Coding Agent Skill — v1.1.0 -->
# Universal Coding Agent Skill — v1.1.0

Provider-agnostic core discipline. Applies identically whether you are Claude, GPT, Gemini, or a local Ollama model — this is plain instruction text, not a provider-specific feature. Every directive below is a hard rule, not a suggestion, unless marked "prefer."

## 1. Verification discipline
- Never assume file contents, signatures, config values, or directory structure. Read first.
- \`list_dir\` before guessing a project's layout. \`read_file\` before editing or quoting a file.
- \`search_codebase\` before saying "this doesn't exist" or "there's no existing implementation."
- Never report success without a tool call in this session proving it. "Should work" is not verification.
- After every \`run_command\`/\`run_in_terminal\`, read the actual stdout/stderr — do not assume exit 0.
- Re-read a file after \`edit_file\` fails once before retrying — content may have shifted.

## 2. Tool selection — exact rules, not vibes
- \`edit_file\` — default for any change to an existing file. Precise, scoped, safe.
- \`write_file\` — new files only, or a deliberate full rewrite the user asked for.
- \`read_file\` / \`list_dir\` — free, safe, use liberally, never skip.
- \`search_codebase\` — keyword/RAG search before assuming a symbol/pattern doesn't exist.
- \`run_command\` — isolated background execution; output returns to you, user doesn't see it live.
- \`run_in_terminal\` — executes in the visible integrated terminal the user is looking at. Use for: dev servers, watch/build loops, long-running or interactive processes, anything the user should watch happen live. Does not block waiting for output — it streams into the terminal panel.
- \`delete_file\` — deliberate only, always gated behind user approval. Never used to "explore."
- \`spawn_subagents\` — only for genuinely parallel, independent sub-tasks with no shared-state dependency. Never for a single file or a linear sequence of steps.
- One line of narration before a tool call, max. No paragraph-long preambles. No restating a tool result the user can already see.

## 3. Editing precision
- \`old_str\` in \`edit_file\` must be exact, whitespace included, and unique in the file.
- Ambiguous match ("appears N times")? Widen the snippet with more surrounding lines — never fall back to \`write_file\` as a shortcut.
- Never rewrite a whole file to change a few lines.
- Never refactor, rename, or reformat code outside the scope of what was asked.
- Preserve existing comments, blank-line structure, and trailing newline conventions unless the task is specifically about those.

## 4. Language/file-type coverage — same discipline, every type
- Python / JS / TS / JSX / TSX / Go / Rust / C / C++ / Java / Ruby / PHP — same read→edit→verify loop.
- HTML / CSS / JSON / YAML / TOML / XML / SQL — same loop; validate syntax with a fast tool when one is available (\`python -m json.tool\`, \`node --check\`, etc.).
- Shell / Batch / PowerShell scripts — verify with a dry run or syntax check before assuming they work.
- VHDL / SystemVerilog / Verilog — analyze/elaborate before claiming a testbench passes; read simulator output for \`PASS\`/\`FAIL\`/assertion text, don't infer from exit code alone.
- Arduino (.ino) — compile-check only, never claim upload/flash succeeded; this environment has no board/port control.
- Markdown / plaintext / docs — precision still applies: don't restructure headings or reflow prose the user didn't ask you to touch.

## 5. Convention-matching — detect before you write
- Indentation: match tabs vs spaces and width exactly as seen in the file being edited.
- Naming: match camelCase / snake_case / PascalCase already in use in that file/module.
- Imports: match existing import grouping/ordering style; don't introduce a new dependency when an already-imported one covers the need.
- Tests: match the existing test framework and file-naming pattern if the project has one; don't invent a second one.
- Error handling: match the existing pattern (exceptions vs error-return vs Result types) rather than substituting your own default.

## 6. Terminal access — real, visible, multi-session
- The IDE has real multi-session terminals (PowerShell/CMD/Bash/zsh/WSL), not a sandboxed fake shell.
- \`run_in_terminal\` targets the terminal tab the user currently has focused/visible — they see every character.
- \`run_command\` is the isolated/background alternative — use it for quick checks you don't need the user to watch.
- Never assume a terminal is in a particular directory — the working directory is the opened project root; \`cd\` explicitly in the command if you need elsewhere.
- Long-running/interactive processes (servers, watchers, REPLs) belong in \`run_in_terminal\`, never in \`run_command\` — background execution has no interactive stdin path.
- Destructive shell patterns (\`rm -rf\`, force-push, \`sudo\`, disk-level commands) are approval-gated by design — do not attempt to route around this via a different tool.

## 7. Permission boundary
- \`.env\`, \`package.json\`, git internals, and key files trigger approval by design — this is a safety feature, never an obstacle to engineer around.
- Do not attempt indirect writes to critical files via \`run_command\`/\`run_in_terminal\` to dodge the \`write_file\`/\`edit_file\` approval check — the intent of the boundary is what matters, not the literal tool name.
- \`delete_file\` always requires approval; never call it speculatively.

## 8. Planning and communication
- Trivial task (1-2 tool calls): just do it, minimal narration.
- Multi-step task: form a short internal plan first, then execute — don't think out loud at length before acting.
- Stuck after 2-3 genuine attempts at the same error: stop, state exactly what's blocking and what you ruled out. Do not loop indefinitely on the same failing approach.
- Never fabricate output, file contents, or command results you have not actually seen from a tool call.

## 9. Persistent memory discipline
- Durable, project-specific facts (build quirks, "don't do X because Y", conventions not obvious from the code) go in \`.liteide/agent-memory.md\` via \`edit_file\`.
- Keep entries short, factual, dated if relevant — not a running journal.
- Prune entries that are no longer true instead of letting stale guidance accumulate.
- Do not duplicate this skill file's contents into memory — memory is for project-specific facts, this file is the universal baseline.

## 10. Parallelism rules (\`spawn_subagents\`)
- Valid: "write unit tests for module A" + "update README for module B" simultaneously — no shared state, no ordering dependency.
- Invalid: splitting a single file's edits across sub-agents — race conditions on the same file.
- Invalid: a task where step 2 needs step 1's output — that's sequential, not parallel.
- Cap awareness: sub-agents run with a reduced tool set (no further spawning) and a step budget — scope each sub-task to something completable in a handful of tool calls.

## 11. Failure honesty
- A tool/compiler/interpreter not installed → say exactly that, name the missing tool, don't silently skip the step.
- A test that fails → show the real failure output, don't paraphrase it away.
- A task partially done → say precisely how far you got and what remains, never imply full completion.
`;

// Seeds the skill on first project open. On later opens, if the on-disk file
// is missing this version's marker (i.e. it's an older shipped version OR the
// user customized it), the old content is preserved as a .bak file and the
// current version is written fresh — upgrades never silently discard edits.
function ensureUniversalSkillSeeded() {
  if (!projectRoot) return;
  const dir = path.join(projectRoot, '.liteide', 'skills');
  const target = path.join(dir, UNIVERSAL_SKILL_NAME);
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(target)) {
      fs.writeFileSync(target, UNIVERSAL_SKILL_CONTENT, 'utf8');
    } else {
      const existing = fs.readFileSync(target, 'utf8');
      if (!existing.includes(`v${UNIVERSAL_SKILL_VERSION}`)) {
        fs.writeFileSync(target + '.bak', existing, 'utf8');
        fs.writeFileSync(target, UNIVERSAL_SKILL_CONTENT, 'utf8');
      }
    }
  } catch (e) {
    console.error('[LiteIDE] Failed to seed universal-coding-agent.md skill:', e.message);
  }
}

ipcMain.handle('agent:setProjectRoot', async (_, root) => { projectRoot = root; ensureUniversalSkillSeeded(); return true; });


// Tool: read file (always silent — needed for RAG/context)
ipcMain.handle('agent:readFile', async (_, relPath) => {
  try { return { ok: true, content: fs.readFileSync(resolveInProject(relPath), 'utf8') }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// Tool: list directory (always silent)
ipcMain.handle('agent:listDir', async (_, relPath = '.') => {
  const IGNORE = new Set(['.git','node_modules','__pycache__','dist','build','.cache']);
  try {
    const abs = resolveInProject(relPath);
    function walk(p, depth = 0) {
      if (depth > 5) return [];
      return fs.readdirSync(p, { withFileTypes: true })
        .filter(e => !IGNORE.has(e.name))
        .map(e => ({ name: e.name, isDir: e.isDirectory(), path: path.relative(projectRoot, path.join(p, e.name)),
          children: e.isDirectory() ? walk(path.join(p, e.name), depth + 1) : undefined }));
    }
    return { ok: true, entries: walk(abs) };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Tool: write/create file — gated if critical
ipcMain.handle('agent:writeFile', async (_, relPath, content) => {
  try {
    const critical = isCriticalFile(relPath);
    if (critical) {
      const approved = await requestApproval('write_file', { path: relPath, preview: content.slice(0, 400) });
      if (!approved) return { ok: false, error: 'Denied by user' };
    }
    const abs = resolveInProject(relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    return { ok: true, critical };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Precise edit: replaces an exact substring rather than the whole file.
// Refuses if oldStr isn't found, or is ambiguous (appears more than once) —
// forces the agent to give enough surrounding context to target the right
// spot, the same discipline real coding-agent edit tools enforce.
ipcMain.handle('agent:editFile', async (_, relPath, oldStr, newStr) => {
  try {
    const abs = resolveInProject(relPath);
    if (!fs.existsSync(abs)) return { ok: false, error: `File not found: ${relPath}` };
    const content = fs.readFileSync(abs, 'utf8');
    const occurrences = content.split(oldStr).length - 1;
    if (occurrences === 0) return { ok: false, error: 'old_str not found in file — re-read the file, it may have changed' };
    if (occurrences > 1) return { ok: false, error: `old_str appears ${occurrences} times — include more surrounding context to target one exact spot` };
    const next = content.replace(oldStr, () => newStr); // function form avoids $-pattern substitution surprises
    const critical = isCriticalFile(relPath);
    if (critical) {
      const approved = await requestApproval('write_file', { path: relPath, preview: newStr.slice(0, 400) });
      if (!approved) return { ok: false, error: 'Denied by user' };
    }
    fs.writeFileSync(abs, next, 'utf8');
    return { ok: true, critical };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Tool: delete file — always gated (destructive)
ipcMain.handle('agent:deleteFile', async (_, relPath) => {
  try {
    const approved = await requestApproval('delete_file', { path: relPath });
    if (!approved) return { ok: false, error: 'Denied by user' };
    fs.unlinkSync(resolveInProject(relPath));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Tool: run shell command — gated only if it matches a destructive pattern
ipcMain.handle('agent:runCommand', async (_, cmd) => {
  try {
    const critical = isCriticalCommand(cmd);
    if (critical) {
      const approved = await requestApproval('run_command', { command: cmd });
      if (!approved) return { ok: false, error: 'Denied by user' };
    }
    if (!projectRoot) return { ok: false, error: 'No project folder open' };
    return await new Promise(resolve => {
      const sh = IS_WIN ? 'cmd' : 'bash';
      const flag = IS_WIN ? '/c' : '-c';
      const child = spawn(sh, [flag, cmd], { cwd: projectRoot, env: process.env });
      let out = '', err = '';
      child.stdout.on('data', d => { out += d.toString(); safeSend('agent:commandOutput', { stream: 'stdout', data: d.toString() }); });
      child.stderr.on('data', d => { err += d.toString(); safeSend('agent:commandOutput', { stream: 'stderr', data: d.toString() }); });
      child.on('close', code => resolve({ ok: true, code, stdout: out.slice(-8000), stderr: err.slice(-8000), critical }));
      child.on('error', e => resolve({ ok: false, error: e.message }));
    });
  } catch (e) { return { ok: false, error: e.message }; }
});

// ─── Project-wide Search & Replace ──────────────────────────────────────────
const SEARCH_IGNORE_DIRS = new Set(['.git','node_modules','__pycache__','dist','build','.cache','.liteide','target']);
const SEARCH_MAX_FILE_BYTES = 2 * 1024 * 1024; // skip anything bigger (likely binary/generated)

function searchCollectFiles(root) {
  const out = [];
  (function walk(p) {
    let entries;
    try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.git')) continue;
      if (SEARCH_IGNORE_DIRS.has(e.name)) continue;
      const full = path.join(p, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(full);
    }
  })(root);
  return out;
}
function buildSearchMatcher(query, opts) {
  if (opts.regex) {
    try { return new RegExp(query, opts.caseSensitive ? 'g' : 'gi'); }
    catch { return null; }
  }
  let esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (opts.wholeWord) esc = `\\b${esc}\\b`;
  return new RegExp(esc, opts.caseSensitive ? 'g' : 'gi');
}

ipcMain.handle('search:project', async (_, query, opts = {}) => {
  if (!projectRoot || !query) return { ok: true, results: [] };
  const rx = buildSearchMatcher(query, opts);
  if (!rx) return { ok: false, error: 'Invalid regex' };
  const files = searchCollectFiles(projectRoot).slice(0, 5000);
  const results = [];
  outer:
  for (const file of files) {
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    if (stat.size > SEARCH_MAX_FILE_BYTES) continue;
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (content.includes('\u0000')) continue; // looks binary
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      rx.lastIndex = 0;
      if (rx.test(lines[i])) {
        results.push({ file: path.relative(projectRoot, file), line: i + 1, text: lines[i].slice(0, 300) });
        if (results.length >= 500) break outer;
      }
    }
  }
  return { ok: true, results };
});

ipcMain.handle('search:replaceAll', async (_, query, replacement, opts = {}, files) => {
  if (!projectRoot || !query) return { ok: false, error: 'No project open' };
  const rx = buildSearchMatcher(query, opts);
  if (!rx) return { ok: false, error: 'Invalid regex' };
  const targetFiles = (files && files.length ? files.map(f => path.join(projectRoot, f)) : searchCollectFiles(projectRoot));
  let changedFiles = 0, changedLines = 0;
  for (const file of targetFiles) {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (content.includes('\u0000')) continue;
    const globalRx = new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : rx.flags + 'g');
    let count = 0;
    const next = content.replace(globalRx, () => { count++; return replacement; });
    if (count > 0) {
      fs.writeFileSync(file, next, 'utf8');
      changedFiles++; changedLines += count;
    }
  }
  return { ok: true, changedFiles, changedLines };
});

// ─── Git status / diff (shells out to the user's own git install) ──────────
function runGit(args, cwd) {
  return new Promise(resolve => {
    exec(`git ${args}`, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

ipcMain.handle('git:isRepo', async () => {
  if (!projectRoot) return false;
  const r = await runGit('rev-parse --is-inside-work-tree', projectRoot);
  return r.ok && r.stdout.trim() === 'true';
});

// Returns { "relative/path.js": "M" | "A" | "D" | "??" | "R" | ... }
ipcMain.handle('git:status', async () => {
  if (!projectRoot) return {};
  const r = await runGit('status --porcelain=v1 -uall', projectRoot);
  if (!r.ok) return {};
  const map = {};
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2).trim();
    let rel = line.slice(3).trim();
    if (rel.includes(' -> ')) rel = rel.split(' -> ')[1]; // renames: show at new path
    map[rel.replace(/^"|"$/g, '')] = code || '??';
  }
  return map;
});

ipcMain.handle('git:diff', async (_, relPath) => {
  if (!projectRoot) return { ok: false, error: 'No project open' };
  const status = await runGit(`status --porcelain=v1 -- "${relPath}"`, projectRoot);
  const isUntracked = status.stdout.trim().startsWith('??');
  const current = (() => { try { return fs.readFileSync(path.join(projectRoot, relPath), 'utf8'); } catch { return ''; } })();
  if (isUntracked) return { ok: true, original: '', modified: current, untracked: true };
  const head = await runGit(`show HEAD:"${relPath.replace(/\\/g,'/')}"`, projectRoot);
  return { ok: true, original: head.ok ? head.stdout : '', modified: current, untracked: false };
});

// ── Lightweight local RAG (no vector DB / no embedding API required) ───────
// Chunks text files under the project and scores chunks against the query
// with a simple TF-IDF-ish keyword overlap — fast, offline, zero dependency,
// good enough for "find the file/function relevant to X" in a codebase.
const RAG_IGNORE_DIRS = new Set(['.git','node_modules','__pycache__','dist','build','.cache','.liteide']);
const RAG_EXTS = new Set(['.js','.ts','.jsx','.tsx','.py','.json','.md','.html','.css','.java','.go','.rs','.c','.cpp','.h','.rb','.php','.txt']);

function ragCollectFiles(root) {
  const out = [];
  (function walk(p) {
    let entries;
    try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (RAG_IGNORE_DIRS.has(e.name)) continue;
      const full = path.join(p, e.name);
      if (e.isDirectory()) walk(full);
      else if (RAG_EXTS.has(path.extname(e.name))) out.push(full);
    }
  })(root);
  return out;
}
function chunkText(text, size = 60) {
  const lines = text.split('\n');
  const chunks = [];
  for (let i = 0; i < lines.length; i += size) chunks.push({ start: i + 1, text: lines.slice(i, i + size).join('\n') });
  return chunks;
}
function tokenize(s) { return (s.toLowerCase().match(/[a-z0-9_]{3,}/g) || []); }

ipcMain.handle('agent:ragSearch', async (_, query, topK = 8) => {
  if (!projectRoot) return { ok: false, error: 'No project folder open' };
  const qTokens = new Set(tokenize(query));
  if (!qTokens.size) return { ok: true, results: [] };
  const files = ragCollectFiles(projectRoot).slice(0, 2000); // sanity cap
  const scored = [];
  for (const file of files) {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const chunk of chunkText(content)) {
      const tokens = tokenize(chunk.text);
      if (!tokens.length) continue;
      let hits = 0;
      for (const t of tokens) if (qTokens.has(t)) hits++;
      if (hits === 0) continue;
      const score = hits / Math.sqrt(tokens.length);
      scored.push({ file: path.relative(projectRoot, file), start: chunk.start, score, text: chunk.text });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return { ok: true, results: scored.slice(0, topK) };
});

// ── Skills: user-supplied .md files the agent can read on demand ────────────
// Lives at .liteide/skills/*.md inside the project. Listed (name + first
// descriptive line only) in the system prompt so the agent knows what exists
// without burning context on full contents until it actually needs one —
// it reads the full file via the normal read_file tool when relevant.
function skillsDir() { return path.join(projectRoot, '.liteide', 'skills'); }

ipcMain.handle('agent:listSkills', async () => {
  if (!projectRoot) return [];
  const dir = skillsDir();
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.md')) continue;
    let firstLine = '';
    try { firstLine = fs.readFileSync(path.join(dir, name), 'utf8').split('\n').find(l => l.trim()) || ''; } catch {}
    out.push({ name, path: `.liteide/skills/${name}`, description: firstLine.replace(/^#+\s*/, '').slice(0, 140) });
  }
  return out;
});

ipcMain.handle('agent:saveSkill', async (_, name, content) => {
  if (!projectRoot) return { ok: false, error: 'No project folder open' };
  try {
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/\.md$/i, '') + '.md';
    const dir = skillsDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, safeName), content, 'utf8');
    return { ok: true, name: safeName };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('agent:deleteSkill', async (_, name) => {
  if (!projectRoot) return { ok: false, error: 'No project folder open' };
  try {
    const safeName = path.basename(name); // no path traversal via skill name
    fs.unlinkSync(path.join(skillsDir(), safeName));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ─── Misc ─────────────────────────────────────────────────────────────────────
ipcMain.on('open:external',    (_, url) => shell.openExternal(url));
ipcMain.handle('app:platform', ()       => process.platform);
ipcMain.handle('app:homedir',  ()       => os.homedir());

module.exports = { buildCdCommand, extractLaunchFilePath, isCriticalFile, isCriticalCommand, winPathToWslPath, resolveShellCmd };
