const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const os = require('os');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_DEV = process.argv.includes('--dev');

let mainWindow, shellProcess = null, runProcess = null, currentShellCmd = '';

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
  'Lua':        { win:'https://lua.org/download.html',             mac:'https://lua.org/download.html',             linux:'https://lua.org/download.html' },
  'Elixir':     { win:'https://elixir-lang.org/install.html',      mac:'https://elixir-lang.org/install.html',      linux:'https://elixir-lang.org/install.html' },
  'Haskell':    { win:'https://www.haskell.org/ghcup/',            mac:'https://www.haskell.org/ghcup/',            linux:'https://www.haskell.org/ghcup/' },
  'Zig':        { win:'https://ziglang.org/download/',             mac:'https://ziglang.org/download/',             linux:'https://ziglang.org/download/' },
  'Julia':      { win:'https://julialang.org/downloads/',          mac:'https://julialang.org/downloads/',          linux:'https://julialang.org/downloads/' },
  'Nim':        { win:'https://nim-lang.org/install.html',         mac:'https://nim-lang.org/install.html',         linux:'https://nim-lang.org/install.html' },
  'C#':         { win:'https://dotnet.microsoft.com/download',         mac:'https://dotnet.microsoft.com/download',         linux:'https://dotnet.microsoft.com/download' },
  'F#':         { win:'https://dotnet.microsoft.com/download',         mac:'https://dotnet.microsoft.com/download',         linux:'https://dotnet.microsoft.com/download' },
  'Deno':       { win:'https://deno.com/',                             mac:'https://deno.com/',                             linux:'https://deno.com/' },
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
  mainWindow.on('maximize',   () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (!IS_MAC) app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ─── Window controls ─────────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('window:close',    () => mainWindow.close());

// ─── File System ─────────────────────────────────────────────────────────────
ipcMain.handle('fs:openFolder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
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
    mainWindow.webContents.send('process:stdout', `🌐 Opening in browser: ${filePath}\n`);
    mainWindow.webContents.send('process:exit', 0);
    return true;
  }

  const cmd = await findCmd(lang.cmds);
  if (!cmd) {
    mainWindow.webContents.send('process:error',
      `${langName} is not installed. Visit ${(INSTALL_LINKS[langName]||{})[(IS_WIN?'win':IS_MAC?'mac':'linux')] || 'the official website'} to install it.`);
    return false;
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

  runProcess.stdout.on('data', d => mainWindow.webContents.send('process:stdout', d.toString()));
  runProcess.stderr.on('data', d => mainWindow.webContents.send('process:stderr', d.toString()));
  runProcess.on('close', code => { mainWindow.webContents.send('process:exit', code); runProcess = null; });
  runProcess.on('error', err => { mainWindow.webContents.send('process:error', err.message); runProcess = null; });
  return true;
});

ipcMain.handle('code:stop', async () => {
  if (runProcess) { try { runProcess.kill(); } catch {} runProcess = null; return true; }
  return false;
});

// ─── Shell (node-pty PTY — full backspace, arrows, Ctrl+C, colours) ─────────
let pty;
try { pty = require('node-pty'); } catch(e) { pty = null; }

ipcMain.handle('shell:getAvailable', async () => {
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
      const exists = s.cmd.includes(path.sep)
        ? fs.existsSync(s.cmd)
        : await new Promise(r => exec(`where ${s.cmd}`, err => r(!err)));
      if (exists) shells.push(s);
    }
  } else {
    // Put user's default shell first
    const defaultShell = process.env.SHELL || '';
    const seen = new Set();

    const candidates = [
      // User's current default shell (from $SHELL env)
      ...(defaultShell ? [{ name: path.basename(defaultShell) + ' (default)', cmd: defaultShell }] : []),
      // macOS system shells
      { name: 'zsh',   cmd: '/bin/zsh'                     },
      { name: 'bash',  cmd: '/bin/bash'                    },
      { name: 'sh',    cmd: '/bin/sh'                      },
      // Homebrew shells (Apple Silicon)
      { name: 'zsh (Homebrew)',  cmd: '/opt/homebrew/bin/zsh'  },
      { name: 'bash (Homebrew)', cmd: '/opt/homebrew/bin/bash' },
      { name: 'fish (Homebrew)', cmd: '/opt/homebrew/bin/fish' },
      // Homebrew shells (Intel Mac)
      { name: 'zsh (Homebrew)',  cmd: '/usr/local/bin/zsh'     },
      { name: 'bash (Homebrew)', cmd: '/usr/local/bin/bash'    },
      { name: 'fish (Homebrew)', cmd: '/usr/local/bin/fish'    },
      // Linux paths
      { name: 'zsh',   cmd: '/usr/bin/zsh'                 },
      { name: 'bash',  cmd: '/usr/bin/bash'                },
      { name: 'fish',  cmd: '/usr/bin/fish'                },
      { name: 'fish',  cmd: '/usr/local/bin/fish'          },
      { name: 'dash',  cmd: '/usr/bin/dash'                },
      { name: 'ksh',   cmd: '/usr/bin/ksh'                 },
    ];

    for (const s of candidates) {
      if (!seen.has(s.cmd) && fs.existsSync(s.cmd)) {
        seen.add(s.cmd);
        shells.push(s);
      }
    }
  }
  return shells;
});

ipcMain.handle('shell:spawn', async (_, shellCmd) => {
  if (shellProcess) { try { shellProcess.kill(); } catch {} shellProcess = null; }
  currentShellCmd = shellCmd;
  if (pty) {
    // Mac/Linux: use --login so shell loads .zshrc/.bashrc etc
    const shellArgs = IS_WIN ? [] : ['--login'];
    shellProcess = pty.spawn(shellCmd, shellArgs, {
      name: 'xterm-256color', cols: 120, rows: 30,
      cwd: os.homedir(),
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    shellProcess.onData(data => mainWindow.webContents.send('shell:output', data));
    shellProcess.onExit(() => { mainWindow.webContents.send('shell:exit'); shellProcess = null; });
  } else {
    const shellArgs = IS_WIN ? [] : ['--login'];
    shellProcess = spawn(shellCmd, shellArgs, { env: { ...process.env, TERM: 'dumb' }, cwd: os.homedir() });
    shellProcess.stdout.on('data', d => mainWindow.webContents.send('shell:output', d.toString()));
    shellProcess.stderr.on('data', d => mainWindow.webContents.send('shell:output', d.toString()));
    shellProcess.on('close', () => { mainWindow.webContents.send('shell:exit'); shellProcess = null; });
    shellProcess.on('error', e => { mainWindow.webContents.send('shell:error', e.message); shellProcess = null; });
  }
  return { ok: true, hasPty: !!pty };
});

ipcMain.on('process:input', (_, data) => { if (runProcess?.stdin) runProcess.stdin.write(data); });
ipcMain.on('shell:input',  (_, data) => {
  if (!shellProcess) return;
  if (pty && typeof shellProcess.write === 'function') shellProcess.write(data);
  else if (shellProcess.stdin) shellProcess.stdin.write(data);
});
ipcMain.on('shell:cd', (_, dir) => {
  if (!shellProcess) return;
  const cmd = `cd "${dir}"\r`;
  if (pty && typeof shellProcess.write === 'function') shellProcess.write(cmd);
  else if (shellProcess.stdin) shellProcess.stdin.write(cmd + '\n');
});
ipcMain.on('shell:resize', (_, cols, rows) => {
  if (pty && shellProcess && typeof shellProcess.resize === 'function') {
    try { shellProcess.resize(cols, rows); } catch {}
  }
});
ipcMain.on('shell:kill', () => { if (shellProcess) { try { shellProcess.kill(); } catch {} shellProcess = null; } });

// ─── Misc ─────────────────────────────────────────────────────────────────────
ipcMain.on('open:external',    (_, url) => shell.openExternal(url));
ipcMain.handle('app:platform', ()       => process.platform);
ipcMain.handle('app:homedir',  ()       => os.homedir());
