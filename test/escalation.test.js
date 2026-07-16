'use strict';
const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMainWithMockElectron } = require('./helpers/mock-electron.js');

const MAIN_PATH = path.join(__dirname, '..', 'main.js');
const EVT = {};

describe('edit_file failure feedback + RAG cap surfacing + permission escalation', () => {
  let mock, projectDir;
  before(() => { mock = loadMainWithMockElectron(MAIN_PATH); });
  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liteide-extratest-'));
    await mock.handleFns.get('agent:setProjectRoot')(EVT, projectDir);
  });

  test('edit_file failure (not found) includes current file content, avoiding a separate read_file round-trip', async () => {
    fs.writeFileSync(path.join(projectDir, 'a.js'), 'const x = 1;\nconst y = 2;\n');
    const r = await mock.handleFns.get('agent:editFile')(EVT, 'a.js', 'const z = 99;', 'const z = 100;');
    assert.equal(r.ok, false);
    assert.match(r.currentContent, /const x = 1/);
    assert.match(r.currentContent, /const y = 2/);
  });

  test('edit_file failure (ambiguous) also includes current file content', async () => {
    fs.writeFileSync(path.join(projectDir, 'a.js'), 'x = 1;\nx = 1;\n');
    const r = await mock.handleFns.get('agent:editFile')(EVT, 'a.js', 'x = 1;', 'x = 2;');
    assert.equal(r.ok, false);
    assert.match(r.currentContent, /x = 1;\nx = 1;/);
  });

  test('ragSearch does not report capped:true for a small project', async () => {
    fs.writeFileSync(path.join(projectDir, 'a.js'), 'function needle() {}');
    const r = await mock.handleFns.get('agent:ragSearch')(EVT, 'needle');
    assert.equal(r.ok, true);
    assert.equal(r.capped, undefined);
  });

  test('requestPermissionEscalation is a no-op when the category is not actually denied', async () => {
    const r = await mock.handleFns.get('agent:requestPermissionEscalation')(EVT, 'read', 'testing');
    assert.equal(r.ok, true);
    assert.equal(r.alreadyAllowed, true);
  });

  test('requestPermissionEscalation prompts the user with the stated reason, and denial keeps the block in place', async () => {
    await mock.handleFns.get('agent:setPermissions')(EVT, { network: 'deny' });
    const pending = mock.handleFns.get('agent:requestPermissionEscalation')(EVT, 'network', 'need to check docs online');
    await new Promise(r => setTimeout(r, 10));
    const req = mock.sent.filter(e => e.channel === 'agent:approvalRequest').at(-1);
    assert.equal(req.payload.action, 'permission_escalation');
    assert.equal(req.payload.detail.reason, 'need to check docs online');
    mock.onFns.get('agent:approvalResponse')[0](EVT, { id: req.payload.id, approved: false });
    const result = await pending;
    assert.equal(result.ok, false);

    const r2 = await mock.handleFns.get('agent:webSearch')(EVT, 'test');
    assert.equal(r2.ok, false);
  });

  test('requestPermissionEscalation, once approved, escalates deny -> ask (never straight to silent allow) for THIS SESSION ONLY', async () => {
    await mock.handleFns.get('agent:setPermissions')(EVT, { network: 'deny' });
    const pending = mock.handleFns.get('agent:requestPermissionEscalation')(EVT, 'network', 'need docs');
    await new Promise(r => setTimeout(r, 10));
    const req = mock.sent.filter(e => e.channel === 'agent:approvalRequest').at(-1);
    mock.onFns.get('agent:approvalResponse')[0](EVT, { id: req.payload.id, approved: true });
    const escalation = await pending;
    assert.equal(escalation.ok, true);
    assert.equal(escalation.newLevel, 'ask');

    const onDisk = JSON.parse(fs.readFileSync(path.join(projectDir, '.liteide', 'agent-permissions.json'), 'utf8'));
    assert.equal(onDisk.network, 'deny', 'escalation must never be written to disk');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ text: async () => '' });
    const pendingSearch = mock.handleFns.get('agent:webSearch')(EVT, 'test query');
    await new Promise(r => setTimeout(r, 10));
    const req2 = mock.sent.filter(e => e.channel === 'agent:approvalRequest').at(-1);
    assert.equal(req2.payload.action, 'web_search');
    mock.onFns.get('agent:approvalResponse')[0](EVT, { id: req2.payload.id, approved: true });
    const searchResult = await pendingSearch;
    assert.equal(searchResult.ok, true);
    globalThis.fetch = originalFetch;
  });

  test('an escalation does not carry over to a different project', async () => {
    await mock.handleFns.get('agent:setPermissions')(EVT, { execute: 'deny' });
    const pending = mock.handleFns.get('agent:requestPermissionEscalation')(EVT, 'execute', 'need to run build');
    await new Promise(r => setTimeout(r, 10));
    const req = mock.sent.filter(e => e.channel === 'agent:approvalRequest').at(-1);
    mock.onFns.get('agent:approvalResponse')[0](EVT, { id: req.payload.id, approved: true });
    await pending;

    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liteide-extratest-other-'));
    await mock.handleFns.get('agent:setProjectRoot')(EVT, otherDir);
    const r = await mock.handleFns.get('agent:runCommand')(EVT, 'echo hi');
    assert.equal(r.ok, true, "a fresh project defaults to execute:allow, unaffected by the other project's escalation");
  });

  test('escalating an unknown category is a clean error, not a crash', async () => {
    const r = await mock.handleFns.get('agent:requestPermissionEscalation')(EVT, 'not_a_real_category', 'x');
    assert.equal(r.ok, false);
    assert.match(r.error, /Unknown permission category/);
  });
});
