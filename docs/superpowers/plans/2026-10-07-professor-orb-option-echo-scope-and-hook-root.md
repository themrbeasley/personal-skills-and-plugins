# professor-orb 1.22.1: option-echo scope, hook project root, prep save question Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four defects in the 2026-10-07 professor-orb report: hooks that lose the project from a subfolder, an option-echo check that blocks prep briefs and re-reads untouched text, and a prep research question that reads as though no research happened.

**Architecture:** One new shared module, `hooks/project-root.mjs`, gives all five hooks the same project lookup. `validate-write.mjs` gains a prep-brief exemption and an Edit-only sentence filter, both inside `checkOptionEcho`. `skills/prep/SKILL.md` merges Steps 3a and 3b into one save question.

**Tech Stack:** Node.js built-ins only (ES modules), no test framework. Markdown skill files.

**Spec:** `docs/superpowers/specs/2026-10-07-professor-orb-option-echo-scope-and-hook-root-design.md`

## Status

| Task | State |
| --- | --- |
| 1. Hooks find the project from any folder | not started |
| 2. Prep briefs skip the option-echo check | not started |
| 3. On an Edit, check only the sentences it wrote | not started |
| 4. Prep asks once to save | not started |
| 5. Release 1.22.1 and live check | not started |

## Global Constraints

- No em dashes, and no double-hyphen stand-ins, in any text written: code comments, docs, commit messages.
- Node built-ins only. No new dependency.
- Comment blocks in the hooks are load-bearing: update the comment when the rule under it changes.
- Version `1.22.1` in both `professor-orb/.claude-plugin/plugin.json` and the professor-orb entry of `.claude-plugin/marketplace.json`; they must match.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Stage with `:(literal)` pathspecs.
- Run a suite: `node professor-orb/hooks/<name>.test.mjs`. All suites: `for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done`.

## Review Focus

1. **A worktree nested inside the main checkout** (rolara's layout): the lookup must stop at the worktree's own `.professor-orb`, never the checkout around it. Pinned in Task 1, `project-root.test.mjs`.
2. **A folder with no professor-orb above it** (any unrelated project): the hooks must behave exactly as today. Pinned in Task 1, `project-root.test.mjs`.
3. **A content Grep with no path from a folder outside every prong:** the guard must over-block, never under-block. Pinned in Task 1, `block-excluded.test.mjs`.
4. **An Edit that touches only the frontmatter:** no body sentence is new, so no echo block. Pinned in Task 3.
5. **An Edit whose `new_string` is no longer in the file** (something changed it after the edit): the whole body is checked, as today. Pinned in Task 3.

---

### Task 1: Hooks find the project from any folder

**Files:**
- Create: `professor-orb/hooks/project-root.mjs`
- Create: `professor-orb/hooks/project-root.test.mjs`
- Modify: `professor-orb/hooks/validate-write.mjs` (imports; `main()` around lines 1239-1267)
- Modify: `professor-orb/hooks/record-options.mjs:47-50`
- Modify: `professor-orb/hooks/block-excluded.mjs` (`grepLeakMode` signature and its Grep-default comment; `main()` around lines 228-326)
- Modify: `professor-orb/hooks/dm-correction.mjs:392-420`
- Modify: `professor-orb/hooks/pipeline-next.mjs` (header comment; `main()` lines 143-165)
- Test: `professor-orb/hooks/option-echo.test.mjs`, `record-options.test.mjs`, `block-excluded.test.mjs`, `dm-correction.test.mjs`, `pipeline-next.test.mjs`

**Interfaces:**
- Produces: `export function projectRootFrom(dir: string): string`, the nearest folder at or above `dir` holding `.professor-orb`, else `path.resolve(dir)`.
- Produces: `runValidator(dir, file, transcript, sessionId = "s1", extra = {})` in `option-echo.test.mjs`, where `extra` is `{ toolName?, toolInput?, cwd? }`. Tasks 2 and 3 use it.

- [ ] **Step 1: Write the failing tests**

Create `professor-orb/hooks/project-root.test.mjs`:

```js
#!/usr/bin/env node
// Checks projectRootFrom, the lookup every professor-orb hook uses to find the
// project it serves.
//
// Run: node professor-orb/hooks/project-root.test.mjs

import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { projectRootFrom } from "./project-root.mjs";

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  if (actual === expected) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failures.push(name);
    console.log(`  [FAIL] ${name}: expected ${expected}, got ${actual}`);
  }
}

const base = path.join(os.tmpdir(), `orb-root-${process.pid}`);
rmSync(base, { recursive: true, force: true });

// A worktree that is a project of its own, inside a checkout that is one too:
// the layout of every rolara worktree session.
const outer = path.join(base, "outer");
const inner = path.join(outer, ".claude", "worktrees", "wt");
mkdirSync(path.join(outer, ".professor-orb"), { recursive: true });
mkdirSync(path.join(inner, ".professor-orb"), { recursive: true });
mkdirSync(path.join(inner, "session-reports", "w", "Camp"), { recursive: true });
const bare = path.join(base, "bare", "sub");
mkdirSync(bare, { recursive: true });

check("the project root finds itself", projectRootFrom(inner), inner);
check("a campaign folder climbs to its project", projectRootFrom(path.join(inner, "session-reports", "w", "Camp")), inner);
check("a worktree stops at its own project, not the checkout around it", projectRootFrom(path.join(inner, "session-reports")), inner);
check("a folder with no project above it comes back unchanged", projectRootFrom(bare), bare);

rmSync(base, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
```

In `professor-orb/hooks/option-echo.test.mjs`, replace the comment above `runValidator` and the function itself with:

```js
// Returns { blocked: boolean, output: string }. validate-write signals a block
// with exit 2 and stderr; a pass or warn exits 0. A default parameter fires on
// an explicitly passed undefined as much as on an omitted argument, so
// "session_id absent, the shape of an older harness" needs its own sentinel:
// pass sessionId: null to omit the field from the payload entirely. Every
// other call site either omits the argument (gets "s1") or passes a real id.
// extra: { toolName, toolInput, cwd } for a case that is not a Write made from
// the project root.
function runValidator(dir, file, transcript, sessionId = "s1", extra = {}) {
  const payload = {
    hook_event_name: "PostToolUse",
    tool_name: extra.toolName || "Write",
    cwd: extra.cwd || dir,
    transcript_path: transcript,
    tool_input: { file_path: file, ...(extra.toolInput || {}) },
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

In the same file, insert before `console.log("fail-silent contract:");`:

```js
console.log("a save made from a subfolder is checked like one from the root:");
(function () {
  // 2026-10-07: the shell sat in a campaign folder, the hook looked for
  // conventions.json there, found none, and ran no rule at all.
  const { dir, file, transcript } = fixture("subfolder", LAUNDERED, OFFERED, "we wrapped up at the warehouse, pretty short night");
  const sub = path.join(dir, "session-reports", "adjustice", "clean-hands");
  check("the 09-18 case blocks from the campaign folder", runValidator(dir, file, transcript, "s1", { cwd: sub }).blocked, true);
  rmSync(dir, { recursive: true, force: true });
})();
```

In `professor-orb/hooks/record-options.test.mjs`, change `run` to take the working folder:

```js
function run(dir, sessionId, questions, cwd = dir) {
  const tmp = path.join(dir, "tmp");
  execFileSync("node", [HOOK], {
    input: JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "AskUserQuestion",
      session_id: sessionId,
      cwd,
      tool_input: { questions },
    }),
    encoding: "utf8",
    env: { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp },
  });
}
```

and insert before `console.log("fail-silent contract:");`:

```js
console.log("a question asked from a subfolder is recorded:");
(function () {
  // 2026-10-07: three question rounds asked while the shell sat in a campaign
  // folder never reached the record, so optionEcho had nothing to compare.
  const dir = fixture("subfolder");
  const sub = path.join(dir, "session-reports", "w", "Camp");
  mkdirSync(sub, { recursive: true });
  run(dir, "s1", ASKED, sub);
  check("the options are recorded", state(dir, "s1") !== null, true);
  rmSync(dir, { recursive: true, force: true });
})();
```

In `professor-orb/hooks/block-excluded.test.mjs`, give `runHook` a `cwdRel` option: change its signature to
`function runHook({ conventions, files, targetRel, toolName = "Read", pathKey = "file_path", cwdRel = "" })`
and its payload's `cwd: dir,` to `cwd: cwdRel ? path.join(dir, cwdRel) : dir,`.

Give `runGrep` the same option, leaving a relative path relative when it is set:

```js
function runGrep({ conventions, files, toolInput, targetRel, cwdRel = "" }) {
  const dir = path.join(os.tmpdir(), `orb-excl-grep-${process.pid}-${Math.abs(hashOf(targetRel))}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  if (conventions !== null) {
    const abs = path.join(dir, ".professor-orb", "conventions.json");
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, JSON.stringify(conventions, null, 2), "utf8");
  }
  // With cwdRel set, a relative path stays relative, as Grep receives it.
  const resolved = { ...toolInput };
  if (typeof resolved.path === "string" && !cwdRel) resolved.path = path.join(dir, resolved.path);
  const cwd = cwdRel ? path.join(dir, cwdRel) : dir;
  const payload = JSON.stringify({ cwd, tool_name: "Grep", tool_input: resolved });
  try {
    const out = execFileSync("node", [HOOK], { input: payload, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "").trim(), err: (e.stderr || "").trim() };
  }
}
```

and insert before the final `console.log(\`\n${passed}/...` line:

```js
console.log("=== from a subfolder ===");

{
  // 2026-10-07: from a subfolder the hook found no conventions.json and fell
  // back to its built-in tag, so a project's own tag went unchecked.
  const r = runHook({
    conventions: CONVENTIONS,
    files: { "settings/w/people/A.md": tagged("Excluded") },
    targetRel: "settings/w/people/A.md",
    cwdRel: "settings/w",
  });
  check("an article with the project's own tag is denied from a subfolder", r.code, 2);
}

{
  // A relative Grep path resolves from the working folder, as Grep resolves it.
  const r = runGrep({
    conventions: CONVENTIONS,
    files: { "session-reports/w/c/A.md": plain },
    toolInput: { pattern: "x", path: "w", output_mode: "content" },
    targetRel: "grep-relative-from-subfolder",
    cwdRel: "session-reports",
  });
  check("a content grep given a relative prong path from a subfolder is denied", r.code, 2);
}

{
  // With no path, Grep searches the working folder. The hook measures from the
  // project root instead, which can only over-block, never under-block.
  const r = runGrep({
    conventions: CONVENTIONS,
    files: { "settings/w/people/A.md": plain, "docs/notes.md": "notes\n" },
    toolInput: { pattern: "x", output_mode: "content" },
    targetRel: "grep-no-path-from-docs",
    cwdRel: "docs",
  });
  check("a content grep with no path from a folder outside every prong is still denied", r.code, 2);
}
```

In `professor-orb/hooks/dm-correction.test.mjs`, insert before the closing `console.log(\`\n${passed} passed, ${failures.length} failed\`);`:

```js
console.log("a correction sent from a subfolder searches the whole project:");
(function () {
  // 2026-10-07: from a subfolder the hook found no conventions.json, searched
  // nothing, and said no line matched.
  const dir = project(
    "subfolder",
    [{ name: "adjustice", kbRoot: "kb/adjustice", sessionReportsRoot: "session-reports/adjustice" }],
    {
      "session-reports/adjustice/clean-hands/2026-09-18-Clean-Hands-REPORT.md": md(
        "Session Report",
        "The reporter asked what the team was called, and they answered on camera."
      ),
    }
  );
  const said = "That NEVER happened, the reporter never asked what the team was called";
  const fromRoot = runHook(said, dir);
  const fromSub = runHook(said, path.join(dir, "session-reports", "adjustice", "clean-hands"));
  report(
    [
      ["finds the line from the subfolder", fromSub.includes("The reporter asked what the team was called"), true],
      ["prints exactly what it prints from the root", fromSub === fromRoot, true],
    ],
    fromSub
  );
  rmSync(dir, { recursive: true, force: true });
})();
```

In `professor-orb/hooks/pipeline-next.test.mjs`, give `runHook` a `fromRel` option: add `fromRel` to the destructured options (`{ pipelineState, states, conventions = DEFAULT_CONVENTIONS, legacyState, versioning, legacyVersioning, fromRel } = {}`) and change its `execFileSync` call's `cwd: dir` to `cwd: fromRel ? path.join(dir, ...fromRel.split("/")) : dir`. Then insert before the final `report();`:

```js
// 2026-10-07: run from a campaign folder, the hook found no conventions.json
// and suggested nothing.
{
  const r = runHook("from-subfolder", { pipelineState: freshState("debrief"), fromRel: "session-reports/rolara/Camp" });
  checkContains("run from a campaign folder, it still suggests the next step", r.out, "Next: /prep", true);
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run each: `node professor-orb/hooks/project-root.test.mjs` (fails: module not found), then `option-echo`, `record-options`, `block-excluded`, `dm-correction`, `pipeline-next`.
Expected: each new case FAILs (a subfolder run is silent or finds nothing); every existing case still PASSes. The two Grep cases already pass (the hook fails closed today); they pin the resolution for Step 3.

- [ ] **Step 3: Implement**

Create `professor-orb/hooks/project-root.mjs`:

```js
// The project a hook serves: the nearest folder at or above the session's
// working folder that holds .professor-orb.
//
// Every hook used to take the working folder itself as the project root. The
// working folder follows the session's shell, and a `cd` into a campaign
// folder moves it there. On 2026-10-07 that left validate-write finding no
// conventions.json and running no rule, while the same text blocked once the
// shell was back at the root. A folder with no .professor-orb above it comes
// back unchanged, so a project that never ran setup behaves exactly as before.
//
// Nearest wins: a worktree under .claude/worktrees/ carries its own
// .professor-orb and must never resolve to the checkout around it.

import { existsSync } from "node:fs";
import path from "node:path";

export function projectRootFrom(dir) {
  const start = path.resolve(dir);
  for (let at = start; ; at = path.dirname(at)) {
    if (existsSync(path.join(at, ".professor-orb"))) return at;
    if (path.dirname(at) === at) return start;
  }
}
```

`professor-orb/hooks/validate-write.mjs`: add `import { projectRootFrom } from "./project-root.mjs";` after the `node:os` import. In `main()`, replace

```js
  const projectRoot =
    typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : process.cwd();
```

with

```js
  // cwd follows the session's shell and can be any folder inside the project;
  // projectRootFrom climbs from it to the project. A path the tool call
  // supplied resolves from cwd, as the harness resolves it.
  const cwd = typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : process.cwd();
  const projectRoot = projectRootFrom(cwd);
```

and `const absFilePath = path.resolve(projectRoot, filePath);` with `const absFilePath = path.resolve(cwd, filePath);`.

`professor-orb/hooks/record-options.mjs`: add `import { projectRootFrom } from "./project-root.mjs";` after the `node:path` import, and replace lines 47-50 with:

```js
  const cwd = typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : process.cwd();
  // Setup never ran, so professor-orb is not in use here and there is no
  // report for the record to protect.
  if (!existsSync(path.resolve(projectRootFrom(cwd), ".professor-orb"))) process.exit(0);
```

`professor-orb/hooks/block-excluded.mjs`: add the same import. In `main()`, replace

```js
  const projectRoot =
    typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : process.cwd();
```

with

```js
  // cwd follows the session's shell; the conventions and prong roots belong to
  // the project above it. A path the tool call supplied resolves from cwd, as
  // the harness resolves it.
  const cwd = typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : process.cwd();
  const projectRoot = projectRootFrom(cwd);
```

Change `grepLeakMode(toolInput, projectRoot, roots)` to `grepLeakMode(toolInput, cwd, projectRoot, roots)` at its definition and its one call. Inside it, replace the comment and `searchPath` block with:

```js
  // Grep searches the working folder when path is omitted. That folder sits at
  // or below the project root, so measuring from the root can only over-block.
  const searchPath =
    typeof toolInput.path === "string" && toolInput.path
      ? path.resolve(cwd, toolInput.path)
      : projectRoot;
```

In `main()`, change `statSync(path.resolve(projectRoot, toolInput.path))` to `statSync(path.resolve(cwd, toolInput.path))` and `const absFilePath = path.resolve(projectRoot, target);` to `const absFilePath = path.resolve(cwd, target);`. Leave `path.relative(projectRoot, absFilePath)` in the denial message as it is.

`professor-orb/hooks/dm-correction.mjs`: add the same import. Replace line 392 with

```js
  // cwd follows the session's shell; the search covers the project above it.
  const projectRoot = projectRootFrom(typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : process.cwd());
```

and change the four later uses in `main()` (`readConventions(cwd)`, `laneRoots(conventions, cwd)`, `path.relative(cwd, r)`, `path.relative(cwd, hit.file)`) to `projectRoot`.

`professor-orb/hooks/pipeline-next.mjs`: add the same import. In the header comment, change "reads .professor-orb/conventions.json from the current working directory" to "reads .professor-orb/conventions.json from the project holding the current working directory". In `main()`, replace `const cwd = process.cwd();` with `const projectRoot = projectRootFrom(process.cwd());` and change the four later uses of `cwd` in `main()` to `projectRoot`.

- [ ] **Step 4: Run the tests to verify they pass**

Run the six suites from Step 2.
Expected: every case PASSes.

- [ ] **Step 5: Commit**

```bash
git add -- ":(literal)professor-orb/hooks/project-root.mjs" ":(literal)professor-orb/hooks/project-root.test.mjs" ":(literal)professor-orb/hooks/validate-write.mjs" ":(literal)professor-orb/hooks/record-options.mjs" ":(literal)professor-orb/hooks/block-excluded.mjs" ":(literal)professor-orb/hooks/dm-correction.mjs" ":(literal)professor-orb/hooks/pipeline-next.mjs" ":(literal)professor-orb/hooks/option-echo.test.mjs" ":(literal)professor-orb/hooks/record-options.test.mjs" ":(literal)professor-orb/hooks/block-excluded.test.mjs" ":(literal)professor-orb/hooks/dm-correction.test.mjs" ":(literal)professor-orb/hooks/pipeline-next.test.mjs"
git commit -m "fix(professor-orb): every hook finds the project from any folder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Prep briefs skip the option-echo check

**Files:**
- Modify: `professor-orb/hooks/validate-write.mjs` (`checkOptionEcho` and the comment block above it, around lines 845-877)
- Modify: `professor-orb/references/base-rules.json:149`
- Modify: `professor-orb/skills/setup/references/conventions-schema.md:526`
- Test: `professor-orb/hooks/option-echo.test.mjs`

**Interfaces:**
- Consumes: `runValidator(dir, file, transcript, sessionId, extra)` and `fixture(...)` from `option-echo.test.mjs`.

- [ ] **Step 1: Write the failing test**

In `professor-orb/hooks/option-echo.test.mjs`, insert after the "the homebrew catalog is exempt" block:

```js
// The 2026-10-07 North Star 1 and the option it was drawn from, verbatim from
// that session's options record and block message.
const NORTH_STAR_OPTION =
  "Horatio at Large Luigi's. Last session: Zelex drew Donjon and vanished. Next: Jace's Giff Drunken Master, Horatio Fastfist, meets the party at Large Luigi's Happy Beholder while they wait on Gwen.";
const NORTH_STAR =
  "**Last session:** Zelex drew Donjon and vanished, and Jace's new PC was set to meet the party at Large Luigi's Happy Beholder while they wait on Gwen.";

console.log("prep briefs are exempt:");
(function () {
  // Prep writes a north star in the same two-part form as the option the DM
  // picked it from, so it echoes that option by construction. The same
  // sentence in a report still blocks.
  const { dir, file, transcript } = fixture("prep", NORTH_STAR, [NORTH_STAR_OPTION], "let's prep tonight");
  check("the north star blocks in a report", runValidator(dir, file, transcript).output.includes("contentOptionEcho"), true);
  const brief = path.join(dir, "session-reports", "adjustice", "clean-hands", "prep", "2026-10-07-TBD-PREP.md");
  mkdirSync(path.dirname(brief), { recursive: true });
  writeFileSync(brief, ["---", "type: Session Prep", "---", "", NORTH_STAR, ""].join("\n"));
  check("the same north star passes in a prep brief", runValidator(dir, brief, transcript).output.includes("contentOptionEcho"), false);
  rmSync(dir, { recursive: true, force: true });
})();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node professor-orb/hooks/option-echo.test.mjs`
Expected: "the north star blocks in a report" PASSes; "the same north star passes in a prep brief" FAILs.

- [ ] **Step 3: Implement**

In `professor-orb/hooks/validate-write.mjs`, replace the comment paragraph that begins `// The homebrew prong is exempt.` and ends `// project.` (directly above `function checkOptionEcho`) with:

```js
// Two places are exempt: the homebrew prong and prep briefs. This check guards
// records of what happened, where an option only points at a topic. In both
// exempt places the option IS the decision. The homebrew skill routes every
// structured rules call through AskUserQuestion, and /catalog runs on text the
// DM already confirmed; on 2026-09-29 this check blocked a spell entry whose
// rule the DM had picked, reviewed, and cataloged, and no confirmation could
// clear it. Prep writes each north star the DM picks from report-drawn options
// in the same "Last session / Next" form as the option, so on 2026-10-07 this
// check blocked a brief's first north star by construction. A brief is a plan,
// and nothing downstream reads it as a record: chronicler takes only its Lore
// Resolution list.
//
// Prep is NOT exempted by accepting a sentence whose words appear in an earlier
// session report. Containment cannot tell planned from happened: a report line
// saying someone "meets the party next session" would let a later report say
// they met the party, which is the 2026-09-18 failure again.
//
// Both exemptions live here rather than as a rule `scope` because setup's
// resync detects drift by rule ID only, so a changed scope would never reach
// an installed project.
const PREP_BRIEF = /-PREP\.md$/i;
```

and in `checkOptionEcho`, after `if (ctx.prongKind === "homebrew") return true;`, add:

```js
  if (ctx.prongKind === "session-reports" && PREP_BRIEF.test(ctx.fileName)) return true;
```

In `professor-orb/references/base-rules.json`, change the `contentOptionEcho` description to:

```json
      "description": "Outside the homebrew catalog and prep briefs, a sentence restating a question option this session offered appears in the DM's own prose before it is written.",
```

In `professor-orb/skills/setup/references/conventions-schema.md`, in the `optionEcho` row, replace

`Skips the homebrew prong entirely, since a homebrew design settles its rules by option and `/catalog` runs on DM-confirmed text.`

with

`Skips the homebrew prong entirely, since a homebrew design settles its rules by option and `/catalog` runs on DM-confirmed text, and skips prep briefs (a `-PREP.md` file in `sessionReportsRoot`), which are plans whose scenes the DM picks from options.`

- [ ] **Step 4: Run the test to verify it passes**

Run: `node professor-orb/hooks/option-echo.test.mjs` and `node professor-orb/hooks/validate-write.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add -- ":(literal)professor-orb/hooks/validate-write.mjs" ":(literal)professor-orb/hooks/option-echo.test.mjs" ":(literal)professor-orb/references/base-rules.json" ":(literal)professor-orb/skills/setup/references/conventions-schema.md"
git commit -m "fix(professor-orb): prep briefs skip the option-echo check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: On an Edit, check only the sentences it wrote

**Files:**
- Modify: `professor-orb/hooks/validate-write.mjs` (new `priorBodyOfEdit` in the Option echo section; `checkOptionEcho` sentence loop; `main()` ctx)
- Modify: `professor-orb/skills/setup/references/conventions-schema.md:526`
- Test: `professor-orb/hooks/option-echo.test.mjs`

**Interfaces:**
- Consumes: `runValidator(..., extra)` from Task 1.
- Produces: `ctx.priorBody: string | null` (the body before an Edit; null means check the whole body).

- [ ] **Step 1: Write the failing tests**

In `professor-orb/hooks/option-echo.test.mjs`, insert before `console.log("fail-silent contract:");`:

```js
console.log("an edit is checked only where it wrote:");
(function () {
  // 2026-10-07: a one-line edit to a session report was blocked over a
  // sentence the debrief wrote a week before the option it was matched
  // against, an option written from that very sentence.
  const said = "we wrapped up at the warehouse, pretty short night";
  // Writes the report as it stood before the edit, applies the edit on disk,
  // and runs the validator with the Edit payload. Returns whether the
  // option-echo rule fired.
  function echoAfterEdit(name, beforeBody, oldString, newString, opts = {}) {
    const f = fixture(name, beforeBody, OFFERED, said);
    const before = readFileSync(f.file, "utf8");
    let after = opts.replaceAll ? before.split(oldString).join(newString) : before.replace(oldString, newString);
    if (opts.crlf) after = after.replace(/\n/g, "\r\n");
    writeFileSync(f.file, after);
    const r = runValidator(f.dir, f.file, f.transcript, "s1", {
      toolName: "Edit",
      toolInput: { old_string: oldString, new_string: newString, replace_all: opts.replaceAll === true },
    });
    rmSync(f.dir, { recursive: true, force: true });
    return r.output.includes("contentOptionEcho");
  }

  const cases = [
    ["an unrelated line added to a report already holding an echo passes",
      [LAUNDERED + "\n\nThe crew went home.", "The crew went home.", "The crew went home after midnight."], false],
    ["an edit that adds the echo blocks",
      ["The crew went home.", "The crew went home.", "The crew went home.\n\n" + LAUNDERED], true],
    ["a deletion passes",
      [LAUNDERED + "\n\nThe crew went home.", "\n\nThe crew went home.", ""], false],
    ["an edit to the frontmatter alone passes",
      [LAUNDERED, "type: Session Report", "type: Session Report\ntags: [recap]"], false],
    ["a replace_all edit is diffed",
      [LAUNDERED + "\n\nThe crew left.\n\nThe crew left.", "The crew left.", "The crew went home.", { replaceAll: true }], false],
    ["a new_string found twice checks the whole body",
      [LAUNDERED + "\n\nThe crew went home.\n\nThe crew left.", "The crew left.", "The crew went home."], true],
    ["a multi-line edit to a CRLF file is still diffed",
      [LAUNDERED + "\n\nThe crew went home.", "The crew went home.", "The crew went home after midnight.\nThey slept late.", { crlf: true }], false],
  ];
  for (const [name, args, expected] of cases) {
    check(name, echoAfterEdit(name.replace(/\W+/g, "-").slice(0, 40), ...args), expected);
  }

  // The edited text is no longer in the file, so the edit cannot be located.
  const f = fixture("edit-not-found", LAUNDERED, OFFERED, said);
  const r = runValidator(f.dir, f.file, f.transcript, "s1", {
    toolName: "Edit",
    toolInput: { old_string: "The crew left.", new_string: "nowhere in this file" },
  });
  check("an edit whose new text is not in the file checks the whole body", r.output.includes("contentOptionEcho"), true);
  rmSync(f.dir, { recursive: true, force: true });
})();
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node professor-orb/hooks/option-echo.test.mjs`
Expected FAIL: "an unrelated line added...", "a deletion passes", "an edit to the frontmatter alone passes", "a replace_all edit is diffed", "a multi-line edit to a CRLF file is still diffed". Expected PASS already: "an edit that adds the echo blocks", "a new_string found twice...", "an edit whose new text is not in the file...".

- [ ] **Step 3: Implement**

In `professor-orb/hooks/validate-write.mjs`, insert directly above the `// Refuses a body sentence that restates an option` comment block:

```js
// The body as it stood before an Edit, rebuilt by putting old_string back
// where new_string now sits. optionEcho checks only the sentences an edit
// wrote: on 2026-10-07 a one-line edit to a session report was blocked over a
// sentence the debrief wrote a week earlier, matched against an option
// written from that very sentence that day, and its only remedies were cutting
// approved text or making the DM retell it. Every other rule still checks the
// whole file.
//
// Compared with LF line endings throughout, because parseFrontmatter
// normalizes CRLF and an edit's strings need not match the file's endings.
// Returns null, meaning "check the whole body", when the edited spot cannot be
// found exactly once: new_string is not in the file, or appears more than once
// without replace_all, so any one occurrence could be the edit.
function priorBodyOfEdit(fileContent, toolInput) {
  const lf = (s) => s.replace(/\r\n/g, "\n");
  const oldString = toolInput.old_string;
  const newString = toolInput.new_string;
  if (typeof oldString !== "string" || typeof newString !== "string") return null;
  const now = lf(fileContent);
  // A deletion wrote no sentence, so everything in the file was already there.
  if (newString === "") {
    const parsed = parseFrontmatter(now);
    return parsed ? parsed.body : null;
  }
  const pieces = now.split(lf(newString));
  if (pieces.length < 2) return null;
  if (pieces.length > 2 && toolInput.replace_all !== true) return null;
  const before = parseFrontmatter(pieces.join(lf(oldString)));
  return before ? before.body : null;
}
```

In `checkOptionEcho`, replace

```js
  for (const sentence of bodySentences(ctx.body)) {
    const words = contentWords(sentence);
```

with

```js
  // On an Edit, a sentence the file already held is not this write's; see
  // priorBodyOfEdit.
  const prior = typeof ctx.priorBody === "string" ? new Set(bodySentences(ctx.priorBody)) : null;

  for (const sentence of bodySentences(ctx.body)) {
    if (prior && prior.has(sentence)) continue;
    const words = contentWords(sentence);
```

In `main()`, after the `if (!parsed || parsed.data.type === undefined ...) { process.exit(0); }` block, add:

```js
  // optionEcho checks only the sentences an Edit wrote; see priorBodyOfEdit.
  const priorBody = toolName === "Edit" ? priorBodyOfEdit(fileContent, toolInput) : null;
```

and add `priorBody,` to the `ctx` object after `sessionId,`.

In `professor-orb/skills/setup/references/conventions-schema.md`, in the `optionEcho` row, replace

`A short confirmation never clears it: only the DM's own prose does.`

with

`A short confirmation never clears it: only the DM's own prose does. On an `Edit`, only the sentences the edit added or changed are checked, found by putting `old_string` back in place of `new_string`; when that spot is not found exactly once, the whole body is checked.`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node professor-orb/hooks/option-echo.test.mjs` and `node professor-orb/hooks/validate-write.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add -- ":(literal)professor-orb/hooks/validate-write.mjs" ":(literal)professor-orb/hooks/option-echo.test.mjs" ":(literal)professor-orb/skills/setup/references/conventions-schema.md"
git commit -m "fix(professor-orb): on an edit, the option-echo check reads only what the edit wrote

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Prep asks once to save

**Files:**
- Modify: `professor-orb/skills/prep/SKILL.md:138-146` and `:178`

- [ ] **Step 1: Replace Steps 3a to 3e**

Replace lines 138 to 146 (Step 3a through Step 3e) with:

```markdown
**Step 3a: Present the draft and ask to save.** Show the complete brief to the DM. Then ask one AskUserQuestion whose question names the brief's north stars (Principle 15), with these three options:

- **Save as written.** Go to Step 3b.
- **Change something first.** The DM describes the change in the notes, or picks Other and says it. Talking it through stays free-form. Revise, re-present the changed sections, and ask this question again.
- **Look into more first.** Its description lists what the brief already drew on: the session report, the previous brief, and each article or other file you read for it. The DM then sees that the lookups happened (Principle 14) and names only what goes beyond them. Read what the DM names and nothing wider, fold the findings into the brief, re-present the changed sections, and ask this question again.

Write files only after the DM picks "Save as written" (Principle 2).

**Step 3b: Save the approved brief.** Follow `.professor-orb/conventions.json` if it exists (the `type` value for session prep files, its required frontmatter fields in order, and its filename suffix), otherwise the project's documented convention, otherwise `YYYY-MM-DD-[Session-Title]-PREP.md` in the campaign's session-reports folder. Writing the file goes through the project's write-time validator hook automatically; if it reports a block violation, fix the write and retry rather than working around it.

**Step 3c: Update indexes and logs** per the project's conventions.

**Step 3d: Confirm with the user.** Share a link to the file and a one-sentence summary. Then mention in one line that `content` can produce read-alouds, handouts, and setpieces if any north stars or handout candidates call for them.
```

- [ ] **Step 2: Update "Things to never do"**

On line 178, change `The Phase 1 catch-up batch and the Phase 3 research decision are both mandatory AskUserQuestion calls` to `The Phase 1 catch-up batch and the Phase 3 save question are both mandatory AskUserQuestion calls`.

- [ ] **Step 3: Verify**

Run: `grep -n "Step 3\|research decision\|deeper research" professor-orb/skills/prep/SKILL.md`
Expected: Steps 3a, 3b, 3c, 3d only, each once as a heading plus the "Go to Step 3b" reference; no "research decision", no "deeper research".

Run: `grep -rn "research decision\|Ask if deeper research" professor-orb`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add -- ":(literal)professor-orb/skills/prep/SKILL.md"
git commit -m "fix(prep): one save question that names what the brief already read

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Release 1.22.1 and live check

**Files:**
- Modify: `professor-orb/.claude-plugin/plugin.json:4`
- Modify: `.claude-plugin/marketplace.json:11`
- Modify: this plan's Status table

- [ ] **Step 1: Bump the version**

In both files, change the professor-orb `"version": "1.22.0"` to `"version": "1.22.1"`.

- [ ] **Step 2: Run every suite**

Run: `for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done`
Expected: every suite exits 0 (14 suites, including the new `project-root.test.mjs`).

- [ ] **Step 3: Live check on rolara, reading files only**

Write this script to the session scratchpad as `live-check.mjs`. It writes nothing in rolara.

```js
// Replays the 2026-10-07 session's writes through a validate-write hook.
// Usage: node live-check.mjs <path to validate-write.mjs>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const HOOK = process.argv[2];
const ROOT = "C:/Users/jorda/GitHub/rolara-project/.claude/worktrees/big-guys-game-session-72c83b";
const CAMP = path.join(ROOT, "session-reports", "rolara", "Big-Guys-Gang");
const REPORT = path.join(CAMP, "reports", "2026-09-30-Zelexs-Gambit-REPORT.md");
const SESSION = "14ade55e-2921-40fc-8677-a66f6fa1663b";
const TRANSCRIPT = path.join(
  os.homedir(),
  ".claude", "projects", "C--Users-jorda-GitHub-rolara-project--claude-worktrees-big-guys-game-session-72c83b",
  `${SESSION}.jsonl`
);

// The 12:37:29 Edit to the report, as the transcript recorded it.
const edit = readFileSync(TRANSCRIPT, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .flatMap((e) => (e.message && Array.isArray(e.message.content) ? e.message.content : []))
  .find((part) => part.type === "tool_use" && part.id === "toolu_01JiwJkJQPvPpPtttZyBru6U").input;

function run(label, toolName, toolInput, cwd) {
  const payload = { hook_event_name: "PostToolUse", tool_name: toolName, tool_input: toolInput, cwd, session_id: SESSION, transcript_path: TRANSCRIPT };
  try {
    execFileSync("node", [HOOK], { input: JSON.stringify(payload), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    console.log(`${label}: passed`);
  } catch (e) {
    console.log(`${label}: exit ${e.status}${/contentOptionEcho/.test(e.stderr || "") ? " (contentOptionEcho)" : ""}`);
  }
}

run("A. the 12:37 report edit, from the root", "Edit", edit, ROOT);
run("B. the 12:37 report edit, from Big-Guys-Gang", "Edit", edit, CAMP);
run("C. the whole report as a Write, from Big-Guys-Gang", "Write", { file_path: REPORT }, CAMP);
```

Run it against the hook on main (before) and on this branch (after), from the worktree root. `$SCRATCH` is this session's scratchpad folder.

```bash
node "$SCRATCH/live-check.mjs" "C:/Users/jorda/GitHub/claude-skills_and_plugins-homebrew/professor-orb/hooks/validate-write.mjs"
node "$SCRATCH/live-check.mjs" professor-orb/hooks/validate-write.mjs
```

The edit's own new lines (the calendar ruling) match no offered option, so the after run of A passes rather than blocking on them.

Expected before: A `exit 2 (contentOptionEcho)`, B `passed`, C `passed`.
Expected after: A `passed`, B `passed`, C `exit 2 (contentOptionEcho)`.

If A or B still blocks after, check that the edit's `new_string` still appears exactly once in the report (it did on 2026-10-07); a later edit to that spot sends the check to the whole body by design.

- [ ] **Step 4: Update the Status table and commit**

Mark every row "done" in this plan's Status table.

```bash
git add -- ":(literal)professor-orb/.claude-plugin/plugin.json" ":(literal).claude-plugin/marketplace.json" ":(literal)docs/superpowers/plans/2026-10-07-professor-orb-option-echo-scope-and-hook-root.md"
git commit -m "chore(professor-orb): 1.22.1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
