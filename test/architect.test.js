'use strict';
const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMainWithMockElectron } = require('./helpers/mock-electron.js');

const MAIN_PATH = path.join(__dirname, '..', 'main.js');
const EVT = {};

describe('Architect fallback config — agent:getArchitectConfig / agent:setArchitectConfig', () => {
  let mock, projectDir;
  before(() => { mock = loadMainWithMockElectron(MAIN_PATH); });
  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liteide-architecttest-'));
    await mock.handleFns.get('agent:setProjectRoot')(EVT, projectDir);
  });

  test('defaults: disabled, no provider/model override, threshold 2', async () => {
    const cfg = await mock.handleFns.get('agent:getArchitectConfig')(EVT);
    assert.deepEqual(cfg, { enabled: false, provider: null, model: null, failureThreshold: 2 });
  });

  test('a fresh project with no config file yet returns defaults with no crash', async () => {
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liteide-architecttest-fresh-'));
    await mock.handleFns.get('agent:setProjectRoot')(EVT, freshDir);
    const cfg = await mock.handleFns.get('agent:getArchitectConfig')(EVT);
    assert.equal(cfg.enabled, false);
  });

  test('no project open returns safe defaults rather than throwing', async () => {
    const freshMock = loadMainWithMockElectron(MAIN_PATH);
    const cfg = await freshMock.handleFns.get('agent:getArchitectConfig')(EVT);
    assert.equal(cfg.enabled, false);
  });

  test('setArchitectConfig persists to .liteide/agent-architect.json and only updates given fields', async () => {
    await mock.handleFns.get('agent:setArchitectConfig')(EVT, { enabled: true, model: 'qwen2.5-coder' });
    const onDisk = JSON.parse(fs.readFileSync(path.join(projectDir, '.liteide', 'agent-architect.json'), 'utf8'));
    assert.equal(onDisk.enabled, true);
    assert.equal(onDisk.model, 'qwen2.5-coder');
    assert.equal(onDisk.provider, null, 'field not mentioned in the partial update must be untouched (still default)');
    assert.equal(onDisk.failureThreshold, 2, 'field not mentioned in the partial update must be untouched (still default)');
  });

  test('setArchitectConfig on an already-configured project only updates the fields given, preserving the rest', async () => {
    await mock.handleFns.get('agent:setArchitectConfig')(EVT, { enabled: true, provider: 'anthropic', model: 'claude-sonnet-4-6', failureThreshold: 3 });
    await mock.handleFns.get('agent:setArchitectConfig')(EVT, { enabled: false });
    const cfg = await mock.handleFns.get('agent:getArchitectConfig')(EVT);
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.provider, 'anthropic', 'previously-set provider must survive an update that only touches enabled');
    assert.equal(cfg.model, 'claude-sonnet-4-6');
    assert.equal(cfg.failureThreshold, 3);
  });

  test('failureThreshold is clamped to the 1-5 range', async () => {
    await mock.handleFns.get('agent:setArchitectConfig')(EVT, { failureThreshold: 99 });
    assert.equal((await mock.handleFns.get('agent:getArchitectConfig')(EVT)).failureThreshold, 5);
    await mock.handleFns.get('agent:setArchitectConfig')(EVT, { failureThreshold: 0 });
    assert.equal((await mock.handleFns.get('agent:getArchitectConfig')(EVT)).failureThreshold, 1);
    await mock.handleFns.get('agent:setArchitectConfig')(EVT, { failureThreshold: -5 });
    assert.equal((await mock.handleFns.get('agent:getArchitectConfig')(EVT)).failureThreshold, 1);
  });

  test('an explicit provider/model of empty string clears the override back to null (falls back to the main model)', async () => {
    await mock.handleFns.get('agent:setArchitectConfig')(EVT, { provider: 'anthropic', model: 'claude-sonnet-4-6' });
    await mock.handleFns.get('agent:setArchitectConfig')(EVT, { provider: '', model: '' });
    const cfg = await mock.handleFns.get('agent:getArchitectConfig')(EVT);
    assert.equal(cfg.provider, null);
    assert.equal(cfg.model, null);
  });

  test('setArchitectConfig throws a clear error when no project is open', async () => {
    const freshMock = loadMainWithMockElectron(MAIN_PATH);
    await assert.rejects(() => freshMock.handleFns.get('agent:setArchitectConfig')(EVT, { enabled: true }), /No project folder open/);
  });

  test('an architect config does not leak into a different project', async () => {
    await mock.handleFns.get('agent:setArchitectConfig')(EVT, { enabled: true, failureThreshold: 4 });
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liteide-architecttest-other-'));
    await mock.handleFns.get('agent:setProjectRoot')(EVT, otherDir);
    const cfg = await mock.handleFns.get('agent:getArchitectConfig')(EVT);
    assert.equal(cfg.enabled, false, "a fresh project must not inherit another project's architect config");
    assert.equal(cfg.failureThreshold, 2);
  });
});
