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
  try {
    require(mainPath);
  } finally {
    Module._load = originalLoad; // only intercept during this one require
  }

  return mock;
}

module.exports = { createMockElectron, loadMainWithMockElectron };
