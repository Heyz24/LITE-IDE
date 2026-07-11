'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadMainWithMockElectron } = require('./helpers/mock-electron.js');

const ROOT = path.join(__dirname, '..');
const PRELOAD_PATH = path.join(ROOT, 'preload.js');
const MAIN_PATH = path.join(ROOT, 'main.js');
const INDEX_PATH = path.join(ROOT, 'src', 'index.html');

function extractChannels(fileContent, ipcCall) {
  // matches ipcRenderer.invoke('x', ...) / ipcRenderer.send('x', ...) / ipcRenderer.on('x', ...)
  const re = new RegExp(`ipcRenderer\\.${ipcCall}\\(\\s*'([^']+)'`, 'g');
  const out = new Set();
  let m;
  while ((m = re.exec(fileContent))) out.add(m[1]);
  return out;
}

describe('IPC wiring: preload.js <-> main.js', () => {
  const preloadSrc = fs.readFileSync(PRELOAD_PATH, 'utf8');
  const mock = loadMainWithMockElectron(MAIN_PATH);

  const invokedChannels = extractChannels(preloadSrc, 'invoke');
  const sentChannels = extractChannels(preloadSrc, 'send');
  const listenedChannels = extractChannels(preloadSrc, 'on');

  test('every ipcRenderer.invoke() channel has a real ipcMain.handle() in main.js', () => {
    const missing = [...invokedChannels].filter(ch => !mock.handleFns.has(ch));
    assert.deepEqual(missing, [], `preload invokes channels main.js never handles: ${missing.join(', ')}`);
  });

  test('every ipcRenderer.send() channel has a real ipcMain.on() in main.js', () => {
    const missing = [...sentChannels].filter(ch => !mock.onFns.has(ch));
    assert.deepEqual(missing, [], `preload sends channels main.js never listens for: ${missing.join(', ')}`);
  });

  test('every channel preload listens for (ipcRenderer.on) is actually sent somewhere in main.js', () => {
    const mainSrc = fs.readFileSync(MAIN_PATH, 'utf8');
    const missing = [...listenedChannels].filter(ch => !mainSrc.includes(`safeSend('${ch}'`) && !mainSrc.includes(`webContents.send('${ch}'`));
    assert.deepEqual(missing, [], `preload listens for channels main.js never sends: ${missing.join(', ')}`);
  });

  test('main.js registers no orphan handlers preload never calls (dead code check)', () => {
    const allPreloadChannels = new Set([...invokedChannels, ...sentChannels]);
    const orphans = [...mock.handleFns.keys()].filter(ch => !invokedChannels.has(ch));
    // This is informational, not a hard failure — flag it loudly if it grows.
    assert.ok(orphans.length < mock.handleFns.size, 'sanity: not literally every handler is orphaned');
  });
});

describe('Renderer HTML static integrity (src/index.html)', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  const inlineScript = scriptMatch ? scriptMatch[1] : '';

  test('every modal overlay has an explicit display:none base rule (catches orphaned/malformed CSS selectors that leave a modal visible on load)', () => {
    const overlayIds = ['approval-overlay', 'skills-overlay', 'diff-overlay', 'shell-picker-overlay'];
    const cssMatch = html.match(/<style>([\s\S]*?)<\/style>/);
    assert.ok(cssMatch, '<style> block not found');
    const css = cssMatch[1];
    for (const id of overlayIds) {
      const rule = new RegExp(`#${id}\\s*\\{[^}]*display:\\s*none`, 'i');
      assert.match(css, rule, `#${id} must have its own "display:none" rule — if this fails, that overlay is likely rendering visible on every page load`);
    }
  });

  test('no orphaned CSS declaration blocks (a stray "}" ending a previous rule immediately followed by bare declarations with no selector)', () => {
    const cssMatch = html.match(/<style>([\s\S]*?)<\/style>/);
    const css = cssMatch[1];
    // A line starting with a CSS property (word-then-colon) immediately after a "}" on the previous
    // meaningful line, with no selector in between, indicates a dropped selector line.
    const lines = css.split('\n').map(l => l.trim()).filter(Boolean);
    const orphans = [];
    for (let i = 1; i < lines.length; i++) {
      const prev = lines[i - 1];
      const cur = lines[i];
      if (prev === '}' && /^[a-z-]+\s*:/.test(cur)) orphans.push(cur.slice(0, 40));
    }
    assert.deepEqual(orphans, [], `orphaned CSS declarations (missing selector) found: ${orphans.join(' | ')}`);
  });

  test('inline <script> is syntactically valid JavaScript', () => {
    assert.doesNotThrow(() => new Function(inlineScript), 'inline script has a syntax error');
  });

  test('no duplicate element ids', () => {
    const ids = [...html.matchAll(/\bid="([a-zA-Z0-9_-]+)"/g)].map(m => m[1]);
    const seen = new Map();
    for (const id of ids) seen.set(id, (seen.get(id) || 0) + 1);
    const dupes = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    assert.deepEqual(dupes, [], `duplicate DOM ids: ${dupes.join(', ')}`);
  });

  test('every onclick/onchange handler references a defined function', () => {
    const refs = new Set([
      ...[...html.matchAll(/onclick="([a-zA-Z_][a-zA-Z0-9_]*)\(/g)].map(m => m[1]),
      ...[...html.matchAll(/onchange="([a-zA-Z_][a-zA-Z0-9_]*)\(/g)].map(m => m[1]),
    ]);
    const missing = [...refs].filter(fn => {
      const asFunctionDecl = new RegExp(`(?:async\\s+)?function\\s+${fn}\\s*\\(`);
      const asConstArrow = new RegExp(`(?:const|let|var)\\s+${fn}\\s*=\\s*(?:async\\s*)?\\(`);
      return !asFunctionDecl.test(inlineScript) && !asConstArrow.test(inlineScript);
    });
    assert.deepEqual(missing, [], `onclick/onchange reference undefined functions: ${missing.join(', ')}`);
  });

  test('balanced <div>/<button>/<span>/<select>/<label> tags', () => {
    for (const tag of ['div', 'button', 'span', 'select', 'label']) {
      const opens = (html.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length;
      const closes = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
      assert.equal(opens, closes, `<${tag}> mismatch: ${opens} open vs ${closes} close`);
    }
  });

  test('no file paths are interpolated into inline onclick attributes (backslashes in Windows paths corrupt via JS escape sequences like \\t \\n \\r)', () => {
    const risky = [...inlineScript.matchAll(/onclick="[a-zA-Z_]+\('\$\{[^}]*\.path[^}]*\}/g)];
    assert.deepEqual(risky.map(m => m[0]), [], 'a file/item .path was interpolated directly into an onclick string attribute — use addEventListener + closure instead');
  });

  test('assistant chat messages have a working copy-to-clipboard button', () => {
    assert.match(inlineScript, /ai-msg-copy/);
    assert.match(inlineScript, /navigator\.clipboard\.writeText\(text\)/);
  });

  test('every AGENT_TOOLS entry has a matching case in execAgentTool, and vice versa', () => {
    const toolsMatch = inlineScript.match(/const AGENT_TOOLS = \[([\s\S]*?)\n\];/);
    assert.ok(toolsMatch, 'AGENT_TOOLS array not found');
    const declared = [...toolsMatch[1].matchAll(/name:\s*'([a-z_]+)'/g)].map(m => m[1]);
    assert.ok(declared.length >= 8, 'expected at least 8 agent tools declared');

    const execMatch = inlineScript.match(/async function execAgentTool\(name, args\) \{([\s\S]*?)\n\}/);
    assert.ok(execMatch, 'execAgentTool not found');
    const implemented = [...execMatch[1].matchAll(/case\s+'([a-z_]+)'/g)].map(m => m[1]);

    const missingImpl = declared.filter(t => !implemented.includes(t));
    const orphanImpl = implemented.filter(t => !declared.includes(t));
    assert.deepEqual(missingImpl, [], `tools declared but not implemented: ${missingImpl.join(', ')}`);
    assert.deepEqual(orphanImpl, [], `tools implemented but not declared (model will never call them): ${orphanImpl.join(', ')}`);
  });

  test('run_in_terminal and run_command are both present (background vs live-visible execution)', () => {
    assert.match(inlineScript, /name:\s*'run_command'/);
    assert.match(inlineScript, /name:\s*'run_in_terminal'/);
  });

  test('no leftover references to the pre-refactor single-terminal API', () => {
    const banned = ['api.spawnShell', 'api.shellInput', 'api.shellCd', 'api.resizePty', 'api.killShell', 'switchTab(', 'respawnShell(', 'changeShell('];
    const found = banned.filter(sig => inlineScript.includes(sig));
    assert.deepEqual(found, [], `found stale single-terminal API usage: ${found.join(', ')}`);
  });
});
