'use strict';
const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMainWithMockElectron } = require('./helpers/mock-electron.js');

const MAIN_PATH = path.join(__dirname, '..', 'main.js');
const EVT = {};

describe('Test-after-edit auto-verification', () => {
  let mock, projectDir;

  before(() => { mock = loadMainWithMockElectron(MAIN_PATH); });

  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liteide-verifytest-'));
  });

  test('auto-detects `npm test` from a real package.json on project open, but leaves verification disabled by default', async () => {
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node --test' } }));
    await mock.handleFns.get('agent:setProjectRoot')(EVT, projectDir);
    const cfg = await mock.handleFns.get('agent:getVerifyConfig')(EVT);
    assert.equal(cfg.command, 'npm test');
    assert.equal(cfg.enabled, false, 'auto-detection must not silently start running the test suite on every edit');
  });

  test('does not detect a command for a placeholder "no test specified" script', async () => {
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
    await mock.handleFns.get('agent:setProjectRoot')(EVT, projectDir);
    const cfg = await mock.handleFns.get('agent:getVerifyConfig')(EVT);
    assert.equal(cfg.command, null);
  });

  test('a normal write_file with verification disabled carries no verification field at all', async () => {
    await mock.handleFns.get('agent:setProjectRoot')(EVT, projectDir);
    const r = await mock.handleFns.get('agent:writeFile')(EVT, 'foo.js', 'console.log(1);');
    assert.equal(r.ok, true);
    assert.equal(r.verification, undefined);
  });

  test('once enabled, writing a code file actually runs the real configured command and reports a real pass', async () => {
    await mock.handleFns.get('agent:setProjectRoot')(EVT, projectDir);
    await mock.handleFns.get('agent:setVerifyConfig')(EVT, { enabled: true, command: 'exit 0', debounceMs: 0 });
    const r = await mock.handleFns.get('agent:writeFile')(EVT, 'foo.js', 'console.log(1);');
    assert.equal(r.verification.skipped, false);
    assert.equal(r.verification.ok, true);
    assert.equal(r.verification.code, 0);
  });

  test('a real failing command is reported as a real failure, not silently swallowed', async () => {
    await mock.handleFns.get('agent:setProjectRoot')(EVT, projectDir);
    await mock.handleFns.get('agent:setVerifyConfig')(EVT, { enabled: true, command: 'exit 1', debounceMs: 0 });
    const r = await mock.handleFns.get('agent:writeFile')(EVT, 'foo.js', 'console.log(1);');
    assert.equal(r.verification.skipped, false);
    assert.equal(r.verification.ok, false);
    assert.equal(r.verification.code, 1);
  });

  test('a non-code file (e.g. README.md) never triggers verification, even when enabled', async () => {
    await mock.handleFns.get('agent:setProjectRoot')(EVT, projectDir);
    await mock.handleFns.get('agent:setVerifyConfig')(EVT, { enabled: true, command: 'exit 1', debounceMs: 0 });
    const r = await mock.handleFns.get('agent:writeFile')(EVT, 'README.md', '# hi');
    assert.equal(r.verification, undefined);
  });

  test('edit_file also triggers verification on success', async () => {
    fs.writeFileSync(path.join(projectDir, 'foo.py'), 'x = 1\n');
    await mock.handleFns.get('agent:setProjectRoot')(EVT, projectDir);
    await mock.handleFns.get('agent:setVerifyConfig')(EVT, { enabled: true, command: 'exit 0', debounceMs: 0 });
    const r = await mock.handleFns.get('agent:editFile')(EVT, 'foo.py', 'x = 1', 'x = 2');
    assert.equal(r.ok, true);
    assert.equal(r.verification.ok, true);
  });

  test('a real long-running command is killed at the timeout and reported as timedOut, not left hanging', async () => {
    await mock.handleFns.get('agent:setProjectRoot')(EVT, projectDir);
    // node avoids the cmd.exe nested-quote fragility seen elsewhere in this suite
    const scriptPath = path.join(projectDir, '__long_test.js');
    fs.writeFileSync(scriptPath, 'setTimeout(() => {}, 30000);\n');
    await mock.handleFns.get('agent:setVerifyConfig')(EVT, { enabled: true, command: 'node __long_test.js', timeoutMs: 800, debounceMs: 0 });
    const start = Date.now();
    const r = await mock.handleFns.get('agent:writeFile')(EVT, 'foo.js', 'x');
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 5000, `must resolve promptly after the timeout, took ${elapsed}ms`);
    assert.equal(r.verification.ok, false);
    assert.equal(r.verification.timedOut, true);
  });

  test('rapid successive edits are debounced — the second edit inside the debounce window is skipped, not silently ignored', async () => {
    await mock.handleFns.get('agent:setProjectRoot')(EVT, projectDir);
    await mock.handleFns.get('agent:setVerifyConfig')(EVT, { enabled: true, command: 'exit 0', debounceMs: 10000 });
    const r1 = await mock.handleFns.get('agent:writeFile')(EVT, 'a.js', 'x');
    assert.equal(r1.verification.skipped, false);
    const r2 = await mock.handleFns.get('agent:writeFile')(EVT, 'b.js', 'y');
    assert.equal(r2.verification.skipped, true);
    assert.match(r2.verification.reason, /debounced/);
  });

  test('verification runs inside the same sandbox as run_command (sandboxType is reported)', async () => {
    await mock.handleFns.get('agent:setProjectRoot')(EVT, projectDir);
    await mock.handleFns.get('agent:setVerifyConfig')(EVT, { enabled: true, command: 'exit 0', debounceMs: 0 });
    const r = await mock.handleFns.get('agent:writeFile')(EVT, 'foo.js', 'x');
    assert.ok('sandboxType' in r.verification);
  });

  test('agent:setVerifyConfig persists to .liteide/agent-verify.json on disk', async () => {
    await mock.handleFns.get('agent:setProjectRoot')(EVT, projectDir);
    await mock.handleFns.get('agent:setVerifyConfig')(EVT, { enabled: true, command: 'my-test-cmd' });
    const onDisk = JSON.parse(fs.readFileSync(path.join(projectDir, '.liteide', 'agent-verify.json'), 'utf8'));
    assert.equal(onDisk.enabled, true);
    assert.equal(onDisk.command, 'my-test-cmd');
  });
});
