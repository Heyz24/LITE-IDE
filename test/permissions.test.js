'use strict';
const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMainWithMockElectron } = require('./helpers/mock-electron.js');

const MAIN_PATH = path.join(__dirname, '..', 'main.js');
const EVT = {};

describe('Granular per-tool-category permission toggles', () => {
  let mock, projectDir;
  before(() => { mock = loadMainWithMockElectron(MAIN_PATH); });
  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liteide-permtest-'));
    await mock.handleFns.get('agent:setProjectRoot')(EVT, projectDir);
  });

  test('defaults reproduce pre-existing behavior exactly: everything allow except delete which asks', async () => {
    const p = await mock.handleFns.get('agent:getPermissions')(EVT);
    assert.deepEqual(p, { read: 'allow', write: 'allow', delete: 'ask', execute: 'allow', network: 'allow', subagents: 'allow' });
  });

  test('read: deny blocks read_file outright with no approval prompt', async () => {
    fs.writeFileSync(path.join(projectDir, 'a.txt'), 'hello');
    await mock.handleFns.get('agent:setPermissions')(EVT, { read: 'deny' });
    const before = mock.sent.length;
    const r = await mock.handleFns.get('agent:readFile')(EVT, 'a.txt');
    assert.equal(r.ok, false);
    assert.match(r.error, /permission settings/);
    assert.equal(mock.sent.length, before, 'a deny must not even trigger an approval popup');
  });

  test('read: ask requires approval, and reading proceeds once approved', async () => {
    fs.writeFileSync(path.join(projectDir, 'a.txt'), 'hello');
    await mock.handleFns.get('agent:setPermissions')(EVT, { read: 'ask' });
    const pending = mock.handleFns.get('agent:readFile')(EVT, 'a.txt');
    await new Promise(r => setTimeout(r, 10));
    const req = mock.sent.filter(e => e.channel === 'agent:approvalRequest').at(-1);
    assert.equal(req.payload.action, 'read_file');
    mock.onFns.get('agent:approvalResponse')[0](EVT, { id: req.payload.id, approved: true });
    const result = await pending;
    assert.equal(result.ok, true);
    assert.equal(result.content, 'hello');
  });

  test('list_dir and search_codebase are also gated under the read category', async () => {
    await mock.handleFns.get('agent:setPermissions')(EVT, { read: 'deny' });
    const r1 = await mock.handleFns.get('agent:listDir')(EVT, '.');
    assert.equal(r1.ok, false);
    const r2 = await mock.handleFns.get('agent:ragSearch')(EVT, 'anything');
    assert.equal(r2.ok, false);
  });

  test('write: deny blocks write_file AND edit_file outright', async () => {
    fs.writeFileSync(path.join(projectDir, 'a.js'), 'x = 1');
    await mock.handleFns.get('agent:setPermissions')(EVT, { write: 'deny' });
    const r1 = await mock.handleFns.get('agent:writeFile')(EVT, 'b.js', 'y = 2');
    assert.equal(r1.ok, false);
    assert.equal(fs.existsSync(path.join(projectDir, 'b.js')), false);
    const r2 = await mock.handleFns.get('agent:editFile')(EVT, 'a.js', 'x = 1', 'x = 2');
    assert.equal(r2.ok, false);
    assert.equal(fs.readFileSync(path.join(projectDir, 'a.js'), 'utf8'), 'x = 1');
  });

  test('write: ask forces approval even for a completely non-critical file', async () => {
    await mock.handleFns.get('agent:setPermissions')(EVT, { write: 'ask' });
    const pending = mock.handleFns.get('agent:writeFile')(EVT, 'totally-normal-file.js', 'x');
    await new Promise(r => setTimeout(r, 10));
    const req = mock.sent.filter(e => e.channel === 'agent:approvalRequest').at(-1);
    assert.equal(req.payload.action, 'write_file');
    mock.onFns.get('agent:approvalResponse')[0](EVT, { id: req.payload.id, approved: false });
    const result = await pending;
    assert.equal(result.ok, false);
    assert.match(result.error, /Denied/);
  });

  test('critical-file approval still applies independently even when write category is allow', async () => {
    await mock.handleFns.get('agent:setPermissions')(EVT, { write: 'allow' });
    const pending = mock.handleFns.get('agent:writeFile')(EVT, '.env', 'SECRET=1');
    await new Promise(r => setTimeout(r, 10));
    const req = mock.sent.filter(e => e.channel === 'agent:approvalRequest').at(-1);
    assert.equal(req.payload.action, 'write_file', 'critical-file gate must still fire independently of the category gate');
    mock.onFns.get('agent:approvalResponse')[0](EVT, { id: req.payload.id, approved: true });
    await pending;
  });

  test('delete: deny blocks outright with no prompt; delete: allow still confirms (delete never becomes silent)', async () => {
    fs.writeFileSync(path.join(projectDir, 'a.txt'), 'x');
    await mock.handleFns.get('agent:setPermissions')(EVT, { delete: 'deny' });
    const beforeCount = mock.sent.length;
    const r = await mock.handleFns.get('agent:deleteFile')(EVT, 'a.txt');
    assert.equal(r.ok, false);
    assert.equal(mock.sent.length, beforeCount);
    assert.equal(fs.existsSync(path.join(projectDir, 'a.txt')), true);

    await mock.handleFns.get('agent:setPermissions')(EVT, { delete: 'allow' });
    const pending = mock.handleFns.get('agent:deleteFile')(EVT, 'a.txt');
    await new Promise(r => setTimeout(r, 10));
    const req = mock.sent.filter(e => e.channel === 'agent:approvalRequest').at(-1);
    assert.equal(req.payload.action, 'delete_file', '"allow" must still confirm for delete — this category has no silent mode');
  });

  test('execute: deny blocks run_command outright, no process ever spawned', async () => {
    await mock.handleFns.get('agent:setPermissions')(EVT, { execute: 'deny' });
    const r = await mock.handleFns.get('agent:runCommand')(EVT, 'echo should-not-run');
    assert.equal(r.ok, false);
    assert.match(r.error, /permission settings/);
  });

  test('execute: ask forces approval even for a harmless command', async () => {
    await mock.handleFns.get('agent:setPermissions')(EVT, { execute: 'ask' });
    const pending = mock.handleFns.get('agent:runCommand')(EVT, 'echo hi');
    await new Promise(r => setTimeout(r, 10));
    const req = mock.sent.filter(e => e.channel === 'agent:approvalRequest').at(-1);
    assert.equal(req.payload.action, 'run_command');
    mock.onFns.get('agent:approvalResponse')[0](EVT, { id: req.payload.id, approved: true });
    const result = await pending;
    assert.equal(result.ok, true);
  });

  test('network: deny blocks web_search and web_fetch outright, no network call made', async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => { called = true; return { text: async () => '' }; };
    await mock.handleFns.get('agent:setPermissions')(EVT, { network: 'deny' });
    const r1 = await mock.handleFns.get('agent:webSearch')(EVT, 'test query');
    assert.equal(r1.ok, false);
    const r2 = await mock.handleFns.get('agent:webFetch')(EVT, 'https://example.com');
    assert.equal(r2.ok, false);
    assert.equal(called, false);
    globalThis.fetch = originalFetch;
  });

  test('subagents: deny blocks the gate before any orchestration starts', async () => {
    await mock.handleFns.get('agent:setPermissions')(EVT, { subagents: 'deny' });
    const r = await mock.handleFns.get('agent:gateSubagents')(EVT, 3);
    assert.equal(r.ok, false);
  });

  test('subagents: ask requires approval, reporting how many tasks were requested', async () => {
    await mock.handleFns.get('agent:setPermissions')(EVT, { subagents: 'ask' });
    const pending = mock.handleFns.get('agent:gateSubagents')(EVT, 4);
    await new Promise(r => setTimeout(r, 10));
    const req = mock.sent.filter(e => e.channel === 'agent:approvalRequest').at(-1);
    assert.equal(req.payload.action, 'spawn_subagents');
    assert.equal(req.payload.detail.taskCount, 4);
    mock.onFns.get('agent:approvalResponse')[0](EVT, { id: req.payload.id, approved: true });
    const result = await pending;
    assert.equal(result.ok, true);
  });

  test('agent:setPermissions persists to .liteide/agent-permissions.json and only updates the categories given', async () => {
    await mock.handleFns.get('agent:setPermissions')(EVT, { execute: 'deny' });
    const onDisk = JSON.parse(fs.readFileSync(path.join(projectDir, '.liteide', 'agent-permissions.json'), 'utf8'));
    assert.equal(onDisk.execute, 'deny');
    assert.equal(onDisk.read, 'allow', 'categories not mentioned in the partial update must be untouched');
  });

  test('a fresh project with no permissions file yet behaves exactly like explicit defaults (no crash, no surprise)', async () => {
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liteide-permtest-fresh-'));
    await mock.handleFns.get('agent:setProjectRoot')(EVT, freshDir);
    const r = await mock.handleFns.get('agent:writeFile')(EVT, 'x.js', 'y');
    assert.equal(r.ok, true);
  });
});
