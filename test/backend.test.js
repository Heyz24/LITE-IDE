'use strict';
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMainWithMockElectron } = require('./helpers/mock-electron.js');

const MAIN_PATH = path.join(__dirname, '..', 'main.js');

// A fake ipcMain event object — main.js handlers ignore the first arg (`_`)
// throughout, but pass one for shape-accuracy anyway.
const EVT = {};

describe('Backend IPC handlers (real main.js code, mocked Electron only)', () => {
  let mock, projectDir;

  before(() => {
    mock = loadMainWithMockElectron(MAIN_PATH);
  });

  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liteide-test-'));
    await mock.handleFns.get('agent:setProjectRoot')(EVT, projectDir);
  });

  after(() => {
    // best-effort cleanup of any dirs we made
  });

  test('agent:writeFile + agent:readFile round-trip on a normal file (no approval needed)', async () => {
    const write = await mock.handleFns.get('agent:writeFile')(EVT, 'hello.txt', 'hello world');
    assert.equal(write.ok, true);
    assert.equal(write.critical, false);

    const read = await mock.handleFns.get('agent:readFile')(EVT, 'hello.txt');
    assert.equal(read.ok, true);
    assert.equal(read.content, 'hello world');
  });

  test('agent:writeFile refuses to escape the project root', async () => {
    const result = await mock.handleFns.get('agent:writeFile')(EVT, '../../etc/passwd', 'pwned');
    assert.equal(result.ok, false);
    assert.match(result.error, /escapes project folder/i);
  });

  test('agent:writeFile to a critical file (.env) requires approval, and is blocked if denied', async () => {
    const pendingWrite = mock.handleFns.get('agent:writeFile')(EVT, '.env', 'SECRET=123');

    // Wait a tick for the approval request to be sent to the (mock) renderer.
    await new Promise(r => setTimeout(r, 10));
    const approvalEvent = mock.sent.find(e => e.channel === 'agent:approvalRequest');
    assert.ok(approvalEvent, 'expected an agent:approvalRequest to be sent for a critical file write');
    assert.equal(approvalEvent.payload.action, 'write_file');
    assert.equal(approvalEvent.payload.detail.path, '.env');

    // Simulate the user clicking Deny
    const respondFn = mock.onFns.get('agent:approvalResponse')[0];
    respondFn(EVT, { id: approvalEvent.payload.id, approved: false });

    const result = await pendingWrite;
    assert.equal(result.ok, false);
    assert.match(result.error, /denied/i);
    assert.equal(fs.existsSync(path.join(projectDir, '.env')), false, '.env should not have been written after denial');
  });

  test('agent:writeFile to a critical file succeeds when approved', async () => {
    const pendingWrite = mock.handleFns.get('agent:writeFile')(EVT, 'package.json', '{"name":"x"}');
    await new Promise(r => setTimeout(r, 10));
    const approvalEvent = mock.sent.filter(e => e.channel === 'agent:approvalRequest').at(-1);
    const respondFn = mock.onFns.get('agent:approvalResponse')[0];
    respondFn(EVT, { id: approvalEvent.payload.id, approved: true });

    const result = await pendingWrite;
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'), '{"name":"x"}');
  });

  test('agent:deleteFile always requires approval, even for a non-critical file', async () => {
    fs.writeFileSync(path.join(projectDir, 'scratch.txt'), 'temp');
    const pendingDelete = mock.handleFns.get('agent:deleteFile')(EVT, 'scratch.txt');
    await new Promise(r => setTimeout(r, 10));
    const approvalEvent = mock.sent.filter(e => e.channel === 'agent:approvalRequest').at(-1);
    assert.equal(approvalEvent.payload.action, 'delete_file');
    mock.onFns.get('agent:approvalResponse')[0](EVT, { id: approvalEvent.payload.id, approved: true });
    const result = await pendingDelete;
    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(path.join(projectDir, 'scratch.txt')), false);
  });

  test('agent:runCommand executes a harmless command without approval', async () => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'echo hello-from-test' : 'echo hello-from-test';
    const result = await mock.handleFns.get('agent:runCommand')(EVT, cmd);
    assert.equal(result.ok, true);
    assert.match(result.stdout, /hello-from-test/);
  });

  test('agent:runCommand gates a destructive command behind approval', async () => {
    const pending = mock.handleFns.get('agent:runCommand')(EVT, 'rm -rf /something');
    await new Promise(r => setTimeout(r, 10));
    const approvalEvent = mock.sent.filter(e => e.channel === 'agent:approvalRequest').at(-1);
    assert.equal(approvalEvent.payload.action, 'run_command');
    mock.onFns.get('agent:approvalResponse')[0](EVT, { id: approvalEvent.payload.id, approved: false });
    const result = await pending;
    assert.equal(result.ok, false);
    assert.match(result.error, /denied/i);
  });

  test('agent:listDir lists real files under the project root', async () => {
    fs.writeFileSync(path.join(projectDir, 'a.js'), '// a');
    fs.mkdirSync(path.join(projectDir, 'sub'));
    fs.writeFileSync(path.join(projectDir, 'sub', 'b.js'), '// b');
    const result = await mock.handleFns.get('agent:listDir')(EVT, '.');
    assert.equal(result.ok, true);
    const names = result.entries.map(e => e.name).sort();
    assert.ok(names.includes('a.js'));
    assert.ok(names.includes('sub'));
  });

  test('agent:ragSearch finds a real keyword match in a real file', async () => {
    fs.writeFileSync(path.join(projectDir, 'calc.py'), 'def add(a, b):\n    return a + b\n');
    const result = await mock.handleFns.get('agent:ragSearch')(EVT, 'add', 5);
    assert.equal(result.ok, true);
    assert.ok(result.results.length > 0);
    assert.ok(result.results.some(r => r.file === 'calc.py'));
  });

  test('search:project finds a match with correct line number', async () => {
    fs.writeFileSync(path.join(projectDir, 'notes.md'), 'line one\nfind-me-here\nline three\n');
    const result = await mock.handleFns.get('search:project')(EVT, 'find-me-here', {});
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].line, 2);
    assert.equal(result.results[0].file, 'notes.md');
  });

  test('search:replaceAll actually rewrites the file on disk', async () => {
    fs.writeFileSync(path.join(projectDir, 'r.txt'), 'foo foo foo');
    const result = await mock.handleFns.get('search:replaceAll')(EVT, 'foo', 'bar', {});
    assert.equal(result.ok, true);
    assert.equal(result.changedFiles, 1);
    assert.equal(result.changedLines, 3); // 3 individual match occurrences, not matching-line count
    assert.equal(fs.readFileSync(path.join(projectDir, 'r.txt'), 'utf8'), 'bar bar bar');
  });

  test('git:isRepo returns false for a plain (non-git) temp dir', async () => {
    const result = await mock.handleFns.get('git:isRepo')(EVT);
    assert.equal(result, false);
  });

  test('ai:getConfig / ai:saveConfig round-trip an API key through mocked safeStorage', async () => {
    await mock.handleFns.get('ai:saveConfig')(EVT, { provider: 'anthropic', model: 'claude-sonnet-4-6', ollamaUrl: 'http://localhost:11434', keys: { anthropic: 'sk-test-123' } });
    const cfg = await mock.handleFns.get('ai:getConfig')(EVT);
    assert.equal(cfg.provider, 'anthropic');
    assert.equal(cfg.model, 'claude-sonnet-4-6');
    assert.equal(cfg.hasKey.anthropic, true);
    // the raw key must never come back to the renderer
    assert.equal(JSON.stringify(cfg).includes('sk-test-123'), false);
  });

  test('ai:clearKey removes a stored key without touching others', async () => {
    await mock.handleFns.get('ai:saveConfig')(EVT, { provider: 'openai', model: 'x', ollamaUrl: 'http://localhost:11434', keys: { openai: 'sk-a', anthropic: 'sk-b' } });
    await mock.handleFns.get('ai:clearKey')(EVT, 'openai');
    const cfg = await mock.handleFns.get('ai:getConfig')(EVT);
    assert.equal(!!cfg.hasKey.openai, false);
    assert.equal(cfg.hasKey.anthropic, true);
  });

  test('app:openPath is delivered to the renderer when a launch file path is detected (Open-With flow)', async () => {
    const filePath = path.join(projectDir, 'launched.py');
    fs.writeFileSync(filePath, 'print("hi")');
    const secondInstanceFns = mock.onFns.get('second-instance') || [];
    assert.ok(secondInstanceFns.length > 0, 'main.js must register a second-instance handler for Open-With to work when already running');
    secondInstanceFns[0]({}, ['LiteIDE.exe', filePath]);
    const openEvent = mock.sent.find(e => e.channel === 'app:openPath' && e.payload === filePath);
    assert.ok(openEvent, 'expected app:openPath to be sent with the double-clicked file path');
  });

  test('lang:detect reports install status (not throwing) for the new HDL/embedded languages', async () => {
    for (const lang of ['VHDL', 'SystemVerilog', 'Arduino', 'GTKWave']) {
      const result = await mock.handleFns.get('lang:detect')(EVT, lang);
      assert.equal(typeof result.installed, 'boolean', `lang:detect('${lang}') must return {installed: boolean}`);
    }
  });

  test('code:run reports a clear "not installed" error for GTKWave rather than crashing, when the tool is absent', async () => {
    const vcdFile = path.join(projectDir, 'wave.vcd');
    fs.writeFileSync(vcdFile, '$date today $end');
    // Whether or not gtkwave is actually installed on the test machine, this must not throw.
    await assert.doesNotReject(async () => {
      await mock.handleFns.get('code:run')(EVT, vcdFile, 'GTKWave');
    });
  });

  test('shell:getAvailable returns an array (system shell auto-detection runs without throwing)', async () => {
    const result = await mock.handleFns.get('shell:getAvailable')(EVT);
    assert.ok(Array.isArray(result));
  });

  test('fs:readFile / fs:writeFile work against a real path', async () => {
    const p = path.join(projectDir, 'direct.txt');
    await mock.handleFns.get('fs:writeFile')(EVT, p, 'direct write');
    const content = await mock.handleFns.get('fs:readFile')(EVT, p);
    assert.equal(content, 'direct write');
  });
});
