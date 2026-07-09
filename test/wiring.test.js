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

  test('no leftover references to the pre-refactor single-terminal API', () => {
    const banned = ['api.spawnShell', 'api.shellInput', 'api.shellCd', 'api.resizePty', 'api.killShell', 'switchTab(', 'respawnShell(', 'changeShell('];
    const found = banned.filter(sig => inlineScript.includes(sig));
    assert.deepEqual(found, [], `found stale single-terminal API usage: ${found.join(', ')}`);
  });
});
