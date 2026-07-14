'use strict';
const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMainWithMockElectron } = require('./helpers/mock-electron.js');

const MAIN_PATH = path.join(__dirname, '..', 'main.js');
const SANDBOX_PATH = path.join(__dirname, '..', 'agent-sandbox.js');
const EVT = {};
const IS_LINUX = process.platform === 'linux';

describe('agent-sandbox.js — pure logic (no Electron)', () => {
  const sandbox = require(SANDBOX_PATH);

  test('buildMinimalEnv strips secrets and keeps only the allowlisted keys (POSIX)', () => {
    const fakeEnv = {
      PATH: '/usr/bin', HOME: '/home/x', USER: 'x', SHELL: '/bin/bash',
      AWS_SECRET_ACCESS_KEY: 'super-secret', OPENAI_API_KEY: 'sk-leak', SSH_AUTH_SOCK: '/tmp/ssh.sock',
    };
    const out = sandbox.buildMinimalEnv(fakeEnv, false);
    assert.equal(out.PATH, '/usr/bin');
    assert.equal(out.HOME, '/home/x');
    assert.equal(out.AWS_SECRET_ACCESS_KEY, undefined, 'unrelated secrets must not be passed to sandboxed commands');
    assert.equal(out.OPENAI_API_KEY, undefined);
    assert.equal(out.SSH_AUTH_SOCK, undefined);
  });

  test('buildMinimalEnv keeps Windows-relevant keys and is case-insensitive on Windows', () => {
    const fakeEnv = { Path: 'C:\\Windows', SystemRoot: 'C:\\Windows', ANTHROPIC_API_KEY: 'sk-leak' };
    const out = sandbox.buildMinimalEnv(fakeEnv, true);
    assert.equal(out.PATH, 'C:\\Windows');
    assert.equal(out.SystemRoot, 'C:\\Windows');
    assert.equal(out.ANTHROPIC_API_KEY, undefined);
  });

  test('buildSeatbeltProfile denies network by default and scopes writes to project + tmp only', () => {
    const profile = sandbox.buildSeatbeltProfile({ projectRoot: '/Users/x/proj', tmpDir: '/Users/x/proj/.liteide/sandbox-tmp', allowNetwork: false });
    assert.match(profile, /\(deny default\)/);
    assert.match(profile, /\(deny network\*\)/);
    assert.match(profile, /subpath "\/Users\/x\/proj"/);
    assert.doesNotMatch(profile, /\(allow network\*\)/);
  });

  test('buildSeatbeltProfile allows network when explicitly requested', () => {
    const profile = sandbox.buildSeatbeltProfile({ projectRoot: '/p', tmpDir: '/p/.liteide/sandbox-tmp', allowNetwork: true });
    assert.match(profile, /\(allow network\*\)/);
  });

  test('buildBwrapArgs binds the scratch tmp dir before the project root (mount-order regression test — a project nested under /tmp was previously shadowed)', () => {
    const { args } = sandbox.buildBwrapArgs('echo hi', {
      projectRoot: '/tmp/liteide-test-abc', tmpDir: '/tmp/liteide-test-abc/.liteide/sandbox-tmp',
      allowNetwork: false, shell: 'bash', shellFlag: '-c',
    });
    const tmpBindIdx = args.indexOf('/tmp');
    const projectBindIdx = args.lastIndexOf('/tmp/liteide-test-abc');
    assert.ok(tmpBindIdx !== -1 && projectBindIdx !== -1);
    assert.ok(tmpBindIdx < projectBindIdx, 'the /tmp bind must be applied before the project-root bind so the project root is not shadowed');
  });

  test('buildBwrapArgs unshares network unless allowNetwork is set', () => {
    const withoutNet = sandbox.buildBwrapArgs('x', { projectRoot: '/p', tmpDir: '/p/.liteide/sandbox-tmp', allowNetwork: false, shell: 'bash', shellFlag: '-c' });
    assert.ok(withoutNet.args.includes('--unshare-net'));
    const withNet = sandbox.buildBwrapArgs('x', { projectRoot: '/p', tmpDir: '/p/.liteide/sandbox-tmp', allowNetwork: true, shell: 'bash', shellFlag: '-c' });
    assert.ok(!withNet.args.includes('--unshare-net'));
  });

  test('detectSandboxCapability reports a real, non-fake result for this platform (not hardcoded true)', () => {
    sandbox._resetCapabilityCache();
    const cap = sandbox.detectSandboxCapability(process.platform);
    assert.equal(cap.platform, process.platform);
    assert.ok(['bwrap', 'seatbelt', 'none'].includes(cap.type));
    if (cap.type === 'none') assert.ok(cap.reason && cap.reason.length > 0, 'a non-sandboxed result must explain why, not fail silently');
  });
});

describe('agent:runCommand — sandbox integration (real main.js, real child processes)', () => {
  let mock, projectDir;

  before(() => { mock = loadMainWithMockElectron(MAIN_PATH); });

  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liteide-sandboxtest-'));
    await mock.handleFns.get('agent:setProjectRoot')(EVT, projectDir);
  });

  test('agent:getSandboxStatus reflects real platform capability', async () => {
    const status = await mock.handleFns.get('agent:getSandboxStatus')(EVT);
    assert.equal(status.platform, process.platform);
    assert.ok('sandboxed' in status);
  });

  test('a harmless command still succeeds and reports its sandbox type', async () => {
    const result = await mock.handleFns.get('agent:runCommand')(EVT, 'echo sandboxed-hello');
    assert.equal(result.ok, true);
    assert.match(result.stdout, /sandboxed-hello/);
    assert.ok('sandboxType' in result);
  });

  test('a command can write inside the project root', async () => {
    const result = await mock.handleFns.get('agent:runCommand')(EVT, 'echo written > sandboxfile.txt');
    assert.equal(result.ok, true);
    assert.equal(result.code, 0);
    assert.equal(fs.readFileSync(path.join(projectDir, 'sandboxfile.txt'), 'utf8').trim(), 'written');
  });

  (IS_LINUX ? test : test.skip)('[Linux/bwrap] a sandboxed command CANNOT write outside the project root, even with an absolute path', async () => {
    const status = await mock.handleFns.get('agent:getSandboxStatus')(EVT);
    if (status.type !== 'bwrap') return; // bubblewrap not installed on this machine — nothing to assert
    // NOTE: /tmp itself is intentionally remapped to a per-project writable
    // scratch dir inside the sandbox (see agent-sandbox.js), so it's not a
    // valid "outside" target for this test — use a path the sandbox has no
    // reason to make writable at all.
    const outsideTarget = '/var/tmp/liteide-sandbox-escape-' + Date.now() + '.txt';
    const result = await mock.handleFns.get('agent:runCommand')(EVT, `echo escaped > "${outsideTarget}"`);
    assert.equal(result.sandboxType, 'bwrap');
    assert.notEqual(result.code, 0, 'writing outside the project root must fail inside the sandbox');
    assert.equal(fs.existsSync(outsideTarget), false, 'the file must not actually have been created outside the project root');
  });

  (IS_LINUX ? test : test.skip)('[Linux/bwrap] network access is blocked by default', async () => {
    const status = await mock.handleFns.get('agent:getSandboxStatus')(EVT);
    if (status.type !== 'bwrap') return;
    const result = await mock.handleFns.get('agent:runCommand')(EVT, 'curl -s -m 3 -o /dev/null -w "%{http_code}" https://example.com || echo BLOCKED');
    assert.match(result.stdout + result.stderr, /BLOCKED|000/, 'network should be unreachable when the sandbox unshares net by default');
  });

  (IS_LINUX ? test : test.skip)('[Linux/bwrap] a command CAN read files outside the project root (dev tools/system libs must remain usable)', async () => {
    const status = await mock.handleFns.get('agent:getSandboxStatus')(EVT);
    if (status.type !== 'bwrap') return;
    const result = await mock.handleFns.get('agent:runCommand')(EVT, 'cat /etc/os-release');
    assert.equal(result.ok, true);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /NAME=/);
  });

  test('destructive-pattern approval gate still runs before the sandbox layer (defense in depth preserved)', async () => {
    const pending = mock.handleFns.get('agent:runCommand')(EVT, 'rm -rf /something');
    await new Promise(r => setTimeout(r, 10));
    const approvalEvent = mock.sent.filter(e => e.channel === 'agent:approvalRequest').at(-1);
    assert.equal(approvalEvent.payload.action, 'run_command');
    mock.onFns.get('agent:approvalResponse')[0](EVT, { id: approvalEvent.payload.id, approved: false });
    const result = await pending;
    assert.equal(result.ok, false);
    assert.match(result.error, /denied/i);
  });
});
