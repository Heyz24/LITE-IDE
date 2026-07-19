#!/usr/bin/env node
'use strict';
// A REAL, minimal, protocol-compliant MCP server over stdio, used as a test
// fixture. It genuinely implements JSON-RPC 2.0 newline-delimited framing,
// `initialize`, `notifications/initialized`, `tools/list`, and `tools/call`
// — this is what real MCP tests should run against, not a fake in-process
// stub, so that main.js's actual stdio transport (spawn, line framing,
// pending-request bookkeeping) is genuinely exercised end-to-end.
//
// Mode is selected via argv[2]:
//   (default/'normal') — responds correctly, exposes echo/add/fail_tool
//   'crash'            — exits immediately without responding to anything
//   'garbage'          — prints a non-JSON banner line before real responses
//   'no-tools'         — tools/list returns an empty array
//   'slow-init'        — delays the initialize response by 300ms (used to prove a normal handshake still completes, not to test the 15s timeout itself — that would make tests slow for no benefit)

const mode = process.argv[2] || 'normal';

if (mode === 'crash') process.exit(1);

let buffer = '';
process.stdin.on('data', (d) => {
  buffer += d.toString();
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (line.trim()) handleLine(line);
  }
});

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

async function handleLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'notifications/initialized') return; // notification, no response
  if (msg.method === 'initialize') {
    if (mode === 'slow-init') await new Promise(r => setTimeout(r, 300));
    return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fixture-mcp-server', version: '1.0.0' } } });
  }
  if (mode === 'garbage' && msg.method === 'tools/list') {
    process.stdout.write('this is not JSON, some servers print startup banners to stdout\n');
  }
  if (msg.method === 'tools/list') {
    const tools = mode === 'no-tools' ? [] : [
      { name: 'echo', description: 'Echoes back the given message.', inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } },
      { name: 'add', description: 'Adds two numbers.', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
      { name: 'fail_tool', description: 'Always returns an error, for testing error propagation.', inputSchema: { type: 'object', properties: {} } },
    ];
    return send({ jsonrpc: '2.0', id: msg.id, result: { tools } });
  }
  if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params || {};
    if (name === 'echo') return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: String(args?.message ?? '') }] } });
    if (name === 'add') return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: String((args?.a ?? 0) + (args?.b ?? 0)) }] } });
    if (name === 'fail_tool') return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'fail_tool always fails, as documented' } });
    return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Unknown tool: ${name}` } });
  }
  send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Unknown method: ${msg.method}` } });
}
