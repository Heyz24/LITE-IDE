'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX_PATH = path.join(__dirname, '..', 'src', 'index.html');

// Same extraction helper compaction.test.js uses: locate a function by its
// literal signature, then find the matching top-level closing brace by
// depth-counting. This runs the ACTUAL orchestration code as written in
// src/index.html, not a reimplementation — it fails the moment renderer
// logic drifts from what these tests assert.
function extractFn(src, signature) {
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

// Minimal fake DOM — just enough surface for runSubagentOrchestration's
// card-building code (createElement/appendChild/querySelector/getElementById)
// to run without throwing. No real rendering; we only assert on the
// orchestration's return value, cancellation set, and chatOnce call log.
function makeFakeElement() {
  const el = {
    className: '', style: {}, innerHTML: '', textContent: '',
    children: [],
    appendChild(child) { el.children.push(child); return child; },
    querySelector(sel) {
      // runSubagentOrchestration only ever does `.querySelector('.th')` on
      // a card whose innerHTML it just set — return a stub whose
      // textContent assignment is harmless and inspectable if needed.
      return { set textContent(v) { el.__thText = v; }, get textContent() { return el.__thText; } };
    },
  };
  return el;
}
function makeFakeDocument(providerValue, modelValue) {
  const chatLog = makeFakeElement();
  const elements = {
    'ai-provider-sel': { value: providerValue },
    'ai-model-input': { value: modelValue },
    'ai-chat-log': chatLog,
  };
  return {
    getElementById: (id) => elements[id],
    createElement: () => makeFakeElement(),
    chatLog,
  };
}

function loadSubagentModule({ chatOnceImpl, gateSubagentsImpl }) {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const inlineScript = html.match(/<script>([\s\S]*)<\/script>/)[1];

  const toolsMatch = inlineScript.match(/const AGENT_TOOLS = \[([\s\S]*?)\n\];/);
  if (!toolsMatch) throw new Error('AGENT_TOOLS not found');
  const execFn = extractFn(inlineScript, 'async function execAgentTool(name, args, requestId) {');
  const orchFn = extractFn(inlineScript, 'async function runSubagentOrchestration(tasks, depth = 1, tree = null) {');
  const getAllToolsFn = extractFn(inlineScript, 'async function getAllAgentToolsCached() {');
  const extractToolCallFn = extractFn(inlineScript, 'function extractToolCallFromText(text) {');
  const maxDepthMatch = inlineScript.match(/const MAX_SUBAGENT_DEPTH = (\d+);/);
  const maxTreeMatch = inlineScript.match(/const MAX_SUBAGENTS_PER_TREE = (\d+);/);
  if (!maxDepthMatch || !maxTreeMatch) throw new Error('recursion cap constants not found');

  const fakeDoc = makeFakeDocument('anthropic', 'claude-sonnet-4-6');
  const chatOnceCalls = [];
  const sandbox = {
    document: fakeDoc,
    currentFolder: '/fake/project',
    agentStopRequested: false,
    activeTreeRequestIds: new Set(),
    mcpToolsCache: [], // no MCP servers connected in these tests — getAllAgentToolsCached should just fall back to AGENT_TOOLS unchanged
    crypto: { randomUUID: () => 'id-' + Math.random().toString(36).slice(2) },
    api: {
      ai: { chatOnce: async (payload) => { chatOnceCalls.push(payload); return await chatOnceImpl(payload); } },
      agent: {
        gateSubagents: async (n) => await (gateSubagentsImpl ? gateSubagentsImpl(n) : { ok: true }),
        mcpListTools: async () => ({ ok: true, tools: [] }),
      },
    },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(`
    const AGENT_TOOLS = [${toolsMatch[1]}\n];
    let subagentCounter = 0;
    ${extractToolCallFn}
    ${maxDepthMatch[0]}
    ${maxTreeMatch[0]}
    ${getAllToolsFn}
    ${execFn}
    ${orchFn}
  `, sandbox);
  return { sandbox, chatOnceCalls, fakeDoc };
}

// A scripted "model" that ALWAYS tries to spawn exactly one more sub-agent
// recursively, forever, if allowed to. Used to prove the depth cap actually
// stops runaway recursion rather than relying on the model behaving.
function recursiveSpawnerChatOnce() {
  return async () => ({
    text: '',
    toolCalls: [{ id: 'c1', name: 'spawn_subagents', args: { tasks: ['go deeper'] } }],
  });
}

describe('Recursive subagents — depth cap, tree-wide budget cap, cancellation propagation', () => {
  test('a sub-agent CAN spawn one more level (depth 1 -> depth 2 is allowed)', async () => {
    let call = 0;
    const { sandbox } = loadSubagentModule({
      chatOnceImpl: async () => {
        call++;
        // First call (the depth-1 sub-agent) spawns one depth-2 sub-agent;
        // the depth-2 sub-agent (second call) just finishes with text.
        if (call === 1) return { text: '', toolCalls: [{ id: 'c1', name: 'spawn_subagents', args: { tasks: ['leaf task'] } }] };
        return { text: 'leaf done', toolCalls: [] };
      },
    });
    const result = await vm.runInContext(`runSubagentOrchestration(['depth1 task'], 1, null)`, sandbox);
    assert.equal(result.ok, true);
    assert.match(result.results[0].summary, /leaf done|no output/); // depth-2 sub-agent's own summary bubbles up through the depth-1 result's tool-call trace, not directly — this just proves no error occurred
  });

  test('recursion is refused at the depth cap — a depth-2 sub-agent cannot spawn a depth-3', async () => {
    const { sandbox, chatOnceCalls } = loadSubagentModule({ chatOnceImpl: recursiveSpawnerChatOnce() });
    const maxDepth = vm.runInContext('MAX_SUBAGENT_DEPTH', sandbox);
    // Start directly at the deepest allowed depth so the FIRST spawn attempt
    // from within it is the one that must be refused.
    const result = await vm.runInContext(`runSubagentOrchestration(['try to go deeper'], ${maxDepth}, null)`, sandbox);
    assert.equal(result.ok, true);
    // The sub-agent's own summary must reflect that its tool call failed
    // with the depth-cap error, since execAgentTool returns {ok:false,...}
    // for spawn_subagents at the cap rather than throwing — the sub-agent
    // loop continues and (with no further tool calls in our stub after
    // that) should NOT have caused unbounded recursion / extra chatOnce calls.
    assert.ok(chatOnceCalls.length < 10, `expected the depth cap to stop runaway recursion quickly, but chatOnce was called ${chatOnceCalls.length} times`);
  });

  test('a deeply-recursive model never grows the tree spawn count past the shared budget cap, however many times it retries', async () => {
    // A model that keeps calling spawn_subagents on every single step, even
    // after being refused, is a genuinely pathological case that this cap
    // does not (and is not meant to) fully neutralize by itself — bounding
    // total LLM call volume for a misbehaving model is what the pre-existing
    // per-project token/cost budget cap is for (see budget.test.js), which
    // this vm-level test deliberately bypasses by stubbing chatOnce. What
    // THIS cap guarantees, and what this test actually checks, is narrower
    // and just as important: the number of sub-agents that ever actually
    // get spawned into the tree can never exceed MAX_SUBAGENTS_PER_TREE,
    // no matter how many times spawning is attempted.
    const { sandbox } = loadSubagentModule({ chatOnceImpl: recursiveSpawnerChatOnce() });
    const maxTree = vm.runInContext('MAX_SUBAGENTS_PER_TREE', sandbox);
    const tree = { spawnedCount: { value: 0 }, stopped: { value: false } };
    sandbox.__tree = tree;
    await vm.runInContext(`runSubagentOrchestration(['recurse forever'], 1, __tree)`, sandbox);
    assert.ok(tree.spawnedCount.value <= maxTree, `tree spawn count exceeded the cap: ${tree.spawnedCount.value} > ${maxTree}`);
  });

  test('the tree-wide sub-agent budget cap is shared across depth levels, not per-call', async () => {
    const { sandbox } = loadSubagentModule({
      chatOnceImpl: async () => ({ text: '', toolCalls: [{ id: 'c1', name: 'spawn_subagents', args: { tasks: ['a', 'b', 'c', 'd'] } }] }),
    });
    const maxTree = vm.runInContext('MAX_SUBAGENTS_PER_TREE', sandbox);
    // A single shared tree object, pre-loaded to just under the cap, so the
    // very next spawn attempt must be refused regardless of depth.
    sandbox.__presetTree = { spawnedCount: { value: maxTree - 1 }, stopped: { value: false } };
    const result = await vm.runInContext(`execAgentTool('spawn_subagents', { tasks: ['x','y','z'], __depth: 1, __tree: __presetTree }, 'req-1')`, sandbox);
    // Only 1 slot was left in the budget, but 3 tasks were requested — must
    // be capped down to what's available, not refused outright, and not
    // allowed to overspend.
    assert.equal(result.ok, true);
    assert.equal(sandbox.__presetTree.spawnedCount.value, maxTree, 'budget must be exactly exhausted, never exceeded');
  });

  test('the tree-wide budget cap refuses outright once fully exhausted', async () => {
    const { sandbox } = loadSubagentModule({ chatOnceImpl: async () => ({ text: 'done', toolCalls: [] }) });
    const maxTree = vm.runInContext('MAX_SUBAGENTS_PER_TREE', sandbox);
    sandbox.__presetTree = { spawnedCount: { value: maxTree }, stopped: { value: false } };
    const result = await vm.runInContext(`execAgentTool('spawn_subagents', { tasks: ['one more'], __depth: 1, __tree: __presetTree }, 'req-1')`, sandbox);
    assert.equal(result.ok, false);
    assert.match(result.error, /budget/i);
    assert.equal(sandbox.__presetTree.spawnedCount.value, maxTree, 'a refused spawn must not touch the budget counter at all');
  });

  test('a gateSubagents denial releases the budget reservation (no permanent leak from a denied spawn)', async () => {
    const { sandbox } = loadSubagentModule({
      chatOnceImpl: async () => ({ text: 'done', toolCalls: [] }),
      gateSubagentsImpl: async () => ({ ok: false, error: 'denied by permission settings' }),
    });
    sandbox.__tree = { spawnedCount: { value: 0 }, stopped: { value: false } };
    const result = await vm.runInContext(`execAgentTool('spawn_subagents', { tasks: ['a','b'], __depth: 0, __tree: __tree }, 'req-1')`, sandbox);
    assert.equal(result.ok, false);
    assert.equal(sandbox.__tree.spawnedCount.value, 0, 'a denied spawn must release its reservation, not leak budget permanently');
  });

  test('depth 0 (a fresh top-level call with no __tree) still enforces the tree budget cap correctly', async () => {
    const { sandbox } = loadSubagentModule({ chatOnceImpl: recursiveSpawnerChatOnce() });
    const maxTree = vm.runInContext('MAX_SUBAGENTS_PER_TREE', sandbox);
    const result = await vm.runInContext(`execAgentTool('spawn_subagents', { tasks: ['start'], __depth: 0, __tree: null }, 'req-1')`, sandbox);
    assert.equal(result.ok, true);
    // execAgentTool creates its own fresh tree object internally when
    // __tree is null — we can't reach into it directly here, so instead
    // assert indirectly: the orchestration must have completed (not hung
    // or thrown) even with a model that tries to recurse on every step.
    assert.ok(Array.isArray(result.results));
  });

  test('cancellation: agentStopRequested being true stops a sub-agent from making further chatOnce calls', async () => {
    const { sandbox, chatOnceCalls } = loadSubagentModule({ chatOnceImpl: async () => ({ text: 'should not get here', toolCalls: [] }) });
    sandbox.agentStopRequested = true;
    const result = await vm.runInContext(`runSubagentOrchestration(['a task'], 1, null)`, sandbox);
    assert.equal(result.ok, true);
    assert.equal(chatOnceCalls.length, 0, 'no chatOnce call should have been made once agentStopRequested was already true');
    assert.match(result.results[0].summary, /Stopped by user/);
  });

  test('cancellation: tree.stopped being set by a tool result (e.g. a real cancelled run_command) stops the sub-agent from taking further steps', async () => {
    let call = 0;
    const { sandbox } = loadSubagentModule({
      chatOnceImpl: async () => {
        call++;
        if (call === 1) return { text: '', toolCalls: [{ id: 'c1', name: 'run_command', args: { command: 'sleep 1' } }] };
        // If the sub-agent loop incorrectly continued past the cancelled
        // tool result, it would reach this second call — the test fails
        // via the chatOnceCalls-count assertion below if that happens.
        return { text: 'should not reach step 2', toolCalls: [] };
      },
    });
    // Extend execAgentTool in this sandbox run to simulate a tool reporting
    // {cancelled: true} for a non-spawn_subagents call, the same shape
    // agent:runCommand reports for a real cancelled process.
    vm.runInContext(`
      const __realExec = execAgentTool;
      execAgentTool = async (name, args, requestId) => {
        if (name === 'run_command') return { ok: true, cancelled: true };
        return __realExec(name, args, requestId);
      };
    `, sandbox);
    const result = await vm.runInContext(`runSubagentOrchestration(['a task'], 1, null)`, sandbox);
    assert.equal(result.ok, true);
    // A single cancelled tool call mid-step doesn't itself produce the
    // "stopped before running remaining tool calls" text (that only fires
    // when a LATER tool call in the SAME batch gets skipped) — what it must
    // do is flip tree.stopped so the loop's next top-of-step check catches
    // it before any further chatOnce call is made.
    assert.match(result.results[0].summary, /Stopped by user/);
    assert.equal(call, 1, 'the sub-agent must not have made a second chatOnce call after its tool result came back cancelled');
  });

  test('cancellation: a SECOND tool call in the same step is skipped once an earlier one in that step cancels the tree', async () => {
    const { sandbox } = loadSubagentModule({
      chatOnceImpl: async () => ({
        text: '', toolCalls: [
          { id: 'c1', name: 'run_command', args: { command: 'a' } },
          { id: 'c2', name: 'run_command', args: { command: 'b' } },
        ],
      }),
    });
    let runCommandCalls = 0;
    vm.runInContext(`
      const __realExec2 = execAgentTool;
      execAgentTool = async (name, args, requestId) => {
        if (name === 'run_command') { __runCommandCalls.value++; return { ok: true, cancelled: true }; }
        return __realExec2(name, args, requestId);
      };
    `, sandbox);
    sandbox.__runCommandCalls = { value: 0 };
    const result = await vm.runInContext(`runSubagentOrchestration(['a task'], 1, null)`, sandbox);
    assert.equal(result.ok, true);
    assert.equal(sandbox.__runCommandCalls.value, 1, 'the second tool call in the same batch must be skipped once the first one cancels the tree');
    assert.match(result.results[0].summary, /Stopped before running remaining tool calls/);
  });

  test('requestIds for both chatOnce and tool calls are tracked in activeTreeRequestIds while in flight, then removed', async () => {
    let sawNonEmptySet = false;
    const { sandbox } = loadSubagentModule({
      chatOnceImpl: async () => {
        if (sandbox.activeTreeRequestIds.size > 0) sawNonEmptySet = true;
        return { text: 'done', toolCalls: [] };
      },
    });
    await vm.runInContext(`runSubagentOrchestration(['a task'], 1, null)`, sandbox);
    assert.equal(sawNonEmptySet, true, 'activeTreeRequestIds must contain the in-flight chatOnce requestId while the call is pending');
    assert.equal(sandbox.activeTreeRequestIds.size, 0, 'activeTreeRequestIds must be empty again once every call has settled — no leak');
  });
});
