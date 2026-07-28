'use strict';
const os = require('os');

// Creates a fresh mock of the parts of the `electron` module that main.js
// touches. Handlers registered via ipcMain.handle/on are captured so tests
// can invoke them directly — this exercises the REAL main.js logic, not a
// re-implementation of it.
function createMockElectron() {
  const handleFns = new Map();   // channel -> fn   (ipcMain.handle)
  const onFns = new Map();       // channel -> [fn] (ipcMain.on)
  const sent = [];               // [{channel, payload}] captured from webContents.send

  class FakeWebContents {
    constructor() { this._destroyed = false; }
    send(channel, payload) { sent.push({ channel, payload }); }
    isDestroyed() { return this._destroyed; }
    openDevTools() {}
    once(evt, cb) { if (evt === 'did-finish-load') cb(); } // fire immediately, like a loaded page would
  }

  class FakeBrowserWindow {
    constructor() {
      this.webContents = new FakeWebContents();
      this._destroyed = false;
      this._listeners = {};
    }
    loadFile() {}
    on(evt, cb) { (this._listeners[evt] ||= []).push(cb); }
    isDestroyed() { return this._destroyed; }
    isMinimized() { return false; }
    restore() {}
    focus() {}
    static getAllWindows() { return []; }
  }

  const ipcMain = {
    handle(channel, fn) { handleFns.set(channel, fn); },
    on(channel, fn) { (onFns.get(channel) || onFns.set(channel, []).get(channel)).push(fn); },
  };

  const app = {
    getPath() { return os.tmpdir(); },
    whenReady() { return Promise.resolve(); },
    on(evt, cb) { (onFns.get(evt) || onFns.set(evt, []).get(evt)).push(cb); },
    quit() {},
    requestSingleInstanceLock() { return true; },
  };

  const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };
  const shell = { openExternal() {} };

  // Simple reversible "encryption" so round-trip tests are meaningful without
  // needing real OS keychain access (unavailable in a headless test run).
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('MOCK:' + s, 'utf8'),
    decryptString: (buf) => buf.toString('utf8').replace(/^MOCK:/, ''),
  };

  return {
    electronModule: { app, BrowserWindow: FakeBrowserWindow, ipcMain, dialog, shell, safeStorage },
    handleFns, onFns, sent,
  };
}

// This test harness ships as part of the SAME delivered version as the
// main.js it tests. If someone updates main.js/src/index.html but keeps an
// older test/ directory (or vice versa), tests that use `vm` to extract and
// execute functions directly from the source (compaction/subagents/
// architect-logic tests) will fail with a raw `ReferenceError` for whatever
// function was added since — which looks like a real bug and isn't one.
// Catch that mismatch here, once, with an error that says exactly what's
// wrong and how to fix it, instead of letting it surface as a confusing
// failure three files later.
//
// BUMP THIS whenever UNIVERSAL_SKILL_VERSION bumps in main.js — this is a
// checklist item, same as bumping package.json's version.
const EXPECTED_LITEIDE_VERSION = '2.2.0';

// Requires `mainPath` with `require('electron')` transparently swapped for a
// fresh mock. Returns the mock's captured handlers/events plus a restore fn.
function loadMainWithMockElectron(mainPath) {
  const Module = require('module');
  const mock = createMockElectron();
  const originalLoad = Module._load;

  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return mock.electronModule;
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve(mainPath)];
  let moduleExports;
  try {
    moduleExports = require(mainPath);
  } finally {
    Module._load = originalLoad; // only intercept during this one require
  }

  if (moduleExports.UNIVERSAL_SKILL_VERSION && moduleExports.UNIVERSAL_SKILL_VERSION !== EXPECTED_LITEIDE_VERSION) {
    throw new Error(
      `\n\nVERSION MISMATCH: main.js reports UNIVERSAL_SKILL_VERSION "${moduleExports.UNIVERSAL_SKILL_VERSION}", ` +
      `but this copy of test/helpers/mock-electron.js expects "${EXPECTED_LITEIDE_VERSION}".\n` +
      `This almost always means main.js and the test/ directory came from DIFFERENT delivered versions ` +
      `(e.g. main.js was updated but test/ wasn't, or vice versa).\n` +
      `Fix: re-download the full delivered package and replace EVERY file in test/ (including this one) ` +
      `and main.js together — never mix files from different versions.\n` +
      `(If you're intentionally developing a new version and haven't bumped this constant yet, update ` +
      `EXPECTED_LITEIDE_VERSION at the top of this file to match.)\n`
    );
  }

  return { ...mock, exports: moduleExports };
}

module.exports = { createMockElectron, loadMainWithMockElectron };
