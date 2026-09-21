# Per-Campaign Pipeline State and Declined Lore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each campaign its own pipeline state that travels to main with the campaign's lane, let chronicler take a declined lore item off the list, and move the AskUserQuestion options record out of the project into OS temp, one file per session.

**Architecture:** Two hooks change shape and five skill/command prose files change behaviour. `pipeline-next.mjs` stops reading one shared `.professor-orb/pipeline-state.json` and instead reads `<sessionReportsRoot>/<campaign>/pipeline-state.json` for every campaign, printing one line per fresh state. `record-options.mjs` and `validate-write.mjs`'s `optionEcho` check both move to `<os.tmpdir()>/professor-orb/asked-options-<session_id>.json`. The four pipeline writers, `orb`, `setup`, `/log`, and `chronicler` get prose edits; the standalone components get a mechanical wording update.

**Tech Stack:** Node built-in modules only (`node:fs`, `node:path`, `node:os`, `node:child_process`). No test framework: each suite prints `[PASS]`/`[FAIL]` and exits non-zero on failure, driving the real hook as a child process. ESM (`.mjs`). Node 24 locally (`readdirSync` with `recursive: true` is available).

**Spec:** `docs/superpowers/specs/2026-09-21-professor-orb-campaign-state-and-declined-lore-design.md`

## Global Constraints

- **Read `professor-orb/skills/SHARED-PRINCIPLES.md` before editing any skill, agent, or command file.**
- **Read `professor-orb/CONTEXT.md` before writing user-facing prose.** "The campaign folder" is a listed term to avoid for the consumer project; name a campaign's folder by its path, `<sessionReportsRoot>/<campaign>/`.
- **No em dashes in any professor-orb output** (Principle 6), including strings the hooks print.
- **Every hook fails silent.** A missing file, unreadable JSON, unrecognized shape, or absent `conventions.json` exits 0 with no output. A hook never crashes a write and never blocks on its own malfunction.
- **Comment blocks in hook files are load-bearing.** Each records the invariant its guard holds. Any new guard gets a comment naming its invariant; any changed rule gets its comment updated.
- **`version` must match in `.claude-plugin/marketplace.json` (repo root) and `professor-orb/.claude-plugin/plugin.json`.** Target: `1.20.0`, from `1.19.0`.
- **The pipeline state path is `<sessionReportsRoot>/<campaign>/pipeline-state.json`**: the campaign's own folder directly under `sessionReportsRoot`, never a subfolder inside it (rolara's campaigns have `reports/` and `prep/` subfolders; the state file does not go in either).
- **The options record path is `path.join(os.tmpdir(), "professor-orb", \`asked-options-${sessionId}.json\`)`**, and a session id is used only if it matches `^[A-Za-z0-9_-]+$`.
- **Run tests with a bare `node <file>`** from the repo root. Each exits non-zero on failure. All suites: `for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done`
- **Working-copy files are CRLF** (`core.autocrlf`). Use the Edit tool or Node string replacement for edits, not `sed`.
- **Commits end with** `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File map

| File | Task | Change |
| --- | --- | --- |
| `professor-orb/hooks/pipeline-next.mjs` | 1 | Reads every campaign's state via `conventions.json` settings |
| `professor-orb/hooks/pipeline-next.test.mjs` | 1 | Fixture writes per-campaign state; new per-campaign cases |
| `professor-orb/hooks/record-options.mjs` | 2 | Writes the per-session temp file |
| `professor-orb/hooks/record-options.test.mjs` | 2 | Reads the temp file; unsafe-id cases |
| `professor-orb/hooks/validate-write.mjs` | 2 | `optionEcho` reads the per-session temp file |
| `professor-orb/hooks/option-echo.test.mjs` | 2 | Seeds the temp file; cross-session and end-to-end cases |
| `professor-orb/skills/setup/SKILL.md` | 2, 4 | Ignore list, Step 12 artifacts and deletions, report, description |
| `professor-orb/skills/{debrief,prep,content,chronicler}/SKILL.md` | 3 | Final act writes the campaign's file; no carry-forward |
| `professor-orb/skills/SHARED-PRINCIPLES.md` | 3 | §10 |
| `professor-orb/README.md` | 3, 4 | Lines 14, 58, 60 |
| `professor-orb/skills/orb/SKILL.md` | 4 | Reads per-campaign state |
| `professor-orb/commands/log.md` | 4 | Lane list and surprise-guard exemption; wording |
| `professor-orb/commands/{catalog,scribe,migrate}.md`, `professor-orb/skills/{homebrew,timeline,forge-prompt}/SKILL.md` | 4 | "never writes pipeline state" wording |
| `professor-orb/CONTEXT.md` | 4, 5 | **pipeline state**, **log command**, **proposal file** entries |
| `professor-orb/skills/chronicler/SKILL.md` | 5 | Section 7, cut flow, Step 1e rejection, write-back, never-do rule |
| `.claude-plugin/marketplace.json`, `professor-orb/.claude-plugin/plugin.json` | 6 | 1.20.0 |

---

### Task 1: The Stop hook reads each campaign's state

**Files:**
- Modify: `professor-orb/hooks/pipeline-next.mjs` (whole file shown below)
- Test: `professor-orb/hooks/pipeline-next.test.mjs`

**Interfaces:**
- Consumes: `.professor-orb/conventions.json` `settings[].sessionReportsRoot` (v3 shape); `<sessionReportsRoot>/<name>/pipeline-state.json` with `{ lastStep, sessionDate, updatedAt }`.
- Produces: stdout of one line per fresh campaign, `"<folder name>: <NEXT_STEP_MESSAGES[lastStep]><LANE_CLAUSES[lastStep] if git/github>"`, joined by `\n`, trailing `\n`; settings in array order, folders in sorted order. Tasks 3 and 4 document this.

- [ ] **Step 1: Change the test fixture to the per-campaign layout**

In `professor-orb/hooks/pipeline-next.test.mjs`, replace the header comment lines 4-8:

```js
// Drives the real hook as a child process against a disposable fixture
// project, exactly the way Claude Code invokes it: no stdin payload, the
// hook reads .professor-orb/conventions.json for each setting's
// sessionReportsRoot, then <sessionReportsRoot>/<campaign>/pipeline-state.json
// for every campaign (and, for the lane clause, .professor-orb/versioning.json)
// from its own process.cwd(). Node built-ins only, no test framework.
```

Replace the whole `runHook` function (lines 62-92) with:

```js
const DEFAULT_CONVENTIONS = {
  schemaVersion: 1,
  settings: [{ name: "rolara", kbRoot: "settings/rolara", sessionReportsRoot: "session-reports/rolara" }],
};

// Builds a disposable project directory, writes whichever fixture files are
// given, then fires the hook with that directory as its cwd (matching how
// the hook resolves process.cwd() for real). Returns stdout, exactly as the
// hook would print it into the Stop hook's transcript.
//
// states: { "<setting folder>/<campaign>": state object or raw string },
// written under session-reports/. pipelineState is shorthand for one campaign,
// "rolara/Camp", which is what every lane-clause case uses. conventions: an
// object, a raw string, or null for no file at all. legacyState: written to the
// pre-1.20.0 shared location, .professor-orb/pipeline-state.json.
function runHook(
  caseName,
  { pipelineState, states, conventions = DEFAULT_CONVENTIONS, legacyState, versioning, legacyVersioning } = {}
) {
  const dir = path.join(os.tmpdir(), `orb-pipeline-next-${process.pid}-${Math.abs(hashOf(caseName))}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, ".professor-orb"), { recursive: true });

  const write = (filePath, value) => {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, typeof value === "string" ? value : JSON.stringify(value), "utf8");
  };

  if (conventions !== null) write(path.join(dir, ".professor-orb", "conventions.json"), conventions);
  const all = { ...(states || {}) };
  if (pipelineState !== undefined) all["rolara/Camp"] = pipelineState;
  for (const [where, state] of Object.entries(all)) {
    write(path.join(dir, "session-reports", ...where.split("/"), "pipeline-state.json"), state);
  }
  if (legacyState !== undefined) write(path.join(dir, ".professor-orb", "pipeline-state.json"), legacyState);
  if (versioning !== undefined) write(path.join(dir, ".professor-orb", "versioning.json"), versioning);
  if (legacyVersioning !== undefined) write(path.join(dir, ".professor-orb", "catalog-versioning.json"), legacyVersioning);

  try {
    const out = execFileSync("node", [HOOK], { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: e.stdout || "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
```

After `freshState`, add:

```js
function staleState(lastStep) {
  return { lastStep, sessionDate: "2026-07-28", updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() };
}
```

- [ ] **Step 2: Prefix the existing exact-output expectations with the campaign**

Every exact `check(...)` against speaking output now expects the `Camp: ` prefix. Make these four replacements (the `checkContains` cases need no change):

- `chronicler + git mode: clause wording is exact`: expected becomes `"Camp: Next: the kb-validator agent can audit the changes, and /timeline can record events in the campaign chronology. /scribe can commit the KB changes, and /log the campaign's staged articles.\n"`
- `debrief + git mode: clause wording is exact`: expected becomes `"Camp: Next: /prep can build a session brief, or /chronicler can update the KB from the session report. /log can commit the session report.\n"`
- `content + git mode: clause wording is exact`: expected becomes `"Camp: Next: /chronicler can update the KB if not done yet, or /timeline for chronology. /log can commit the recap and handouts.\n"`
- Both `prep + ...: output is byte-identical to today's baseline` checks: expected becomes `"Camp: " + PREP_BASELINE`, and rename each to `... output is the baseline under the campaign's prefix`.

Also replace the comment on the `no-pipeline-state` case with:

```js
  // No campaign has a pipeline-state.json: the whole hook stays silent, lane
  // clause or not.
```

and rename its check to `"no campaign state: completely silent"`.

- [ ] **Step 3: Add the per-campaign cases**

Insert before `console.log("\n=== prototype pollution: ...`:

```js
console.log("\n=== per-campaign state: one line per fresh campaign, none for the rest ===");

{
  const r = runHook("two-campaigns", {
    states: { "rolara/Alpha": freshState("debrief"), "rolara/Bravo": freshState("prep") },
  });
  check(
    "two fresh campaigns: one line each, in folder order",
    r.out,
    "Alpha: Next: /prep can build a session brief, or /chronicler can update the KB from the session report.\n" +
      "Bravo: " + PREP_BASELINE
  );
}

{
  const r = runHook("two-settings", {
    conventions: {
      schemaVersion: 1,
      settings: [
        { name: "rolara", sessionReportsRoot: "session-reports/rolara" },
        { name: "supers", sessionReportsRoot: "session-reports/supers" },
      ],
    },
    states: { "rolara/Big-Guys-Gang": freshState("prep"), "supers/Adjustice": freshState("prep") },
  });
  check("every setting's campaigns are read, settings in order", r.out, "Big-Guys-Gang: " + PREP_BASELINE + "Adjustice: " + PREP_BASELINE);
}

{
  const r = runHook("fresh-and-stale", {
    states: { "rolara/Alpha": staleState("debrief"), "rolara/Bravo": freshState("prep") },
  });
  check("a stale campaign is silent and does not silence a fresh one", r.out, "Bravo: " + PREP_BASELINE);
}

{
  const r = runHook("fresh-and-malformed", {
    states: { "rolara/Alpha": "{ not json", "rolara/Bravo": freshState("prep") },
  });
  check("a malformed campaign state is silent and does not silence a fresh one", r.out, "Bravo: " + PREP_BASELINE);
}

{
  const r = runHook("stale-only", { pipelineState: staleState("prep") });
  check("a state older than two hours: silent", r.out, "");
}

{
  const r = runHook("no-conventions", { pipelineState: freshState("prep"), conventions: null });
  check("no conventions.json: silent, there is no root to look under", r.out, "");
}

{
  const r = runHook("v2-conventions", { pipelineState: freshState("prep"), conventions: { kbRoot: "kb" } });
  check("conventions.json with no settings array (v1/v2): silent", r.out, "");
}

{
  const r = runHook("malformed-conventions", { pipelineState: freshState("prep"), conventions: "{ not json" });
  check("unparseable conventions.json: silent", r.out, "");
  check("unparseable conventions.json: exits 0", r.code, 0);
}

{
  // The pre-1.20.0 shared file names no campaign. Reading it is how one
  // campaign's step was reported as another's, so the hook ignores it.
  const r = runHook("legacy-root-state", { legacyState: freshState("prep") });
  check("a legacy .professor-orb/pipeline-state.json is ignored", r.out, "");
}
```

- [ ] **Step 4: Run the suite to verify it fails**

Run: `node professor-orb/hooks/pipeline-next.test.mjs`
Expected: FAIL. Every speaking case prints `actual: ""` (the old hook reads only `.professor-orb/pipeline-state.json`), and `a legacy .professor-orb/pipeline-state.json is ignored` fails because the old hook speaks.

- [ ] **Step 5: Rewrite the hook**

Replace `professor-orb/hooks/pipeline-next.mjs` with:

```js
#!/usr/bin/env node
// Stop hook: suggests the next session-pipeline step, deterministically.
//
// Pipeline state is kept per campaign, at
// <sessionReportsRoot>/<campaign>/pipeline-state.json, so it reaches main in
// the campaign's own /log commit and two campaigns never share a slot. This
// hook reads .professor-orb/conventions.json from the current working
// directory for each setting's sessionReportsRoot, reads the state file in
// every folder directly under that root, and prints one line per campaign
// whose last completed step is recent: the campaign's folder name, then the
// suggestion. Purely mechanical: no model judgment, no conversation parsing.
// Never blocks (always exits 0).
//
// Before 1.20.0 the state was one shared .professor-orb/pipeline-state.json
// naming no campaign, and a skill could record one campaign's work against
// another campaign's session. This hook does not read that file; setup's
// resync deletes it.
//
// A second, independent read of .professor-orb/versioning.json (or the legacy
// .professor-orb/catalog-versioning.json, when versioning.json does not yet
// exist) decides whether a lane-command clause is appended to each base
// message. The base message always emits on its own; only the appended clause
// is conditional on the versioning marker. Every read shares the same
// fail-silent contract: a missing file, unreadable JSON, or unrecognized shape
// is treated as "nothing to say" for that read, never as a crash, and never as
// a reason to suppress another campaign's line. This hook never writes or
// converts the versioning marker; it only reads it.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Both maps below are built with a null prototype (the "__proto__: null"
// object-literal key sets the object's own [[Prototype]] to null; it does
// not create an own "__proto__" property). This is structural, not a guard:
// a plain object literal inherits from Object.prototype, so a corrupted or
// crafted lastStep such as "__proto__", "toString", "constructor", or
// "hasOwnProperty" would resolve to a truthy inherited value (an object or a
// native function) on an ordinary "{}"-style map, defeating the truthiness
// checks below and printing that inherited value's string coercion instead
// of staying silent. With no prototype chain to inherit from, a lookup by
// any name that is not one of this map's own keys returns undefined, no
// matter what Object.prototype happens to expose.
const NEXT_STEP_MESSAGES = {
  __proto__: null,
  debrief:
    "Next: /prep can build a session brief, or /chronicler can update the KB from the session report.",
  prep: "Next: /content can write recaps and handouts, or /chronicler can update the KB.",
  chronicler:
    "Next: the kb-validator agent can audit the changes, and /timeline can record events in the campaign chronology.",
  content:
    "Next: /chronicler can update the KB if not done yet, or /timeline for chronology.",
  // "timeline" and any unrecognized lastStep intentionally have no entry;
  // absence means stay silent.
};

// Appended to the base message above only when a versioning marker exists and
// its mode is "git" or "github". Never appended on its own; a lastStep with
// no NEXT_STEP_MESSAGES entry stays silent regardless of this map. There is
// no "timeline" entry: timeline never writes pipeline state, so
// NEXT_STEP_MESSAGES has no "timeline" key and this hook can never reach
// this map with that lastStep in the first place. The chronology-document
// lane wording belongs to timeline/SKILL.md's own handoff line, not here.
const LANE_CLAUSES = {
  __proto__: null,
  debrief: " /log can commit the session report.",
  content: " /log can commit the recap and handouts.",
  // Chronicler writes in two lanes now: kbRoot articles that /scribe commits,
  // and staged articles in the campaign's articles/ folder that /log commits.
  // The hook reads only pipeline state, conventions.json's settings, and
  // versioning.json, so it cannot know the run's mode; naming both
  // unconditionally is the only correct shape.
  chronicler: " /scribe can commit the KB changes, and /log the campaign's staged articles.",
};

// Parses a JSON file, or returns null for a missing or unreadable one.
function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

// Reads the versioning decision, fail-silent. Tries versioning.json first;
// falls back to the legacy catalog-versioning.json only when versioning.json
// itself is absent (ENOENT or similar). Never converts or writes either
// file; that conversion belongs to setup and /catalog alone. Returns the
// mode string on success, or null if no usable marker could be read.
function readVersioningMode(cwd) {
  const primaryPath = path.resolve(cwd, ".professor-orb", "versioning.json");
  const legacyPath = path.resolve(
    cwd,
    ".professor-orb",
    "catalog-versioning.json"
  );

  let raw;
  try {
    raw = readFileSync(primaryPath, "utf8");
  } catch {
    try {
      raw = readFileSync(legacyPath, "utf8");
    } catch {
      return null;
    }
  }

  let marker;
  try {
    marker = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!marker || typeof marker !== "object" || Array.isArray(marker)) {
    return null;
  }

  return typeof marker.mode === "string" ? marker.mode : null;
}

// One campaign's suggestion, or null when its state has nothing to say: not
// an object, no parseable updatedAt, older than STALE_MS, or a lastStep with
// no NEXT_STEP_MESSAGES entry. A null silences this campaign only.
function suggestionFor(state, mode) {
  if (!state || typeof state !== "object") return null;
  const { lastStep, updatedAt } = state;
  if (typeof updatedAt !== "string") return null;
  const updatedAtMs = Date.parse(updatedAt);
  if (Number.isNaN(updatedAtMs)) return null;
  // Stale, the suggestion is no longer relevant.
  if (Date.now() - updatedAtMs > STALE_MS) return null;
  if (typeof lastStep !== "string") return null;
  const message = NEXT_STEP_MESSAGES[lastStep];
  if (!message) return null;
  const clause = mode === "git" || mode === "github" ? LANE_CLAUSES[lastStep] : undefined;
  return clause ? message + clause : message;
}

function main() {
  const cwd = process.cwd();
  const conventions = readJson(path.resolve(cwd, ".professor-orb", "conventions.json"));
  // A v1 or v2 file has no settings array and so no sessionReportsRoot to
  // look under. Silent until setup resyncs it to v3.
  const settings =
    conventions && Array.isArray(conventions.settings) ? conventions.settings : [];
  const mode = readVersioningMode(cwd);

  const lines = [];
  for (const setting of settings) {
    const root = setting && setting.sessionReportsRoot;
    if (typeof root !== "string" || root.length === 0) continue;
    let names;
    try {
      names = readdirSync(path.resolve(cwd, root)).sort();
    } catch {
      continue;
    }
    // A plain file under the root (an index, say) has no state file inside
    // it, so its read returns null and it is skipped like any campaign that
    // has not run a pipeline step yet.
    for (const name of names) {
      const state = readJson(path.resolve(cwd, root, name, "pipeline-state.json"));
      const line = suggestionFor(state, mode);
      if (line) lines.push(`${name}: ${line}`);
    }
  }

  if (lines.length > 0) process.stdout.write(lines.join("\n") + "\n");
  process.exit(0);
}

main();
```

- [ ] **Step 6: Run the suite to verify it passes**

Run: `node professor-orb/hooks/pipeline-next.test.mjs`
Expected: every expectation `[PASS]`, final line `N/N expectations met.`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add professor-orb/hooks/pipeline-next.mjs professor-orb/hooks/pipeline-next.test.mjs
git commit -m "feat(professor-orb): read pipeline state per campaign in the Stop hook

Each campaign's state now lives at <sessionReportsRoot>/<campaign>/pipeline-state.json.
The hook reads every one of them through conventions.json's settings and prints
one line per fresh campaign, prefixed with its folder name. The pre-1.20.0
shared .professor-orb/pipeline-state.json is no longer read.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The options record moves to OS temp, one file per session

**Files:**
- Modify: `professor-orb/hooks/record-options.mjs` (whole file shown below)
- Modify: `professor-orb/hooks/validate-write.mjs` (import, `main()`, `checkOptionEcho`)
- Modify: `professor-orb/skills/setup/SKILL.md:63`
- Test: `professor-orb/hooks/record-options.test.mjs`, `professor-orb/hooks/option-echo.test.mjs`

**Interfaces:**
- Consumes: hook stdin `session_id` (string), `cwd`, `tool_input.questions`.
- Produces: file `path.join(os.tmpdir(), "professor-orb", \`asked-options-${sessionId}.json\`)` containing `{ "options": string[] }`. `validate-write.mjs` `ctx.sessionId: string` (`""` when absent).

- [ ] **Step 1: Rewrite the recorder's tests for the temp path**

In `professor-orb/hooks/record-options.test.mjs`, change the `node:fs` import to:

```js
import { mkdirSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
```

Replace `fixture`, `run`, and `state` (lines 36-60) with:

```js
function fixture(name) {
  const dir = path.join(os.tmpdir(), `orb-rec-${name}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, ".professor-orb"), { recursive: true });
  mkdirSync(path.join(dir, "tmp"), { recursive: true });
  return dir;
}

// The recorder resolves os.tmpdir() from these variables (TEMP and TMP on
// Windows, TMPDIR elsewhere), so each fixture's record lands in its own tmp/.
function run(dir, sessionId, questions) {
  const tmp = path.join(dir, "tmp");
  execFileSync("node", [HOOK], {
    input: JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "AskUserQuestion",
      session_id: sessionId,
      cwd: dir,
      tool_input: { questions },
    }),
    encoding: "utf8",
    env: { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp },
  });
}

function state(dir, sessionId) {
  const p = path.join(dir, "tmp", "professor-orb", `asked-options-${sessionId}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

// Everything under the fixture's temp folder, so a case can assert that the
// recorder wrote nothing at all.
function tempEntries(dir) {
  return readdirSync(path.join(dir, "tmp"), { recursive: true }).map(String).sort();
}
```

Replace the `recording:`, `appending and session rollover:`, and `fail-silent contract:` blocks (lines 74-124) with:

```js
console.log("recording:");
(function () {
  const dir = fixture("basic");
  run(dir, "s1", ASKED);
  const s = state(dir, "s1");
  check("both options recorded, selected or not", s?.options?.length, 2);
  check(
    "label and description joined",
    s?.options?.[0],
    "Reporter asked the name. The team answered on camera as the Neighborhood Watch Association"
  );
  check("the file name carries the session, so the record carries no session field", s !== null && "sessionId" in s, false);
  check("nothing is written inside the project", existsSync(path.join(dir, ".professor-orb", "asked-options.json")), false);
  rmSync(dir, { recursive: true, force: true });
})();

console.log("appending, and one file per session:");
(function () {
  const dir = fixture("append");
  run(dir, "s1", ASKED);
  run(dir, "s1", ASKED);
  check("same session appends", state(dir, "s1")?.options?.length, 4);
  run(dir, "s2", ASKED);
  check("a new session starts its own file", state(dir, "s2")?.options?.length, 2);
  check("the earlier session's file is untouched", state(dir, "s1")?.options?.length, 4);
  rmSync(dir, { recursive: true, force: true });
})();

console.log("a session id that is not a plain token writes nothing:");
(function () {
  for (const [i, bad] of ["../escape", "a/b", "a\\b", "s1.json", ""].entries()) {
    const dir = fixture(`bad-${i}`);
    run(dir, bad, ASKED);
    check(`session id ${JSON.stringify(bad)}: no file written`, tempEntries(dir), []);
    rmSync(dir, { recursive: true, force: true });
  }
  const dir = fixture("no-session");
  run(dir, undefined, ASKED);
  check("no session id: no file written", tempEntries(dir), []);
  rmSync(dir, { recursive: true, force: true });
})();

console.log("fail-silent contract:");
(function () {
  // No .professor-orb directory: setup never ran, so the recorder writes nothing.
  const bare = path.join(os.tmpdir(), `orb-rec-bare-${process.pid}`);
  rmSync(bare, { recursive: true, force: true });
  mkdirSync(path.join(bare, "tmp"), { recursive: true });
  run(bare, "s1", ASKED);
  check("no .professor-orb means no record", tempEntries(bare), []);
  rmSync(bare, { recursive: true, force: true });

  let threw = false;
  try {
    execFileSync("node", [HOOK], { input: "not json", encoding: "utf8" });
  } catch {
    threw = true;
  }
  check("malformed stdin exits 0", threw, false);

  const dir = fixture("silent");
  run(dir, "s1", [{ question: "q", header: "h", multiSelect: false, options: "not an array" }]);
  check("malformed questions writes nothing", tempEntries(dir), []);
  rmSync(dir, { recursive: true, force: true });
})();
```

The import no longer includes `writeFileSync`; no remaining line in this file uses it.

- [ ] **Step 2: Rewrite the optionEcho tests for the temp path**

In `professor-orb/hooks/option-echo.test.mjs`, after the `RULES` constant add:

```js
const RECORDER = path.join(path.dirname(fileURLToPath(import.meta.url)), "record-options.mjs");

// The hooks resolve os.tmpdir() from these variables (TEMP and TMP on
// Windows, TMPDIR elsewhere), so pointing all three at the fixture keeps each
// case's options record inside its own folder.
function tempEnv(dir) {
  const tmp = path.join(dir, "tmp");
  return { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp };
}
```

Change the `fixture` signature and its `if (offered)` block. The new signature is `function fixture(name, reportBody, offered, dmSaid, offeredSession = "s1")`, and the block becomes:

```js
  if (offered) {
    const record = path.join(dir, "tmp", "professor-orb", `asked-options-${offeredSession}.json`);
    mkdirSync(path.dirname(record), { recursive: true });
    writeFileSync(record, JSON.stringify({ options: offered }));
  }
```

Replace `runValidator` with:

```js
// Returns { blocked: boolean, output: string }. validate-write signals a block
// with exit 2 and stderr; a pass or warn exits 0. A default parameter fires on
// an explicitly passed undefined as much as on an omitted argument, so
// "session_id absent, the shape of an older harness" needs its own sentinel:
// pass sessionId: null to omit the field from the payload entirely. Every
// other call site either omits the argument (gets "s1") or passes a real id.
function runValidator(dir, file, transcript, sessionId = "s1") {
  const payload = {
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    cwd: dir,
    transcript_path: transcript,
    tool_input: { file_path: file },
  };
  if (sessionId !== null) payload.session_id = sessionId;
  try {
    execFileSync("node", [HOOK], {
      cwd: dir,
      input: JSON.stringify(payload),
      encoding: "utf8",
      env: tempEnv(dir),
    });
    return { blocked: false, output: "" };
  } catch (err) {
    return { blocked: err.status === 2, output: `${err.stdout || ""}${err.stderr || ""}` };
  }
}
```

Insert before `console.log("fail-silent contract:");`:

```js
console.log("one session cannot read another's options:");
(function () {
  // Before 1.20.0 the record was one file in .professor-orb/, read without
  // comparing sessions, so a new session inherited the last one's options
  // until it asked its own first question. The legacy file below is exactly
  // what a 1.19.0 project still has on disk.
  const { dir, file, transcript } = fixture(
    "other-session",
    LAUNDERED,
    OFFERED,
    "we wrapped up at the warehouse, pretty short night",
    "s-old"
  );
  writeFileSync(
    path.join(dir, ".professor-orb", "asked-options.json"),
    JSON.stringify({ sessionId: "s-old", options: OFFERED })
  );
  check("an option offered in another session does not block", runValidator(dir, file, transcript, "s1").blocked, false);
  check("no session id passes rather than blocks", runValidator(dir, file, transcript, null).blocked, false);
  rmSync(dir, { recursive: true, force: true });
})();

console.log("recorder and validator agree on the path:");
(function () {
  // The two hooks each compute the record's path. This case runs the real
  // recorder, then the real validator, so a drift between the two fails here
  // instead of leaving optionEcho quietly inert.
  const { dir, file, transcript } = fixture(
    "end-to-end",
    LAUNDERED,
    null,
    "we wrapped up at the warehouse, pretty short night"
  );
  execFileSync("node", [RECORDER], {
    input: JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "AskUserQuestion",
      session_id: "s-e2e",
      cwd: dir,
      tool_input: {
        questions: [
          {
            question: "What happened in the aftermath?",
            header: "Aftermath",
            multiSelect: true,
            options: [
              { label: "Reporter asked the name", description: "The team answered on camera as the Neighborhood Watch Association" },
              { label: "Nothing on camera", description: "The crash site cleared without press" },
            ],
          },
        ],
      },
    }),
    encoding: "utf8",
    env: tempEnv(dir),
  });
  check("an option the recorder saw blocks the validator's write", runValidator(dir, file, transcript, "s-e2e").blocked, true);
  rmSync(dir, { recursive: true, force: true });
})();
```

- [ ] **Step 3: Run both suites to verify they fail**

Run: `node professor-orb/hooks/record-options.test.mjs`
Expected: FAIL on the `recording:` and `appending` expectations (the old recorder writes `.professor-orb/asked-options.json`, not the temp path), and on `nothing is written inside the project`.

Run: `node professor-orb/hooks/option-echo.test.mjs`
Expected: FAIL on `a paraphrase of an offered option blocks the write` (the old validator reads the old path, finds nothing, passes), on `an option offered in another session does not block` (the old validator reads the legacy file and blocks), and on the end-to-end case.

- [ ] **Step 4: Rewrite the recorder**

Replace `professor-orb/hooks/record-options.mjs` with:

```js
#!/usr/bin/env node
// PostToolUse hook on AskUserQuestion: records every option offered.
//
// On 2026-09-18 a debrief option whose DESCRIPTION stated an outcome ("The team
// answered on camera as the Neighborhood Watch Association") became a sentence
// in a session report, then a source for the index, chronicler, and a recap.
// The pipeline laundered its own proposal into canon. This file is half of the
// detector for that: it remembers what was offered, and validate-write's
// optionEcho check refuses a report sentence that paraphrases one.
//
// EVERY option is recorded, not only those selected. The DM states the option
// was never selected on their screen, so matching against the full offered set
// is what covers the case as reported, and it removes any dependence on the
// shape of tool_response.
//
// The record is hook-owned: read by hooks, never by the model. Keeping it out
// of the model's context is part of its contract, not incidental, because it
// holds proposed-scene text. It lives in the OS temp directory, one file per
// session, at <os.tmpdir()>/professor-orb/asked-options-<session_id>.json.
// Outside the project, git can never pick it up; named by session, one session
// can never read another's options. validate-write's checkOptionEcho computes
// the same path, and the end-to-end case in option-echo.test.mjs fails if the
// two drift apart.
//
// ponytail: one small file per questioning session is left for the OS's temp
// cleanup. Delete it from a SessionEnd hook if that ever matters.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// The session id becomes part of a file name. Anything but a plain token (a
// path separator, "..", a dot, an empty string) writes nothing rather than a
// file somewhere the reader will not look.
const SESSION_ID = /^[A-Za-z0-9_-]+$/;

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  if (!input || typeof input !== "object") process.exit(0);
  if (input.tool_name !== "AskUserQuestion") process.exit(0);

  const cwd = typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : process.cwd();
  // Setup never ran, so professor-orb is not in use here and there is no
  // report for the record to protect.
  if (!existsSync(path.resolve(cwd, ".professor-orb"))) process.exit(0);

  const sessionId = typeof input.session_id === "string" ? input.session_id : "";
  if (!SESSION_ID.test(sessionId)) process.exit(0);

  const questions = input.tool_input && Array.isArray(input.tool_input.questions)
    ? input.tool_input.questions
    : [];

  const offered = [];
  for (const question of questions) {
    if (!question || !Array.isArray(question.options)) continue;
    for (const option of question.options) {
      if (!option || typeof option !== "object") continue;
      const label = typeof option.label === "string" ? option.label.trim() : "";
      const description = typeof option.description === "string" ? option.description.trim() : "";
      const joined = [label, description].filter(Boolean).join(". ");
      if (joined !== "") offered.push(joined);
    }
  }
  // Nothing usable. Writing an empty record would only churn the file.
  if (offered.length === 0) process.exit(0);

  const stateDir = path.join(os.tmpdir(), "professor-orb");
  const statePath = path.join(stateDir, `asked-options-${sessionId}.json`);

  let options = [];
  try {
    const prior = JSON.parse(readFileSync(statePath, "utf8"));
    if (prior && Array.isArray(prior.options)) options = prior.options;
  } catch {
    // No prior file, or an unreadable one. Start fresh rather than fail.
  }

  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(statePath, JSON.stringify({ options: [...options, ...offered] }, null, 2) + "\n", "utf8");
  } catch {
    // An unwritable temp directory must not break the DM's question.
  }
  process.exit(0);
}

main();
```

- [ ] **Step 5: Point `checkOptionEcho` at the same path**

In `professor-orb/hooks/validate-write.mjs`:

After `import path from "node:path";` (line 10) add:

```js
import os from "node:os";
```

In `main()`, directly after the `transcriptPath` declaration (line 1189), add:

```js
  // Names the per-session options record optionEcho reads. Absent in older
  // harness versions, and that absence is handled by the check.
  const sessionId = typeof input.session_id === "string" ? input.session_id : "";
```

In the `ctx` literal, after `transcriptPath,` add `sessionId,`.

In the comment above `checkOptionEcho`, replace the paragraph beginning `// Fail-silent on an absent or unreadable state file` with:

```js
// The record is record-options.mjs's, one file per session in the OS temp
// directory; that hook's header states why. Fail-silent on a missing or unsafe
// session id, an absent or unreadable record, and equally on an unreadable
// transcript: with no record of what the DM typed, the check cannot tell a
// laundered sentence from a confirmed one, and a block on no evidence is worse
// than no block. A session in which the recorder never ran behaves exactly as
// before.
```

Replace the state read inside `checkOptionEcho`:

```js
  let offered;
  try {
    const statePath = path.resolve(ctx.projectRoot, ".professor-orb", "asked-options.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
```

with:

```js
  // Same path and same token rule as record-options.mjs; the end-to-end case
  // in option-echo.test.mjs pins the two together.
  if (!/^[A-Za-z0-9_-]+$/.test(ctx.sessionId)) return true;
  let offered;
  try {
    const statePath = path.join(os.tmpdir(), "professor-orb", `asked-options-${ctx.sessionId}.json`);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
```

- [ ] **Step 6: Drop the ignore entry from setup**

In `professor-orb/skills/setup/SKILL.md` line 63, replace:

```
Ignored, as derived or transient: `.professor-orb/pipeline-state.json`, `.professor-orb/proposals/`, `.professor-orb/tag-registry*.json`, `.professor-orb/asked-options.json`, `**/.obsidian/workspace*.json`, `**/.obsidian/plugins/`.
```

with:

```
Ignored, as derived or transient: `.professor-orb/pipeline-state.json`, `.professor-orb/proposals/`, `.professor-orb/tag-registry*.json`, `**/.obsidian/workspace*.json`, `**/.obsidian/plugins/`.
```

(Task 4 removes the `pipeline-state.json` entry.)

- [ ] **Step 7: Run the three affected suites to verify they pass**

Run: `node professor-orb/hooks/record-options.test.mjs`
Expected: `N passed, 0 failed`, exit 0.

Run: `node professor-orb/hooks/option-echo.test.mjs`
Expected: `N passed, 0 failed`, exit 0.

Run: `node professor-orb/hooks/validate-write.test.mjs && node professor-orb/hooks/pronoun-checks.test.mjs`
Expected: both exit 0 (they do not touch the options record, and must not regress).

- [ ] **Step 8: Commit**

```bash
git add professor-orb/hooks/record-options.mjs professor-orb/hooks/record-options.test.mjs professor-orb/hooks/validate-write.mjs professor-orb/hooks/option-echo.test.mjs professor-orb/skills/setup/SKILL.md
git commit -m "fix(professor-orb): keep the options record in OS temp, one file per session

asked-options.json lived in .professor-orb/, where git could pick it up, and
optionEcho read it without comparing sessions, so a new session inherited the
previous one's options until it asked its first question. Both hooks now use
<os.tmpdir()>/professor-orb/asked-options-<session_id>.json; an end-to-end test
pins the two paths together.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The pipeline writers record their own campaign's state

Prose only. No automated test; Step 6 is a grep check.

**Files:**
- Modify: `professor-orb/skills/debrief/SKILL.md:128-138`
- Modify: `professor-orb/skills/prep/SKILL.md:148-158`
- Modify: `professor-orb/skills/content/SKILL.md:217-227`
- Modify: `professor-orb/skills/chronicler/SKILL.md:242-254`
- Modify: `professor-orb/skills/SHARED-PRINCIPLES.md` §10
- Modify: `professor-orb/README.md:58`

**Interfaces:**
- Consumes: Task 1's path, `<sessionReportsRoot>/<campaign>/pipeline-state.json`.
- Produces: the four writers' final acts, which Task 4's `orb` text describes.

- [ ] **Step 1: debrief**

Replace:

```
After everything else in this workflow has succeeded, the very last thing you do is write `.professor-orb/pipeline-state.json`:
```

with:

```
After everything else in this workflow has succeeded, the very last thing you do is write this campaign's pipeline state to `<sessionReportsRoot>/<campaign>/pipeline-state.json`: the campaign's own folder directly under `sessionReportsRoot`, never a subfolder inside it. Each campaign has its own file, and `/log` commits it with the report.
```

The JSON block and the paragraph after it (`Use the session date gathered in Phase 2's metadata question...`) stay as they are.

- [ ] **Step 2: prep**

Replace:

```
After everything else in this workflow has succeeded, the very last thing you do is write `.professor-orb/pipeline-state.json`:

```json
{
  "lastStep": "prep",
  "sessionDate": "<carried forward or the date of the session being prepped, YYYY-MM-DD>",
  "updatedAt": "<current UTC time, ISO 8601>"
}
```

For `sessionDate`: if `.professor-orb/pipeline-state.json` already exists (typically because `debrief` just ran), read its `sessionDate` field and carry it forward unchanged. If no `pipeline-state.json` exists yet, use the date of the session report you read in Inputs, the session being prepped for. `updatedAt` must be the current time at the moment you write this file; the Stop hook ignores state older than two hours.
```

with:

```
After everything else in this workflow has succeeded, the very last thing you do is write this campaign's pipeline state to `<sessionReportsRoot>/<campaign>/pipeline-state.json`: the campaign's own folder directly under `sessionReportsRoot`, never a subfolder inside it. Each campaign has its own file, and `/log` commits it with the brief.

```json
{
  "lastStep": "prep",
  "sessionDate": "<the date of the session report you read in Inputs, YYYY-MM-DD>",
  "updatedAt": "<current UTC time, ISO 8601>"
}
```

`sessionDate` is the date of the session report you read in Inputs, the report this brief was built from. `updatedAt` must be the current time at the moment you write this file; the Stop hook ignores state older than two hours.
```

- [ ] **Step 3: content**

Replace:

```
After everything else in this workflow has succeeded, the very last thing you do is write `.professor-orb/pipeline-state.json`:

```json
{
  "lastStep": "content",
  "sessionDate": "<carried forward, or the date of the session the content was drawn from, YYYY-MM-DD>",
  "updatedAt": "<current UTC time, ISO 8601>"
}
```

For `sessionDate`: if `.professor-orb/pipeline-state.json` already exists (typically because `debrief` or `prep` just ran), read its `sessionDate` field and carry it forward unchanged. If no `pipeline-state.json` exists yet, use the date of the session report the content was drawn from. `updatedAt` must be the current time at the moment you write this file; the Stop hook ignores state older than two hours.
```

with:

```
After everything else in this workflow has succeeded, the very last thing you do is write this campaign's pipeline state to `<sessionReportsRoot>/<campaign>/pipeline-state.json`: the campaign's own folder directly under `sessionReportsRoot`, never a subfolder inside it. Each campaign has its own file, and `/log` commits it with the content.

```json
{
  "lastStep": "content",
  "sessionDate": "<the date of the session report the content was drawn from, YYYY-MM-DD>",
  "updatedAt": "<current UTC time, ISO 8601>"
}
```

`sessionDate` is the date of the session report the content was drawn from. `updatedAt` must be the current time at the moment you write this file; the Stop hook ignores state older than two hours.
```

- [ ] **Step 4: chronicler**

Replace:

```
After everything else in this workflow has succeeded, the very last thing you do is write `.professor-orb/pipeline-state.json`:

```json
{
  "lastStep": "chronicler",
  "sessionDate": "<the session date the executed proposal covered, YYYY-MM-DD>",
  "updatedAt": "<current UTC time, ISO 8601>"
}
```

For `sessionDate`: if `.professor-orb/pipeline-state.json` already exists (typically because `debrief`, `prep`, or `content` just ran), read its `sessionDate` field and carry it forward unchanged. If no `pipeline-state.json` exists yet, use the session date of the proposal you just executed (the date embedded in the proposal's filename). `updatedAt` must be the current time at the moment you write this file; the Stop hook ignores state older than two hours.
```

with:

```
After everything else in a **session-driven run** has succeeded, the very last thing you do is write the campaign's pipeline state to `<sessionReportsRoot>/<campaign>/pipeline-state.json`: the campaign's own folder directly under `sessionReportsRoot`, never a subfolder inside it. Each campaign has its own file, and `/log` commits it with the campaign's staged articles and write-backs.

```json
{
  "lastStep": "chronicler",
  "sessionDate": "<the session date of the proposal you executed, YYYY-MM-DD>",
  "updatedAt": "<current UTC time, ISO 8601>"
}
```

`sessionDate` is the session date of the proposal you just executed, the date embedded in the proposal's filename. `updatedAt` must be the current time at the moment you write this file; the Stop hook ignores state older than two hours.

**A standalone run writes no pipeline state.** It has no report and so no campaign, and it is not a step in any campaign's session pipeline.
```

The `**If `.professor-orb/` does not exist**` paragraph after it stays.

- [ ] **Step 5: SHARED-PRINCIPLES §10 and README**

In `professor-orb/skills/SHARED-PRINCIPLES.md`, replace:

```
Every pipeline skill's final act is updating `.professor-orb/pipeline-state.json` with what completed and what comes next. This breadcrumb drives the Stop hook's next-step suggestion and answers "where were we?" in fresh sessions. A skill that finishes without updating this file has left the pipeline in an unknown state.
```

with:

```
Every pipeline skill's final act is updating its campaign's pipeline state, `<sessionReportsRoot>/<campaign>/pipeline-state.json`, with the step that completed and the date of the session report it worked from. Each campaign has its own file, inside the campaign's lane, so `/log` commits it with the work it describes. This breadcrumb drives the Stop hook's next-step suggestion and answers "where were we?" in fresh sessions, per campaign. A skill that finishes without updating this file has left its campaign's pipeline in an unknown state.
```

In `professor-orb/README.md`, replace line 58:

```
Each pipeline skill's last act is writing `.professor-orb/pipeline-state.json` with the step that just completed, the session date, and a timestamp. Only `debrief`, `prep`, `content`, and `chronicler` write this file. The Stop hook (`pipeline-next.mjs`) reads it to suggest the next step automatically, and the `orb` skill reads the same file on demand for the same purpose.
```

with:

```
Each pipeline skill's last act is writing its campaign's pipeline state, `<sessionReportsRoot>/<campaign>/pipeline-state.json`, with the step that just completed, the date of the session report it worked from, and a timestamp. Only `debrief`, `prep`, `content`, and `chronicler` write these files, and each campaign has its own, inside the campaign's lane, so `/log` commits it with the rest of the campaign's work. The Stop hook (`pipeline-next.mjs`) reads every campaign's file and suggests the next step for each one updated in the last two hours, and the `orb` skill reads the same files on demand for the same purpose.
```

- [ ] **Step 6: Verify no writer still carries forward or writes the old path**

Run: `grep -n "carry it forward\|\.professor-orb/pipeline-state" professor-orb/skills/debrief/SKILL.md professor-orb/skills/prep/SKILL.md professor-orb/skills/content/SKILL.md professor-orb/skills/chronicler/SKILL.md professor-orb/skills/SHARED-PRINCIPLES.md`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add professor-orb/skills/debrief/SKILL.md professor-orb/skills/prep/SKILL.md professor-orb/skills/content/SKILL.md professor-orb/skills/chronicler/SKILL.md professor-orb/skills/SHARED-PRINCIPLES.md professor-orb/README.md
git commit -m "feat(professor-orb): each pipeline skill records its own campaign's state

debrief, prep, content, and chronicler now write
<sessionReportsRoot>/<campaign>/pipeline-state.json and record the date of the
report they worked from. The carry-forward rule is gone: it is how a Big Guy's
Gang brief would have been recorded against an Adjustice session. A standalone
chronicler run writes no state.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: orb, setup, /log, and the standalone components follow the new location

Prose only. Step 8 is a grep check.

**Files:**
- Modify: `professor-orb/skills/orb/SKILL.md` (lines 3, 14, 28, 51-63, 73)
- Modify: `professor-orb/skills/setup/SKILL.md` (lines 3, 10, 63, 174, 179, 264)
- Modify: `professor-orb/commands/log.md` (Step 3, Step 6)
- Modify: `professor-orb/commands/catalog.md`, `professor-orb/commands/log.md`, `professor-orb/commands/scribe.md`, `professor-orb/commands/migrate.md`, `professor-orb/skills/homebrew/SKILL.md`, `professor-orb/skills/timeline/SKILL.md`, `professor-orb/skills/forge-prompt/SKILL.md` (wording)
- Modify: `professor-orb/README.md` (lines 14, 60)
- Modify: `professor-orb/CONTEXT.md` (**pipeline state**, **log command**)

**Interfaces:**
- Consumes: Task 1's output format and Task 3's writer text.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Mechanical wording in the standalone components**

Run from the repo root, with the Bash tool (the single quotes keep the backticks literal):

```bash
node -e '
const fs = require("fs");
const files = [
  "professor-orb/commands/catalog.md",
  "professor-orb/commands/log.md",
  "professor-orb/commands/scribe.md",
  "professor-orb/commands/migrate.md",
  "professor-orb/skills/homebrew/SKILL.md",
  "professor-orb/skills/timeline/SKILL.md",
  "professor-orb/skills/forge-prompt/SKILL.md",
];
for (const f of files) {
  const before = fs.readFileSync(f, "utf8");
  const after = before
    .replaceAll("`.professor-orb/pipeline-state.json`", "pipeline state")
    .replaceAll("`pipeline-state.json`", "pipeline state")
    .replaceAll("pipeline-state.json", "pipeline state");
  fs.writeFileSync(f, after);
  console.log(before === after ? "unchanged" : "updated", f);
}'
```

Expected: all seven `updated`.

Then in `professor-orb/skills/timeline/SKILL.md`, replace:

```
Because this skill sits outside the session pipeline, it does not write pipeline state. That file belongs to `debrief`, `prep`, `content`, and `chronicler`.
```

with:

```
Because this skill sits outside the session pipeline, it does not write pipeline state. That belongs to `debrief`, `prep`, `content`, and `chronicler`.
```

- [ ] **Step 2: /log carries the state file without stopping on it**

In `professor-orb/commands/log.md` Step 3, replace:

```
and the `articles/` subdirectory holding new KB articles `chronicler` staged during a session-driven run, all as a single path for staging and committing (Step 7).
```

with:

```
the `articles/` subdirectory holding new KB articles `chronicler` staged during a session-driven run, and the campaign's `pipeline-state.json`, which `debrief`, `prep`, `content`, and `chronicler` rewrite as their last act, all as a single path for staging and committing (Step 7).
```

In Step 6, replace:

```
They are expected there until the DM promotes them.
```

with:

```
They are expected there until the DM promotes them. So is the campaign's `pipeline-state.json`: a JSON file in a lane of Markdown looks like a schema mismatch and is not one. It is the campaign's pipeline state, in the lane on purpose so it reaches main with the work it describes.
```

- [ ] **Step 3: orb reads each campaign's state**

In `professor-orb/skills/orb/SKILL.md` line 3 (the `description`), replace `Reads .professor-orb/pipeline-state.json (if present) to recommend` with `Reads each campaign's pipeline state (<sessionReportsRoot>/<campaign>/pipeline-state.json) to recommend`, and replace `it never writes pipeline-state.json, conventions.json, or any KB file` with `it never writes pipeline state, conventions.json, or any KB file`.

Replace line 14:

```
This skill does not need `.professor-orb/conventions.json`. Conventions govern KB frontmatter, folder structure, and writing style, none of which the menu itself touches. The one file this skill reads is `.professor-orb/pipeline-state.json`, for the "what to run next" section below. If that file or the whole `.professor-orb/` directory is missing, that is itself useful information (it means `setup` has not run yet), not an error to recover from.
```

with:

```
This skill does not need the rules in `.professor-orb/conventions.json`. Conventions govern KB frontmatter, folder structure, and writing style, none of which the menu itself touches. It reads two things, both for the "what to run next" section below: the `settings` array in `.professor-orb/conventions.json`, for each setting's `sessionReportsRoot`, and the `pipeline-state.json` in each campaign's folder under those roots. If the whole `.professor-orb/` directory is missing, that is itself useful information (it means `setup` has not run yet), not an error to recover from.
```

In line 28 (the setup row of the table), replace `produces `.professor-orb/` (conventions, pipeline state, tag registry, proposals)` with `produces `.professor-orb/` (conventions, tag registry, proposals)`.

Replace the opening of "What to run next" through its first two bullets:

```
Read `.professor-orb/pipeline-state.json` if it exists, and check its `lastStep`, `sessionDate`, and `updatedAt` fields.

- **`.professor-orb/` missing, or `pipeline-state.json` missing.** Nothing has been set up yet. Suggest running `setup` first; little else works reliably without it.
- **`pipeline-state.json` exists but has no `lastStep`** (the empty `{}` that `setup` writes on first install). Setup has run but the pipeline has not started. Suggest `debrief` as the first step.
```

with:

```
Pipeline state is kept per campaign, at `<sessionReportsRoot>/<campaign>/pipeline-state.json`. Read the `settings` array in `.professor-orb/conventions.json`; for each setting, list the folders directly under its `sessionReportsRoot` and read the `pipeline-state.json` in each one that has it. If the DM named a campaign, read only that campaign's. Each file carries `lastStep`, `sessionDate`, and `updatedAt`, and the bullets below apply to each campaign on its own.

- **`.professor-orb/` missing.** Nothing has been set up yet. Suggest running `setup` first; little else works reliably without it.
- **`.professor-orb/` exists but no campaign has a `pipeline-state.json`.** Setup has run but the pipeline has not started. Suggest `debrief` as the first step.
```

Replace:

```
Mention `sessionDate` when you report the suggestion, so the DM knows which session's progress this reflects.
```

with:

```
Report each campaign's suggestion under the campaign's name, with its `sessionDate`, so the DM knows which campaign and which session each one reflects. When more than one campaign has state, lead with the most recently updated.
```

Replace line 73:

```
- **Never write `.professor-orb/pipeline-state.json`.** Orb reads it; only `debrief`, `prep`, `content`, and `chronicler` write it.
```

with:

```
- **Never write pipeline state.** Orb reads it; only `debrief`, `prep`, `content`, and `chronicler` write it.
```

- [ ] **Step 4: setup stops writing the shared file and deletes the legacy one**

In `professor-orb/skills/setup/SKILL.md`:

Line 3 (`description`): replace `(conventions.json, versioning.json, pipeline-state.json, per-setting tag registries, proposals/)` with `(conventions.json, versioning.json, per-setting tag registries, proposals/)`.

Line 10: replace `and the session pipeline reads `pipeline-state.json` from the moment it exists.` with `and the Stop hook finds each campaign's pipeline state through the `settings` array this skill writes into `conventions.json`.`

Line 63: replace

```
Ignored, as derived or transient: `.professor-orb/pipeline-state.json`, `.professor-orb/proposals/`, `.professor-orb/tag-registry*.json`, `**/.obsidian/workspace*.json`, `**/.obsidian/plugins/`.
```

with

```
Ignored, as derived or transient: `.professor-orb/proposals/`, `.professor-orb/tag-registry*.json`, `**/.obsidian/workspace*.json`, `**/.obsidian/plugins/`.
```

Delete line 174 entirely (the `- **`pipeline-state.json`**: an empty initial state, `{}`. ...` bullet).

Line 179: replace

```
Then delete `.professor-orb/conventions.json.pre-migration` and, if Step 4 converted it, the old `.professor-orb/catalog-versioning.json`. The snapshot captured both.
```

with

```
Then delete `.professor-orb/conventions.json.pre-migration`, a legacy `.professor-orb/pipeline-state.json` (with `git rm` if it is tracked), and, if Step 4 converted it, the old `.professor-orb/catalog-versioning.json`. The snapshot captured each of them. The legacy `pipeline-state.json` is the one shared breadcrumb from before 1.20.0: it names no campaign, so it cannot be converted, and each campaign's pipeline skills now write their own in `<sessionReportsRoot>/<campaign>/`.
```

(the sentence after it, `` `versioning.json` itself is never regenerated here... ``, stays).

Line 264: replace `whether the workflows copied successfully, and, on a first-time setup, that `pipeline-state.json` was initialized empty.` with `and whether the workflows copied successfully.`, so the sentence reads `...the number of rules and their enforcement levels, and whether the workflows copied successfully.`

- [ ] **Step 5: README lines 14 and 60**

Line 14: replace `Setup also produces the rest of `.professor-orb/`: `pipeline-state.json` (a breadcrumb of the last completed pipeline step), `tag-registry.json` (a tag inventory for drift tracking),` with `Setup also produces the rest of `.professor-orb/`: `tag-registry.json` (a tag inventory for drift tracking),`.

Line 60: replace `and none of them write `pipeline-state.json`.` with `and none of them write pipeline state.`

- [ ] **Step 6: CONTEXT.md**

Replace the **pipeline state** entry:

```
**pipeline state**:
A small breadcrumb file in `.professor-orb/` recording where the session pipeline
stands (e.g., "debrief done for 2026-07-08, chronicler pending"). Each pipeline
skill's final act is updating it. Read by two consumers: the Stop hook (a
deterministic `command` script that prints the next-step suggestion after a
pipeline skill finishes and stays silent otherwise) and any fresh session
answering "where were we?". No model judgment anywhere in the path: the hook
either fires correctly or says nothing.
_Avoid_: "the nag", prompt-type Stop hooks in any form
```

with:

```
**pipeline state**:
A small breadcrumb file per campaign, `<sessionReportsRoot>/<campaign>/pipeline-state.json`,
recording the last pipeline step that completed for that campaign, the date of the
session report it worked from, and when. Each pipeline skill's final act is
rewriting its own campaign's file, and no skill reads another run's state. The file
sits in the campaign's lane, so `/log` carries it to main with the work it describes,
and two campaigns never write the same file. Read by two consumers: the Stop hook (a
deterministic `command` script that prints one next-step line per campaign updated in
the last two hours and stays silent otherwise) and any fresh session answering "where
were we?". No model judgment anywhere in the path: the hook either fires correctly or
says nothing. Before 1.20.0 it was one shared file in `.professor-orb/`, which setup's
resync deletes.
_Avoid_: "the nag", prompt-type Stop hooks in any form, one state file for every campaign
```

In the **log command** entry, replace:

```
stages into the campaign's `articles/` staging area on a session-driven run.
Authors none of it.
```

with:

```
stages into the campaign's `articles/` staging area on a session-driven run, plus
the campaign's pipeline state, which the pipeline skills rewrite as their last act.
Authors none of it.
```

- [ ] **Step 7: Run the hook suites**

Run: `node professor-orb/hooks/pipeline-next.test.mjs`
Expected: exit 0 (prose changes must not touch hook behaviour).

- [ ] **Step 8: Verify every remaining mention of the old path is intentional**

Run: `grep -rln "\.professor-orb/pipeline-state" professor-orb`
Expected: exactly these three files, each mentioning only the legacy file:
- `professor-orb/hooks/pipeline-next.mjs` (the "Before 1.20.0" header paragraph)
- `professor-orb/hooks/pipeline-next.test.mjs` (the `runHook` doc comment and the legacy-root-state case)
- `professor-orb/skills/setup/SKILL.md` (the Step 12 deletion)

Run: `grep -rln "pipeline-state.json" professor-orb --include=*.md`
Expected: exactly these files, and in each one every mention is the per-campaign path or (setup only) the legacy deletion:
- `professor-orb/README.md` (line 58)
- `professor-orb/CONTEXT.md` (**pipeline state**)
- `professor-orb/commands/log.md` (Steps 3 and 6)
- `professor-orb/skills/SHARED-PRINCIPLES.md` (§10)
- `professor-orb/skills/chronicler/SKILL.md`, `content/SKILL.md`, `debrief/SKILL.md`, `prep/SKILL.md` (final acts)
- `professor-orb/skills/orb/SKILL.md` (description, line 14, "What to run next")
- `professor-orb/skills/setup/SKILL.md` (the Step 12 deletion)

Any other file in that list still describes the shared file: fix it.

- [ ] **Step 9: Commit**

```bash
git add professor-orb/skills/orb/SKILL.md professor-orb/skills/setup/SKILL.md professor-orb/commands professor-orb/skills/homebrew/SKILL.md professor-orb/skills/timeline/SKILL.md professor-orb/skills/forge-prompt/SKILL.md professor-orb/README.md professor-orb/CONTEXT.md
git commit -m "feat(professor-orb): orb, setup, and /log follow per-campaign state

orb answers \"where were we?\" per campaign. setup stops writing the shared
{} file, stops ignoring pipeline state, and deletes the legacy file on a
resync. /log names the state file as part of the lane and exempts it from the
surprise guard, which would otherwise stop on a JSON file in every commit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: chronicler takes a declined lore item off the list

Prose only. Step 7 is a grep check.

**Files:**
- Modify: `professor-orb/skills/chronicler/SKILL.md` (Step 1b, Step 1c template and hand-edit note, Step 1d, new Step 1e, Step 2b item 7, Step 2e, never-do list, connections)
- Modify: `professor-orb/CONTEXT.md` (**proposal file**)

**Interfaces:**
- Consumes: the Lore Candidates and Lore Resolution checkbox shape shown in chronicler Step 2b and prep Section 5.
- Produces: proposal section `## 7. Lore Items to Remove (count)` with columns `Item | Carrier(s) | DM's reason`.

- [ ] **Step 1: Step 1b gains bucket 8**

After bucket 7 (`7. **Lore items to mark resolved.** ...`), add:

```
8. **Lore items to remove.** Items the DM has declined for good, each with its carrier or carriers and the DM's reason in their own words. Empty when you first draft: an item reaches this bucket only through Step 1d, or when the DM moves it here by hand. Step 2b's write-back deletes each one from its carriers, which is what keeps a declined item from coming back: `prep` builds its Lore Resolution section from the unticked items it finds, and a deleted item is not there to find.
```

- [ ] **Step 2: Step 1c template and hand-edit note**

In the proposal template, between the section 6 table and `## Deferred / Flagged`, insert:

```
## 7. Lore Items to Remove (count)
| Item | Carrier(s) | DM's reason |
|------|-----------|-------------|
```

Replace the hand-edit paragraph:

```
**The DM may edit the file directly.** Tell the DM they can revise the file by hand at the absolute path you gave (reword a summary, cut a row, change a target folder) instead of dictating changes back through chat. Either path is fine. What matters is that the file on disk, not the conversation, is what Phase 2 executes.
```

with:

```
**The DM may edit the file directly.** Tell the DM they can revise the file by hand at the absolute path you gave (reword a summary, cut a row, change a target folder) instead of dictating changes back through chat. Either path is fine. What matters is that the file on disk, not the conversation, is what Phase 2 executes. Tell them, too, that cutting a lore item has two forms: deleting its rows takes it out of this pass and leaves it open for a later one, and moving its section 6 row into section 7 (with a reason) takes it off the list for good.
```

After the approval-question paragraph (`**Ask for approval as a structured decision.** ...`), add:

```
A rejection goes to Step 1e.
```

- [ ] **Step 3: Step 1d handles a cut item**

At the end of Step 1d, after `Do not proceed to Phase 2 until the DM has given a clear approval signal for the current state of the file.`, add:

```
**When the DM cuts a lore item in chat**, during review or a walk-through, ask with AskUserQuestion whether it is off the list for good or only out of this pass, naming the item in the question itself (Principle 15).

- **Off the list for good.** Delete its rows from sections 1 through 6 and add a section 7 row: the item, its carrier or carriers, and the DM's reason in their own words. If they gave no reason, ask for one in chat; "none given" is an acceptable answer.
- **Out of this pass only.** Delete its rows and add nothing. The Lore Candidate stays unticked, and `prep` carries it forward as it carries any open item.
```

- [ ] **Step 4: New Step 1e for a rejected proposal**

Insert after Step 1d, before `### Phase 2: Execute`:

```
#### Step 1e: If the DM rejects the proposal

A rejection ends the run without Phase 2. Before it ends:

1. Set the proposal file's Status line to `Rejected YYYY-MM-DD: <the DM's reason in their words>`, with today's date, or `Rejected YYYY-MM-DD` if they gave no reason.
2. Ask once, with AskUserQuestion, what happens to the lore items the proposal covered, stating in the question how many there are and naming them if there are few (Principle 15). Offer: take them all off the list for good, keep them all for a later pass, or decide item by item in chat.
3. Delete each item coming off the list from every carrier, exactly as Step 2b deletes a section 7 row. Leave the items kept for later as they are.
4. Report back which items came off and from which carriers, naming any carrier that was missing. Write no articles, indexes, or log entries, and skip the final pipeline-state step: no pipeline step completed.
```

- [ ] **Step 5: Step 2b executes section 7; Step 2e reports it**

In Step 2b, replace the start of item 7:

```
7. **Mark resolved lore items last**, once every article they refer to exists.
```

with:

```
7. **Mark resolved lore items and remove declined ones last**, once every article they refer to exists.
```

After item 7's existing closing paragraph (`...the point of the record is that nobody is later unsure whether the work was done.`), add, indented to match item 7:

```
   For each row of section 7, "Lore Items to Remove", delete the item's line, and any resolution-note line indented beneath it, from every carrier that holds it: the session report's Lore Candidates section and the prep brief's Lore Resolution section. A missing carrier is named in the report-back, exactly as for resolved items, and never fails the run.
```

In Step 2e's report block, after the `**Lore items marked resolved (N):** ...` line, add:

```
**Lore items removed (N):** [list, naming any carrier that was missing]
```

- [ ] **Step 6: Never-do rule, connections, and CONTEXT.md**

In "Things to never do", replace:

```
You may update **work-tracking state** in them, and only that: ticking a lore item's checkbox in the report's Lore Candidates section or the brief's Lore Resolution section and appending the one-line resolution note.
```

with:

```
You may update **work-tracking state** in them, and only that: ticking a lore item's checkbox in the report's Lore Candidates section or the brief's Lore Resolution section and appending the one-line resolution note, or deleting an item the DM declined for good (a section 7 row, or an item taken off the list at Step 1e).
```

In "How this skill connects to the others", in the **Outputs** bullet, replace `and work-tracking state updates marking lore items resolved in the source report and prep brief.` with `and work-tracking state updates in the source report and prep brief: marking lore items resolved, and removing the ones the DM declined for good.`

In `professor-orb/CONTEXT.md`, in the **proposal file** entry, replace:

```
re-deriving intent from the discussion. What you approved is what lands on disk.
```

with:

```
re-deriving intent from the discussion. What you approved is what lands on disk.
A lore item the DM declines for good goes in the file's section 7 and is deleted
from the report and the brief at execution, so `prep` never carries it forward.
```

- [ ] **Step 7: Verify the structure**

Run: `grep -n "## 7. Lore Items to Remove\|Step 1e\|Lore items removed\|declined for good" professor-orb/skills/chronicler/SKILL.md`
Expected, at least: the `## 7. Lore Items to Remove` template heading, the `#### Step 1e` heading, Step 1c's "A rejection goes to Step 1e.", the never-do rule's Step 1e mention, the `**Lore items removed (N):**` report-back line, and bucket 8 in Step 1b.

- [ ] **Step 8: Commit**

```bash
git add professor-orb/skills/chronicler/SKILL.md professor-orb/CONTEXT.md
git commit -m "feat(professor-orb): chronicler takes a declined lore item off the list

The approval question offered \"reject\" and nothing said what happened next,
so a turned-down item stayed unticked and prep carried it forward as open work.
A proposal now has section 7, Lore Items to Remove, which the write-back
deletes from the report and brief; Step 1e handles a whole-proposal rejection.
An item set aside for later stays unticked, which prep already carries.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Release 1.20.0

**Files:**
- Modify: `.claude-plugin/marketplace.json:11`
- Modify: `professor-orb/.claude-plugin/plugin.json:4`
- Modify: `docs/superpowers/specs/2026-09-21-professor-orb-campaign-state-and-declined-lore-design.md` (only if implementation forced an amendment)

- [ ] **Step 1: Run every suite**

Run: `for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done`
Expected: every suite exits 0; the loop does not break early.

- [ ] **Step 2: Bump both versions**

In `.claude-plugin/marketplace.json`, `"version": "1.19.0"` becomes `"version": "1.20.0"`. In `professor-orb/.claude-plugin/plugin.json`, the same.

Run: `grep -n '"version"' .claude-plugin/marketplace.json professor-orb/.claude-plugin/plugin.json`
Expected: both show `1.20.0`.

- [ ] **Step 3: Record any amendment the implementation forced**

If any task had to depart from the spec, append a `## Amendments at implementation` section to the spec naming each departure and why, as the 1.19.0 release did. If none, skip this step.

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/marketplace.json professor-orb/.claude-plugin/plugin.json docs/superpowers/specs/2026-09-21-professor-orb-campaign-state-and-declined-lore-design.md
git commit -m "chore(professor-orb): 1.20.0

Upgrading an existing project: run setup's resync (restores scope on the
structural rules, deletes the legacy .professor-orb/pipeline-state.json), and
delete any leftover .professor-orb/asked-options.json by hand. See the spec's
upgrade section.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
