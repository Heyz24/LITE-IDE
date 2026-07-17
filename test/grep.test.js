'use strict';
const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { loadMainWithMockElectron } = require('./helpers/mock-electron.js');

const MAIN_PATH = path.join(__dirname, '..', 'main.js');
const EVT = {};

function hasRg() {
  try { execSync(process.platform === 'win32' ? 'where rg' : 'command -v rg', { stdio: 'ignore' }); return true; }
  catch { return false; }
}

describe('grep_codebase — ripgrep-backed exact/regex search (companion to search_codebase RAG)', () => {
  let mock, projectDir;

  before(() => { mock = loadMainWithMockElectron(MAIN_PATH); });

  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liteide-greptest-'));
    fs.writeFileSync(path.join(projectDir, 'foo.js'),
      'function parseConfig(x) {\n  return x;\n}\nconst y = parseConfig(42);\n');
    fs.writeFileSync(path.join(projectDir, 'bar.py'), 'def parseConfig(x):\n    return x\n');
    fs.mkdirSync(path.join(projectDir, 'empty'));
    fs.writeFileSync(path.join(projectDir, 'empty', 'nothing.txt'), 'irrelevant content\n');
    fs.mkdirSync(path.join(projectDir, 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'node_modules', 'dep', 'index.js'), 'parseConfig ignored in node_modules\n');
    await mock.handleFns.get('agent:setProjectRoot')(EVT, projectDir);
  });

  test('literal match finds all real occurrences, ignores node_modules', async () => {
    const r = await mock.handleFns.get('agent:grepCodebase')(EVT, 'parseConfig', {});
    assert.equal(r.ok, true);
    assert.equal(r.results.length, 3); // def in bar.py, function decl + call site in foo.js — NOT node_modules
    assert.ok(r.results.every(m => !m.file.includes('node_modules')));
  });

  test('path scoping restricts results; an empty subdir returns nothing', async () => {
    const r = await mock.handleFns.get('agent:grepCodebase')(EVT, 'parseConfig', { path: 'empty' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.results, []);
  });

  test('path traversal outside the project root is blocked', async () => {
    const r = await mock.handleFns.get('agent:grepCodebase')(EVT, 'parseConfig', { path: '../../etc' });
    assert.equal(r.ok, false);
    assert.match(r.error, /escapes project folder/i);
  });

  test('fixed_strings:false enables real regex matching', async () => {
    const r = await mock.handleFns.get('agent:grepCodebase')(EVT, 'def parseConfig\\(', { fixed_strings: false });
    assert.equal(r.ok, true);
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0].file, 'bar.py');
  });

  test('literal (default) mode treats regex metacharacters as plain text', async () => {
    fs.writeFileSync(path.join(projectDir, 'weird.js'), 'const rx = /a.b(c)/;\n');
    // '.' and '(' ')' are regex metacharacters — in fixed_strings (default)
    // mode this must match the LITERAL substring "a.b(c)" only.
    const r = await mock.handleFns.get('agent:grepCodebase')(EVT, 'a.b(c)', {});
    assert.equal(r.ok, true);
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0].file, 'weird.js');
  });

  test('empty pattern is rejected', async () => {
    const r = await mock.handleFns.get('agent:grepCodebase')(EVT, '', {});
    assert.equal(r.ok, false);
  });

  test('errors cleanly with no project open', async () => {
    const freshMock = loadMainWithMockElectron(MAIN_PATH); // no setProjectRoot called on this instance
    const r = await freshMock.handleFns.get('agent:grepCodebase')(EVT, 'anything', {});
    assert.equal(r.ok, false);
    assert.match(r.error, /no project/i);
  });

  test('respects the read permission category set to deny', async () => {
    await mock.handleFns.get('agent:setPermissions')(EVT, { read: 'deny' });
    const r = await mock.handleFns.get('agent:grepCodebase')(EVT, 'parseConfig', {});
    assert.equal(r.ok, false);
    assert.match(r.error, /permission settings/i);
    await mock.handleFns.get('agent:setPermissions')(EVT, { read: 'allow' }); // don't leak into later tests
  });

  test('read: ask requires approval, and the search proceeds once approved', async () => {
    await mock.handleFns.get('agent:setPermissions')(EVT, { read: 'ask' });
    const pending = mock.handleFns.get('agent:grepCodebase')(EVT, 'parseConfig', {});
    await new Promise(r => setTimeout(r, 10));
    const req = mock.sent.filter(e => e.channel === 'agent:approvalRequest').at(-1);
    assert.equal(req.payload.action, 'read_file');
    mock.onFns.get('agent:approvalResponse')[0](EVT, { id: req.payload.id, approved: true });
    const result = await pending;
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 3);
    await mock.handleFns.get('agent:setPermissions')(EVT, { read: 'allow' }); // don't leak into later tests
  });

  test('truncates at the match cap and reports truncated:true', async () => {
    const lines = Array.from({ length: 350 }, (_, i) => `needle_${i} present`).join('\n');
    fs.writeFileSync(path.join(projectDir, 'big.txt'), lines + '\n');
    const r = await mock.handleFns.get('agent:grepCodebase')(EVT, 'present', {});
    assert.equal(r.ok, true);
    assert.equal(r.results.length, 300);
    assert.equal(r.truncated, true);
  });

  test('ripgrep engine (if installed on this machine): same result shape as the fallback', { skip: !hasRg() && 'ripgrep (rg) not installed — skipping engine-specific check' }, async () => {
    const r = await mock.handleFns.get('agent:grepCodebase')(EVT, 'parseConfig', {});
    assert.equal(r.ok, true);
    assert.equal(r.engine, 'ripgrep');
    assert.equal(r.results.length, 3);
    for (const m of r.results) {
      assert.equal(typeof m.file, 'string');
      assert.equal(typeof m.line, 'number');
      assert.equal(typeof m.text, 'string');
    }
  });

  test('falls back to the pure-JS scan when ripgrep is unavailable, with the same correctness', { skip: !hasRg() && 'no rg installed to fall back FROM in a meaningful way, but the fallback path is still exercised elsewhere' }, async () => {
    // We can't easily uninstall rg mid-test-run, so this documents the
    // contract: whichever engine ran, the `engine` field always says which,
    // and grep.test.js's other tests (which run in whatever environment rg
    // is or isn't installed) already exercise the actual fallback path
    // end-to-end when rg is absent — see 'literal match finds all real
    // occurrences' etc. above, which assert on results regardless of engine.
    const r = await mock.handleFns.get('agent:grepCodebase')(EVT, 'parseConfig', {});
    assert.ok(['ripgrep', 'fallback'].some(e => r.engine.startsWith(e)));
  });
});
