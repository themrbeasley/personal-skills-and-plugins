# Machine-Enforced Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a DM correction propagate mechanically, and stop a `debrief` question's own option text from becoming a sentence in a session report.

**Architecture:** Three additions to professor-orb's existing hook surfaces, so each fix runs in a subprocess outside the model's cooperation. A new `UserPromptSubmit` hook detects a correction and runs the campaign-lane search itself, printing hits into the turn. A new `PostToolUse` recorder captures every `AskUserQuestion` option offered, and a new `optionEcho` check in `validate-write.mjs` blocks a report sentence that paraphrases one. Two new pronoun checks join the same validator.

**Tech Stack:** Node built-in modules only (`node:fs`, `node:path`, `node:child_process`). No test framework: each suite is a script that prints `[PASS]`/`[FAIL]` and exits non-zero on failure, driving the real hook as a child process. ESM (`.mjs`) throughout.

**Spec:** `docs/superpowers/specs/2026-09-20-professor-orb-machine-enforced-corrections-design.md`

## Global Constraints

- **Read `professor-orb/skills/SHARED-PRINCIPLES.md` before editing any skill, agent, or command file.** All 19 components carry that preamble.
- **No em dashes in any professor-orb output** (Principle 6). This binds the strings these hooks print, because the DM reads them.
- **Every hook fails silent.** A missing file, unreadable JSON, unrecognized shape, or absent `conventions.json` exits 0 with no output. A hook must never crash a write and never block on its own malfunction. `pipeline-next.mjs` is the reference implementation of this contract.
- **`version` must match in `.claude-plugin/marketplace.json` (repo root) and `professor-orb/.claude-plugin/plugin.json`.** Target: `1.19.0`, from `1.18.0`.
- **Agent `color` values** must be one of `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan`. (No agent gains a color here; noted because it is a standing repo rule.)
- **Comment blocks in hook files are load-bearing.** Each records the invariant its guard holds. Any new guard gets a comment naming its invariant.
- **Run tests with a bare `node <file>`.** Each exits non-zero on failure.

---

## Reach and timing, stated once

Two facts constrain every task below. They are correct placements, not compromises, but an implementer who does not know them will build the wrong thing.

**`validate-write.mjs` requires frontmatter `type`.** At `hooks/validate-write.mjs:904` the hook exits 0 when `parseFrontmatter` returns nothing or the parsed `type` is absent. So a check registered in `CHECKS` reaches only files carrying a frontmatter `type`. Session reports (`type: Session Report`) and indexes (`type: Index`) qualify, which covers both sites the 09-18 falsehood reached on disk. Content files carry a `type` only in projects whose `conventions.json` defines one, and `skills/content/SKILL.md` states many projects never formalize content-file conventions. Tasks 4 and 5 therefore do not claim to cover recaps in every project.

**Both validator checks fire after the DM has seen the draft.** Principle 2 makes every pipeline skill present its draft before writing. A write-time block is the last gate before the content becomes durable, not the first gate before the DM sees it. That is the right place for these two checks: on 09-18 the DM approved a draft containing the false sentence, because one wrong line in two thousand words of right ones is invisible, and the damage came from the sentence reaching disk and propagating to the index, `chronicler`, and three commits. Blocking the write stops the propagation and forces the sentence back through the DM in prose.

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `professor-orb/hooks/dm-correction.mjs` | `UserPromptSubmit` hook. Detects correction-shaped language, resolves the campaign lane, greps it, prints hits. |
| `professor-orb/hooks/dm-correction.test.mjs` | Detection matrix and lane-search behavior, driving the hook as a child process. |
| `professor-orb/hooks/record-options.mjs` | `PostToolUse` hook on `AskUserQuestion`. Appends offered option text to session-scoped state. |
| `professor-orb/hooks/record-options.test.mjs` | Append, session rollover, and malformed-input paths. |
| `professor-orb/hooks/option-echo.test.mjs` | `optionEcho` check, driven through `validate-write.mjs` against fixture projects. |
| `professor-orb/hooks/pronoun-checks.test.mjs` | `pronounDeclaration` and `pronounConsistency`, same harness. |

**Modified**

| File | Change |
| --- | --- |
| `professor-orb/hooks/hooks.json` | Two new entries: `UserPromptSubmit`, and a second `PostToolUse` matcher for `AskUserQuestion`. |
| `professor-orb/hooks/validate-write.mjs` | Three new check functions plus three `CHECKS` entries. |
| `professor-orb/references/base-rules.json` | Three new rules. |
| `professor-orb/agents/kb-validator.md` | Pronoun declaration bucketed as needs-judgment. |
| `professor-orb/skills/SHARED-PRINCIPLES.md` | One paragraph in Principle 3, marked as prose. |
| `professor-orb/skills/debrief/SKILL.md` | One rule in Phase 2 Round discipline, marked as prose. |
| `.gitignore` (repo root) | The recorder's state file. |
| `.claude-plugin/marketplace.json`, `professor-orb/.claude-plugin/plugin.json` | `1.19.0`. |
| `docs/superpowers/specs/2026-09-20-professor-orb-machine-enforced-corrections-design.md` | Amendment recording the two findings above. |

---

### Task 1: Correction detector

The riskiest decision in this plan is the pattern list, because a list wide enough to catch ordinary conversation makes the hook fire constantly. This task ships detection alone so that list gets its own review gate. The hook prints a fixed line on a match and nothing otherwise; Task 2 replaces that line with real hits.

**Files:**
- Create: `professor-orb/hooks/dm-correction.mjs`
- Test: `professor-orb/hooks/dm-correction.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: an executable hook reading `UserPromptSubmit` JSON on stdin (`{ prompt, cwd, session_id, ... }`), writing to stdout, always exiting 0. Task 2 extends its `main()`.

- [ ] **Step 1: Write the failing test**

Create `professor-orb/hooks/dm-correction.test.mjs`:

```javascript
#!/usr/bin/env node
// Regression suite for the correction-detection hook.
//
// Drives the real hook as a child process the way Claude Code invokes it:
// UserPromptSubmit JSON on stdin, stdout injected into the turn as context.
// Node built-ins only, no test framework.
//
// The must-NOT-fire column matters as much as the must-fire column. This hook
// runs on every DM message, so a pattern list wide enough to catch ordinary
// conversation turns every turn into a lane grep.
//
// Run: node professor-orb/hooks/dm-correction.test.mjs

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "dm-correction.mjs");
const MARKER = "reads as a correction";

let passed = 0;
const failures = [];

function runHook(prompt, cwd) {
  try {
    return execFileSync("node", [HOOK], {
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: cwd || process.cwd(), session_id: "s1" }),
      encoding: "utf8",
    });
  } catch (err) {
    // A non-zero exit is itself a failure of the fail-silent contract; surface
    // the output so the assertion below reports something legible.
    return `HOOK EXITED NON-ZERO: ${err.stdout || ""}${err.stderr || ""}`;
  }
}

function checkFires(prompt, shouldFire) {
  const out = runHook(prompt);
  const fired = out.includes(MARKER);
  if (fired === shouldFire) {
    passed++;
    console.log(`  [PASS] ${shouldFire ? "fires" : "silent"}: ${JSON.stringify(prompt)}`);
  } else {
    failures.push(prompt);
    console.log(`  [FAIL] expected ${shouldFire ? "fire" : "silence"}: ${JSON.stringify(prompt)}`);
    console.log(`         actual output: ${JSON.stringify(out)}`);
  }
}

console.log("must fire:");
[
  "This NEVER fucking happened",
  "that never happened",
  "the reporter thing didn't happen",
  "no that's wrong, the clan name came later",
  "that is incorrect",
  "that's not what I said",
  "I already told you they use they/them",
  "no, it was Pemberton who warned them",
  "you used the wrong pronouns for Psyche again",
].forEach((p) => checkFires(p, true));

console.log("must stay silent:");
[
  "what happened next?",
  "that's right, keep going",
  "I said yes to the first option",
  "never mind, let's move on",
  "write the recap",
  "the party never found the ledger, so they moved on",
  "was that wrong of them in character?",
  "",
].forEach((p) => checkFires(p, false));

console.log("fail-silent contract:");
(function () {
  const out = (() => {
    try {
      return execFileSync("node", [HOOK], { input: "not json at all", encoding: "utf8" });
    } catch (err) {
      return `HOOK EXITED NON-ZERO: ${err.stdout || ""}${err.stderr || ""}`;
    }
  })();
  if (out === "") {
    passed++;
    console.log("  [PASS] malformed stdin exits 0 with no output");
  } else {
    failures.push("malformed stdin");
    console.log(`  [FAIL] malformed stdin produced: ${JSON.stringify(out)}`);
  }
})();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
```

Note on `"the party never found the ledger, so they moved on"`: this is the deliberate near-miss. It contains `never` and a past-tense verb but is the DM narrating, not correcting. The pattern list must require `happen` or an explicit wrongness word rather than `never` alone.

- [ ] **Step 2: Run test to verify it fails**

Run: `node professor-orb/hooks/dm-correction.test.mjs`
Expected: FAIL. Node cannot find `dm-correction.mjs`, so every case reports `HOOK EXITED NON-ZERO`.

- [ ] **Step 3: Write minimal implementation**

Create `professor-orb/hooks/dm-correction.mjs`:

```javascript
#!/usr/bin/env node
// UserPromptSubmit hook: catches a DM correction and, in Task 2, searches the
// campaign lane for every copy of what they corrected.
//
// Six principles in SHARED-PRINCIPLES already state that the DM's word is law.
// All six held on 2026-09-18 and none fired: a false sentence entered a report
// and spread to its NPC line, its faction line, the Reports-INDEX summary, and
// three commits before the DM caught it two days later. This hook exists
// because a seventh statement would have done the same nothing. It fires in the
// harness, before the model acts, and its output is a list of places rather
// than an instruction to go looking.
//
// Fail-silent throughout, matching pipeline-next.mjs: a non-match, malformed
// stdin, or a missing conventions file exits 0 with no output. A non-match is
// indistinguishable from this hook not existing.

import { readFileSync } from "node:fs";

// Correction-shaped language. Deliberately narrow: this hook runs on every DM
// message, so each pattern added here is a lane grep added to some ordinary
// turn. Every pattern requires an explicit wrongness marker ("wrong",
// "incorrect", "not what I said") or the verb "happen" under a negation.
// "never" alone is NOT enough: "the party never found the ledger" is the DM
// narrating, not correcting, and the test pins that case as silent.
const CORRECTION_PATTERNS = [
  /\bnever\s+(?:\w+\s+){0,2}happen(?:ed)?\b/i,
  /\b(?:did\s*n[o']?t|didnt|does\s*n[o']?t)\s+(?:\w+\s+){0,2}happen(?:ed)?\b/i,
  /\b(?:that'?s|that\s+is|this\s+is|it'?s|you'?re|thats)\s+(?:just\s+)?(?:wrong|incorrect|false|backwards)\b/i,
  /\bnot\s+what\s+i\s+(?:said|told|asked|meant)\b/i,
  /\bi\s+(?:already\s+)?told\s+you\b/i,
  /\bno,?\s+it\s+(?:was|wasn'?t|is|isn'?t)\b/i,
  /\bwrong\s+(?:pronouns?|name|date|order|person|place)\b/i,
];

function looksLikeCorrection(text) {
  if (typeof text !== "string" || text.trim() === "") return false;
  return CORRECTION_PATTERNS.some((re) => re.test(text));
}

function main() {
  let raw;
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    process.exit(0);
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  if (!input || typeof input !== "object") process.exit(0);

  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  if (!looksLikeCorrection(prompt)) process.exit(0);

  process.stdout.write("The DM's last message reads as a correction.\n");
  process.exit(0);
}

main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node professor-orb/hooks/dm-correction.test.mjs`
Expected: PASS, 18 passed, 0 failed.

If `"you used the wrong pronouns for Psyche again"` fails, check that `wrong\s+(?:pronouns?...)` allows the plural. If `"the party never found the ledger, so they moved on"` fires, the first pattern's `{0,2}` gap is reaching `happen` from too far away; tighten it.

- [ ] **Step 5: Commit**

```bash
git add professor-orb/hooks/dm-correction.mjs professor-orb/hooks/dm-correction.test.mjs
git commit -m "feat(professor-orb): detect a DM correction in the harness

Six principles say the DM's word is law and none fired on 2026-09-18. A
UserPromptSubmit hook fires before the model acts instead of asking it to
remember. Detection only; the lane search lands next.

The pattern list is deliberately narrow. Every entry requires an explicit
wrongness marker or negated \"happen\", because this hook runs on every DM
message and \"never\" alone matches the DM narrating.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Lane search and injection

The hook now does the work instead of asking for it. This is what makes the mechanism independent of the model's cooperation: the hits are in context before the model has a chance to skip the search.

**Files:**
- Modify: `professor-orb/hooks/dm-correction.mjs`
- Modify: `professor-orb/hooks/dm-correction.test.mjs`
- Modify: `professor-orb/hooks/hooks.json`

**Interfaces:**
- Consumes: `looksLikeCorrection(text)` and `main()` from Task 1.
- Produces: `searchTerms(text) -> string[]`, `laneRoots(cwd) -> string[]`, `findHits(roots, terms) -> {file, line, text}[]`. No later task imports these; they stay module-local.

- [ ] **Step 1: Write the failing test**

Append to `professor-orb/hooks/dm-correction.test.mjs`, before the final tally:

```javascript
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";

// A fixture project with a conventions file and one report carrying the
// 2026-09-18 sentence in two places, the way it actually spread.
function makeFixture(name) {
  const dir = path.join(os.tmpdir(), `orb-corr-${name}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, ".professor-orb"), { recursive: true });
  mkdirSync(path.join(dir, "session-reports", "adjustice", "clean-hands"), { recursive: true });
  writeFileSync(
    path.join(dir, ".professor-orb", "conventions.json"),
    JSON.stringify({
      schemaVersion: 3,
      settings: [{ name: "adjustice", kbRoot: "kb/adjustice", sessionReportsRoot: "session-reports/adjustice" }],
    })
  );
  writeFileSync(
    path.join(dir, "session-reports", "adjustice", "clean-hands", "2026-09-18-Clean-Hands-REPORT.md"),
    [
      "---",
      "type: Session Report",
      "---",
      "",
      "The reporter asked what the team was called, and they answered on camera.",
      "",
      "## NPCs",
      "",
      "- The reporter who survived the crash now knows the team's name.",
      "",
      "## Locations",
      "",
      "- The lab showed hints of research into superpowered plants.",
      "",
    ].join("\n")
  );
  return dir;
}

console.log("lane search:");
(function () {
  const dir = makeFixture("hits");
  const out = runHook("That NEVER happened, the reporter never asked what the team was called", dir);

  const cases = [
    ["names the report file", out.includes("2026-09-18-Clean-Hands-REPORT.md"), true],
    ["reports the body line", out.includes("The reporter asked what the team was called"), true],
    ["reports the NPC line", out.includes("now knows the team's name"), true],
    ["leaves an unrelated line out", out.includes("superpowered plants"), false],
    ["states the search is scope, not truth", out.includes("scope, not truth"), true],
    ["carries a file:line pointer", /2026-09-18-Clean-Hands-REPORT\.md:\d+/.test(out), true],
  ];
  for (const [name, actual, expected] of cases) {
    if (actual === expected) {
      passed++;
      console.log(`  [PASS] ${name}`);
    } else {
      failures.push(name);
      console.log(`  [FAIL] ${name}: expected ${expected}, got ${actual}`);
      console.log(`         output: ${JSON.stringify(out)}`);
    }
  }
  rmSync(dir, { recursive: true, force: true });
})();

console.log("a correction the hook cannot locate still speaks:");
(function () {
  const dir = path.join(os.tmpdir(), `orb-corr-bare-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const out = runHook("That never happened", dir);
  const cases = [
    ["still says it read as a correction", out.includes(MARKER), true],
    ["says nothing matched", out.includes("No line in the campaign lane matched"), true],
    ["does not claim a hit", /:\d+\s\s/.test(out), false],
  ];
  for (const [name, actual, expected] of cases) {
    if (actual === expected) {
      passed++;
      console.log(`  [PASS] ${name}`);
    } else {
      failures.push(name);
      console.log(`  [FAIL] ${name}: expected ${expected}, got ${actual}`);
      console.log(`         output: ${JSON.stringify(out)}`);
    }
  }
  rmSync(dir, { recursive: true, force: true });
})();
```

Two notes on why this case asserts speech rather than silence.

The Task 1 detection cases call `runHook(p)` with no `cwd`, so they run against this repo, which has no `conventions.json`. If a missing conventions file silenced the hook, every one of those cases would break the moment this task landed.

More importantly it is the right behavior. A correction the hook cannot locate must still say so: silence there reads as "nothing to fix", which is the exact failure this hook exists to prevent. The fail-silent contract in the Global Constraints covers a hook that cannot *run*, never a hook that ran and found nothing.

- [ ] **Step 2: Run test to verify it fails**

Run: `node professor-orb/hooks/dm-correction.test.mjs`
Expected: FAIL on all six lane-search cases. The hook prints only the preamble, so `names the report file` is false.

- [ ] **Step 3: Write minimal implementation**

In `professor-orb/hooks/dm-correction.mjs`, add imports and the three functions, then replace `main()`'s output block.

Imports become:

```javascript
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
```

Add before `main()`:

```javascript
// Caps. A correction must not turn into an unbounded walk of the DM's whole
// knowledge base on a 10 second hook timeout.
const MAX_FILES = 2000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_HITS = 20;

// Words that carry no search signal. Short list on purpose: the length filter
// below removes most function words already, and an over-long stoplist starts
// removing the nouns a correction turns on.
const STOPWORDS = new Set([
  "that", "this", "never", "happened", "happen", "wrong", "incorrect", "said",
  "told", "about", "there", "their", "they", "them", "with", "from", "have",
  "what", "when", "where", "which", "were", "was", "and", "the", "for", "not",
  "didnt", "doesnt", "actually", "really", "just", "only", "also", "fucking",
]);

// The correction's content words, which are what the lane is searched for. A
// term must be four characters or longer: shorter tokens match everywhere and
// turn every report into a hit.
function searchTerms(text) {
  const seen = new Set();
  for (const raw of text.toLowerCase().split(/[^a-z0-9']+/)) {
    const word = raw.replace(/'/g, "");
    if (word.length < 4) continue;
    if (STOPWORDS.has(word)) continue;
    seen.add(word);
    if (seen.size >= 8) break;
  }
  return [...seen];
}

// Every prong of every setting, plus the proposals folder. Returns absolute
// paths that exist. An absent conventions file returns an empty array, which
// main() treats as "say nothing".
function laneRoots(cwd) {
  let conventions;
  try {
    conventions = JSON.parse(readFileSync(path.resolve(cwd, ".professor-orb", "conventions.json"), "utf8"));
  } catch {
    return [];
  }
  if (!conventions || typeof conventions !== "object") return [];

  const settings = Array.isArray(conventions.settings) ? conventions.settings : [];
  const candidates = [];
  for (const setting of settings) {
    if (!setting || typeof setting !== "object") continue;
    for (const key of ["kbRoot", "homebrewRoot", "sessionReportsRoot"]) {
      if (typeof setting[key] === "string" && setting[key].length > 0) candidates.push(setting[key]);
    }
  }
  // A v1 or v2 conventions file has a bare top-level kbRoot and no settings
  // array. Reading it is enough for a search, unlike lane resolution.
  if (candidates.length === 0 && typeof conventions.kbRoot === "string") candidates.push(conventions.kbRoot);
  candidates.push(path.join(".professor-orb", "proposals"));

  const roots = [];
  for (const rel of candidates) {
    const abs = path.resolve(cwd, rel);
    try {
      if (statSync(abs).isDirectory()) roots.push(abs);
    } catch {
      // Not on disk. A configured prong the DM has not created yet is normal.
    }
  }
  return roots;
}

// Every markdown line under roots holding at least two search terms, or one
// when the correction yielded only one term. Two is the floor because a single
// common noun ("reporter") matches half a campaign, and the DM reads this list.
function findHits(roots, terms) {
  if (terms.length === 0) return [];
  const floor = terms.length === 1 ? 1 : 2;
  const hits = [];
  let filesSeen = 0;

  const walk = (dir) => {
    if (hits.length >= MAX_HITS || filesSeen >= MAX_FILES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (hits.length >= MAX_HITS || filesSeen >= MAX_FILES) return;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(abs);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith(".md")) continue;
      filesSeen++;
      let content;
      try {
        if (statSync(abs).size > MAX_FILE_BYTES) continue;
        content = readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase();
        let matched = 0;
        for (const term of terms) if (lower.includes(term)) matched++;
        if (matched >= floor) {
          hits.push({ file: abs, line: i + 1, text: lines[i].trim() });
          if (hits.length >= MAX_HITS) return;
        }
      }
    }
  };

  for (const root of roots) walk(root);
  return hits;
}
```

Replace the output block at the end of `main()`:

```javascript
  const cwd = typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : process.cwd();
  const terms = searchTerms(prompt);
  const hits = findHits(laneRoots(cwd), terms);

  const out = [
    "The DM's last message reads as a correction. Their statement stands on its own;",
    "the search below establishes scope, not truth. Never re-litigate the correction.",
    "",
  ];

  if (hits.length === 0) {
    // A correction the hook cannot locate still gets said out loud. Silence here
    // would read as "nothing to fix", which is the failure this hook exists for.
    out.push("No line in the campaign lane matched it. Find what they corrected yourself,");
    out.push("then fix every copy before anything else this turn.");
  } else {
    out.push(`${hits.length} line${hits.length === 1 ? "" : "s"} in the campaign lane mention it:`);
    out.push("");
    for (const hit of hits) {
      const rel = path.relative(cwd, hit.file).split(path.sep).join("/");
      out.push(`  ${rel}:${hit.line}  ${hit.text}`);
    }
    out.push("");
    out.push("Report this list to the DM and ask once whether to fix them all.");
    out.push("A correction is not closed while a copy survives.");
  }

  process.stdout.write(out.join("\n") + "\n");
  process.exit(0);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node professor-orb/hooks/dm-correction.test.mjs`
Expected: PASS, 25 passed, 0 failed.

If `leaves an unrelated line out` fails, the two-term floor is being met by terms that are too generic; check what `searchTerms` returned for the fixture prompt and add the offending word to `STOPWORDS`.

- [ ] **Step 5: Wire the hook**

In `professor-orb/hooks/hooks.json`, add a `UserPromptSubmit` key alongside the existing `PreToolUse`, `PostToolUse`, and `Stop` keys:

```json
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/dm-correction.mjs\"",
            "timeout": 10
          }
        ]
      }
    ]
```

- [ ] **Step 6: Verify the wiring by hand**

Run from the repo root:

```bash
echo '{"hook_event_name":"UserPromptSubmit","prompt":"that never happened","cwd":"."}' | node professor-orb/hooks/dm-correction.mjs
```

Expected: the two-line preamble plus the "No line in the campaign lane matched it" branch, because this repo has no `conventions.json`. Exit code 0.

- [ ] **Step 7: Commit**

```bash
git add professor-orb/hooks/dm-correction.mjs professor-orb/hooks/dm-correction.test.mjs professor-orb/hooks/hooks.json
git commit -m "feat(professor-orb): search the lane on a correction, in the hook

The hook runs the grep itself and prints the hits, rather than instructing the
model to go looking. That is the whole point: a list already in context needs no
cooperation to produce, and the 2026-09-18 correction reached only the sites the
DM happened to name.

Caps the walk at 2000 files and 20 hits so a correction cannot blow the 10
second timeout on a large knowledge base. A correction the hook cannot locate
says so rather than staying silent, because silence reads as nothing to fix.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Option recorder

**Files:**
- Create: `professor-orb/hooks/record-options.mjs`
- Test: `professor-orb/hooks/record-options.test.mjs`
- Modify: `professor-orb/hooks/hooks.json`
- Modify: `.gitignore` (repo root)

**Interfaces:**
- Consumes: nothing.
- Produces: `.professor-orb/asked-options.json`, shape `{ "sessionId": string, "options": string[] }`. Each entry is one offered option's label and description joined by `". "`. Task 4 reads this file.

- [ ] **Step 1: Write the failing test**

Create `professor-orb/hooks/record-options.test.mjs`:

```javascript
#!/usr/bin/env node
// Regression suite for the AskUserQuestion option recorder.
//
// The recorder stores EVERY option offered, not only those selected. That is
// deliberate and it is what makes the optionEcho check cover the 2026-09-18
// case as the DM describes it: they state the option was never selected on
// their screen. Matching against the full offered set catches a phantom
// selection and a real one alike, and removes any dependence on the shape of
// tool_response.
//
// Run: node professor-orb/hooks/record-options.test.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "record-options.mjs");

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failures.push(name);
    console.log(`  [FAIL] ${name}`);
    console.log(`         expected: ${JSON.stringify(expected)}`);
    console.log(`         actual:   ${JSON.stringify(actual)}`);
  }
}

function fixture(name) {
  const dir = path.join(os.tmpdir(), `orb-rec-${name}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, ".professor-orb"), { recursive: true });
  return dir;
}

function run(dir, sessionId, questions) {
  execFileSync("node", [HOOK], {
    input: JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "AskUserQuestion",
      session_id: sessionId,
      cwd: dir,
      tool_input: { questions },
    }),
    encoding: "utf8",
  });
}

function state(dir) {
  const p = path.join(dir, ".professor-orb", "asked-options.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

const ASKED = [
  {
    question: "What happened in the aftermath?",
    header: "Aftermath",
    multiSelect: true,
    options: [
      { label: "Reporter asked the name", description: "The team answered on camera as the Neighborhood Watch Association" },
      { label: "Nothing on camera", description: "The crash site cleared without press" },
    ],
  },
];

console.log("recording:");
(function () {
  const dir = fixture("basic");
  run(dir, "s1", ASKED);
  const s = state(dir);
  check("session id recorded", s.sessionId, "s1");
  check("both options recorded, selected or not", s.options.length, 2);
  check(
    "label and description joined",
    s.options[0],
    "Reporter asked the name. The team answered on camera as the Neighborhood Watch Association"
  );
  rmSync(dir, { recursive: true, force: true });
})();

console.log("appending and session rollover:");
(function () {
  const dir = fixture("append");
  run(dir, "s1", ASKED);
  run(dir, "s1", ASKED);
  check("same session appends", state(dir).options.length, 4);
  run(dir, "s2", ASKED);
  const s = state(dir);
  check("new session resets", s.options.length, 2);
  check("new session id stored", s.sessionId, "s2");
  rmSync(dir, { recursive: true, force: true });
})();

console.log("fail-silent contract:");
(function () {
  const dir = fixture("silent");
  // No .professor-orb directory: setup never ran, so the recorder writes nothing.
  const bare = path.join(os.tmpdir(), `orb-rec-bare-${process.pid}`);
  rmSync(bare, { recursive: true, force: true });
  mkdirSync(bare, { recursive: true });
  run(bare, "s1", ASKED);
  check("no .professor-orb means no state file", state(bare), null);
  rmSync(bare, { recursive: true, force: true });

  let threw = false;
  try {
    execFileSync("node", [HOOK], { input: "not json", encoding: "utf8" });
  } catch {
    threw = true;
  }
  check("malformed stdin exits 0", threw, false);

  run(dir, "s1", [{ question: "q", header: "h", multiSelect: false, options: "not an array" }]);
  check("malformed questions writes nothing", state(dir), null);
  rmSync(dir, { recursive: true, force: true });
})();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node professor-orb/hooks/record-options.test.mjs`
Expected: FAIL. `execFileSync` throws because `record-options.mjs` does not exist, so the suite exits non-zero on the first `run`.

- [ ] **Step 3: Write minimal implementation**

Create `professor-orb/hooks/record-options.mjs`:

```javascript
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
// The state file is hook-owned: read by hooks, never by the model, and
// git-ignored. Principle 8's scope discipline binds skills, not hooks, and
// pipeline-state.json is the precedent. Keeping it out of the model's context
// is part of its contract, not incidental, because it holds proposed-scene text.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

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
  const orbDir = path.resolve(cwd, ".professor-orb");
  // Setup never ran. Creating the directory is setup's job, not a hook's.
  if (!existsSync(orbDir)) process.exit(0);

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

  const statePath = path.join(orbDir, "asked-options.json");
  const sessionId = typeof input.session_id === "string" ? input.session_id : "";

  let state = { sessionId, options: [] };
  try {
    const prior = JSON.parse(readFileSync(statePath, "utf8"));
    // A record from another session is stale: option text from a different
    // debrief must never block this session's report.
    if (prior && prior.sessionId === sessionId && Array.isArray(prior.options)) {
      state.options = prior.options;
    }
  } catch {
    // No prior file, or an unreadable one. Start fresh rather than fail.
  }

  state.options = [...state.options, ...offered];
  try {
    writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");
  } catch {
    // A read-only checkout must not break the DM's question.
  }
  process.exit(0);
}

main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node professor-orb/hooks/record-options.test.mjs`
Expected: PASS, 9 passed, 0 failed.

- [ ] **Step 5: Wire the hook and ignore the state file**

In `professor-orb/hooks/hooks.json`, add a second entry to the existing `PostToolUse` array, leaving the `Write|Edit` entry unchanged:

```json
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/record-options.mjs\"",
            "timeout": 5
          }
        ]
      }
```

Append to the repo-root `.gitignore`:

```
# professor-orb hook state: holds offered question text, read by hooks only
.professor-orb/asked-options.json
```

- [ ] **Step 6: Commit**

```bash
git add professor-orb/hooks/record-options.mjs professor-orb/hooks/record-options.test.mjs professor-orb/hooks/hooks.json .gitignore
git commit -m "feat(professor-orb): record every AskUserQuestion option offered

Half of the detector for option laundering. On 2026-09-18 an option whose
description stated an outcome became a report sentence, then a source for the
index, chronicler, and a recap.

Records every option offered rather than only those selected: the DM states the
option was never selected on their screen, so the full offered set is what
covers the case as reported, and it drops any dependence on tool_response's
shape. State is hook-owned and git-ignored, because it holds proposed-scene text
that must never reach the model's context.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The `optionEcho` check

**Files:**
- Modify: `professor-orb/hooks/validate-write.mjs` (add function, add `CHECKS` entry at `:711-728`)
- Modify: `professor-orb/references/base-rules.json` (add rule after `contentNoEmDashes`)
- Test: `professor-orb/hooks/option-echo.test.mjs`

**Interfaces:**
- Consumes: `.professor-orb/asked-options.json` from Task 3. The validator's `ctx` object, whose fields are `{ projectRoot, toolName, prongKind, searchRoots, absFilePath, relPath, relProjectPath, fileName, frontmatter, frontmatterOrder, body, tagRegistryPath, conventions }`.
- Produces: `checkOptionEcho(params, ctx)`, returning `true` on pass or a violation string. Registered as `optionEcho`.

**Why overlap and not edit distance.** The spec named `levenshtein`, already in the file, as the natural basis. The 09-18 case disproves it. The option read `"Reporter asked the name. The team answered on camera as the Neighborhood Watch Association"`; the report read `"The reporter asked what the team was called, and they answered on camera."` That is a paraphrase merging label and description, so edit distance is large. Content-word overlap is 5 of the sentence's 6 content words, or 0.83. The check uses overlap.

- [ ] **Step 1: Write the failing test**

Create `professor-orb/hooks/option-echo.test.mjs`:

```javascript
#!/usr/bin/env node
// Regression suite for the optionEcho check, driven through the real
// validate-write hook against fixture projects.
//
// The known-positive case is the 2026-09-18 sentence. It is a PARAPHRASE of the
// option that produced it, merging the option's label and description, which is
// why this check scores content-word overlap rather than edit distance. A
// levenshtein-based threshold tuned to pass the must-not-fire cases below can
// never catch it.
//
// Run: node professor-orb/hooks/option-echo.test.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "validate-write.mjs");
const RULES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "references", "base-rules.json");

let passed = 0;
const failures = [];
const OFFERED = [
  "Reporter asked the name. The team answered on camera as the Neighborhood Watch Association",
];

// dmSaid: the DM's own prose for the transcript. Pass "" for a session where
// they never typed the claim, which is the 09-18 shape.
function fixture(name, reportBody, offered, dmSaid) {
  const dir = path.join(os.tmpdir(), `orb-echo-${name}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, ".professor-orb"), { recursive: true });
  mkdirSync(path.join(dir, "session-reports", "adjustice", "clean-hands"), { recursive: true });

  const transcript = path.join(dir, "transcript.jsonl");
  writeFileSync(
    transcript,
    [
      JSON.stringify({ type: "user", message: { role: "user", content: "let's debrief the clean hands session" } }),
      JSON.stringify({ type: "user", message: { role: "user", content: typeof dmSaid === "string" ? dmSaid : "" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: "drafting the report" } }),
    ].join("\n") + "\n"
  );

  const base = JSON.parse(readFileSync(RULES, "utf8"));
  writeFileSync(
    path.join(dir, ".professor-orb", "conventions.json"),
    JSON.stringify({
      schemaVersion: 3,
      settings: [
        {
          name: "adjustice",
          kbRoot: "kb/adjustice",
          sessionReportsRoot: "session-reports/adjustice",
          rules: base.rules,
        },
      ],
    })
  );
  if (offered) {
    writeFileSync(
      path.join(dir, ".professor-orb", "asked-options.json"),
      JSON.stringify({ sessionId: "s1", options: offered })
    );
  }
  const file = path.join(dir, "session-reports", "adjustice", "clean-hands", "2026-09-18-Clean-Hands-REPORT.md");
  writeFileSync(file, ["---", "type: Session Report", "---", "", reportBody, ""].join("\n"));
  return { dir, file, transcript };
}

// Returns { blocked: boolean, output: string }. validate-write signals a block
// with exit 2 and stderr; a pass or warn exits 0.
function runValidator(dir, file, transcript) {
  try {
    execFileSync("node", [HOOK], {
      cwd: dir,
      input: JSON.stringify({
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        cwd: dir,
        transcript_path: transcript,
        tool_input: { file_path: file },
      }),
      encoding: "utf8",
    });
    return { blocked: false, output: "" };
  } catch (err) {
    return { blocked: err.status === 2, output: `${err.stdout || ""}${err.stderr || ""}` };
  }
}

function check(name, actual, expected) {
  if (actual === expected) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failures.push(name);
    console.log(`  [FAIL] ${name}: expected ${expected}, got ${actual}`);
  }
}

const LAUNDERED = "The reporter asked what the team was called, and they answered on camera.";

console.log("the 2026-09-18 case:");
(function () {
  // The DM's transcript talks about the session but never states this claim,
  // which is the whole shape of the bug: only the option ever said it.
  const { dir, file, transcript } = fixture("known-positive", LAUNDERED, OFFERED, "we wrapped up at the warehouse, pretty short night");
  const r = runValidator(dir, file, transcript);
  check("a paraphrase of an offered option blocks the write", r.blocked, true);
  check("the violation names the rule", r.output.includes("contentOptionEcho"), true);
  check("the violation quotes the sentence", r.output.includes("answered on camera"), true);
  rmSync(dir, { recursive: true, force: true });
})();

console.log("no deadlock when the DM said it themselves:");
(function () {
  // The escape hatch, and the case that makes `block` safe. A sentence the DM
  // confirmed in prose still overlaps the option heavily, because a good option
  // paraphrases what it asks about. Without this branch the rule would refuse
  // the TRUE sentence forever and the DM could never get it into the report.
  const { dir, file, transcript } = fixture(
    "dm-said-it",
    LAUNDERED,
    OFFERED,
    "yes the reporter asked what the team was called and they answered on camera, that one happened"
  );
  check("the DM's own prose lets it through", runValidator(dir, file, transcript).blocked, false);
  rmSync(dir, { recursive: true, force: true });
})();

console.log("a long scattered transcript must not suppress the block:");
(function () {
  // The case that forces per-message containment. None of these messages states
  // the claim, but between them they use every content word in it. Pooled, that
  // scores 1.00 and kills the rule while leaving it looking alive; per message
  // the best is 0.33. This case fails loudly if anyone reintroduces pooling.
  const dir = path.join(os.tmpdir(), `orb-echo-scattered-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, ".professor-orb"), { recursive: true });
  mkdirSync(path.join(dir, "session-reports", "adjustice", "clean-hands"), { recursive: true });
  const base = JSON.parse(readFileSync(RULES, "utf8"));
  writeFileSync(
    path.join(dir, ".professor-orb", "conventions.json"),
    JSON.stringify({
      schemaVersion: 3,
      settings: [{ name: "adjustice", kbRoot: "kb/adjustice", sessionReportsRoot: "session-reports/adjustice", rules: base.rules }],
    })
  );
  writeFileSync(path.join(dir, ".professor-orb", "asked-options.json"), JSON.stringify({ sessionId: "s1", options: OFFERED }));
  const transcript = path.join(dir, "transcript.jsonl");
  writeFileSync(
    transcript,
    [
      "the team regrouped at the warehouse after the crash",
      "a reporter survived and was hospitalized",
      "they asked me about insurance later",
      "the camera crew packed up early",
      "someone called Pemberton on the way out",
      "the whole team answered the door together",
      "done, write the report",
    ]
      .map((c) => JSON.stringify({ type: "user", message: { role: "user", content: c } }))
      .join("\n") + "\n"
  );
  const file = path.join(dir, "session-reports", "adjustice", "clean-hands", "2026-09-18-Clean-Hands-REPORT.md");
  writeFileSync(file, ["---", "type: Session Report", "---", "", LAUNDERED, ""].join("\n"));
  check("scattered words across many messages still blocks", runValidator(dir, file, transcript).blocked, true);
  rmSync(dir, { recursive: true, force: true });
})();

console.log("an AskUserQuestion selection is not the DM's prose:");
(function () {
  // The selection comes back through the transcript as a user-role event
  // carrying a tool_result. Counting it as DM prose would feed the option's own
  // text back in and suppress exactly the block this rule exists for.
  const dir = path.join(os.tmpdir(), `orb-echo-toolresult-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, ".professor-orb"), { recursive: true });
  mkdirSync(path.join(dir, "session-reports", "adjustice", "clean-hands"), { recursive: true });
  const base = JSON.parse(readFileSync(RULES, "utf8"));
  writeFileSync(
    path.join(dir, ".professor-orb", "conventions.json"),
    JSON.stringify({
      schemaVersion: 3,
      settings: [{ name: "adjustice", kbRoot: "kb/adjustice", sessionReportsRoot: "session-reports/adjustice", rules: base.rules }],
    })
  );
  writeFileSync(path.join(dir, ".professor-orb", "asked-options.json"), JSON.stringify({ sessionId: "s1", options: OFFERED }));
  const transcript = path.join(dir, "transcript.jsonl");
  writeFileSync(
    transcript,
    [
      JSON.stringify({ type: "user", message: { role: "user", content: "let's debrief" } }),
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: OFFERED[0], text: OFFERED[0] }],
        },
      }),
    ].join("\n") + "\n"
  );
  const file = path.join(dir, "session-reports", "adjustice", "clean-hands", "2026-09-18-Clean-Hands-REPORT.md");
  writeFileSync(file, ["---", "type: Session Report", "---", "", LAUNDERED, ""].join("\n"));
  check("a tool_result carrying the option text still blocks", runValidator(dir, file, transcript).blocked, true);
  rmSync(dir, { recursive: true, force: true });
})();

console.log("must not fire:");
(function () {
  const cases = [
    ["an unrelated sentence sharing one word", "The reporter survived the crash and was hospitalized overnight."],
    ["a short sentence", "The reporter left."],
    // The measured near-miss. Under a Math.min denominator this scores exactly
    // 0.60 against the offered option and blocks at any threshold low enough to
    // catch the real one; under Jaccard it scores 0.27 against the real 0.50.
    ["an innocent sentence sharing three words", "The reporter and the team were on camera together at the scene."],
  ];
  for (const [name, body] of cases) {
    const { dir, file, transcript } = fixture(name.replace(/\W+/g, "-"), body, OFFERED, "");
    check(name, runValidator(dir, file, transcript).blocked, false);
    rmSync(dir, { recursive: true, force: true });
  }
})();

console.log("fail-silent contract:");
(function () {
  let f = fixture("no-state", LAUNDERED, null, "");
  check("no recorded options means no violation", runValidator(f.dir, f.file, f.transcript).blocked, false);
  rmSync(f.dir, { recursive: true, force: true });

  // No transcript means the check cannot tell a laundered sentence from a
  // confirmed one, and a block on no evidence is worse than no block.
  f = fixture("no-transcript", LAUNDERED, OFFERED, "");
  check("an unreadable transcript passes rather than blocks", runValidator(f.dir, f.file, path.join(f.dir, "nope.jsonl")).blocked, false);
  rmSync(f.dir, { recursive: true, force: true });
})();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node professor-orb/hooks/option-echo.test.mjs`
Expected: FAIL on the three known-positive cases. `optionEcho` is not in `CHECKS`, so the rule is skipped by the forward-compatible `if (!checkFn) continue` at `validate-write.mjs:934`, and the write passes.

- [ ] **Step 3: Write minimal implementation**

In `professor-orb/hooks/validate-write.mjs`, add before the `CHECKS` map:

```javascript
// ---------------------------------------------------------------------------
// Option echo
// ---------------------------------------------------------------------------

// Words carrying no distinguishing signal when comparing a report sentence
// against a question's option text. Kept short: the four-character floor below
// already removes most function words, and a long list starts removing the
// nouns that make two sentences the same claim.
const ECHO_STOPWORDS = new Set([
  "the", "and", "that", "this", "with", "from", "have", "they", "them", "their",
  "what", "when", "where", "which", "were", "was", "for", "not", "then", "than",
  "also", "into", "onto", "about", "after", "before", "would", "could", "should",
  "did", "does", "done", "been", "being", "there", "here", "your", "yours",
]);

function contentWords(text) {
  const out = new Set();
  for (const raw of String(text).toLowerCase().split(/[^a-z0-9']+/)) {
    const word = raw.replace(/'/g, "");
    if (word.length < 4) continue;
    if (ECHO_STOPWORDS.has(word)) continue;
    out.add(word);
  }
  return out;
}

// Jaccard: shared words over the union. Edit distance cannot do this job at all,
// because the 2026-09-18 report sentence paraphrases its option and merges the
// option's label into its description, so the strings are far apart while the
// claim is identical.
//
// The denominator is the union and NOT Math.min(a.size, b.size), which was
// measured and rejected. Dividing by the smaller set scores any short sentence
// whose few content words happen to sit inside a long option at up to 1.0: the
// innocent sentence "The reporter and the team were on camera together at the
// scene" scores exactly 0.60 against the 09-18 option and would block at any
// threshold low enough to catch the real one (0.83). Under Jaccard the same
// pair scores 0.27 against the real sentence's 0.50, which is a margin wide
// enough to sit a threshold in.
function overlapRatio(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / (a.size + b.size - shared);
}

// Sentences of the body, frontmatter already stripped by parseFrontmatter.
function bodySentences(body) {
  return String(body)
    .replace(/^#+.*$/gm, " ")       // headings assert nothing
    .replace(/^\s*[-*]\s*\[[ x]\]/gm, " ") // checkbox markers, not prose
    .split(/(?<=[.!?])\s+|\r?\n/)
    .map((s) => s.replace(/^\s*[-*]\s*/, "").trim())
    .filter((s) => s.length > 0);
}

// The DM's own words, from the session transcript. Each line of the JSONL
// transcript is one event; a user event's text is what the DM actually typed.
//
// This function is what keeps the rule from deadlocking, and the rule is
// useless without it. A sentence the DM confirmed in prose STILL overlaps the
// option heavily, because a good option paraphrases what it asks about: "Yes,
// the reporter did ask, and the team said Neighborhood Watch Association"
// scores 0.60 against the 09-18 option. Blocking on option overlap alone would
// therefore refuse the true sentence forever, with no way for the DM to get it
// into the report. The discrimination the rule actually needs is not "does this
// resemble an option" but "does this resemble an option AND nothing the DM
// typed", which is exactly the 09-18 defect.
// Returns ONE ENTRY PER DM MESSAGE, never a single joined blob. Both properties
// below were measured against a realistic debrief transcript and both are
// load-bearing.
//
// Per message, not pooled. A real debrief transcript is a bulk-memory dump plus
// dozens of short answers, and between them those messages use nearly every word
// in the campaign. Pooling them and asking "did the DM use these words" scores
// the 09-18 sentence at 1.00 against a transcript that never states it, which
// would suppress every block and leave the rule dead while looking alive. The
// same sentence scores 0.33 as a maximum over individual messages, against 1.00
// for a DM who actually confirmed it in one breath. The question has to be "did
// the DM say this thing", not "did the DM ever use these words".
//
// Text parts only. An AskUserQuestion selection comes back through the
// transcript as a user-role event carrying a tool_result, so accepting every
// part of every user event would feed the option's own text back in as the DM's
// prose and suppress exactly the blocks this rule exists for.
function dmMessages(transcriptPath) {
  if (typeof transcriptPath !== "string" || transcriptPath.length === 0) return null;
  let raw;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch {
    return null;
  }
  const said = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    // Shape varies by harness version, so read defensively.
    const role = event && (event.role || (event.message && event.message.role) || event.type);
    if (role !== "user") continue;
    const content = event.content || (event.message && event.message.content);
    if (typeof content === "string") {
      said.push(content);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || part.type !== "text") continue;
        if (typeof part.text === "string") said.push(part.text);
      }
    }
  }
  return said.length > 0 ? said : null;
}

// Refuses a body sentence that restates an option this session offered AND that
// the DM never put in prose themselves. The signature of the 2026-09-18 bug: a
// sentence in the report that the pipeline wrote rather than the DM.
//
// Fail-silent on an absent or unreadable state file, and equally on an
// unreadable transcript: with no record of what the DM typed, the check cannot
// tell a laundered sentence from a confirmed one, and a block on no evidence is
// worse than no block. A session in which the recorder never ran behaves
// exactly as before.
function checkOptionEcho(params, ctx) {
  const minWords = typeof params.minContentWords === "number" ? params.minContentWords : 4;
  const threshold = typeof params.overlapThreshold === "number" ? params.overlapThreshold : 0.4;
  const proseThreshold = typeof params.proseThreshold === "number" ? params.proseThreshold : 0.5;

  let offered;
  try {
    const statePath = path.resolve(ctx.projectRoot, ".professor-orb", "asked-options.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    offered = Array.isArray(state.options) ? state.options : [];
  } catch {
    return true;
  }
  if (offered.length === 0) return true;

  const messages = dmMessages(ctx.transcriptPath);
  if (messages === null) return true;
  const messageWords = messages.map((m) => contentWords(m));

  const offeredSets = offered.map((text) => ({ text, words: contentWords(text) }));

  for (const sentence of bodySentences(ctx.body)) {
    const words = contentWords(sentence);
    // A sentence with few content words cannot be distinguished from an option
    // by overlap alone, and flagging it would be noise on every index line.
    if (words.size < minWords) continue;

    // Containment against the single best DM message: how much of THIS sentence
    // appears in one thing the DM actually typed. Measured over pooled messages
    // instead, this is 1.00 for a transcript that never states the claim, which
    // is why dmMessages returns them separately.
    let bestContainment = 0;
    for (const msg of messageWords) {
      let shared = 0;
      for (const word of words) if (msg.has(word)) shared++;
      const containment = shared / words.size;
      if (containment > bestContainment) bestContainment = containment;
    }
    if (bestContainment >= proseThreshold) continue;

    for (const option of offeredSets) {
      if (overlapRatio(words, option.words) >= threshold) {
        return [
          `This sentence restates a question option from this session, and the DM never wrote it in prose: "${sentence}"`,
          `  the option offered: "${option.text}"`,
          "  Confirm it with the DM in their own words, or cut it. An option points at a topic; what happened comes back in the DM's own words.",
        ].join("\n");
      }
    }
  }
  return true;
}
```

Add to the `CHECKS` map:

```javascript
  optionEcho: checkOptionEcho,
```

- [ ] **Step 4: Carry the transcript path on `ctx`**

`checkOptionEcho` needs the transcript, and `ctx` does not carry it. In `main()`, read it from the hook payload alongside `agentType` (near `hooks/validate-write.mjs:813`):

```javascript
  // Carried for optionEcho, which must distinguish a sentence the DM wrote from
  // one only a question option ever said. Absent in older harness versions, and
  // that absence is handled by the check rather than here.
  const transcriptPath = typeof input.transcript_path === "string" ? input.transcript_path : "";
```

Then add one field to the `ctx` object literal (at `hooks/validate-write.mjs:909-925`):

```javascript
    transcriptPath,
```

**Verify the field exists before trusting it.** `input.transcript_path` is documented for hook payloads but this plan does not assume it on `PostToolUse`. Confirm with:

```bash
echo '{"hook_event_name":"PostToolUse","tool_name":"Write","cwd":".","tool_input":{"file_path":"x.md"}}' | node -e 'process.stdin.on("data",d=>console.log(Object.keys(JSON.parse(d))))'
```

That only proves the parse path. Step 1's test cases all supply `transcript_path` explicitly, so they pass whether or not the harness sends it, which means they cannot confirm this. If the field is absent in practice, `dmMessages` returns `null`, the check passes, and `contentOptionEcho` silently never fires: correct degradation, and indistinguishable from the rule working. See **The one thing to confirm live** near the end of this plan for the check that settles it.

- [ ] **Step 5: Add the rule**

In `professor-orb/references/base-rules.json`, add after `contentNoEmDashes`:

```json
    "contentOptionEcho": {
      "provenance": "professor-orb",
      "category": "content",
      "check": "optionEcho",
      "enforcement": "block",
      "description": "A sentence restating a question option this session offered is confirmed in the DM's own words before it is written.",
      "params": { "overlapThreshold": 0.4, "minContentWords": 4, "proseThreshold": 0.5 }
    }
```

`overlapThreshold` is 0.4 against a Jaccard score, measured: the 09-18 sentence scores 0.50 and its verbatim option 0.67, while the worst innocent sentence tested scores 0.27.

No `scope` field, deliberately. The only prong filter `validate-write.mjs` applies is `rule.scope === "kb"` at `:960`, so an absent `scope` lets the rule fire on every write it reaches. That is wanted: the laundered sentence reached the Reports-INDEX summary as well as the report body, and a KB article echoing an option is the same bug with a different filename.

No `autofix`. The remedy is the DM's own words, never a mechanical substitution.

- [ ] **Step 6: Run test to verify it passes**

Run: `node professor-orb/hooks/option-echo.test.mjs`
Expected: PASS, 11 passed, 0 failed. (9 `check()` call sites; the "must not
fire" block's loop runs 3 cases from one call site, so it contributes 3
assertions rather than 1.)

Diagnosing failures, because each one points at a specific measured decision:

- `scattered words across many messages still blocks` failing means containment is being measured over pooled messages. That scores 1.00 against a transcript that never states the claim, so the rule would be dead while appearing alive. Measure per message and take the maximum.
- `a tool_result carrying the option text still blocks` failing means `dmMessages` is accepting parts other than `type: "text"`, so an `AskUserQuestion` selection is being read as the DM's prose.
- `an innocent sentence sharing three words` blocking means `overlapRatio` is dividing by `Math.min` rather than the union. That sentence scores 0.60 under `min` and 0.27 under Jaccard.
- `the DM's own prose lets it through` failing means `proseThreshold` is too high, or `ctx.transcriptPath` is not reaching the check from Step 4.

- [ ] **Step 7: Run the existing validator suite for regressions**

Run: `node professor-orb/hooks/validate-write.test.mjs`
Expected: PASS, unchanged from before this task. A new `CHECKS` entry and one new `ctx` field must not disturb any existing rule.

- [ ] **Step 8: Commit**

```bash
git add professor-orb/hooks/validate-write.mjs professor-orb/hooks/option-echo.test.mjs professor-orb/references/base-rules.json
git commit -m "feat(professor-orb): block a report sentence that restates its own question

Completes the option-laundering detector. On 2026-09-18 an option description
became a report sentence, then a source for the index, chronicler, a recap, and
three commits. The write-time block is the last gate before the claim becomes
durable, which is what propagates.

Blocks only a sentence that restates an option AND that the DM never wrote in
prose. Option overlap alone would deadlock: a good option paraphrases what it
asks about, so a sentence the DM confirmed still overlaps it heavily and the
true sentence could never be written. Containment is measured against the single
best DM message, never pooled messages, which score 1.00 against a transcript
that never states the claim.

Scores Jaccard overlap, not edit distance and not overlap over the smaller set.
The report sentence paraphrases its option and merges the label into the
description, so edit distance is large while the claim is identical; dividing by
the smaller set scores an innocent sentence at 0.60 against the real one's 0.83.

No scope field, so the rule also reaches the index summary, which was one of the
sites the 09-18 sentence spread to.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Pronoun checks

`party/Psyche.md` opened with `*Pronouns: she, they, and he.*` while the body, the reports, and the DM's own usage are they throughout. Four consecutive drafts used she.

Two checks, not one. The spec described a single check plus a `kb-validator` update; splitting is cleaner because the two failures are different. `pronounDeclaration` is the root fix: it makes the article unambiguous, so there is nothing to choose. `pronounConsistency` is the backstop, deliberately narrow.

**Files:**
- Modify: `professor-orb/hooks/validate-write.mjs`
- Modify: `professor-orb/references/base-rules.json`
- Modify: `professor-orb/agents/kb-validator.md`
- Test: `professor-orb/hooks/pronoun-checks.test.mjs`

**Interfaces:**
- Consumes: the same `ctx` fields as Task 4, plus `ctx.searchRoots` for resolving character articles by name.
- Produces: `checkPronounDeclaration(params, ctx)` and `checkPronounConsistency(params, ctx)`, registered as `pronounDeclaration` and `pronounConsistency`. Both return `true` on pass or a violation string.

- [ ] **Step 1: Write the failing test**

Create `professor-orb/hooks/pronoun-checks.test.mjs`:

```javascript
#!/usr/bin/env node
// Regression suite for the two pronoun checks.
//
// pronounDeclaration is the root fix: an article listing three pronoun sets
// with none named for writing reads as a choice, and party/Psyche.md read
// exactly that way while every other source used they throughout.
//
// pronounConsistency is the backstop and is deliberately narrow. It fires only
// when an article names ONE set for writing AND lists others, and the body uses
// one of the others. With no other set listed there is nothing to confuse, so
// there is nothing to flag, and a narrow check is worth more than a noisy one.
//
// Run: node professor-orb/hooks/pronoun-checks.test.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(HERE, "validate-write.mjs");
const RULES = path.join(HERE, "..", "references", "base-rules.json");

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

// Writes a fixture project whose kbRoot holds the given articles, then returns
// the absolute path of the one to validate.
function fixture(name, articles, targetRel) {
  const dir = path.join(os.tmpdir(), `orb-pron-${name}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, ".professor-orb"), { recursive: true });
  const base = JSON.parse(readFileSync(RULES, "utf8"));
  writeFileSync(
    path.join(dir, ".professor-orb", "conventions.json"),
    JSON.stringify({
      schemaVersion: 3,
      settings: [{ name: "adjustice", kbRoot: "kb", sessionReportsRoot: "session-reports", rules: base.rules }],
    })
  );
  for (const [rel, content] of Object.entries(articles)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return { dir, file: path.join(dir, targetRel) };
}

// Returns the validator's combined output. warn rules arrive on stdout inside
// hookSpecificOutput.additionalContext; block rules arrive on stderr with exit 2.
function runValidator(dir, file) {
  try {
    const out = execFileSync("node", [HOOK], {
      cwd: dir,
      input: JSON.stringify({
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        cwd: dir,
        tool_input: { file_path: file },
      }),
      encoding: "utf8",
    });
    return out;
  } catch (err) {
    return `${err.stdout || ""}${err.stderr || ""}`;
  }
}

const PSYCHE_AMBIGUOUS = ["---", "type: Person", "---", "", "*Pronouns: she, they, and he.*", "", "Nika leads the team.", ""].join("\n");
const PSYCHE_NAMED = ["---", "type: Person", "---", "", "*Pronouns: they/them in writing; she/her and he/him also accepted.*", "", "Nika leads the team.", ""].join("\n");
const PSYCHE_SINGLE = ["---", "type: Person", "---", "", "*Pronouns: they/them.*", "", "Nika leads the team.", ""].join("\n");

console.log("pronounDeclaration:");
(function () {
  let f = fixture("ambiguous", { "kb/party/Psyche.md": PSYCHE_AMBIGUOUS }, "kb/party/Psyche.md");
  check("three sets with none named for writing warns", runValidator(f.dir, f.file).includes("contentPronounDeclaration"), true);
  rmSync(f.dir, { recursive: true, force: true });

  f = fixture("named", { "kb/party/Psyche.md": PSYCHE_NAMED }, "kb/party/Psyche.md");
  check("a named writing pronoun passes", runValidator(f.dir, f.file).includes("contentPronounDeclaration"), false);
  rmSync(f.dir, { recursive: true, force: true });

  f = fixture("single", { "kb/party/Psyche.md": PSYCHE_SINGLE }, "kb/party/Psyche.md");
  check("one set alone passes", runValidator(f.dir, f.file).includes("contentPronounDeclaration"), false);
  rmSync(f.dir, { recursive: true, force: true });
})();

console.log("pronounConsistency:");
(function () {
  const recapWrong = ["---", "type: Session Report", "---", "", "Psyche stepped through the gate. She had seen this before.", ""].join("\n");
  const recapRight = ["---", "type: Session Report", "---", "", "Psyche stepped through the gate. They had seen this before.", ""].join("\n");

  let f = fixture("wrong", { "kb/party/Psyche.md": PSYCHE_NAMED, "session-reports/r.md": recapWrong }, "session-reports/r.md");
  check("a draft using a non-writing set warns", runValidator(f.dir, f.file).includes("contentPronounConsistency"), true);
  rmSync(f.dir, { recursive: true, force: true });

  f = fixture("right", { "kb/party/Psyche.md": PSYCHE_NAMED, "session-reports/r.md": recapRight }, "session-reports/r.md");
  check("a draft using the writing set passes", runValidator(f.dir, f.file).includes("contentPronounConsistency"), false);
  rmSync(f.dir, { recursive: true, force: true });

  f = fixture("single-src", { "kb/party/Psyche.md": PSYCHE_SINGLE, "session-reports/r.md": recapWrong }, "session-reports/r.md");
  check("no other set listed means nothing to confuse, so no warning", runValidator(f.dir, f.file).includes("contentPronounConsistency"), false);
  rmSync(f.dir, { recursive: true, force: true });

  f = fixture("absent", { "session-reports/r.md": recapWrong }, "session-reports/r.md");
  check("no article for the name passes", runValidator(f.dir, f.file).includes("contentPronounConsistency"), false);
  rmSync(f.dir, { recursive: true, force: true });
})();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node professor-orb/hooks/pronoun-checks.test.mjs`
Expected: FAIL on `three sets with none named for writing warns` and `a draft using a non-writing set warns`. Neither check is registered, so both rules are skipped.

- [ ] **Step 3: Write minimal implementation**

In `professor-orb/hooks/validate-write.mjs`, add before the `CHECKS` map:

```javascript
// ---------------------------------------------------------------------------
// Pronouns
// ---------------------------------------------------------------------------

// The recognized sets, each as its subject form plus the object and possessive
// forms that identify it in prose. A set is "used" when any of its forms
// appears as a whole word.
const PRONOUN_SETS = {
  __proto__: null,
  "they/them": ["they", "them", "their", "theirs", "themself", "themselves"],
  "she/her": ["she", "her", "hers", "herself"],
  "he/him": ["he", "him", "his", "himself"],
  "it/its": ["it", "its", "itself"],
  "xe/xem": ["xe", "xem", "xyr", "xyrs"],
  "ze/hir": ["ze", "hir", "hirs", "zir", "zirs"],
};

// The article's pronoun line: the first line naming pronouns at all. Returns
// { line, sets, writing } where writing is the set the line names for prose, or
// null when it names none.
function pronounLine(body) {
  for (const raw of String(body).split(/\r?\n/)) {
    if (!/pronouns?\s*[:\-]/i.test(raw)) continue;
    const line = raw.trim();
    const lower = line.toLowerCase();
    const sets = [];
    for (const name of Object.keys(PRONOUN_SETS)) {
      const subject = name.split("/")[0];
      if (new RegExp(`\\b${subject}\\b`, "i").test(lower)) sets.push(name);
    }
    if (sets.length === 0) continue;
    // "in writing", "for prose", "in prose", "written as": the phrases that
    // name one set as the one to use. The set named is the one nearest before
    // the phrase, which is how the sentence reads in English.
    let writing = null;
    const marker = lower.search(/\b(?:in writing|for prose|in prose|written as|use)\b/);
    if (marker !== -1) {
      const before = lower.slice(0, marker);
      for (const name of sets) {
        const subject = name.split("/")[0];
        if (new RegExp(`\\b${subject}\\b`, "i").test(before)) writing = name;
      }
    }
    if (writing === null && sets.length === 1) writing = sets[0];
    return { line, sets, writing };
  }
  return null;
}

// An article listing more than one set must name the one prose uses. A
// declaration offering three reads as a choice, which is how party/Psyche.md
// produced four drafts in the wrong pronoun while every other source used one.
// Warn, not block: which set to write is the DM's call about their own
// character, so there is no unambiguous mechanical fix.
function checkPronounDeclaration(params, ctx) {
  const types = Array.isArray(params.appliesToTypes) ? params.appliesToTypes : ["Person"];
  if (!types.includes(ctx.frontmatter.type)) return true;

  const found = pronounLine(ctx.body);
  if (!found) return true;
  if (found.sets.length <= 1) return true;
  if (found.writing !== null) return true;

  return [
    `This article lists ${found.sets.length} pronoun sets (${found.sets.join(", ")}) without naming the one prose uses: "${found.line}"`,
    '  Name it, for example "they/them in writing; she/her and he/him also accepted", so nothing downstream has to choose.',
  ].join("\n");
}

// Flags a body using a pronoun set that a referenced character's article lists
// as accepted but does not name for writing. Deliberately narrow: it fires only
// when the article names one set AND lists others. With no other set listed
// there is nothing to confuse, and a check that guessed would be noise on every
// article with more than one character in it.
function checkPronounConsistency(params, ctx) {
  const types = Array.isArray(params.sourceTypes) ? params.sourceTypes : ["Person"];
  const articles = [];
  for (const root of ctx.searchRoots || []) {
    collectArticles(root, articles, 0);
  }

  // Filter by FILENAME before reading anything. collectArticles walks
  // directories, which costs one readdir per folder; reading and parsing every
  // article it finds would cost up to 1500 readFileSync plus 1500 frontmatter
  // parses on EVERY write, against this hook's timeout. A draft names a handful
  // of characters, so the name test cuts the read set to those few. The test is
  // the same one used below, hoisted, so it cannot drift from it.
  const nameMatches = (abs) => {
    const name = baseNameNoExt(path.basename(abs));
    if (name.length < 3) return false;
    return new RegExp(`\\b${name.replace(/[-_]/g, "[ -_]")}\\b`, "i").test(ctx.body);
  };

  for (const abs of articles) {
    if (abs === ctx.absFilePath) continue;
    if (!nameMatches(abs)) continue;

    let parsed;
    try {
      parsed = parseFrontmatter(readFileSync(abs, "utf8"));
    } catch {
      continue;
    }
    if (!parsed || !types.includes(parsed.data.type)) continue;

    const found = pronounLine(parsed.body);
    if (!found || found.writing === null || found.sets.length <= 1) continue;

    const name = baseNameNoExt(path.basename(abs));
    for (const set of found.sets) {
      if (set === found.writing) continue;
      for (const form of PRONOUN_SETS[set]) {
        if (new RegExp(`\\b${form}\\b`, "i").test(ctx.body)) {
          return [
            `This draft uses ${set} while ${name}'s article names ${found.writing} as the pronoun prose uses: "${found.line}"`,
            `  Rewrite the draft in ${found.writing}, or change the article if the DM says the article is stale (Principle 1).`,
          ].join("\n");
        }
      }
    }
  }
  return true;
}

// Bounded recursive collection of markdown files, matching searchForFileStat's
// depth discipline so a deep knowledge base cannot stall a write.
//
// Does NOT use this file's safeReaddir: that helper returns bare filename
// strings and null on failure, so entry.isDirectory() would throw, the
// check-crash guard at the rule loop would swallow it, and this check would
// silently never fire. withFileTypes avoids a statSync per entry as well.
function collectArticles(dir, out, depth) {
  if (depth > 6 || out.length > 1500) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      collectArticles(path.join(dir, entry.name), out, depth + 1);
    } else if (entry.name.toLowerCase().endsWith(".md")) {
      out.push(path.join(dir, entry.name));
    }
  }
}
```

Add to the `CHECKS` map:

```javascript
  pronounDeclaration: checkPronounDeclaration,
  pronounConsistency: checkPronounConsistency,
```

- [ ] **Step 4: Add the rules**

In `professor-orb/references/base-rules.json`, add after `contentOptionEcho`:

```json
    "contentPronounDeclaration": {
      "provenance": "professor-orb",
      "category": "content",
      "check": "pronounDeclaration",
      "enforcement": "warn",
      "description": "A character article listing more than one pronoun set names the one prose uses.",
      "params": { "appliesToTypes": ["Person"] }
    },
    "contentPronounConsistency": {
      "provenance": "professor-orb",
      "category": "content",
      "check": "pronounConsistency",
      "enforcement": "warn",
      "description": "Prose uses the pronoun a referenced character's article names for writing.",
      "params": { "sourceTypes": ["Person"] }
    }
```

Neither carries a `scope` field, for the reason given in Task 4: a KB article contradicting a character's own writing pronoun is the same defect as a recap that does. Neither carries an `autofix`: which pronoun to write is the DM's judgment.

- [ ] **Step 5: Run test to verify it passes**

Run: `node professor-orb/hooks/pronoun-checks.test.mjs`
Expected: PASS, 7 passed, 0 failed.

- [ ] **Step 6: Update kb-validator**

In `professor-orb/agents/kb-validator.md`, add to the needs-judgment bucket's examples (the section following the mechanically-fixable list at `:111-115`):

```markdown
- A character article whose pronoun line lists more than one set without naming the one prose uses: state the sets found and quote the line. Which set to write is the DM's call about their own character, so this is never a mechanical fix, no matter how consistently the rest of the article reads.
```

- [ ] **Step 7: Run the existing validator suite for regressions**

Run: `node professor-orb/hooks/validate-write.test.mjs`
Expected: PASS, unchanged.

- [ ] **Step 8: Commit**

```bash
git add professor-orb/hooks/validate-write.mjs professor-orb/hooks/pronoun-checks.test.mjs professor-orb/references/base-rules.json professor-orb/agents/kb-validator.md
git commit -m "feat(professor-orb): check a character's writing pronoun mechanically

party/Psyche.md opened with three pronoun sets while the body, the reports, and
the DM's own usage were they throughout, and four consecutive drafts used she.

Two checks rather than one. pronounDeclaration is the root fix: an article
naming the set prose uses leaves nothing downstream to choose.
pronounConsistency is the backstop and fires only when an article names one set
AND lists others, because with nothing to confuse there is nothing to flag.

Both warn rather than block, and neither carries an autofix: which set to write
is the DM's judgment about their own character. kb-validator buckets the
declaration as needs-judgment for the same reason.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The two prose changes

Everything above runs in a subprocess. These two do not, and each is labelled in the file as prose so a later reader does not mistake it for a guarantee. Each earns its place by covering a gap a mechanism structurally cannot.

**Files:**
- Modify: `professor-orb/skills/SHARED-PRINCIPLES.md` (Principle 3, `:27-33`)
- Modify: `professor-orb/skills/debrief/SKILL.md` (Phase 2 Round discipline)

**Interfaces:** none. No code changes.

- [ ] **Step 1: Read the shared principles**

Read `professor-orb/skills/SHARED-PRINCIPLES.md` in full before editing. Every skill, agent, and command reads it at the start of every run, so a change here reaches all 19 components.

- [ ] **Step 2: Extend Principle 3**

Append to Principle 3, after the existing "Do not re-list completed work as open tasks" paragraph:

```markdown
A correction travels. The same claim is usually in the report, its indexes, any
brief that carried it forward, and any staged article drawn from it. On a
correction, the turn's first tool call searches the campaign's lane for every
copy, and the correction is not closed while one survives. The search
establishes scope. It never re-litigates the correction.

This paragraph is prose, and prose is the weakest thing in this plugin: six
principles here already state that the DM's word is law, and on 2026-09-18 all
six held while a false sentence spread through a report, two indexes, and three
commits. The mechanism that catches a correction is the `dm-correction` hook,
which searches the lane itself before this file is even read. What this
paragraph covers is the case the hook's pattern list misses.
```

- [ ] **Step 3: Add the option rule to debrief**

In `professor-orb/skills/debrief/SKILL.md`, append to the **Round discipline** paragraph in Phase 2:

```markdown
**No option states an outcome.** The test is mechanical: if an option's text
could be lifted into the report as a sentence about the session, it is not an
option, it is a draft sentence, and it goes back as the question it should have
asked. A selection points at a topic. What happened comes back in the DM's own
words.

This rule is prose with a machine behind it, which is why it reads as a test
rather than a warning. The `contentOptionEcho` rule refuses to write a report
sentence that restates an option this session offered, so breaking this rule
costs a blocked write rather than a false report. Write the option as a question
and neither fires.
```

- [ ] **Step 4: Add the matching entry to Things to never do**

In the same file's **Things to never do** list, add:

```markdown
- **Never write an option whose text could be a sentence in the report.** An option asks. The answer comes back in the DM's prose, and `contentOptionEcho` blocks the write if it does not.
```

- [ ] **Step 5: Verify every component still carries the preamble**

Run:

```bash
grep -rl "SHARED-PRINCIPLES.md" professor-orb/skills professor-orb/agents professor-orb/commands --include="*.md" | wc -l
```

Expected: 19. CLAUDE.md records that all 19 commands, agents, and skills open by reading that file.

- [ ] **Step 6: Commit**

```bash
git add professor-orb/skills/SHARED-PRINCIPLES.md professor-orb/skills/debrief/SKILL.md
git commit -m "docs(professor-orb): the two prose rules the mechanisms cannot cover

Principle 3 gains the part it never said: a correction is not closed while a
copy survives. The debrief round discipline gains the rule that an option asks
rather than answers.

Both are labelled as prose in the files themselves, with the mechanism that
backs each one named alongside it, so a later reader does not mistake either for
a guarantee. Six principles already said the DM's word is law and all six held
while the 2026-09-18 falsehood spread.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Release

**Files:**
- Modify: `.claude-plugin/marketplace.json` (repo root)
- Modify: `professor-orb/.claude-plugin/plugin.json`
- Modify: `docs/superpowers/specs/2026-09-20-professor-orb-machine-enforced-corrections-design.md`

**Interfaces:** none.

- [ ] **Step 1: Run every suite**

Run:

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

Expected: all twelve suites pass (the eight that existed plus the four added here). Each exits non-zero on failure, so `break` stops at the first one. Takes roughly a minute.

- [ ] **Step 2: Amend the spec with the implementation findings**

Append a section to `docs/superpowers/specs/2026-09-20-professor-orb-machine-enforced-corrections-design.md`:

```markdown
## Amendments from implementation

**`validate-write.mjs` requires frontmatter `type`.** The hook exits 0 at
`hooks/validate-write.mjs:904` when the parsed frontmatter carries no `type`, so
every check in `CHECKS` reaches only files that have one. Session reports
(`Session Report`) and indexes (`Index`) qualify, which covers both sites the
09-18 falsehood reached on disk, so Mechanism 2 has full reach. Content files
qualify only in projects whose `conventions.json` defines a content type, and
`skills/content/SKILL.md` states many projects never formalize content-file
conventions. Mechanism 3 therefore does not reach recaps in every project. The
pronoun failure in a recap draft is caught by `pronounDeclaration` making the
source article unambiguous, not by checking the draft.

**Jaccard content-word overlap replaces edit distance for `optionEcho`, at 0.40.**
The spec named `levenshtein`, already present in the file, as the natural basis
for the near-copy threshold. The 09-18 case disproves it: the option read
"Reporter asked the name. The team answered on camera as the Neighborhood Watch
Association" and the report read "The reporter asked what the team was called,
and they answered on camera." That is a paraphrase merging the option's label
into its description, so edit distance is large while the claim is identical.
Overlap over the union scores it 0.50, against 0.27 for the worst innocent
sentence tested. Overlap over the smaller of the two sets was tried first and
rejected: it scores an innocent sentence at exactly 0.60 against the real
sentence's 0.83, leaving no threshold that separates them.

**`optionEcho` blocks only a sentence the DM never wrote in prose.** The spec
described the rule as blocking a sentence that restates an option, which
deadlocks. A good option paraphrases what it asks about, so a sentence the DM
explicitly confirms still overlaps its option heavily ("yes the reporter asked
what the team was called and they answered on camera" scores 0.60 against its
own option). Under the spec's wording the true sentence could never be written
at all. The implemented check reads the session transcript and passes any
sentence the DM substantially wrote themselves, which is the discrimination the
defect actually calls for: restates an option AND appears nowhere in the DM's
own words. Containment is measured against the single best DM message rather
than all of them pooled, because a realistic debrief transcript scores 1.00
pooled against a sentence it never states, which would suppress every block.
This adds `transcriptPath` to the validator's `ctx`.

**`pronounConsistency` split into two checks.** The spec described one check
plus a `kb-validator` update. The implementation ships `pronounDeclaration` (an
article listing several sets names the one prose uses) and
`pronounConsistency` (prose uses the named set), because the root fix is making
the article unambiguous rather than policing every consumer of it.

**Known follow-up: three new check kinds are not propagated to the other three
places check semantics live.** `hooks/validate-write.mjs` carries a load-bearing
comment (above its `CHECKS` map) stating check semantics are duplicated four
ways: `skills/setup/references/conventions-schema.md`'s check catalog, the
`CHECKS` table itself, the `checkerPrompt` in `workflows/validation-sweep.mjs`,
and `agents/kb-validator.md` Step 4, with the base rule data single-sourced at
`references/base-rules.json` but the semantics not. `optionEcho`,
`pronounDeclaration`, and `pronounConsistency` update only the `CHECKS` table
and `references/base-rules.json`; none of the other three locations mention any
of the three. This means `/sweep`'s validation pass and a `kb-validator` run
have no instruction to retroactively catch these three violation shapes in
articles and reports that predate this plan, including the specific
`party/Psyche.md` case that motivated the pronoun checks in the first place;
only the write-time hooks catch them, and only on the next write to the
affected file. This plan's task decomposition never scoped a task to touch the
other three locations, which is the gap, not an error in what was built: the
write-time mechanisms themselves are complete and independently verified. A
follow-up task should update `conventions-schema.md`'s check catalog,
`validation-sweep.mjs`'s `checkerPrompt`, and `kb-validator.md` Step 4's Content
validation section for all three check kinds together, in one reviewed unit.
```

- [ ] **Step 3: Bump both version files**

Set `version` to `1.19.0` in `.claude-plugin/marketplace.json` and in `professor-orb/.claude-plugin/plugin.json`. They must match; a release with a mismatch is the failure CLAUDE.md warns about.

- [ ] **Step 4: Verify the match**

Run:

```bash
grep -h '"version"' .claude-plugin/marketplace.json professor-orb/.claude-plugin/plugin.json
```

Expected: both lines read `1.19.0`.

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin/marketplace.json professor-orb/.claude-plugin/plugin.json docs/superpowers/specs/2026-09-20-professor-orb-machine-enforced-corrections-design.md
git commit -m "chore(professor-orb): 1.19.0

Records three amendments the implementation forced on the design: the
validator's frontmatter-type gate and what it means for each mechanism's reach,
content-word overlap replacing edit distance for optionEcho, and the pronoun
check splitting in two.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Measured decisions, do not re-litigate by taste

An adversarial pass ran the plan's own code against the 2026-09-18 material before implementation began. Four decisions below came out of that and each has a test case pinning it. A reviewer who finds one of them odd should read its test before changing it, because each replaced something that looked more natural and was wrong.

| Decision | What it replaced, and why |
| --- | --- |
| Jaccard, threshold 0.40 | Overlap over `Math.min(a,b)` at 0.60. "The reporter and the team were on camera together at the scene" scores exactly 0.60 that way and blocks; the real 09-18 sentence scores 0.83. No threshold separates them. Under Jaccard: 0.27 against 0.50. |
| Block only when the DM never wrote it | Blocking on option overlap alone. A good option paraphrases what it asks about, so "yes the reporter asked what the team was called and they answered on camera" scores 0.60 against its own option. The rule would refuse the true sentence forever with no escape. |
| Containment per message, maximum | Containment against pooled DM messages. On a realistic debrief transcript (bulk memory plus short answers) the 09-18 sentence scores **1.00** pooled, suppressing every block and leaving the rule dead while it still looks alive. Per message the same transcript scores 0.33, against 1.00 for a real confirmation. |
| `type: "text"` parts only | Accepting every part of a user-role event. An `AskUserQuestion` selection returns through the transcript as a user event carrying a `tool_result`, so the option's own text would come back as the DM's prose and suppress exactly the blocks this rule exists for. |

Two further findings are already folded into the tasks: `collectArticles` cannot use this file's `safeReaddir` (it returns bare strings and `null`, so `entry.isDirectory()` throws into the rule loop's crash guard and the check silently never fires), and `checkPronounConsistency` filters candidate articles by filename before reading any of them (otherwise up to 1500 `readFileSync` plus 1500 frontmatter parses run on every write).

The pattern list in Task 1 was also run against its full corpus: 9 must-fire and 8 must-stay-silent all classify correctly as written, including the near-miss "the party never found the ledger, so they moved on".

## The one thing to confirm live

`ctx.transcriptPath` comes from `input.transcript_path` on the `PostToolUse` payload. Task 4's tests supply that field explicitly, so they pass whether or not the harness sends it. If the harness does not, `dmMessages` returns `null`, `checkOptionEcho` passes, and `contentOptionEcho` silently never fires, which is the correct degradation and is indistinguishable from the rule working.

So after Task 7, run one real `debrief` through Phase 3 and confirm the rule either blocks or visibly passes on a report you know contains an option restatement. This is the only claim in the plan that its own tests cannot verify.

## Notes for the implementer

**`setup` propagation.** `setup` generates a consumer's `conventions.json` from `references/base-rules.json` plus a project extras layer, so the three new rules reach an existing project on its next setup or resync. No migration ships here. Absent the new rules, the three checks never fire, which is the correct degradation: `validate-write.mjs` iterates `owner.rules`, so a rule the consumer does not have is simply not run.

**The `.professor-orb/asked-options.json` ignore is in the wrong repo.** The `.gitignore` entry in Task 3 covers this development repo. A consumer project needs its own entry, which `setup` writes alongside the rest of its `.professor-orb/` scaffolding. That is out of scope here and worth a follow-up: the file is small and holds no secrets, so a consumer committing it is untidy rather than dangerous.

**What this plan does not fix.** The length and compression defect (report section 3) and hedge escalation (report section 2, remainder) ship nothing, by decision recorded in the spec. Both are only addressable by unenforceable prose, and this plugin already has six pieces of unenforceable prose that failed on the night in question.
