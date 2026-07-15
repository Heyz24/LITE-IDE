'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX_PATH = path.join(__dirname, '..', 'src', 'index.html');

function extractFn(src, signature) {
  const re = new RegExp(signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('XXX', '[\\s\\S]*?') + '[\\s\\S]*?\\n\\}', 'm');
  // simpler: locate by literal start marker then find the matching top-level closing brace.
  const startIdx = src.indexOf(signature);
  if (startIdx === -1) throw new Error('function not found: ' + signature);
  const braceStart = src.indexOf('{', startIdx);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(startIdx, i + 1);
}

// This test suite runs the ACTUAL compaction functions as written in
// src/index.html (extracted verbatim + executed via vm), not a
// reimplementation — so it fails the moment renderer logic drifts from what
// these tests assert, the same guarantee the wiring tests give for IPC.
function loadCompactionModule(chatOnceImpl) {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  const inlineScript = scriptMatch[1];

  const findFn = extractFn(inlineScript, 'function findUserTurnBoundaries(history) {');
  const serializeFn = extractFn(inlineScript, 'function serializeMessageForSummary(m) {');
  const compactFn = extractFn(inlineScript, 'async function maybeCompactHistory(provider, model) {');
  const promptMatch = inlineScript.match(/const COMPACTION_PROMPT = '([\s\S]*?)';/);
  if (!promptMatch) throw new Error('COMPACTION_PROMPT not found');

  const sandbox = {
    api: { ai: { chatOnce: chatOnceImpl } },
    refreshUsageDisplay: () => { sandbox.__refreshCalled = true; },
    agentHistory: [],
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(`
    const KEEP_RECENT_USER_TURNS = 3;
    const COMPACTION_PROMPT = '${promptMatch[1]}';
    ${findFn}
    ${serializeFn}
    ${compactFn}
  `, sandbox);
  return sandbox;
}

function turn(userText, assistantText, toolCalls) {
  const msgs = [{ role: 'user', content: userText }];
  msgs.push({ role: 'assistant', content: assistantText || '', toolCalls: toolCalls || [] });
  for (const tc of (toolCalls || [])) msgs.push({ role: 'tool', name: tc.name, tool_call_id: tc.id, content: JSON.stringify({ ok: true }) });
  return msgs;
}

describe('Context compaction (executes the real src/index.html functions)', () => {
  test('findUserTurnBoundaries finds only real user turns, not compaction-summary markers', () => {
    const sandbox = loadCompactionModule(async () => ({}));
    const history = [
      { role: 'user', __compactionSummary: true, content: 'summary' },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ];
    const result = vm.runInContext('findUserTurnBoundaries(' + JSON.stringify(history) + ')', sandbox);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), [1, 3]);
  });

  test('does nothing when there are not enough turns yet', async () => {
    const sandbox = loadCompactionModule(async () => { throw new Error('should not be called'); });
    sandbox.agentHistory = [...turn('a'), ...turn('b')]; // only 2 turns, KEEP_RECENT_USER_TURNS=3
    const compacted = await vm.runInContext('maybeCompactHistory("anthropic","claude-sonnet-4-6")', sandbox);
    assert.equal(compacted, false);
    assert.equal(sandbox.agentHistory.length, 4); // untouched
  });

  test('compacts everything before the last 3 user turns into one summary message, preserving the recent ones verbatim', async () => {
    let capturedTranscript = null;
    const sandbox = loadCompactionModule(async (payload) => {
      capturedTranscript = payload.messages[0].content;
      return { text: 'CONDENSED SUMMARY TEXT' };
    });
    const t1 = turn('turn one', 'did thing one', [{ id: 'c1', name: 'read_file', args: { path: 'a.js' } }]);
    const t2 = turn('turn two', 'did thing two');
    const t3 = turn('turn three', 'did thing three');
    const t4 = turn('turn four', 'did thing four');
    sandbox.agentHistory = [...t1, ...t2, ...t3, ...t4]; // 4 turns, keep last 3 -> t1 gets compacted
    const compacted = await vm.runInContext('maybeCompactHistory("anthropic","claude-sonnet-4-6")', sandbox);

    assert.equal(compacted, true);
    assert.match(capturedTranscript, /turn one/);
    assert.match(capturedTranscript, /read_file/);

    const result = sandbox.agentHistory;
    assert.equal(result[0].__compactionSummary, true);
    assert.match(result[0].content, /CONDENSED SUMMARY TEXT/);
    // t2, t3, t4 (6 messages, no tool calls) must survive completely verbatim after the summary
    assert.equal(result.length, 1 + 6);
    assert.equal(result[1].content, 'turn two');
    assert.equal(result.at(-1).content, 'did thing four');
  });

  test('never splits a tool_use from its tool_result — the cut always lands exactly on a user-message boundary', async () => {
    const sandbox = loadCompactionModule(async () => ({ text: 'summary' }));
    const t1 = turn('t1', 'a1', [{ id: 'c1', name: 'read_file', args: {} }]);
    const t2 = turn('t2', 'a2', [{ id: 'c2', name: 'write_file', args: {} }]);
    const t3 = turn('t3', 'a3', [{ id: 'c3', name: 'run_command', args: {} }]);
    const t4 = turn('t4', 'a4', [{ id: 'c4', name: 'edit_file', args: {} }]);
    sandbox.agentHistory = [...t1, ...t2, ...t3, ...t4];
    await vm.runInContext('maybeCompactHistory("anthropic","claude-sonnet-4-6")', sandbox);

    const result = sandbox.agentHistory;
    // Every remaining 'tool' message's assistant toolCalls entry must also be present.
    const remainingToolCallIds = new Set();
    for (const m of result) if (m.role === 'assistant') for (const tc of (m.toolCalls || [])) remainingToolCallIds.add(tc.id);
    for (const m of result) {
      if (m.role === 'tool') assert.ok(remainingToolCallIds.has(m.tool_call_id), `tool_result ${m.tool_call_id} has no matching tool_use left in history — this would break the next provider call`);
    }
  });

  test('leaves history untouched if the summarization call errors', async () => {
    const sandbox = loadCompactionModule(async () => ({ error: 'rate limited' }));
    const turns = [...turn('a'), ...turn('b'), ...turn('c'), ...turn('d')];
    sandbox.agentHistory = [...turns];
    const compacted = await vm.runInContext('maybeCompactHistory("anthropic","claude-sonnet-4-6")', sandbox);
    assert.equal(compacted, false);
    assert.deepEqual(sandbox.agentHistory, turns);
  });

  test('leaves history untouched if the summarization call hits the budget cap', async () => {
    const sandbox = loadCompactionModule(async () => ({ budgetExceeded: true, reason: 'cap reached' }));
    const turns = [...turn('a'), ...turn('b'), ...turn('c'), ...turn('d')];
    sandbox.agentHistory = [...turns];
    const compacted = await vm.runInContext('maybeCompactHistory("anthropic","claude-sonnet-4-6")', sandbox);
    assert.equal(compacted, false);
  });

  test('serializeMessageForSummary renders a compaction-summary message distinctly from a real user message', () => {
    const sandbox = loadCompactionModule(async () => ({}));
    const real = vm.runInContext(`serializeMessageForSummary(${JSON.stringify({ role: 'user', content: 'hello' })})`, sandbox);
    const summary = vm.runInContext(`serializeMessageForSummary(${JSON.stringify({ role: 'user', __compactionSummary: true, content: 'earlier stuff' })})`, sandbox);
    assert.match(real, /^USER: hello$/);
    assert.match(summary, /^\[EARLIER SUMMARY\]/);
  });
});
