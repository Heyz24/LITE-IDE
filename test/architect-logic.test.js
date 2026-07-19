'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX_PATH = path.join(__dirname, '..', 'src', 'index.html');

// Same extraction helper compaction.test.js and subagents.test.js use.
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
function extractConst(src, name) {
  const re = new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`);
  const m = src.match(re);
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

function loadArchitectModule({ chatOnceImpl, execAgentToolImpl }) {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const inlineScript = html.match(/<script>([\s\S]*)<\/script>/)[1];

  const parseFn = extractFn(inlineScript, 'function extractSearchReplaceBlock(text) {');
  const fixFn = extractFn(inlineScript, 'async function attemptArchitectFix(relPath, recentAttempts, currentContent, archCfg, fallbackProvider, fallbackModel) {');
  const promptConst = extractConst(inlineScript, 'ARCHITECT_SYSTEM_PROMPT');
  const markerConsts = [
    inlineScript.match(/const ARCHITECT_SEARCH_MARKER = [^\n]+\n/)[0],
    inlineScript.match(/const ARCHITECT_DIVIDER_MARKER = [^\n]+\n/)[0],
    inlineScript.match(/const ARCHITECT_REPLACE_MARKER = [^\n]+\n/)[0],
  ].join('');

  const execCalls = [];
  const sandbox = {
    api: {
      ai: { chatOnce: async (payload) => chatOnceImpl(payload) },
    },
    crypto: { randomUUID: () => 'id-' + Math.random().toString(36).slice(2) },
    execAgentTool: async (name, args, requestId) => { execCalls.push({ name, args }); return execAgentToolImpl(name, args); },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(`
    ${markerConsts}
    ${parseFn}
    ${promptConst}
    ${fixFn}
  `, sandbox);
  return { sandbox, execCalls };
}

describe('Architect fallback — SEARCH/REPLACE parser', () => {
  test('parses a well-formed block correctly', () => {
    const { sandbox } = loadArchitectModule({});
    const text = [
      '<<<<<<< SEARCH',
      'function old() {',
      '  return 1;',
      '}',
      '=======',
      'function old() {',
      '  return 2;',
      '}',
      '>>>>>>> REPLACE',
    ].join('\n');
    const result = vm.runInContext(`extractSearchReplaceBlock(${JSON.stringify(text)})`, sandbox);
    assert.equal(result.old_str, 'function old() {\n  return 1;\n}');
    assert.equal(result.new_str, 'function old() {\n  return 2;\n}');
  });

  test('returns null when no SEARCH marker is present', () => {
    const { sandbox } = loadArchitectModule({});
    const result = vm.runInContext(`extractSearchReplaceBlock(${JSON.stringify('just some prose, no block here')})`, sandbox);
    assert.equal(result, null);
  });

  test('returns null when the block is malformed (missing REPLACE marker)', () => {
    const { sandbox } = loadArchitectModule({});
    const text = '<<<<<<< SEARCH\nfoo\n=======\nbar\n';
    const result = vm.runInContext(`extractSearchReplaceBlock(${JSON.stringify(text)})`, sandbox);
    assert.equal(result, null);
  });

  test('returns null for an empty SEARCH section (can never match anything real)', () => {
    const { sandbox } = loadArchitectModule({});
    const text = '<<<<<<< SEARCH\n=======\nsomething\n>>>>>>> REPLACE';
    const result = vm.runInContext(`extractSearchReplaceBlock(${JSON.stringify(text)})`, sandbox);
    assert.equal(result, null);
  });

  test('handles surrounding prose/explanation around the block gracefully', () => {
    const { sandbox } = loadArchitectModule({});
    const text = 'Here is the fix:\n\n<<<<<<< SEARCH\nx = 1\n=======\nx = 2\n>>>>>>> REPLACE\n\nThat should do it.';
    const result = vm.runInContext(`extractSearchReplaceBlock(${JSON.stringify(text)})`, sandbox);
    assert.equal(result.old_str, 'x = 1');
    assert.equal(result.new_str, 'x = 2');
  });

  test('an empty REPLACE section is valid (deleting text is a legitimate edit)', () => {
    const { sandbox } = loadArchitectModule({});
    const text = '<<<<<<< SEARCH\nconsole.log("debug");\n=======\n>>>>>>> REPLACE';
    const result = vm.runInContext(`extractSearchReplaceBlock(${JSON.stringify(text)})`, sandbox);
    assert.equal(result.old_str, 'console.log("debug");');
    assert.equal(result.new_str, '');
  });
});

describe('Architect fallback — attemptArchitectFix end-to-end', () => {
  test('a well-formed architect response that matches the file produces a successful edit', async () => {
    const { sandbox, execCalls } = loadArchitectModule({
      chatOnceImpl: async () => ({ text: '<<<<<<< SEARCH\nold code\n=======\nnew code\n>>>>>>> REPLACE' }),
      execAgentToolImpl: (name, args) => ({ ok: true, path: args.path }),
    });
    const result = await vm.runInContext(
      `attemptArchitectFix('foo.js', [], 'old code', {enabled:true}, 'anthropic', 'claude-sonnet-4-6')`, sandbox
    );
    assert.equal(result.ok, true);
    assert.equal(result.result.path, 'foo.js');
    assert.equal(execCalls.length, 1);
    assert.equal(execCalls[0].name, 'edit_file');
    assert.equal(execCalls[0].args.old_str, 'old code');
    assert.equal(execCalls[0].args.new_str, 'new code');
  });

  test('archCfg.provider/model override the fallback provider/model when set', async () => {
    let seenPayload = null;
    const { sandbox } = loadArchitectModule({
      chatOnceImpl: async (payload) => { seenPayload = payload; return { text: '<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE' }; },
      execAgentToolImpl: () => ({ ok: true }),
    });
    await vm.runInContext(
      `attemptArchitectFix('foo.js', [], 'a', {enabled:true, provider:'ollama', model:'qwen2.5-coder'}, 'anthropic', 'claude-sonnet-4-6')`, sandbox
    );
    assert.equal(seenPayload.provider, 'ollama');
    assert.equal(seenPayload.model, 'qwen2.5-coder');
  });

  test('falls back to the main provider/model when archCfg has no override', async () => {
    let seenPayload = null;
    const { sandbox } = loadArchitectModule({
      chatOnceImpl: async (payload) => { seenPayload = payload; return { text: '<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE' }; },
      execAgentToolImpl: () => ({ ok: true }),
    });
    await vm.runInContext(
      `attemptArchitectFix('foo.js', [], 'a', {enabled:true, provider:null, model:null}, 'anthropic', 'claude-sonnet-4-6')`, sandbox
    );
    assert.equal(seenPayload.provider, 'anthropic');
    assert.equal(seenPayload.model, 'claude-sonnet-4-6');
  });

  test('the architect call itself is made with NO tools — it must not be able to recurse into further tool-calling', async () => {
    let seenPayload = null;
    const { sandbox } = loadArchitectModule({
      chatOnceImpl: async (payload) => { seenPayload = payload; return { text: '<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE' }; },
      execAgentToolImpl: () => ({ ok: true }),
    });
    await vm.runInContext(`attemptArchitectFix('foo.js', [], 'a', {enabled:true}, 'anthropic', 'claude-sonnet-4-6')`, sandbox);
    // Cross-vm-realm arrays fail assert.deepEqual's prototype-identity check
    // even with identical content, so compare structurally instead.
    assert.equal(Array.isArray(seenPayload.tools) || seenPayload.tools.length === 0, true);
    assert.equal(seenPayload.tools.length, 0);
  });

  test('failed attempts are included in the prompt so the architect knows what NOT to repeat', async () => {
    let seenPayload = null;
    const { sandbox } = loadArchitectModule({
      chatOnceImpl: async (payload) => { seenPayload = payload; return { text: '<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE' }; },
      execAgentToolImpl: () => ({ ok: true }),
    });
    const attempts = [{ old_str: 'wrong guess 1', new_str: 'x', error: 'not found' }, { old_str: 'wrong guess 2', new_str: 'y', error: 'ambiguous' }];
    await vm.runInContext(`attemptArchitectFix('foo.js', ${JSON.stringify(attempts)}, 'real content', {enabled:true}, 'anthropic', 'm')`, sandbox);
    const userMsg = seenPayload.messages[0].content;
    assert.match(userMsg, /wrong guess 1/);
    assert.match(userMsg, /wrong guess 2/);
    assert.match(userMsg, /real content/);
  });

  test('a response with no parseable block returns {ok:false} without ever calling execAgentTool', async () => {
    const { sandbox, execCalls } = loadArchitectModule({
      chatOnceImpl: async () => ({ text: "I'm not sure how to fix this." }),
      execAgentToolImpl: () => { throw new Error('should not be called'); },
    });
    const result = await vm.runInContext(`attemptArchitectFix('foo.js', [], 'content', {enabled:true}, 'anthropic', 'm')`, sandbox);
    assert.equal(result.ok, false);
    assert.match(result.reason, /parseable/);
    assert.equal(execCalls.length, 0);
  });

  test("if the architect's own edit_file call ALSO fails to match, that is reported as {ok:false}, not thrown", async () => {
    const { sandbox } = loadArchitectModule({
      chatOnceImpl: async () => ({ text: '<<<<<<< SEARCH\nguess\n=======\nfix\n>>>>>>> REPLACE' }),
      execAgentToolImpl: () => ({ ok: false, error: 'old_str not found' }),
    });
    const result = await vm.runInContext(`attemptArchitectFix('foo.js', [], 'content', {enabled:true}, 'anthropic', 'm')`, sandbox);
    assert.equal(result.ok, false);
    assert.match(result.reason, /not found|also failed/);
  });

  test('an error/abort/budget-exceeded response from chatOnce returns null (caller just moves on, no crash)', async () => {
    for (const badRes of [{ error: 'rate limited' }, { aborted: true }, { budgetExceeded: true, reason: 'cap' }, null]) {
      const { sandbox } = loadArchitectModule({
        chatOnceImpl: async () => badRes,
        execAgentToolImpl: () => { throw new Error('should not be called'); },
      });
      const result = await vm.runInContext(`attemptArchitectFix('foo.js', [], 'content', {enabled:true}, 'anthropic', 'm')`, sandbox);
      assert.equal(result, null, `expected null for response ${JSON.stringify(badRes)}`);
    }
  });

  test('a thrown/rejected chatOnce call is caught and returns null rather than propagating', async () => {
    const { sandbox } = loadArchitectModule({
      chatOnceImpl: async () => { throw new Error('network error'); },
      execAgentToolImpl: () => { throw new Error('should not be called'); },
    });
    const result = await vm.runInContext(`attemptArchitectFix('foo.js', [], 'content', {enabled:true}, 'anthropic', 'm')`, sandbox);
    assert.equal(result, null);
  });
});
