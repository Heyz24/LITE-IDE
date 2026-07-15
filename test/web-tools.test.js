'use strict';
const { test, describe, before, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadMainWithMockElectron } = require('./helpers/mock-electron.js');

const MAIN_PATH = path.join(__dirname, '..', 'main.js');
const EVT = {};

describe('web_search / web_fetch (previously missing entirely — never implemented despite being declared as a tool)', () => {
  let mock, originalFetch;
  before(() => { mock = loadMainWithMockElectron(MAIN_PATH); });
  afterEach(() => { if (originalFetch) globalThis.fetch = originalFetch; });

  test('agent:webSearch parses real DuckDuckGo HTML result markup into structured results', async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      text: async () => `
        <div class="result">
          <a class="result__a" href="https://example.com/foo">Example &amp; Foo</a>
          <a class="result__snippet">A snippet about <b>foo</b> and stuff.</a>
        </div>
        <div class="result">
          <a class="result__a" href="https://example.com/bar">Bar Page</a>
          <a class="result__snippet">Another snippet here.</a>
        </div>
      `,
    });
    const r = await mock.handleFns.get('agent:webSearch')(EVT, 'foo bar');
    assert.equal(r.ok, true);
    assert.equal(r.results.length, 2);
    assert.equal(r.results[0].url, 'https://example.com/foo');
    assert.equal(r.results[0].title, 'Example & Foo');
    assert.match(r.results[0].snippet, /snippet about foo/);
  });

  test('agent:webSearch handles zero results without throwing', async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ text: async () => '<html><body>no results markup here</body></html>' });
    const r = await mock.handleFns.get('agent:webSearch')(EVT, 'asdkfjhaslkdjfh');
    assert.equal(r.ok, true);
    assert.deepEqual(r.results, []);
  });

  test('agent:webSearch rejects an empty query without making a network call', async () => {
    let called = false;
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { called = true; return { text: async () => '' }; };
    const r = await mock.handleFns.get('agent:webSearch')(EVT, '   ');
    assert.equal(r.ok, false);
    assert.equal(called, false);
  });

  test('agent:webSearch surfaces a real fetch failure instead of throwing', async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network unreachable'); };
    const r = await mock.handleFns.get('agent:webSearch')(EVT, 'test');
    assert.equal(r.ok, false);
    assert.match(r.error, /network unreachable/);
  });

  test('agent:webFetch strips HTML down to readable text', async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => '<html><head><style>.x{color:red}</style></head><body><h1>Title</h1><p>Some &amp; text.</p><script>evil()</script></body></html>',
    });
    const r = await mock.handleFns.get('agent:webFetch')(EVT, 'https://example.com/page');
    assert.equal(r.ok, true);
    assert.match(r.content, /Title/);
    assert.match(r.content, /Some & text/);
    assert.doesNotMatch(r.content, /evil\(\)/, 'script contents must be stripped, not just the tags');
    assert.doesNotMatch(r.content, /color:red/, 'style contents must be stripped, not just the tags');
  });

  test('agent:webFetch rejects a non-http(s) URL without making a network call', async () => {
    let called = false;
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { called = true; return {}; };
    const r = await mock.handleFns.get('agent:webFetch')(EVT, 'file:///etc/passwd');
    assert.equal(r.ok, false);
    assert.equal(called, false);
  });

  test('agent:webFetch refuses unsupported binary content types rather than returning garbage', async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ headers: { get: () => 'image/png' }, text: async () => '\x89PNG...' });
    const r = await mock.handleFns.get('agent:webFetch')(EVT, 'https://example.com/pic.png');
    assert.equal(r.ok, false);
    assert.match(r.error, /content-type/i);
  });

  test('agent:webFetch truncates very long pages and flags truncation', async () => {
    originalFetch = globalThis.fetch;
    const long = 'x'.repeat(20000);
    globalThis.fetch = async () => ({ headers: { get: () => 'text/plain' }, text: async () => long });
    const r = await mock.handleFns.get('agent:webFetch')(EVT, 'https://example.com/huge');
    assert.equal(r.ok, true);
    assert.equal(r.content.length, 15000);
    assert.equal(r.truncated, true);
  });
});
