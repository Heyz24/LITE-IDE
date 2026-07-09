# LiteIDE — Manual Test Checklist

I statically verified every IPC channel (preload.js ↔ main.js), every `onclick`/`onchange`
handler, and both `main.js` and the inline renderer script for syntax errors — all clean.
What I *can't* do from here: launch Electron (no display in this sandbox) or reach
`api.anthropic.com` / `api.openai.com` / `localhost:11434` (network is locked to package
registries only). So — run this checklist yourself once, top to bottom. Should take ~10 min.

**Before anything else:** open DevTools (`Ctrl+Shift+I` / `Cmd+Opt+I`) and keep the Console
tab visible while you click through this. Any red error there is a real bug — screenshot it
and send it back to me with the step number.

---

## 0. Boot
1. `npm start`
2. Console should show no red errors on load.
3. A shell tab should auto-appear in the terminal area within ~1s, already connected
   (this is the "auto-connect to system shell" feature — no picker, no config needed).
   Type `echo hi` and hit Enter — should echo back immediately.

## 1. Terminal — multi-session + split
1. Click the **+** button in the terminal header → picker modal shows your real detected
   system shells (PowerShell/CMD/Git Bash on Windows; zsh/bash/fish on Mac/Linux).
2. Pick one → a new tab appears (e.g. "Shell 2"), separate prompt, separate history.
3. Click between "Shell 1" / "Shell 2" / "Output" tabs — each keeps its own scrollback.
4. Click the split icon (top right of terminal header) → second pane appears with a
   dropdown; pick a different session in the right pane — both panes are independently
   typeable at the same time.
5. Right-click inside a terminal → context menu (Copy/Paste/Select All/Clear/CD to Project).
6. Close a shell tab via the ✕ on its tab — process should terminate (check your OS task
   manager if you want to be thorough; no orphaned shell process).
7. `Ctrl+Shift+C` / `Ctrl+Shift+V` copy/paste still work inside a terminal.

## 2. Split editor view
1. Open two different files.
2. Click the split-editor icon next to the AI Agent button (top of tab bar).
3. Right pane appears with a dropdown — pick the *other* open file.
4. Edit in the right pane → left pane's tab dot / your file on disk is unaffected until
   you stop typing ~500ms (autosave triggers independently per pane).
5. Click ✕ on the right pane header → closes split, left pane still has your file.

## 3. Project search & replace
1. Click the 🔍 icon above Explorer in the sidebar (or it'll be the second icon).
2. Type a string you know exists in your project → Search.
3. Results grouped by file — click any result line → opens that file, cursor jumps to
   that exact line.
4. Type something in "Replace with…" → Replace All → confirms, reports "Replaced N
   matches in M files", and any of those files you had open in tabs auto-reload.

## 4. Git status + diff
*(Only meaningful if the opened folder is actually a git repo with some uncommitted changes.)*
1. Modify a tracked file, save it, create a new untracked file.
2. Within ~4s the file tree should show a colored letter badge next to each
   (M = modified/orange, U = untracked/blue, D = deleted/red).
3. Right-click a modified file → "View Git Diff" → modal opens a real Monaco side-by-side
   diff (HEAD version vs your working copy).

## 5. AI Agent — connection
1. Click "AI Agent" tab.
2. Pick a provider. Type a model name in the model box (it's free text now — type
   literally anything, including older/custom model names; the datalist dropdown is
   just suggestions, not a restriction).
3. Paste your API key (skip for Ollama) → **Save**.
4. Click **Test** → should show "✅ Connected. Model replied: OK" within a few seconds.
   If it errors, the exact provider error message is shown (bad key, model not found,
   rate limit, etc.) — that's the real API talking, not a generic failure.

## 6. AI Agent — tool execution (no model needed)
1. With a project folder open, click **Self-Test Tools**.
2. This runs `list_dir → write_file → read_file → search_codebase → run_command →
   delete_file` directly against your real project folder, independent of any AI model,
   and reports pass/fail per step. This isolates "is the tool layer wired correctly"
   from "does the model call tools correctly" — if this fails, it's a bug in my code,
   not a model/prompt issue.

## 7. AI Agent — real end-to-end task
1. Ask it something concrete: *"list the files in this project, then create a file
   called hello.txt with a short greeting in it."*
2. Watch for tool cards (📖/📁/✏️ icons) appearing as it works — these are real tool
   calls executing against your disk, not just text.
3. **If you're using a local Ollama model that doesn't support native tool-calling**
   (this was the exact bug in your screenshot — the model printed raw JSON as chat text
   instead of calling the tool): it should now be auto-detected and executed anyway — you
   should see a proper tool card, not a raw `{"name":"write_file",...}` text bubble. If you
   still see raw JSON printed as a chat bubble, that model's output format doesn't match
   what my fallback parser expects — send me the exact bubble text and I'll widen the parser.
4. Check `hello.txt` actually exists on disk with the content described.
5. Try something that touches a critical file — e.g. *"add a comment to package.json"* —
   an approval popup should block the write until you click Allow/Deny.

## 8. AI Agent — memory & session continuity
1. Have a short conversation, then close the AI Agent tab (✕) and reopen it.
2. Your previous messages should reappear ("— resumed session —").
3. Check your project folder for a new `.liteide/agent-session.json` — that's the
   transcript backing this.
4. Ask the agent to *"remember that this project uses 4-space indentation"* (or similar) —
   it should write to `.liteide/agent-memory.md`. Reopen the tab later / restart the app —
   ask something unrelated and confirm that note still influences its behavior (it's
   injected into the system prompt every session).

## 9. AI Agent — parallel sub-agents (orchestrator)
1. Ask something genuinely parallelizable: *"spawn two sub-agents: one to list all
   Python files in this project, another to list all JS files, at the same time."*
2. You should see a "🧬 spawn_subagents" card, then two "🤖 sub-agent #N" cards appear
   and fill in **concurrently** (not one-after-another) — each with its own mini tool log
   and a final summary, ending in "done (despawned)".
3. This confirms real `Promise.all` parallel execution, not sequential faking.

---

### If something fails
Tell me: which numbered step, the exact console error (if any), your OS, and which AI
provider/model you were testing. Everything above was verified by static analysis
(syntax, IPC wiring, DOM references) — actual runtime behavior against live shells/APIs
is what this checklist is for.
