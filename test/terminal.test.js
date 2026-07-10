'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMainWithMockElectron } = require('./helpers/mock-electron.js');

const MAIN_PATH = path.join(__dirname, '..', 'main.js');

describe('Terminal correctness (regression tests for real bugs found in testing)', () => {
  const mock = loadMainWithMockElectron(MAIN_PATH);
  const { buildCdCommand, extractLaunchFilePath } = mock.exports;

  test('buildCdCommand: cmd.exe gets "cd /d" (fixes silent no-op when project is on a different drive)', () => {
    assert.equal(buildCdCommand('C:\\Windows\\System32\\cmd.exe', 'D:\\projects\\foo'), 'cd /d "D:\\projects\\foo"\r');
    assert.equal(buildCdCommand('cmd.exe', 'C:\\x'), 'cd /d "C:\\x"\r');
  });

  test('buildCdCommand: PowerShell/bash/zsh do NOT get /d (it would be an invalid flag for them)', () => {
    assert.equal(buildCdCommand('powershell.exe', 'D:\\x'), 'cd "D:\\x"\r');
    assert.equal(buildCdCommand('pwsh.exe', 'D:\\x'), 'cd "D:\\x"\r');
    assert.equal(buildCdCommand('/bin/zsh', '/home/x'), 'cd "/home/x"\r');
  });

  test('buildCdCommand: WSL gets a translated /mnt/c/... path, not a raw Windows path bash cannot parse', () => {
    const { winPathToWslPath } = mock.exports;
    assert.equal(buildCdCommand('wsl.exe', 'C:\\Users\\me\\project'), 'cd "/mnt/c/Users/me/project"\r');
    assert.equal(winPathToWslPath('D:\\code\\app'), '/mnt/d/code/app');
  });

  test('extractLaunchFilePath: never picks argv[0], even though it is always a real existing file (the exe itself)', () => {
    const fakeExe = __filename; // stand-in for "a real file that always exists", like LiteIDE.exe would be
    const result = extractLaunchFilePath([fakeExe]); // simulates launching with NO file — just the app icon
    assert.equal(result, null, 'launching with no file arg must not treat the exe itself as an opened file');
  });

  test('extractLaunchFilePath: correctly finds the real file when one IS passed (Open-With flow)', () => {
    const fakeExe = __filename;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'liteide-launch-test-'));
    const realFile = path.join(tmp, 'opened.py');
    fs.writeFileSync(realFile, 'print(1)');
    const result = extractLaunchFilePath([fakeExe, realFile]);
    assert.equal(result, path.resolve(realFile));
  });

  test('extractLaunchFilePath: ignores flags and the dev-mode "." app-path argument', () => {
    const fakeExe = __filename;
    assert.equal(extractLaunchFilePath([fakeExe, '--dev']), null);
    assert.equal(extractLaunchFilePath([fakeExe, '.']), null);
  });

  test('term:create never throws/rejects even with a stale project root or a bogus shell command (fixes silent "not loading" tabs)', async () => {
    const { handleFns } = mock;
    await handleFns.get('agent:setProjectRoot')({}, '/this/path/does/not/exist/at/all');
    // Must resolve to {ok:...}, never reject — previously a synchronous spawn
    // failure here would have left the promise rejected and the tab blank.
    await assert.doesNotReject(async () => {
      const r = await handleFns.get('term:create')({}, 'test-session-bogus', 'definitely-not-a-real-shell-xyz');
      assert.equal(typeof r.ok, 'boolean');
    });
  });
});
