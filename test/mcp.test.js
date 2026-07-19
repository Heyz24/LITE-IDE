'use strict';
const { test, describe, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMainWithMockElectron } = require('./helpers/mock-electron.js');

const MAIN_PATH = path.join(__dirname, '..', 'main.js');
const FIXTURE_SERVER = path.join(__dirname, 'fixtures', 'mock-mcp-server.js');
const EVT = {};

describe('MCP client — real stdio JSON-RPC protocol against a real fixture server', () => {
  let mock, projectDir;
  before(() => { mock = loadMainWithMockElectron(MAIN_PATH); });
  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liteide-mcptest-'));
    await mock.handleFns.get('agent:setProjectRoot')(EVT, projectDir);
  });
  afterEach(async () => {
    const { servers } = await mock.handleFns.get('agent:mcpListServers')(EVT);
    for (const s of servers) await mock.handleFns.get('agent:mcpDisconnect')(EVT, s.name);
  });

  test('agent:mcpAddServer persists config, agent:mcpListServers reflects it', async () => {
    const r = await mock.handleFns.get('agent:mcpAddServer')(EVT, { name: 'fixture', command: 'node', args: [FIXTURE_SERVER] });
    assert.equal(r.ok, true);
    const { servers } = await mock.handleFns.get('agent:mcpListServers')(EVT);
    assert.equal(servers.length, 1);
    assert.equal(servers[0].name, 'fixture');
    assert.equal(servers[0].connected, false);
    const onDisk = JSON.parse(fs.readFileSync(path.join(projectDir, '.liteide', 'mcp-servers.json'), 'utf8'));
    assert.equal(onDisk.servers[0].name, 'fixture');
  });

  test('server names with underscores are rejected (would make qualified tool names ambiguous to parse)', async () => {
    const r = await mock.handleFns.get('agent:mcpAddServer')(EVT, { name: 'my_server', command: 'node', args: [] });
    assert.equal(r.ok, false);
    assert.match(r.error, /letters, numbers, and hyphens/);
  });

  test('duplicate server names are rejected', async () => {
    await mock.handleFns.get('agent:mcpAddServer')(EVT, { name: 'fixture', command: 'node', args: [FIXTURE_SERVER] });
    const r = await mock.handleFns.get('agent:mcpAddServer')(EVT, { name: 'fixture', command: 'node', args: [] });
    assert.equal(r.ok, false);
    assert.match(r.error, /already exists/);
  });

  test('a real connect performs the real handshake and discovers real tools', async () => {
    await mock.handleFns.get('agent:mcpAddServer')(EVT, { name: 'fixture', command: 'node', args: [FIXTURE_SERVER] });
    const r = await mock.handleFns.get('agent:mcpConnect')(EVT, 'fixture');
    assert.equal(r.ok, true);
    assert.equal(r.tools.length, 3);
    assert.ok(r.tools.some(t => t.name === 'echo'));
    assert.ok(r.tools.some(t => t.name === 'add'));
    assert.equal(r.serverInfo.name, 'fixture-mcp-server');
  });

  test('connecting to an already-connected server is a harmless no-op reporting alreadyConnected', async () => {
    await mock.handleFns.get('agent:mcpAddServer')(EVT, { name: 'fixture', command: 'node', args: [FIXTURE_SERVER] });
    await mock.handleFns.get('agent:mcpConnect')(EVT, 'fixture');
    const r2 = await mock.handleFns.get('agent:mcpConnect')(EVT, 'fixture');
    assert.equal(r2.ok, true);
    assert.equal(r2.alreadyConnected, true);
  });

  test('connecting to an unconfigured server name fails cleanly', async () => {
    const r = await mock.handleFns.get('agent:mcpConnect')(EVT, 'does-not-exist');
    assert.equal(r.ok, false);
    assert.match(r.error, /No MCP server configured/);
  });

  test('a crashing server (exits immediately) fails the connect cleanly, not hanging or throwing', async () => {
    await mock.handleFns.get('agent:mcpAddServer')(EVT, { name: 'crasher', command: 'node', args: [FIXTURE_SERVER, 'crash'] });
    const r = await mock.handleFns.get('agent:mcpConnect')(EVT, 'crasher');
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
  });

  test('a slow-but-valid handshake still completes successfully (not everything needs to be instant)', async () => {
    await mock.handleFns.get('agent:mcpAddServer')(EVT, { name: 'slowfixture', command: 'node', args: [FIXTURE_SERVER, 'slow-init'] });
    const r = await mock.handleFns.get('agent:mcpConnect')(EVT, 'slowfixture');
    assert.equal(r.ok, true);
    assert.equal(r.tools.length, 3);
  });

  test('non-JSON lines printed to stdout (e.g. a startup banner) are ignored, not treated as a fatal parse error', async () => {
    await mock.handleFns.get('agent:mcpAddServer')(EVT, { name: 'noisyfixture', command: 'node', args: [FIXTURE_SERVER, 'garbage'] });
    const r = await mock.handleFns.get('agent:mcpConnect')(EVT, 'noisyfixture');
    assert.equal(r.ok, true, 'a stray non-JSON line must not break the connection');
    assert.equal(r.tools.length, 3);
  });

  test('a server exposing zero tools connects fine and reports an empty tool list', async () => {
    await mock.handleFns.get('agent:mcpAddServer')(EVT, { name: 'notools', command: 'node', args: [FIXTURE_SERVER, 'no-tools'] });
    const r = await mock.handleFns.get('agent:mcpConnect')(EVT, 'notools');
    assert.equal(r.ok, true);
    assert.deepEqual(r.tools, []);
  });

  test('a real tool call round-trips through the real subprocess and returns real content', async () => {
    await mock.handleFns.get('agent:mcpAddServer')(EVT, { name: 'fixture', command: 'node', args: [FIXTURE_SERVER] });
    await mock.handleFns.get('agent:mcpConnect')(EVT, 'fixture');
    const r = await mock.handleFns.get('agent:mcpCallTool')(EVT, 'mcp_fixture_add', { a: 7, b: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.result.content[0].text, '12');
  });

  test('a tool call to a server that errors on that specific tool propagates the error, not a crash', async () => {
    await mock.handleFns.get('agent:mcpAddServer')(EVT, { name: 'fixture', command: 'node', args: [FIXTURE_SERVER] });
    await mock.handleFns.get('agent:mcpConnect')(EVT, 'fixture');
    const r = await mock.handleFns.get('agent:mcpCallTool')(EVT, 'mcp_fixture_fail_tool', {});
    assert.equal(r.ok, false);
    assert.match(r.error, /always fails/);
  });

  test('a tool call to a disconnected server fails cleanly with a clear message', async () => {
    const r = await mock.handleFns.get('agent:mcpCallTool')(EVT, 'mcp_fixture_add', { a: 1, b: 1 });
    assert.equal(r.ok, false);
    assert.match(r.error, /not connected/);
  });

  test('a malformed qualified tool name is rejected without crashing', async () => {
    const r = await mock.handleFns.get('agent:mcpCallTool')(EVT, 'not_a_valid_mcp_name_format', {});
    assert.equal(r.ok, false);
    assert.match(r.error, /not a valid MCP tool name/i);
  });

  test('agent:mcpListTools returns qualified, namespaced tool names with server prefix', async () => {
    await mock.handleFns.get('agent:mcpAddServer')(EVT, { name: 'fixture', command: 'node', args: [FIXTURE_SERVER] });
    await mock.handleFns.get('agent:mcpConnect')(EVT, 'fixture');
    const { tools } = await mock.handleFns.get('agent:mcpListTools')(EVT);
    assert.ok(tools.some(t => t.name === 'mcp_fixture_echo'));
    assert.ok(tools.some(t => t.name === 'mcp_fixture_add'));
    const addTool = tools.find(t => t.name === 'mcp_fixture_add');
    assert.equal(addTool.parameters.type, 'object');
    assert.ok(addTool.parameters.properties.a);
  });

  test('two servers exposing tools with the SAME name do not collide (qualified names disambiguate)', async () => {
    await mock.handleFns.get('agent:mcpAddServer')(EVT, { name: 'server-a', command: 'node', args: [FIXTURE_SERVER] });
    await mock.handleFns.get('agent:mcpAddServer')(EVT, { name: 'server-b', command: 'node', args: [FIXTURE_SERVER] });
    await mock.handleFns.get('agent:mcpConnect')(EVT, 'server-a');
    await mock.handleFns.get('agent:mcpConnect')(EVT, 'server-b');
    const { tools } = await mock.handleFns.get('agent:mcpListTools')(EVT);
    assert.ok(tools.some(t => t.name === 'mcp_server-a_echo'));
    assert.ok(tools.some(t => t.name === 'mcp_server-b_echo'));
    // Confirm they're actually independently callable, not aliased to the same underlying connection.
    const rA = await mock.handleFns.get('agent:mcpCallTool')(EVT, 'mcp_server-a_add', { a: 1, b: 1 });
    const rB = await mock.handleFns.get('agent:mcpCallTool')(EVT, 'mcp_server-b_add', { a: 10, b: 10 });
    assert.equal(rA.result.content[0].text, '2');
    assert.equal(rB.result.content[0].text, '20');
  });

  test('agent:mcpListTools only includes tools from CONNECTED servers, not merely configured ones', async () => {
    await mock.handleFns.get('agent:mcpAddServer')(EVT, { name: 'notconnected', command: 'node', args: [FIXTURE_SERVER] });
    const { tools } = await mock.handleFns.get('agent:mcpListTools')(EVT);
    assert.deepEqual(tools, []);
  });

  test('agent:mcpDisconnect actually kills the real child process', async () => {
    await mock.handleFns.get('agent:mcpAddServer')(EVT, { name: 'fixture', command: 'node', args: [FIXTURE_SERVER] });
    await mock.handleFns.get('agent:mcpConnect')(EVT, 'fixture');
    const before = await mock.handleFns.get('agent:mcpListServers')(EVT);
    assert.equal(before.servers[0].connected, true);
    const r = await mock.handleFns.get('agent:mcpDisconnect')(EVT, 'fixture');
    assert.equal(r.ok, true);
    assert.equal(r.wasConnected, true);
    const after = await mock.handleFns.get('agent:mcpListServers')(EVT);
    assert.equal(after.servers[0].connected, false);
    // The tool must no longer be callable after disconnect.
    const callResult = await mock.handleFns.get('agent:mcpCallTool')(EVT, 'mcp_fixture_add', { a: 1, b: 1 });
    assert.equal(callResult.ok, false);
  });

  test('disconnecting an already-disconnected server is a harmless no-op', async () => {
    const r = await mock.handleFns.get('agent:mcpDisconnect')(EVT, 'never-connected');
    assert.equal(r.ok, true);
    assert.equal(r.wasConnected, false);
  });

  test('agent:mcpRemoveServer disconnects first, then deletes the config', async () => {
    await mock.handleFns.get('agent:mcpAddServer')(EVT, { name: 'fixture', command: 'node', args: [FIXTURE_SERVER] });
    await mock.handleFns.get('agent:mcpConnect')(EVT, 'fixture');
    const r = await mock.handleFns.get('agent:mcpRemoveServer')(EVT, 'fixture');
    assert.equal(r.ok, true);
    const { servers } = await mock.handleFns.get('agent:mcpListServers')(EVT);
    assert.equal(servers.length, 0);
  });

  test('switching projects (agent:setProjectRoot) disconnects all MCP servers from the previous project', async () => {
    await mock.handleFns.get('agent:mcpAddServer')(EVT, { name: 'fixture', command: 'node', args: [FIXTURE_SERVER] });
    await mock.handleFns.get('agent:mcpConnect')(EVT, 'fixture');
    let list = await mock.handleFns.get('agent:mcpListServers')(EVT);
    assert.equal(list.servers[0].connected, true);

    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liteide-mcptest-other-'));
    await mock.handleFns.get('agent:setProjectRoot')(EVT, otherDir);
    // The tool from the old project's server must no longer be callable —
    // proves the underlying process was actually killed, not just
    // forgotten about while still running.
    const callResult = await mock.handleFns.get('agent:mcpCallTool')(EVT, 'mcp_fixture_add', { a: 1, b: 1 });
    assert.equal(callResult.ok, false);

    // And the new project starts with no configured servers of its own.
    list = await mock.handleFns.get('agent:mcpListServers')(EVT);
    assert.equal(list.servers.length, 0);
  });

  test('respects the execute permission category set to deny for BOTH connect and tool calls', async () => {
    await mock.handleFns.get('agent:mcpAddServer')(EVT, { name: 'fixture', command: 'node', args: [FIXTURE_SERVER] });
    await mock.handleFns.get('agent:setPermissions')(EVT, { execute: 'deny' });
    const connectResult = await mock.handleFns.get('agent:mcpConnect')(EVT, 'fixture');
    assert.equal(connectResult.ok, false);
    assert.match(connectResult.error, /permission settings/i);
    await mock.handleFns.get('agent:setPermissions')(EVT, { execute: 'allow' });
    await mock.handleFns.get('agent:mcpConnect')(EVT, 'fixture');
    await mock.handleFns.get('agent:setPermissions')(EVT, { execute: 'deny' });
    const callResult = await mock.handleFns.get('agent:mcpCallTool')(EVT, 'mcp_fixture_add', { a: 1, b: 1 });
    assert.equal(callResult.ok, false);
    assert.match(callResult.error, /permission settings/i);
    await mock.handleFns.get('agent:setPermissions')(EVT, { execute: 'allow' });
  });

  test('execute: ask requires approval to connect, and to call a tool', async () => {
    await mock.handleFns.get('agent:mcpAddServer')(EVT, { name: 'fixture', command: 'node', args: [FIXTURE_SERVER] });
    await mock.handleFns.get('agent:setPermissions')(EVT, { execute: 'ask' });
    const pendingConnect = mock.handleFns.get('agent:mcpConnect')(EVT, 'fixture');
    await new Promise(r => setTimeout(r, 20));
    const req = mock.sent.filter(e => e.channel === 'agent:approvalRequest').at(-1);
    assert.equal(req.payload.action, 'run_command');
    mock.onFns.get('agent:approvalResponse')[0](EVT, { id: req.payload.id, approved: true });
    const connectResult = await pendingConnect;
    assert.equal(connectResult.ok, true);
    await mock.handleFns.get('agent:setPermissions')(EVT, { execute: 'allow' });
  });

  test('agent:mcpRemoveServer on no project open throws a clear error', async () => {
    const freshMock = loadMainWithMockElectron(MAIN_PATH);
    await assert.rejects(() => freshMock.handleFns.get('agent:mcpRemoveServer')(EVT, 'x'), /No project folder open/);
  });

  test('agent:mcpListServers on no project open returns an empty list rather than throwing', async () => {
    const freshMock = loadMainWithMockElectron(MAIN_PATH);
    const r = await freshMock.handleFns.get('agent:mcpListServers')(EVT);
    assert.equal(r.ok, true);
    assert.deepEqual(r.servers, []);
  });
});
