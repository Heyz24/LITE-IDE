'use strict';
const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMainWithMockElectron } = require('./helpers/mock-electron.js');

const MAIN_PATH = path.join(__dirname, '..', 'main.js');
const EVT = {};

describe('get_repo_map — condensed symbol-level codebase overview', () => {
  let mock, projectDir;
  before(() => { mock = loadMainWithMockElectron(MAIN_PATH); });
  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liteide-repomaptest-'));
    await mock.handleFns.get('agent:setProjectRoot')(EVT, projectDir);
  });

  test('extracts JS function and class declarations', async () => {
    fs.writeFileSync(path.join(projectDir, 'app.js'), [
      'function parseConfig(x) {',
      '  return x;',
      '}',
      '',
      'class Widget {',
      '  render() {}',
      '}',
      '',
      'export function helper() {}',
    ].join('\n'));
    const r = await mock.handleFns.get('agent:getRepoMap')(EVT, {});
    assert.equal(r.ok, true);
    const file = r.files.find(f => f.path === 'app.js');
    assert.ok(file, 'app.js should appear in the map');
    const sigs = file.symbols.map(s => s.sig);
    assert.ok(sigs.some(s => s.includes('function parseConfig')));
    assert.ok(sigs.some(s => s.includes('class Widget')));
    assert.ok(sigs.some(s => s.includes('export function helper')));
  });

  test('extracts Python def/class declarations', async () => {
    fs.writeFileSync(path.join(projectDir, 'app.py'), [
      'def parse_config(x):',
      '    return x',
      '',
      'class Widget:',
      '    def render(self):',
      '        pass',
      '',
      'async def fetch_data():',
      '    pass',
    ].join('\n'));
    const r = await mock.handleFns.get('agent:getRepoMap')(EVT, {});
    const file = r.files.find(f => f.path === 'app.py');
    assert.ok(file);
    const sigs = file.symbols.map(s => s.sig);
    assert.ok(sigs.some(s => s.includes('def parse_config')));
    assert.ok(sigs.some(s => s.includes('class Widget')));
    assert.ok(sigs.some(s => s.includes('def render')));
    assert.ok(sigs.some(s => s.includes('async def fetch_data')));
  });

  test('extracts Go func/type declarations', async () => {
    fs.writeFileSync(path.join(projectDir, 'main.go'), [
      'package main',
      '',
      'func ParseConfig(x int) int {',
      '  return x',
      '}',
      '',
      'type Widget struct {',
      '  Name string',
      '}',
    ].join('\n'));
    const r = await mock.handleFns.get('agent:getRepoMap')(EVT, {});
    const file = r.files.find(f => f.path === 'main.go');
    assert.ok(file);
    const sigs = file.symbols.map(s => s.sig);
    assert.ok(sigs.some(s => s.includes('func ParseConfig')));
    assert.ok(sigs.some(s => s.includes('type Widget struct')));
  });

  test('extracts Rust fn/struct/enum/trait/impl declarations', async () => {
    fs.writeFileSync(path.join(projectDir, 'lib.rs'), [
      'pub fn parse_config(x: i32) -> i32 {',
      '    x',
      '}',
      '',
      'struct Widget {',
      '    name: String,',
      '}',
      '',
      'enum Shape { Circle, Square }',
      '',
      'trait Drawable {',
      '    fn draw(&self);',
      '}',
      '',
      'impl Drawable for Widget {',
      '    fn draw(&self) {}',
      '}',
    ].join('\n'));
    const r = await mock.handleFns.get('agent:getRepoMap')(EVT, {});
    const file = r.files.find(f => f.path === 'lib.rs');
    assert.ok(file);
    const sigs = file.symbols.map(s => s.sig);
    assert.ok(sigs.some(s => s.includes('fn parse_config')));
    assert.ok(sigs.some(s => s.includes('struct Widget')));
    assert.ok(sigs.some(s => s.includes('enum Shape')));
    assert.ok(sigs.some(s => s.includes('trait Drawable')));
    assert.ok(sigs.some(s => s.includes('impl Drawable for Widget')));
  });

  test('extracts Ruby def/class/module declarations', async () => {
    fs.writeFileSync(path.join(projectDir, 'app.rb'), [
      'module Utils',
      '  def self.parse_config(x)',
      '    x',
      '  end',
      'end',
      '',
      'class Widget',
      '  def render?',
      '    true',
      '  end',
      'end',
    ].join('\n'));
    const r = await mock.handleFns.get('agent:getRepoMap')(EVT, {});
    const file = r.files.find(f => f.path === 'app.rb');
    assert.ok(file);
    const sigs = file.symbols.map(s => s.sig);
    assert.ok(sigs.some(s => s.includes('module Utils')));
    assert.ok(sigs.some(s => s.includes('class Widget')));
    assert.ok(sigs.some(s => s.includes('def self.parse_config') || s.includes('def render?')));
  });

  test('extracts PHP function/class declarations', async () => {
    fs.writeFileSync(path.join(projectDir, 'app.php'), [
      '<?php',
      'function parseConfig($x) {',
      '  return $x;',
      '}',
      '',
      'class Widget {',
      '  public function render() {}',
      '}',
    ].join('\n'));
    const r = await mock.handleFns.get('agent:getRepoMap')(EVT, {});
    const file = r.files.find(f => f.path === 'app.php');
    assert.ok(file);
    const sigs = file.symbols.map(s => s.sig);
    assert.ok(sigs.some(s => s.includes('function parseConfig')));
    assert.ok(sigs.some(s => s.includes('class Widget')));
  });

  test('files with no recognized symbols are excluded entirely', async () => {
    fs.writeFileSync(path.join(projectDir, 'data.json'), '{"key": "value"}');
    fs.writeFileSync(path.join(projectDir, 'notes.txt'), 'just some notes, no code here');
    const r = await mock.handleFns.get('agent:getRepoMap')(EVT, {});
    assert.equal(r.ok, true);
    assert.equal(r.files.find(f => f.path === 'data.json'), undefined);
    assert.equal(r.files.find(f => f.path === 'notes.txt'), undefined);
  });

  test('node_modules and other ignored directories are excluded', async () => {
    fs.mkdirSync(path.join(projectDir, 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'node_modules', 'dep', 'index.js'), 'function shouldNotAppear() {}');
    fs.writeFileSync(path.join(projectDir, 'real.js'), 'function shouldAppear() {}');
    const r = await mock.handleFns.get('agent:getRepoMap')(EVT, {});
    assert.ok(!r.files.some(f => f.path.includes('node_modules')));
    assert.ok(r.files.some(f => f.path === 'real.js'));
  });

  test('focus_path biases ranking toward files in the same directory', async () => {
    fs.mkdirSync(path.join(projectDir, 'src', 'auth'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'src', 'unrelated'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'src', 'auth', 'login.js'), 'function login() {}\nfunction logout() {}');
    fs.writeFileSync(path.join(projectDir, 'src', 'unrelated', 'thing.js'), 'function a() {}\nfunction b() {}\nfunction c() {}\nfunction d() {}');
    const r = await mock.handleFns.get('agent:getRepoMap')(EVT, { focus_path: 'src/auth/login.js' });
    assert.equal(r.ok, true);
    // 'thing.js' has MORE symbols (4 vs 2), which would normally rank it
    // first under symbol-count ranking alone — focus_path must override that
    // for files near the focus path.
    const authIdx = r.files.findIndex(f => f.path === 'src/auth/login.js');
    const unrelatedIdx = r.files.findIndex(f => f.path === 'src/unrelated/thing.js');
    assert.ok(authIdx !== -1 && unrelatedIdx !== -1);
    assert.ok(authIdx < unrelatedIdx, 'the file near focus_path must rank ahead of a file with more symbols but in an unrelated directory');
  });

  test('without focus_path, files with more symbols rank first', async () => {
    fs.writeFileSync(path.join(projectDir, 'small.js'), 'function one() {}');
    fs.writeFileSync(path.join(projectDir, 'big.js'), 'function a(){}\nfunction b(){}\nfunction c(){}\nfunction d(){}\nfunction e(){}');
    const r = await mock.handleFns.get('agent:getRepoMap')(EVT, {});
    const bigIdx = r.files.findIndex(f => f.path === 'big.js');
    const smallIdx = r.files.findIndex(f => f.path === 'small.js');
    assert.ok(bigIdx < smallIdx);
  });

  test('respects the read permission category set to deny', async () => {
    await mock.handleFns.get('agent:setPermissions')(EVT, { read: 'deny' });
    const r = await mock.handleFns.get('agent:getRepoMap')(EVT, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /permission settings/i);
    await mock.handleFns.get('agent:setPermissions')(EVT, { read: 'allow' });
  });

  test('errors cleanly with no project open', async () => {
    const freshMock = loadMainWithMockElectron(MAIN_PATH);
    const r = await freshMock.handleFns.get('agent:getRepoMap')(EVT, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /no project/i);
  });

  test('an empty project returns ok:true with an empty file list, not an error', async () => {
    const r = await mock.handleFns.get('agent:getRepoMap')(EVT, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.files, []);
  });

  test('per-file symbol count is capped (a file with hundreds of functions does not blow up the response)', async () => {
    const lines = [];
    for (let i = 0; i < 200; i++) lines.push(`function fn${i}() {}`);
    fs.writeFileSync(path.join(projectDir, 'huge.js'), lines.join('\n'));
    const r = await mock.handleFns.get('agent:getRepoMap')(EVT, {});
    const file = r.files.find(f => f.path === 'huge.js');
    assert.ok(file.symbols.length <= 40, `expected symbols capped at 40, got ${file.symbols.length}`);
  });

  test('output is capped to the top N files by relevance, with outputTruncated flagged', async () => {
    for (let i = 0; i < 350; i++) {
      fs.writeFileSync(path.join(projectDir, `file${i}.js`), `function f${i}() {}`);
    }
    const r = await mock.handleFns.get('agent:getRepoMap')(EVT, {});
    assert.equal(r.ok, true);
    assert.ok(r.files.length <= 300);
    assert.equal(r.outputTruncated, true);
    assert.equal(r.filesWithSymbols, 350);
  });

  test('a C-family function definition is recognized without false-positiving on control-flow statements', async () => {
    fs.writeFileSync(path.join(projectDir, 'app.c'), [
      '#include <stdio.h>',
      '',
      'int add(int a, int b) {',
      '    if (a > 0) {',
      '        return a + b;',
      '    }',
      '    for (int i = 0; i < 10; i++) {}',
      '    while (a > 0) {}',
      '    return b;',
      '}',
    ].join('\n'));
    const r = await mock.handleFns.get('agent:getRepoMap')(EVT, {});
    const file = r.files.find(f => f.path === 'app.c');
    assert.ok(file, 'app.c should have at least the add() function recognized');
    const sigs = file.symbols.map(s => s.sig);
    assert.ok(sigs.some(s => s.includes('int add')));
    assert.ok(!sigs.some(s => s.startsWith('if') || s.startsWith('for') || s.startsWith('while')),
      'control-flow statements must not be misidentified as function definitions');
  });
});
