'use strict';
const { test, describe, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadMainWithMockElectron } = require('./helpers/mock-electron.js');

const MAIN_PATH = path.join(__dirname, '..', 'main.js');
const EVT = {};

describe('AI provider adapters (mocked fetch — no real network/API calls)', () => {
  let mock, originalFetch, lastRequest;

  before(() => {
    mock = loadMainWithMockElectron(MAIN_PATH);
  });

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    await mock.handleFns.get('ai:saveConfig')(EVT, {
      provider: 'openai', model: 'gpt-5.1', ollamaUrl: 'http://localhost:11434',
      keys: { openai: 'sk-test', anthropic: 'sk-ant-test', gemini: 'g-test' },
    });
  });

  afterEach(() => { globalThis.fetch = originalFetch; });

  function stubFetch(responseBody) {
    globalThis.fetch = async (url, opts) => {
      lastRequest = { url, body: opts?.body ? JSON.parse(opts.body) : null, headers: opts?.headers };
      return { json: async () => responseBody };
    };
  }

  test('OpenAI: system prompt is actually sent as a system message (regression test — this was silently dropped before)', async () => {
    stubFetch({ choices: [{ message: { role: 'assistant', content: 'OK' } }] });
    await mock.handleFns.get('ai:chatOnce')(EVT, {
      provider: 'openai', model: 'gpt-5.1',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [], systemPrompt: 'SYSTEM_MARKER_XYZ',
    });
    assert.equal(lastRequest.url, 'https://api.openai.com/v1/chat/completions');
    assert.ok(lastRequest.body.messages.some(m => m.role === 'system' && m.content === 'SYSTEM_MARKER_XYZ'),
      'systemPrompt must be present as a system message in the OpenAI request body');
  });

  test('Ollama: system prompt is actually sent (regression test — this was silently dropped before)', async () => {
    stubFetch({ message: { role: 'assistant', content: 'OK' } });
    await mock.handleFns.get('ai:chatOnce')(EVT, {
      provider: 'ollama', model: 'qwen2.5-coder',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [], systemPrompt: 'SYSTEM_MARKER_XYZ',
    });
    assert.equal(lastRequest.url, 'http://localhost:11434/api/chat');
    assert.ok(lastRequest.body.messages.some(m => m.role === 'system' && m.content === 'SYSTEM_MARKER_XYZ'));
  });

  test('Anthropic: system prompt goes in the top-level `system` field, not the messages array', async () => {
    stubFetch({ content: [{ type: 'text', text: 'OK' }] });
    await mock.handleFns.get('ai:chatOnce')(EVT, {
      provider: 'anthropic', model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [], systemPrompt: 'SYSTEM_MARKER_XYZ',
    });
    assert.equal(lastRequest.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(lastRequest.body.system, 'SYSTEM_MARKER_XYZ');
    assert.equal(lastRequest.headers['x-api-key'], 'sk-ant-test');
  });

  test('Anthropic: tool_use + tool_result round-trip converts to the correct block format', async () => {
    stubFetch({ content: [{ type: 'text', text: 'done' }] });
    await mock.handleFns.get('ai:chatOnce')(EVT, {
      provider: 'anthropic', model: 'claude-sonnet-4-6',
      messages: [
        { role: 'user', content: 'read package.json' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'read_file', args: { path: 'package.json' } }] },
        { role: 'tool', tool_call_id: 'call_1', name: 'read_file', content: '{"ok":true}' },
      ],
      tools: [], systemPrompt: '',
    });
    const wireMessages = lastRequest.body.messages;
    const assistantMsg = wireMessages.find(m => m.role === 'assistant');
    assert.ok(Array.isArray(assistantMsg.content));
    assert.ok(assistantMsg.content.some(b => b.type === 'tool_use' && b.id === 'call_1'));
    const toolResultMsg = wireMessages.find(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result'));
    assert.ok(toolResultMsg, 'a tool_result block must be present for the tool response');
  });

  test('Gemini: thoughtSignature is captured from the response and replayed on the next call', async () => {
    // First call: model returns a function call carrying a thoughtSignature.
    stubFetch({
      candidates: [{ content: { parts: [{ functionCall: { name: 'read_file', args: { path: 'x' } }, thoughtSignature: 'SIG_ABC' }] } }],
    });
    const first = await mock.handleFns.get('ai:chatOnce')(EVT, {
      provider: 'gemini', model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hi' }], tools: [], systemPrompt: '',
    });
    assert.equal(first.toolCalls[0].thoughtSignature, 'SIG_ABC');

    // Second call: replay that assistant turn — the signature must appear in the outgoing request.
    stubFetch({ candidates: [{ content: { parts: [{ text: 'done' }] } }] });
    await mock.handleFns.get('ai:chatOnce')(EVT, {
      provider: 'gemini', model: 'gemini-2.5-flash',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '', toolCalls: first.toolCalls },
        { role: 'tool', tool_call_id: first.toolCalls[0].id, name: 'read_file', content: '{}' },
      ],
      tools: [], systemPrompt: '',
    });
    const modelTurn = lastRequest.body.contents.find(c => c.role === 'model');
    const fnCallPart = modelTurn.parts.find(p => p.functionCall);
    assert.equal(fnCallPart.thoughtSignature, 'SIG_ABC', 'thoughtSignature must be echoed back on the function call part');
  });

  test('Gemini: a tool result is sent with role "user", not "function" (regression test — the live API rejects role:"function" with "Role \'function\' is not supported")', async () => {
    stubFetch({ candidates: [{ content: { parts: [{ text: 'done' }] } }] });
    await mock.handleFns.get('ai:chatOnce')(EVT, {
      provider: 'gemini', model: 'gemini-2.5-flash',
      messages: [
        { role: 'user', content: 'read package.json' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'read_file', args: { path: 'package.json' } }] },
        { role: 'tool', tool_call_id: 'call_1', name: 'read_file', content: '{"ok":true}' },
      ],
      tools: [], systemPrompt: '',
    });
    // No 'function'-role content is ever valid to send — Gemini's `contents`
    // array only accepts 'user' and 'model'.
    assert.ok(!lastRequest.body.contents.some(c => c.role === 'function'), 'no content in the request may use role "function" — the live Gemini API rejects it outright');
    const toolResultTurn = lastRequest.body.contents.find(c => c.parts?.some(p => p.functionResponse));
    assert.ok(toolResultTurn, 'a functionResponse part must be present for the tool result');
    assert.equal(toolResultTurn.role, 'user', 'the functionResponse part must be inside a role:"user" turn');
    assert.equal(toolResultTurn.parts[0].functionResponse.name, 'read_file');
    assert.deepEqual(toolResultTurn.parts[0].functionResponse.response, { result: '{"ok":true}' });
  });

  test('OpenAI/Ollama text-only responses (no tool calls) parse cleanly', async () => {
    stubFetch({ choices: [{ message: { role: 'assistant', content: 'plain text reply' } }] });
    const result = await mock.handleFns.get('ai:chatOnce')(EVT, {
      provider: 'openai', model: 'gpt-5.1', messages: [{ role: 'user', content: 'hi' }], tools: [], systemPrompt: '',
    });
    assert.equal(result.text, 'plain text reply');
    assert.deepEqual(result.toolCalls, []);
  });

  test('a provider API error surfaces as {error: ...} rather than throwing', async () => {
    stubFetch({ error: { message: 'invalid_api_key' } });
    const result = await mock.handleFns.get('ai:chatOnce')(EVT, {
      provider: 'openai', model: 'gpt-5.1', messages: [{ role: 'user', content: 'hi' }], tools: [], systemPrompt: '',
    });
    assert.equal(result.error, 'invalid_api_key');
  });
});
