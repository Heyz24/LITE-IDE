'use strict';
// ── agent-sandbox.js — OS-level sandboxing for agent:runCommand ────────────
// Real OS-level sandboxing where the platform supports a dependency-light
// primitive (bubblewrap on Linux, Seatbelt on macOS): read access
// everywhere (dev tools/system libs need it), write access ONLY to the
// project folder + its own scratch tmp dir, network unshared unless the
// caller explicitly opts in. No dependency-free equivalent exists on
// Windows, so that platform runs hardened-but-unsandboxed instead: jailed
// cwd (via `cwd` on spawn, unchanged) + a minimal explicit environment
// allowlist instead of a full process.env passthrough.
//
// Two API layers:
//   - Low-level, pure, individually testable building blocks:
//       buildMinimalEnv, buildSeatbeltProfile, buildBwrapArgs,
//       detectSandboxCapability, _resetCapabilityCache
//   - buildSandboxedCommand: the one main.js actually calls, which wires
//     the above together into {command, args, env, sandboxType, sandboxed, cleanup}.

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

function commandExists(cmd) {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Never pass the agent's full process.env through to a spawned command when
// we can't fully sandbox it (Windows, or Linux/macOS with the real sandbox
// tool missing) — that would leak unrelated secrets (cloud CLI tokens, SSH
// agent sockets, other providers' API keys) to anything the model asks to
// run. Real sandboxing (bwrap/Seatbelt) still gets the full env, since
// filesystem/network isolation is the actual security boundary there.
const POSIX_ENV_ALLOWLIST = [
  'PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'TERM',
  'TMPDIR', 'TZ', 'NODE_ENV', 'PYTHONUTF8', 'PYTHONIOENCODING',
];
const WINDOWS_ENV_ALLOWLIST = [
  'PATH', 'HOME', 'USERPROFILE', 'TEMP', 'TMP',
  'SystemRoot', 'SystemDrive', 'windir', 'ComSpec',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'USERNAME',
  'NODE_ENV', 'PYTHONUTF8', 'PYTHONIOENCODING',
];

// Windows env var names are case-insensitive at the OS level (`Path` and
// `PATH` are the same variable) — normalize by matching the allowlist
// case-insensitively, but always emit the allowlist's own canonical casing
// so downstream code can rely on a single spelling.
function buildMinimalEnv(sourceEnv, isWindows) {
  const out = {};
  if (isWindows) {
    const lowerMap = {};
    for (const k of Object.keys(sourceEnv || {})) lowerMap[k.toLowerCase()] = sourceEnv[k];
    for (const k of WINDOWS_ENV_ALLOWLIST) {
      const hit = lowerMap[k.toLowerCase()];
      if (hit !== undefined) out[k] = hit;
    }
  } else {
    for (const k of POSIX_ENV_ALLOWLIST) if (sourceEnv && sourceEnv[k] !== undefined) out[k] = sourceEnv[k];
  }
  return out;
}

// Minimal Seatbelt (macOS `sandbox-exec`) profile: deny-by-default, explicit
// allow for read everywhere + write only inside the project folder and the
// scratch tmp dir, network allowed only when the caller opted in.
function buildSeatbeltProfile({ projectRoot, tmpDir, allowNetwork }) {
  return [
    '(version 1)',
    '(deny default)',
    '(allow process-exec)',
    '(allow process-fork)',
    '(allow file-read*)',
    `(allow file-write* (subpath "${projectRoot}"))`,
    `(allow file-write* (subpath "${tmpDir}"))`,
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    allowNetwork ? '(allow network*)' : '(deny network*)',
  ].join('\n');
}

// bubblewrap (Linux) argument list. Binds the per-project scratch dir ONTO
// /tmp first (so /tmp inside the sandbox is a real, writable, isolated
// scratch space) and binds the project root itself AFTER — that ordering
// matters: bwrap applies binds in sequence and a later bind nested under an
// earlier one takes precedence, so if the project root happens to live
// under /tmp (very common with temp-dir-based test fixtures, but also true
// of any real project checked out under a tmpfs home), binding /tmp first
// and the project root second means the project-root bind wins and the
// project's real files stay visible — reversing the order would silently
// shadow the project root behind the generic /tmp remap.
function buildBwrapArgs(cmd, { projectRoot, tmpDir, allowNetwork, shell, shellFlag }) {
  const args = [
    '--ro-bind', '/', '/',
    '--bind', tmpDir, '/tmp',
    '--bind', projectRoot, projectRoot,
    '--dev', '/dev',
    '--proc', '/proc',
    '--chdir', projectRoot,
    '--die-with-parent',
    '--unshare-pid',
  ];
  if (!allowNetwork) args.push('--unshare-net');
  args.push('--', shell, shellFlag, cmd);
  return { command: 'bwrap', args };
}

let cachedCapability = null;
function detectSandboxCapability(platform = process.platform) {
  if (cachedCapability && cachedCapability.platform === platform) return cachedCapability;
  if (platform === 'linux') {
    cachedCapability = commandExists('bwrap')
      ? { platform, type: 'bwrap', sandboxed: true }
      : { platform, type: 'none', sandboxed: false,
          reason: 'bubblewrap (bwrap) not found on PATH — install it (e.g. `apt install bubblewrap`) for real OS-level sandboxing. Falling back to hardened-but-unsandboxed execution.' };
  } else if (platform === 'darwin') {
    cachedCapability = commandExists('sandbox-exec')
      ? { platform, type: 'seatbelt', sandboxed: true }
      : { platform, type: 'none', sandboxed: false,
          reason: 'sandbox-exec not found — unexpected on macOS, it ships with the OS. Falling back to hardened-but-unsandboxed execution.' };
  } else {
    cachedCapability = { platform, type: 'none', sandboxed: false,
      reason: 'No dependency-free OS-level sandbox primitive is reachable from pure Node on Windows (real isolation needs AppContainer/low-integrity tokens via a native addon, or a per-call Windows Sandbox VM — both out of scope for v1). Running hardened-but-unsandboxed: jailed to the project folder, minimal explicit environment allowlist instead of full process.env passthrough.' };
  }
  return cachedCapability;
}
// Test-only hook: lets tests force a fresh probe instead of trusting a
// cross-test cached result (real callers never need this).
function _resetCapabilityCache() { cachedCapability = null; }

function ensureScratchDir(projectRoot) {
  const tmpDir = path.join(projectRoot, '.liteide', 'sandbox-tmp');
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch { /* best-effort */ }
  return tmpDir;
}

function buildSandboxedCommand(cmd, { projectRoot, env, shell, shellFlag, allowNetwork }) {
  const cap = detectSandboxCapability();
  const isWindows = process.platform === 'win32';

  if (cap.type === 'bwrap' || cap.type === 'seatbelt') {
    try {
      const tmpDir = ensureScratchDir(projectRoot);
      if (cap.type === 'bwrap') {
        const built = buildBwrapArgs(cmd, { projectRoot, tmpDir, allowNetwork, shell, shellFlag });
        return { command: built.command, args: built.args, env: { ...env, TMPDIR: tmpDir },
          sandboxType: 'bwrap', sandboxed: true, cleanup: null };
      }
      // seatbelt
      const profile = buildSeatbeltProfile({ projectRoot, tmpDir, allowNetwork });
      const profilePath = path.join(tmpDir, `profile-${process.pid}-${Date.now()}.sb`);
      fs.writeFileSync(profilePath, profile, 'utf8');
      return {
        command: 'sandbox-exec', args: ['-f', profilePath, shell, shellFlag, cmd],
        env: { ...env, TMPDIR: tmpDir }, sandboxType: 'seatbelt', sandboxed: true,
        cleanup: () => { try { fs.unlinkSync(profilePath); } catch { /* best-effort */ } },
      };
    } catch {
      // Real sandbox tool detected but failed to construct (e.g. permissions,
      // mkdir failure) — fall through to the hardened fallback rather than
      // letting a sandboxing bug block the command entirely.
    }
  }

  return {
    command: shell, args: [shellFlag, cmd], env: buildMinimalEnv(env, isWindows),
    sandboxType: 'none', sandboxed: false, cleanup: null,
  };
}

module.exports = {
  buildMinimalEnv, buildSeatbeltProfile, buildBwrapArgs,
  detectSandboxCapability, _resetCapabilityCache,
  buildSandboxedCommand,
};
