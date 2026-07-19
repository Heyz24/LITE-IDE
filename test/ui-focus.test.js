'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX_PATH = path.join(__dirname, '..', 'src', 'index.html');

describe('Skills modal — focus-stealing fix regression guard', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const inlineScript = html.match(/<script>([\s\S]*)<\/script>/)[1];

  // Context: reported symptom was "cannot type" in the Agent Skills modal's
  // name/content fields. Root-caused (best available diagnosis without a
  // real browser in this environment — Monaco/xterm bundles can't load
  // headlessly here, so this could not be behaviorally reproduced end-to-end)
  // to Monaco Editor's internal keybinding service, which attaches its own
  // window-level CAPTURE-phase keydown listener and can keep "logical"
  // focus even when a modal is visually on top of it. Capture-phase
  // listeners at `window` always fire before the event reaches any
  // descendant target, so the only reliable fix is to make Monaco itself
  // stop believing it's focused — by explicitly blurring whatever
  // document.activeElement currently is before moving focus to the modal's
  // own input. These are static regression guards ensuring that fix stays
  // in place; they cannot verify real keystroke delivery without an actual
  // rendering engine, which isn't available in this test environment.

  test('openSkillsModal calls the focus-release helper before/around showing the modal', () => {
    const fnMatch = inlineScript.match(/async function openSkillsModal\(\)[\s\S]*?\n\}/);
    assert.ok(fnMatch, 'openSkillsModal not found');
    assert.match(fnMatch[0], /releaseEditorFocusForModal\(/, 'openSkillsModal must call releaseEditorFocusForModal to prevent Monaco/xterm from swallowing keystrokes meant for the modal input');
  });

  test('releaseEditorFocusForModal blurs the current active element before re-focusing', () => {
    const fnMatch = inlineScript.match(/function releaseEditorFocusForModal\(inputId\)[\s\S]*?\n\}/);
    assert.ok(fnMatch, 'releaseEditorFocusForModal not found');
    assert.match(fnMatch[0], /activeElement\?\.blur\(\)/, 'must blur document.activeElement — this is what actually releases Monaco\'s internal keyboard-capture focus');
    assert.match(fnMatch[0], /\.focus\(\)/, 'must explicitly focus the modal input afterward — blur alone would leave nothing focused');
  });

  test('the focus-release happens asynchronously (setTimeout), not synchronously, to win any focus-stealing Monaco/xterm do on their own next tick', () => {
    const fnMatch = inlineScript.match(/function releaseEditorFocusForModal\(inputId\)[\s\S]*?\n\}/);
    assert.match(fnMatch[0], /setTimeout\(/, 'focusing synchronously can lose a race if Monaco/xterm re-assert focus on the next tick — must be deferred');
  });
});
