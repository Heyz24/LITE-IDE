'use strict';
const { test, describe, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMainWithMockElectron } = require('./helpers/mock-electron.js');

const MAIN_PATH = path.join(__dirname, '..', 'main.js');
const EVT = {};

describe('Cost / token budget caps', () => {
  let mock, projectDir, originalFetch;

  before(() => { mock = loadMainWithMockElectron(MAIN_PATH); });

  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liteide-budgettest-'));
    await mock.handleFns.get('agent:setProjectRoot')(EVT, projectDir);
    await mock.handleFns.get('ai:saveConfig')(EVT, {
      provider: 'anthropic', model: 'claude-sonnet-4-6', ollamaUrl: 'http://localhost:11434',
      keys: { anthropic: 'sk-ant-test' },
    });
    originalFetch = globalThis.fetch;
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  function stubUsageResponse(inputTokens, outputTokens) {
    globalThis.fetch = async () => ({
      json: async () => ({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      }),
    });
  }

  test('agent:getUsage on a fresh project starts at zero with no cap', async () => {
    const u = await mock.handleFns.get('agent:getUsage')(EVT);
    assert.equal(u.totalInputTokens, 0);
    assert.equal(u.totalOutputTokens, 0);
    assert.equal(u.totalCostUsd, 0);
    assert.equal(u.callCount, 0);
    assert.deepEqual(u.cap, { maxTokens: null, maxUsd: null });
  });

  test('a real chatOnce call records real token usage from the provider response, and it persists to disk', async () => {
    stubUsageResponse(1000, 500);
    const res = await mock.handleFns.get('ai:chatOnce')(EVT, {
      provider: 'anthropic', model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }], tools: [], systemPrompt: '',
    });
    assert.equal(res.usage.inputTokens, 1000);
    assert.equal(res.usage.outputTokens, 500);
    assert.ok(res.usage.costUsd > 0);
    assert.equal(res.cumulativeUsage.callCount, 1);

    const onDisk = JSON.parse(fs.readFileSync(path.join(projectDir, '.liteide', 'agent-usage.json'), 'utf8'));
    assert.equal(onDisk.totalInputTokens, 1000);
    assert.equal(onDisk.totalOutputTokens, 500);
    assert.equal(onDisk.log.length, 1);
  });

  test('usage accumulates correctly across multiple calls', async () => {
    stubUsageResponse(100, 50);
    await mock.handleFns.get('ai:chatOnce')(EVT, { provider: 'anthropic', model: 'claude-sonnet-4-6', messages: [{role:'user',content:'a'}], tools: [], systemPrompt: '' });
    stubUsageResponse(200, 75);
    await mock.handleFns.get('ai:chatOnce')(EVT, { provider: 'anthropic', model: 'claude-sonnet-4-6', messages: [{role:'user',content:'b'}], tools: [], systemPrompt: '' });
    const u = await mock.handleFns.get('agent:getUsage')(EVT);
    assert.equal(u.totalInputTokens, 300);
    assert.equal(u.totalOutputTokens, 125);
    assert.equal(u.callCount, 2);
  });

  test('a token cap actually blocks the NEXT call before any network request is made', async () => {
    await mock.handleFns.get('agent:setBudgetCap')(EVT, { maxTokens: 1000, maxUsd: null });
    stubUsageResponse(900, 200); // pushes total to 1100, over the 1000 cap
    const first = await mock.handleFns.get('ai:chatOnce')(EVT, { provider: 'anthropic', model: 'claude-sonnet-4-6', messages: [{role:'user',content:'a'}], tools: [], systemPrompt: '' });
    assert.equal(first.budgetExceeded, undefined, 'the call that CROSSES the cap must still be allowed to complete');

    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return { json: async () => ({ content: [{type:'text',text:'x'}] }) }; };
    const second = await mock.handleFns.get('ai:chatOnce')(EVT, { provider: 'anthropic', model: 'claude-sonnet-4-6', messages: [{role:'user',content:'b'}], tools: [], systemPrompt: '' });
    assert.equal(second.budgetExceeded, true);
    assert.match(second.reason, /Token cap reached/);
    assert.equal(fetchCalled, false, 'once the cap is exceeded, the next call must be blocked BEFORE hitting the network — no wasted paid call');
  });

  test('a USD cap blocks further calls once the estimated cost crosses it', async () => {
    await mock.handleFns.get('agent:setBudgetCap')(EVT, { maxTokens: null, maxUsd: 0.001 });
    // sonnet pricing in the table: $3/M in, $15/M out -> 100k in + 100k out tokens is well over $0.001
    stubUsageResponse(100000, 100000);
    await mock.handleFns.get('ai:chatOnce')(EVT, { provider: 'anthropic', model: 'claude-sonnet-4-6', messages: [{role:'user',content:'a'}], tools: [], systemPrompt: '' });
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return { json: async () => ({ content: [] }) }; };
    const second = await mock.handleFns.get('ai:chatOnce')(EVT, { provider: 'anthropic', model: 'claude-sonnet-4-6', messages: [{role:'user',content:'b'}], tools: [], systemPrompt: '' });
    assert.equal(second.budgetExceeded, true);
    assert.match(second.reason, /Cost cap reached/);
    assert.equal(fetchCalled, false);
  });

  test('ollama (local) calls are always free regardless of token volume', async () => {
    globalThis.fetch = async () => ({ json: async () => ({ message: { content: 'ok' }, prompt_eval_count: 500000, eval_count: 500000 }) });
    await mock.handleFns.get('ai:saveConfig')(EVT, { provider: 'ollama', model: 'qwen2.5-coder', ollamaUrl: 'http://localhost:11434', keys: {} });
    const res = await mock.handleFns.get('ai:chatOnce')(EVT, { provider: 'ollama', model: 'qwen2.5-coder', messages: [{role:'user',content:'a'}], tools: [], systemPrompt: '' });
    assert.equal(res.usage.costUsd, 0);
  });

  test('agent:resetUsage zeroes counters but keeps the configured cap', async () => {
    await mock.handleFns.get('agent:setBudgetCap')(EVT, { maxTokens: 5000, maxUsd: null });
    stubUsageResponse(100, 50);
    await mock.handleFns.get('ai:chatOnce')(EVT, { provider: 'anthropic', model: 'claude-sonnet-4-6', messages: [{role:'user',content:'a'}], tools: [], systemPrompt: '' });
    const afterReset = await mock.handleFns.get('agent:resetUsage')(EVT);
    assert.equal(afterReset.totalInputTokens, 0);
    assert.equal(afterReset.callCount, 0);
    assert.deepEqual(afterReset.cap, { maxTokens: 5000, maxUsd: null });
  });

  test('a fresh project with no chatOnce calls yet is never blocked, even with a very low cap', async () => {
    await mock.handleFns.get('agent:setBudgetCap')(EVT, { maxTokens: 1, maxUsd: null });
    const u = await mock.handleFns.get('agent:getUsage')(EVT);
    assert.equal(budgetNotYetExceeded(u), true);
    function budgetNotYetExceeded(u) { return (u.totalInputTokens + u.totalOutputTokens) < u.cap.maxTokens ? true : false; }
    // zero usage vs cap of 1 token -> not yet exceeded, first call must be allowed through
    stubUsageResponse(0, 0);
    const res = await mock.handleFns.get('ai:chatOnce')(EVT, { provider: 'anthropic', model: 'claude-sonnet-4-6', messages: [{role:'user',content:'a'}], tools: [], systemPrompt: '' });
    assert.equal(res.budgetExceeded, undefined);
  });
});
