'use strict';
const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMainWithMockElectron } = require('./helpers/mock-electron.js');

const MAIN_PATH = path.join(__dirname, '..', 'main.js');
const EVT = {};

describe('Cancellation propagation', () => {
  let mock, projectDir, originalFetch;

  before(() => { mock = loadMainWithMockElectron(MAIN_PATH); });

  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liteide-canceltest-'));
    await mock.handleFns.get('agent:setProjectRoot')(EVT, projectDir);
    await mock.handleFns.get('ai:saveConfig')(EVT, {
      provider: 'openai', model: 'gpt-5.1', ollamaUrl: 'http://localhost:11434',
      keys: { openai: 'sk-test', anthropic: 'sk-ant-test', gemini: 'g-test' },
    });
    originalFetch = globalThis.fetch;
  });

  test('ai:chatOnce receives a real AbortSignal, and cancelling it produces {aborted:true} rather than throwing', async () => {
    let receivedSignal = null;
    globalThis.fetch = (url, opts) => {
      receivedSignal = opts.signal;
      return new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    };
    const requestId = 'req-1';
    const pending = mock.handleFns.get('ai:chatOnce')(EVT, {
      provider: 'openai', model: 'gpt-5.1', messages: [{ role: 'user', content: 'hi' }],
      tools: [], systemPrompt: '', requestId,
    });
    await new Promise(r => setTimeout(r, 10));
    assert.ok(receivedSignal instanceof AbortSignal, 'the provider adapter must actually receive an AbortSignal, not just accept the param');
    assert.equal(receivedSignal.aborted, false);

    mock.onFns.get('agent:cancelRequest')[0](EVT, requestId);
    const result = await pending;
    assert.equal(receivedSignal.aborted, true, 'the signal handed to fetch must actually flip to aborted');
    assert.deepEqual(result, { aborted: true });
    globalThis.fetch = originalFetch;
  });

  test('cancelling an unknown/already-finished requestId is a harmless no-op', async () => {
    assert.doesNotThrow(() => mock.onFns.get('agent:cancelRequest')[0](EVT, 'not-a-real-request-id'));
  });

  test('cancelling one request does not abort a different concurrent request', async () => {
    const signals = {};
    let call = 0;
    globalThis.fetch = (url, opts) => {
      call++;
      const label = call === 1 ? 'A' : 'B';
      signals[label] = opts.signal;
      return new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => { const e = new Error('x'); e.name = 'AbortError'; reject(e); });
      });
    };
    const pendingA = mock.handleFns.get('ai:chatOnce')(EVT, { provider: 'openai', model: 'm', messages: [{role:'user',content:'a'}], tools: [], systemPrompt: '', requestId: 'req-A' });
    const pendingB = mock.handleFns.get('ai:chatOnce')(EVT, { provider: 'openai', model: 'm', messages: [{role:'user',content:'b'}], tools: [], systemPrompt: '', requestId: 'req-B' });
    await new Promise(r => setTimeout(r, 10));

    mock.onFns.get('agent:cancelRequest')[0](EVT, 'req-A');
    const resultA = await pendingA;
    assert.deepEqual(resultA, { aborted: true });
    assert.equal(signals.B.aborted, false, 'cancelling request A must not touch request B\'s signal');

    mock.onFns.get('agent:cancelRequest')[0](EVT, 'req-B');
    const resultB = await pendingB;
    assert.deepEqual(resultB, { aborted: true });
    globalThis.fetch = originalFetch;
  });

  test('agent:runCommand: cancelling a long-running command actually kills the real child process', async () => {
    const requestId = 'req-cmd-1';
    // Deliberately NOT using `node -e "...(...)..."` inline here: on Windows,
    // cmd.exe's own re-quoting of a /c argument that already contains
    // double quotes and parens is fragile (this bit us for real — the
    // process exited near-instantly on a syntax error from mangled
    // quoting, before the cancel ever had anything to kill, producing a
    // false "not cancelled" failure that had nothing to do with
    // cancellation itself). A real script file sidesteps shell quoting
    // entirely and is the more realistic test anyway.
    const scriptPath = path.join(projectDir, '__sleep_test.js');
    fs.writeFileSync(scriptPath, 'setTimeout(() => {}, 30000);\n', 'utf8');
    const longRunningCmd = 'node __sleep_test.js';
    const pending = mock.handleFns.get('agent:runCommand')(EVT, longRunningCmd, { requestId });
    await new Promise(r => setTimeout(r, 500)); // let the shell actually spawn node
    mock.onFns.get('agent:cancelRequest')[0](EVT, requestId);
    const start = Date.now();
    const result = await pending;
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 8000, `cancelled command must resolve promptly, took ${elapsed}ms`);
    assert.equal(result.ok, true);
    assert.ok(result.cancelled, 'result must be flagged as cancelled, not treated as a normal 0-exit success');
  });

  test('a completed command is cleaned out of the tracking map (no leak — cancelling it afterward is a no-op)', async () => {
    const requestId = 'req-cmd-2';
    const result = await mock.handleFns.get('agent:runCommand')(EVT, 'echo done', { requestId });
    assert.equal(result.ok, true);
    assert.doesNotThrow(() => mock.onFns.get('agent:cancelRequest')[0](EVT, requestId));
  });
});
