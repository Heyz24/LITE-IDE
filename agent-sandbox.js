'use strict';
// ─── agent-sandbox.js ─────────────────────────────────────────────────────
// Real OS-level sandboxing for agent:runCommand, per gap-analysis-v3 Critical #1.
//
// Strategy (matches what Codex CLI / Cursor / Claude Code actually ship,
// per the audit's own [WEB:1,2,5,6] citations):
//   - Linux:   bubblewrap (bwrap) — namespace-level FS + network isolation.
//              Also what Codex CLI uses under WSL2.
//   - macOS:   sandbox-exec (Seatbelt) — Apple's own syscall-level sandbox,
//              same primitive Cursor's writeup cites.
//   - Windows: no first-party, dependency-free, syscall-level sandbox is
//              reachable from pure Node without either a native addon or a
//              bundled third-party binary (real AppContainer / low-integrity
//              tokens require Win32 calls; Windows Sandbox is a per-call VM,
//              too slow for iterative tool calls). This is flagged, not
//              silently faked — see README "Known limitation" note. v1 here
//              ships the audit's own suggested interim hardening for
//              Windows: jailed cwd (already existed) + a minimal explicit
//              env allowlist instead of full process.env passthrough.
//
// Every command still passes through the existing regex approval gate in
// main.js (isCriticalCommand) — the sandbox is a second, OS-enforced layer
// underneath that, not a replacement for it (matches Cursor's own
// "allowlist → sandbox → classifier" layering, and Claude Code's principle
// that a model classifier is convenience, not a security boundary).

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Env vars safe (and generally necessary) to pass through to a spawned dev
// command on each platform. Everything else in process.env — cloud CLI
// tokens, SSH agent sockets, unrelated secrets a project has no reason to
// see — is stripped. This applies on every platform, sandboxed or not.
const ENV_ALLOWLIST_COMMON = ['PATH', 'LANG', 'LC_ALL', 'TERM', 'TZ', 'TMPDIR', 'TEMP', 'TMP'];
const ENV_ALLOWLIST_WIN = [
  'SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'PATHEXT',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)',
  'ProgramData', 'HOMEDRIVE', 'HOMEPATH', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
  'USERNAME', 'USERDOMAIN',
];
const ENV_ALLOWLIST_POSIX = ['HOME', 'USER', 'LOGNAME', 'SHELL'];

function buildMinimalEnv(baseEnv, isWin) {
  const keys = ENV_ALLOWLIST_COMMON.concat(isWin ? ENV_ALLOWLIST_WIN : ENV_ALLOWLIST_POSIX);
  const out = {};
  for (const k of keys) {
    if (baseEnv[k] !== undefined) out[k] = baseEnv[k];
    // Windows env lookups are case-insensitive but object keys aren't —
    // guard against a differently-cased source key (e.g. "Path" vs "PATH").
    else if (isWin) {
      const hit = Object.keys(baseEnv).find(bk => bk.toLowerCase() === k.toLowerCase());
      if (hit) out[k] = baseEnv[hit];
    }
  }
  return out;
}

// Cached after first check — bwrap/sandbox-exec presence doesn't change
// mid-session, and spawnSync-ing a version check on every single tool call
// would add latency for no benefit.
let _capabilityCache = null;

function detectSandboxCapability(platform = process.platform) {
  if (_capabilityCache && _capabilityCache.platform === platform) return _capabilityCache;

  let result;
  if (platform === 'linux') {
    const probe = spawnSync('bwrap', ['--version'], { timeout: 3000 });
    result = (!probe.error && probe.status === 0)
      ? { type: 'bwrap', platform, sandboxed: true }
      : { type: 'none', platform, sandboxed: false, reason: 'bubblewrap (bwrap) not found on PATH — install it for real sandboxing, e.g. `sudo apt install bubblewrap`. Falling back to hardened-but-unsandboxed execution.' };
  } else if (platform === 'darwin') {
    const probe = spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)', '/usr/bin/true'], { timeout: 3000 });
    result = (!probe.error && probe.status === 0)
      ? { type: 'seatbelt', platform, sandboxed: true }
      : { type: 'none', platform, sandboxed: false, reason: 'sandbox-exec unavailable or non-functional on this Mac. Falling back to hardened-but-unsandboxed execution.' };
  } else if (platform === 'win32') {
    // See module header: no dependency-free OS-level primitive reachable here.
    result = { type: 'none', platform, sandboxed: false, reason: 'No dependency-free OS-level sandbox primitive on Windows (real isolation needs AppContainer/low-integrity tokens via a native addon, or per-call Windows Sandbox VMs — both out of scope for v1). Running hardened-but-unsandboxed: jailed to project folder, minimal env only. See README.' };
  } else {
    result = { type: 'none', platform, sandboxed: false, reason: `Unrecognized platform "${platform}".` };
  }
  _capabilityCache = result;
  return result;
}

// Exposed for tests that need to force a re-detection against a fresh PATH/mock.
function _resetCapabilityCache() { _capabilityCache = null; }

function ensureSandboxTmpDir(projectRoot) {
  const dir = path.join(projectRoot, '.liteide', 'sandbox-tmp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Linux: bubblewrap ───────────────────────────────────────────────────────
// Read access to the whole filesystem (dev tools, system libs, global
// node_modules/pip caches all need this to function) but write access is
// bound ONLY to the project root and a scratch tmp dir inside it. Network is
// unshared by default — most agent shell commands (build/test/lint/git-local)
// don't need it, and it removes a large exfiltration/SSRF surface for free.
function buildBwrapArgs(cmd, { projectRoot, tmpDir, allowNetwork, shell, shellFlag }) {
  // Bind order matters: bwrap applies binds in sequence and later binds
  // win on overlapping paths. projectRoot commonly lives *inside* the
  // system tmp dir (e.g. test fixtures, or a project opened from a scratch
  // folder), so `--bind tmpDir /tmp` MUST come before `--bind projectRoot
  // projectRoot`, or the /tmp shadow silently swallows the nested
  // projectRoot mount and every write inside the sandbox fails.
  const args = [
    '--ro-bind', '/', '/',
    '--dev', '/dev',
    '--proc', '/proc',
    '--bind', tmpDir, '/tmp',
    '--bind', projectRoot, projectRoot,
    '--chdir', projectRoot,
    '--die-with-parent',
    '--unshare-pid',
    '--unshare-uts',
    '--unshare-ipc',
  ];
  if (!allowNetwork) args.push('--unshare-net');
  args.push(shell, shellFlag, cmd);
  return { command: 'bwrap', args };
}

// ── macOS: Seatbelt (sandbox-exec) ─────────────────────────────────────────
// Same read-everywhere / write-only-in-project shape as the Linux profile.
// sandbox-exec is a public-API-deprecated but still-functional and still
// widely used primitive (this is literally what Cursor's own sandboxing
// writeup uses on macOS, per the audit).
function buildSeatbeltProfile({ projectRoot, tmpDir, allowNetwork }) {
  const esc = p => p.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `(version 1)
(deny default)
(allow process-fork)
(allow process-exec)
(allow file-read*)
(allow file-write* (subpath "${esc(projectRoot)}"))
(allow file-write* (subpath "${esc(tmpDir)}"))
(allow file-ioctl)
(allow sysctl-read)
(allow mach-lookup)
(allow signal (target self))
${allowNetwork ? '(allow network*)' : '(deny network*)'}
`;
}

function buildSeatbeltArgs(cmd, { projectRoot, tmpDir, allowNetwork, shell, shellFlag }) {
  const profile = buildSeatbeltProfile({ projectRoot, tmpDir, allowNetwork });
  const profilePath = path.join(tmpDir, `profile-${Date.now()}-${Math.random().toString(36).slice(2)}.sb`);
  fs.writeFileSync(profilePath, profile, 'utf8');
  return {
    command: '/usr/bin/sandbox-exec',
    args: ['-f', profilePath, shell, shellFlag, cmd],
    cleanup: () => { try { fs.unlinkSync(profilePath); } catch { /* best-effort */ } },
  };
}

// ── Top-level dispatcher used by main.js ────────────────────────────────────
// Returns { command, args, env, cleanup, sandboxType, sandboxed, warning }.
// `cleanup` (if present) must be called after the child process exits.
function buildSandboxedCommand(cmd, { projectRoot, env, shell, shellFlag, allowNetwork = false, platform = process.platform }) {
  const isWin = platform === 'win32';
  const minimalEnv = buildMinimalEnv(env, isWin);
  const cap = detectSandboxCapability(platform);

  if (cap.type === 'bwrap') {
    const tmpDir = ensureSandboxTmpDir(projectRoot);
    const built = buildBwrapArgs(cmd, { projectRoot, tmpDir, allowNetwork, shell, shellFlag });
    return { ...built, env: minimalEnv, sandboxType: 'bwrap', sandboxed: true };
  }
  if (cap.type === 'seatbelt') {
    const tmpDir = ensureSandboxTmpDir(projectRoot);
    const built = buildSeatbeltArgs(cmd, { projectRoot, tmpDir, allowNetwork, shell, shellFlag });
    return { ...built, env: minimalEnv, sandboxType: 'seatbelt', sandboxed: true };
  }
  // No real sandbox available (Windows today, or Linux/macOS missing their
  // tool). Interim hardening only: jailed cwd (caller already sets cwd =
  // projectRoot) + minimal env. This is explicitly NOT a security boundary —
  // callers must not treat `sandboxed: false` as safe-by-default.
  return {
    command: shell, args: [shellFlag, cmd], env: minimalEnv,
    sandboxType: 'none-hardened', sandboxed: false, warning: cap.reason,
  };
}

module.exports = {
  buildMinimalEnv,
  detectSandboxCapability,
  _resetCapabilityCache,
  buildBwrapArgs,
  buildSeatbeltProfile,
  buildSeatbeltArgs,
  buildSandboxedCommand,
  ENV_ALLOWLIST_COMMON,
  ENV_ALLOWLIST_WIN,
  ENV_ALLOWLIST_POSIX,
};
