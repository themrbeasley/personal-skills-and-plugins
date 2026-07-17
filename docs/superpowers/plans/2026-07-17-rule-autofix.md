# Rule Autofix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A KB write that trips a rule the DM marked auto-fixable gets fixed by a haiku subagent without the DM prompting, and the DM sees one line saying what changed.

**Architecture:** A rule opts in by carrying an `autofix` guidance string in `conventions.json`. When such a rule fails, `validate-write.mjs` appends a dispatch request naming the file, rule, and guidance; the main session reads it and dispatches the new `rule-fixer` agent, which applies only that rule's fix and reports one line. A hook cannot dispatch a subagent (it is a subprocess with no channel to the Agent tool), so the request is an instruction the main agent acts on, not a forced call. The fixer's own Edit re-fires the hook, which detects `agent_type === "rule-fixer"` and withholds a second request, bounding the system at one dispatch per firing while still verifying the fix.

**Tech Stack:** Node ESM built-ins only (the hook's standing constraint). No test framework; verification is the scratchpad harness driving real PostToolUse payloads.

**Spec:** `docs/superpowers/specs/2026-07-17-rule-autofix-design.md`. Read it before starting; it carries the evidence and the verbatim doc quotes this plan relies on.

## Global Constraints

- **No em dashes in any output**: code, comments, commit messages, rule descriptions, agent prose, doc prose. A double hyphen is not a substitute. Verify with `grep -c $'—' <file>` before each commit.
- Node built-ins only in `validate-write.mjs`.
- Never edit the marketplace cache under `C:\Users\jorda\.claude\plugins\cache\`. It is a build artifact.
- Never run `professor-orb:setup`. It regenerates `conventions.json` wholesale and would discard hand-tuned rules.
- The plugin stays system-agnostic: no Rolara rule ids, no em dash logic, no see-also logic in plugin code.
- No Shadow Moon / Hemingway Protocol content in any rule description, message, doc, or commit message.
- A check must never crash a write. Malformed config is inconclusive (`null`), never an enforcement change.
- Commit style: `feat(professor-orb): ...` / `fix(professor-orb): ...`, body paragraph, then `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Version goes 1.3.0 to 1.4.0 in BOTH `professor-orb/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, same commit.
- Paths: hook at `C:\Users\jorda\OneDrive\Documents\GitHub\claude-skills_and_plugins-homebrew\professor-orb\hooks\validate-write.mjs`; scratchpad `<SCRATCH>` = `C:\Users\jorda\AppData\Local\Temp\claude\C--Users-jorda-OneDrive-Documents-GitHub-claude-skills-and-plugins-homebrew\8323ef37-1954-4064-9709-59fe79b749b0\scratchpad`.
- **Never pipe hand-written JSON payloads through Git Bash.** MSYS collapses `\\`, the hook's JSON.parse guard swallows the bad escape and exits 0 silently, and the test looks like a pass while proving nothing. Build every payload inside Node with `JSON.stringify`. See `.claude/skills/verify/SKILL.md`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `professor-orb/hooks/validate-write.mjs` | Modify | Emit warnings where Claude can see them; emit autofix dispatch requests; guard recursion via `agent_type` |
| `professor-orb/agents/rule-fixer.md` | Create | The haiku fixer: one rule, one file, one line back |
| `professor-orb/skills/setup/references/conventions-schema.md` | Modify | Document the `autofix` field; correct the false `warn` row |
| `professor-orb/hooks/hooks.json` | Modify | Timeout units (seconds, not milliseconds) |
| `<Rolara>\.professor-orb\conventions.json` | Modify (no git) | Switch on autofix for two rules |
| `professor-orb/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | Modify | 1.4.0 |

---

### Task 1: Harness for the new behavior (scratchpad only, no commit)

**Files:**
- Create: `<SCRATCH>\autofix-cases.mjs`
- Creates at runtime: `<SCRATCH>\autofix-fixture\`

**Interfaces:**
- Produces: `node autofix-cases.mjs [hookPath]` prints one PASS/FAIL line per case, then `ALL PASS` or `N FAILING`; exit 0/1.
- Case ids A1 through A8 map 1:1 to the spec's Testing section.

- [ ] **Step 1: Write the harness**

Write to `<SCRATCH>\autofix-cases.mjs`:

```js
#!/usr/bin/env node
// End-to-end driver for the autofix and warn-visibility behavior of
// professor-orb's validate-write.mjs. Payloads are built with JSON.stringify
// so no shell can mangle them. Node built-ins only.

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK =
  process.argv[2] ||
  "C:\\Users\\jorda\\OneDrive\\Documents\\GitHub\\claude-skills_and_plugins-homebrew\\professor-orb\\hooks\\validate-write.mjs";
const FIX = path.join(HERE, "autofix-fixture");

const GUIDANCE_BLOCK = "Replace each FORBIDDEN token with the word ALLOWED. Change nothing else.";
const GUIDANCE_WARN = "Add the missing category field. Change nothing else.";

function write(rel, content) {
  const abs = path.join(FIX, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

function buildFixture() {
  rmSync(FIX, { recursive: true, force: true });
  write(
    ".professor-orb/conventions.json",
    JSON.stringify({
      version: 1,
      kbRoot: "kb",
      generatedBy: "manual",
      rules: {
        blockAutofix: {
          category: "content",
          check: "prohibitedPattern",
          enforcement: "block",
          description: "No FORBIDDEN token.",
          autofix: GUIDANCE_BLOCK,
          params: { pattern: "FORBIDDEN", appliesTo: "body" },
        },
        blockPlain: {
          category: "content",
          check: "prohibitedPattern",
          enforcement: "block",
          description: "No NOFIXTOKEN token.",
          params: { pattern: "NOFIXTOKEN", appliesTo: "body" },
        },
        warnAutofix: {
          category: "frontmatter",
          check: "requiredFields",
          enforcement: "warn",
          description: "category should be present.",
          autofix: GUIDANCE_WARN,
          params: { fields: ["category"], requiredSubset: ["category"], orderMatters: false },
        },
        warnPlain: {
          category: "frontmatter",
          check: "requiredFields",
          enforcement: "warn",
          description: "summary should be present.",
          params: { fields: ["summary"], requiredSubset: ["summary"], orderMatters: false },
        },
        badAutofix: {
          category: "content",
          check: "prohibitedPattern",
          enforcement: "block",
          description: "No MALFORMEDCASE token.",
          autofix: 42,
          params: { pattern: "MALFORMEDCASE", appliesTo: "body" },
        },
      },
    })
  );

  // Trips blockAutofix only. warnAutofix/warnPlain also fire (no category,
  // no summary), so this file doubles as the block-plus-warn case.
  write("kb/Block.md", "---\ntype: Person\n---\n\nThis has a FORBIDDEN token.\n");
  // Trips blockPlain only, plus the two warns.
  write("kb/Plain.md", "---\ntype: Person\n---\n\nThis has a NOFIXTOKEN token.\n");
  // Trips warns only: no block token present.
  write("kb/WarnOnly.md", "---\ntype: Person\n---\n\nNothing forbidden here.\n");
  // Trips badAutofix (malformed autofix param) only.
  write("kb/Malformed.md", "---\ntype: Person\ncategory: X\nsummary: Y\n---\n\nA MALFORMEDCASE token.\n");
  // Trips nothing at all.
  write("kb/Clean.md", "---\ntype: Person\ncategory: X\nsummary: Y\n---\n\nAll fine here.\n");
}

function run(rel, extra = {}) {
  const payload = {
    tool_name: "Write",
    tool_input: { file_path: path.join(FIX, rel) },
    cwd: FIX,
    ...extra,
  };
  const res = spawnSync("node", [HOOK], { input: JSON.stringify(payload), encoding: "utf8" });
  return { code: res.status, out: res.stdout || "", err: res.stderr || "" };
}

function parseJsonStdout(out) {
  try {
    return JSON.parse(out.trim());
  } catch {
    return null;
  }
}

const CASES = [
  {
    name: "A1 block rule with autofix, outside fixer: stderr carries the dispatch request",
    fn: () => {
      const r = run("kb/Block.md");
      const p = [];
      if (r.code !== 2) p.push(`exit ${r.code}, expected 2`);
      if (!r.err.includes("blockAutofix")) p.push("stderr missing rule id");
      if (!r.err.includes("rule-fixer")) p.push("stderr missing the agent name");
      if (!r.err.includes("kb\\Block.md") && !r.err.includes("kb/Block.md")) p.push("stderr missing the file path");
      if (!r.err.includes(GUIDANCE_BLOCK)) p.push("stderr missing the guidance verbatim");
      return p;
    },
  },
  {
    name: "A2 same payload inside the fixer: violation reported, NO dispatch request",
    fn: () => {
      const r = run("kb/Block.md", { agent_id: "sub-1", agent_type: "rule-fixer" });
      const p = [];
      if (r.code !== 2) p.push(`exit ${r.code}, expected 2`);
      if (!r.err.includes("blockAutofix")) p.push("stderr missing rule id");
      if (r.err.includes("AUTOFIX AVAILABLE")) p.push("stderr must not ask the fixer to dispatch the fixer");
      return p;
    },
  },
  {
    name: "A3 warn rule with autofix: exit 0, JSON additionalContext carries the request",
    fn: () => {
      const r = run("kb/WarnOnly.md");
      const p = [];
      if (r.code !== 0) p.push(`exit ${r.code}, expected 0`);
      const j = parseJsonStdout(r.out);
      if (!j) return [...p, `stdout is not JSON: ${JSON.stringify(r.out.slice(0, 120))}`];
      const ctx = (j.hookSpecificOutput || {}).additionalContext || "";
      if ((j.hookSpecificOutput || {}).hookEventName !== "PostToolUse") p.push("hookEventName not PostToolUse");
      if (!ctx.includes("warnAutofix")) p.push("additionalContext missing the warn rule id");
      if (!ctx.includes(GUIDANCE_WARN)) p.push("additionalContext missing the warn guidance");
      return p;
    },
  },
  {
    name: "A4 warn rule without autofix reaches Claude at all (dead-warn regression guard)",
    fn: () => {
      const r = run("kb/WarnOnly.md");
      const j = parseJsonStdout(r.out);
      if (!j) return ["stdout is not JSON"];
      const ctx = (j.hookSpecificOutput || {}).additionalContext || "";
      return ctx.includes("warnPlain") ? [] : ["additionalContext missing the plain warn rule id"];
    },
  },
  {
    name: "A5 block and warn on one write: stderr carries both",
    fn: () => {
      const r = run("kb/Block.md");
      const p = [];
      if (r.code !== 2) p.push(`exit ${r.code}, expected 2`);
      if (!r.err.includes("blockAutofix")) p.push("stderr missing the block rule id");
      if (!r.err.includes("warnPlain")) p.push("stderr missing the warn rule id (warnings dropped on block)");
      return p;
    },
  },
  {
    name: "A6 block rule without autofix: no dispatch request",
    fn: () => {
      const r = run("kb/Plain.md");
      const p = [];
      if (r.code !== 2) p.push(`exit ${r.code}, expected 2`);
      if (!r.err.includes("blockPlain")) p.push("stderr missing rule id");
      if (r.err.includes("AUTOFIX AVAILABLE")) p.push("opted-out rule must not request a dispatch");
      return p;
    },
  },
  {
    name: "A7 malformed autofix (a number) is treated as absent, no crash",
    fn: () => {
      const r = run("kb/Malformed.md");
      const p = [];
      if (r.code !== 2) p.push(`exit ${r.code}, expected 2`);
      if (!r.err.includes("badAutofix")) p.push("stderr missing rule id, rule should still enforce");
      if (r.err.includes("AUTOFIX AVAILABLE")) p.push("malformed autofix must not request a dispatch");
      return p;
    },
  },
  {
    name: "A8 clean file: exit 0, no output at all",
    fn: () => {
      const r = run("kb/Clean.md");
      const p = [];
      if (r.code !== 0) p.push(`exit ${r.code}, expected 0`);
      if (r.out.trim() !== "") p.push(`stdout not empty: ${JSON.stringify(r.out.slice(0, 80))}`);
      if (r.err.trim() !== "") p.push(`stderr not empty: ${JSON.stringify(r.err.slice(0, 80))}`);
      return p;
    },
  },
];

buildFixture();
let failed = 0;
for (const c of CASES) {
  const problems = c.fn();
  if (problems.length === 0) {
    console.log(`PASS ${c.name}`);
  } else {
    failed++;
    console.log(`FAIL ${c.name}`);
    for (const p of problems) console.log(`     ${p}`);
  }
}
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILING`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run the baseline against the shipped 1.3.0 hook and confirm the failures are the expected ones**

Run: `node "<SCRATCH>\autofix-cases.mjs"`

Expected against the unmodified hook:
- FAIL A1 (no dispatch request exists yet)
- PASS A2 (vacuously: nothing emits a request, so none leaks to the fixer)
- FAIL A3 (stdout is bare text, not JSON)
- FAIL A4 (same)
- FAIL A5 (warnings are dropped when a block fires)
- PASS A6, A7 (vacuously)
- PASS A8

If anything fails differently, STOP and diagnose. A2/A6/A7 passing vacuously is expected and fine; they become real guards once Task 3 lands.

- [ ] **Step 3: Confirm the existing 1.3.0 suites still pass, so this task changed nothing**

Run: `node "<SCRATCH>\run-cases.mjs"` then `node "<SCRATCH>\probes.mjs"`
Expected: `ALL PASS` and `ALL PROBES PASS`.

---

### Task 2: Make warn rules visible to Claude

**Files:**
- Modify: `professor-orb/hooks/validate-write.mjs` (end of `main()`)
- Modify: `professor-orb/skills/setup/references/conventions-schema.md` (Enforcement levels table)

**Interfaces:**
- Produces: on a warn-only write, stdout is a JSON body `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"<warnings>"}}`; on a blocking write, stderr carries block violations followed by warnings. Cases A3, A4, A5 go green.

- [ ] **Step 1: Confirm A3, A4, A5 are red** (Task 1 baseline showed this; re-run if anything changed)

- [ ] **Step 2: Replace the output block at the end of `main()`**

Replace:

```js
  if (blockViolations.length > 0) {
    process.stderr.write(blockViolations.join("\n") + "\n");
    process.exit(2);
  }

  if (warnings.length > 0) {
    process.stdout.write(warnings.join("\n") + "\n");
  }

  process.exit(0);
```

with:

```js
  // Exit 2 is the only channel that reaches Claude with a non-zero status, and
  // a JSON body is parsed only on exit 0, so the two are mutually exclusive. A
  // blocking write therefore carries its warnings on stderr as well; before
  // this they were discarded whenever anything blocked.
  if (blockViolations.length > 0) {
    process.stderr.write([...blockViolations, ...warnings].join("\n") + "\n");
    process.exit(2);
  }

  // PostToolUse stdout goes to the debug log, not to Claude and not to the
  // transcript: only UserPromptSubmit, UserPromptExpansion, and SessionStart
  // treat it as context. additionalContext in a JSON body is the supported way
  // for this event to reach the model, so warn rules use it. Printing bare text
  // here, as earlier versions did, meant no warn rule was ever seen by anyone.
  if (warnings.length > 0) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: warnings.join("\n"),
        },
      })
    );
  }

  process.exit(0);
```

- [ ] **Step 3: Run the harness**

Run: `node "<SCRATCH>\autofix-cases.mjs"`
Expected: A3 partially advances (JSON now parses) but still FAILs on the missing guidance; A4 PASS; A5 PASS; A8 PASS.

- [ ] **Step 4: Guard the older suites**

Run: `node "<SCRATCH>\run-cases.mjs"`
Expected: C1's `outHas: ["Ghost-Article"]` assertion still passes because the rule id and target now travel inside the JSON body's `additionalContext` string, which `stdout.includes` still matches. If C1 fails, the assertion needs updating to parse JSON, not the hook.

Run: `node "<SCRATCH>\probes.mjs"`
Expected: `ALL PROBES PASS`.

- [ ] **Step 5: Correct the schema doc's false claim**

In `conventions-schema.md`, replace the `warn` row:

```markdown
| `warn` | Exits 0, prints the violation to stdout. The write proceeds. | Claude sees the warning and may act on it, but nothing is gated. |
```

with:

```markdown
| `warn` | Exits 0 and returns the violation as `hookSpecificOutput.additionalContext`. The write proceeds. | Claude sees the warning next to the tool result and may act on it, but nothing is gated. |
```

Add below the table:

```markdown
A PostToolUse hook's plain stdout reaches the debug log only, never Claude and
never the transcript; `additionalContext` in a JSON body is the supported channel
for this event. Any future check that wants to tell Claude something must go
through the same field rather than printing.
```

- [ ] **Step 6: Commit**

```bash
git add professor-orb/hooks/validate-write.mjs professor-orb/skills/setup/references/conventions-schema.md
git commit -m "fix(professor-orb): make warn rules visible to Claude

A PostToolUse hook's stdout reaches the debug log and nothing else; only
UserPromptSubmit, UserPromptExpansion, and SessionStart treat it as context.
The hook printed warnings to stdout and exited 0, so every warn rule has been
invisible to Claude and to the DM since the validator shipped. Seven of
Rolara's twelve rules are warn, including contentWikilinkPolicy, whose
escaped-pipe defect was reported as hard to notice for exactly this reason.
Return warnings as hookSpecificOutput.additionalContext instead, and carry
them on stderr alongside a block rather than dropping them. The schema
reference documented the old behavior as working; correct it.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Autofix dispatch request and recursion guard

**Files:**
- Modify: `professor-orb/hooks/validate-write.mjs` (new constant and helper above `main()`; ctx, rule loop, and output inside `main()`)
- Modify: `professor-orb/skills/setup/references/conventions-schema.md` (rule entry shape section)

**Interfaces:**
- Consumes: `rule.autofix` (string), `input.agent_type` (string, present only inside a subagent).
- Produces: `ctx.relProjectPath` (string, file path relative to the project root, what the fixer opens); a dispatch request appended to stderr (blocking write) or to `additionalContext` (warn-only write). Cases A1, A2, A3, A6, A7 go green.

- [ ] **Step 1: Confirm A1 is red and A3 still fails on the guidance assertion**

- [ ] **Step 2: Add the fixer constant and the request formatter above `main()`**

Insert directly above the `// Main` banner comment:

```js
// ---------------------------------------------------------------------------
// Autofix requests
// ---------------------------------------------------------------------------

// The agent the hook asks the main session to dispatch. A hook cannot dispatch
// it directly: a hook is a subprocess handed JSON on stdin, with no channel to
// the Agent tool. It can only leave the request in output Claude reads, so this
// is an instruction the main session follows, not a forced call.
const FIXER_AGENT = "rule-fixer";

function formatAutofixRequest(ruleId, guidance, ctx) {
  return [
    `AUTOFIX AVAILABLE for [${ruleId}]. Dispatch the professor-orb ${FIXER_AGENT} agent now, once for this file, and do not fix this yourself.`,
    `  file: ${ctx.relProjectPath}`,
    `  rule: ${ruleId}`,
    `  guidance: ${guidance}`,
    "The DM pre-approved this fix class by setting autofix on the rule, so apply it without asking.",
  ].join("\n");
}
```

- [ ] **Step 3: Read `agent_type` and add `relProjectPath` to ctx**

In `main()`, after `const toolName = input.tool_name;` add:

```js
  // Present only when the hook fires inside a subagent. Used to stop the fixer
  // being asked to dispatch itself.
  const agentType = input.agent_type;
```

In the `ctx` literal, after `relPath: relToKb,` add:

```js
    relProjectPath: path.relative(projectRoot, absFilePath),
```

- [ ] **Step 4: Collect requests in the rule loop**

Change:

```js
  const blockViolations = [];
  const warnings = [];
```

to:

```js
  const blockViolations = [];
  const warnings = [];
  const autofixRequests = [];
```

Then, immediately after the existing enforcement branch:

```js
    if (rule.enforcement === "block") {
      blockViolations.push(`[${ruleId}] ${message}`);
    } else if (rule.enforcement === "warn") {
      warnings.push(`[${ruleId}] ${message}`);
    }
```

insert:

```js
    // Only a rule that actually failed reaches here, and only one whose
    // enforcement is a recognized level that produced a violation entry above.
    // A malformed autofix value, or an unrecognized enforcement value, is
    // treated as absent: it never emits a request and never changes enforcement.
    if (
      (rule.enforcement === "block" || rule.enforcement === "warn") &&
      typeof rule.autofix === "string" &&
      rule.autofix.trim() !== "" &&
      agentType !== FIXER_AGENT
    ) {
      autofixRequests.push(formatAutofixRequest(ruleId, rule.autofix.trim(), ctx));
    }
```

- [ ] **Step 5: Append requests to both output channels**

In the output block from Task 2, change the stderr line:

```js
    process.stderr.write([...blockViolations, ...warnings].join("\n") + "\n");
```

to:

```js
    process.stderr.write([...blockViolations, ...warnings, ...autofixRequests].join("\n") + "\n");
```

and change the warn condition and body:

```js
  if (warnings.length > 0) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: warnings.join("\n"),
        },
      })
    );
  }
```

to:

```js
  if (warnings.length > 0 || autofixRequests.length > 0) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: [...warnings, ...autofixRequests].join("\n"),
        },
      })
    );
  }
```

- [ ] **Step 6: Run the harness**

Run: `node "<SCRATCH>\autofix-cases.mjs"`
Expected: `ALL PASS`.

- [ ] **Step 7: Guard the older suites**

Run: `node "<SCRATCH>\run-cases.mjs"` then `node "<SCRATCH>\probes.mjs"`
Expected: `ALL PASS` and `ALL PROBES PASS`. Neither fixture defines `autofix`, so neither should see a request.

- [ ] **Step 8: Document the field in the schema reference**

In `conventions-schema.md`, in the "Rule entry shape" annotated block, add after the `description` field:

```jsonc
    // Optional. Plain-English instructions for fixing a violation of THIS rule,
    // written for a model to follow. Present means the DM has pre-approved this
    // class of fix: when the rule fails, the hook asks the main session to
    // dispatch the rule-fixer agent, which applies the guidance to the whole
    // file and reports one line. Absent (the default) means violations are
    // only reported. A non-string or empty value is treated as absent.
    "autofix": "Replace each X with Y. Change nothing else.",
```

Add a subsection after "Enforcement levels":

```markdown
## Autofix

A rule may carry an optional `autofix` string. It holds plain-English guidance a
model can follow to correct a violation of that rule, and its presence is the
DM's standing approval for that class of fix.

When a rule with `autofix` fails, the hook appends a request naming the file, the
rule, and the guidance verbatim, and the main session dispatches the `rule-fixer`
agent to apply it. The hook cannot dispatch the agent itself; it can only make
the request. If the main session does not act on it, behavior degrades to a
reported violation, which is the same as having no `autofix` at all.

Write guidance that is specific about what may change and what may not. The
fixer applies it to every instance in the file, not only the one that triggered
the write, so a rule whose fix depends on per-instance judgment is a poor
candidate: leave those opted out and let the DM decide each one.

`autofix` composes with any `enforcement` level and any `check` kind. Nothing
about a particular project's rules lives in plugin code.
```

- [ ] **Step 9: Verify no em dashes, then commit**

Run: `grep -c $'—' professor-orb/hooks/validate-write.mjs professor-orb/skills/setup/references/conventions-schema.md`
Expected: `0` for both.

```bash
git add professor-orb/hooks/validate-write.mjs professor-orb/skills/setup/references/conventions-schema.md
git commit -m "feat(professor-orb): request an autofix dispatch when a rule opts in

A rule carrying an autofix guidance string is one the DM has pre-approved a
fix class for. When such a rule fails, the hook now appends a request naming
the file, the rule, and the guidance, and the main session dispatches the
rule-fixer agent to apply it. A hook cannot dispatch a subagent, so this is
an instruction rather than a forced call; if it is ignored, behavior is
exactly what it is today.

The hook withholds the request when agent_type is rule-fixer, so the fixer is
never asked to dispatch itself. Its edit still re-fires the hook, which is how
the fix gets verified for free, the same property the validation sweep relies
on.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: The `rule-fixer` agent

**Files:**
- Create: `professor-orb/agents/rule-fixer.md`

**Interfaces:**
- Consumes: a dispatch prompt carrying `file`, `rule`, and `guidance`, as formatted by `formatAutofixRequest`.
- Produces: exactly one line of text, for example `Kivin.md: 3 em dashes to commas, 1 to a colon`.

- [ ] **Step 1: Read the sibling agent and the existing fixer prompt for shape**

Read `professor-orb/agents/kb-validator.md` (frontmatter shape, Rules section style) and the `fixPrompt` function in `professor-orb/workflows/validation-sweep.mjs` (around line 205). The new agent is the interactive counterpart of that prompt and must not contradict it.

- [ ] **Step 2: Write the agent**

Create `professor-orb/agents/rule-fixer.md`:

```markdown
---
name: rule-fixer
description: |
  Applies one pre-approved convention fix to one KB article, using guidance the
  DM wrote into that rule. Fixes every instance of that one rule in the file and
  changes nothing else, then reports one line.

  Dispatched by the write-time validator hook when a failing rule carries an
  autofix guidance string. Never invoke it for a rule without one, and never for
  a violation the DM has not pre-approved a fix class for.

  <example>
  Context: the validator hook reports a rule failure and names this agent
  user: (hook output) AUTOFIX AVAILABLE for [contentNoEmDashes]. Dispatch the professor-orb rule-fixer agent now.
  assistant: "I'll dispatch the rule-fixer agent to apply the DM's approved fix for contentNoEmDashes."
  <commentary>
  The DM pre-approved this fix class by configuring autofix on the rule, so the fix is applied without asking.
  </commentary>
  </example>
tools: Read, Edit
model: haiku
color: green
---

You apply exactly one convention fix to exactly one knowledge base article. You are given a file, a rule id, and the DM's own guidance for fixing that rule. Apply that guidance and nothing else, then report one line.

Apply the principles in `../skills/SHARED-PRINCIPLES.md`: the DM is the source of truth, no em dashes, scope discipline.

## Your input

Three things, from the validator hook:

- **file**: the article to fix, relative to the project root.
- **rule**: the rule id that failed.
- **guidance**: the DM's instructions for fixing that rule. This is authoritative. It came from the project's conventions file, which the DM wrote. Follow it literally.

## Process

1. Read the file.
2. Find every instance in it that violates the named rule. Fix all of them, not only the one that triggered the write. Cleaning the whole file on touch is the point: most violations predate the rule.
3. Apply the guidance exactly. Where the guidance offers a choice (for example several punctuation marks), pick the one that fits the sentence.
4. Save with Edit.
5. Report one line.

## Rules

- **One rule only.** Fix only the rule you were given. If you notice a different violation, leave it: another rule owns it, and the DM may not have approved a fix for it.
- **Change nothing else.** Not wording, not word order, not formatting, not frontmatter, not headings, not links. The guidance defines the entire scope of your edit. A fix that also improves a sentence is a violation of this rule.
- **Never touch fenced code blocks.** Content inside triple-backtick fences is mechanical text (Foundry HTML, macros, stat blocks). A character that looks like a violation there is data, not prose.
- **If you cannot fix an instance within the guidance, leave it and say so.** Do not guess, do not stretch the guidance, do not invent a remedy the DM did not authorize. A reported miss is cheap; a wrong edit to the DM's prose is not.
- **Do not ask for approval.** The DM approved this fix class in advance by configuring it. Asking defeats the point.
- **No em dashes** in your output or your edits. A double hyphen is not a substitute.

## Output

One line, and nothing else. Name the file and what you changed, specifically enough that the DM can spot a bad call and undo it:

```
Kivin.md: 3 em dashes to commas, 1 to a colon
```

If you left something unfixed, say so in the same line:

```
Void.md: 2 em dashes to commas; left 1 inside a code fence
```

If there was nothing to fix, say that:

```
Kivin.md: nothing to fix for contentNoEmDashes
```
```

- [ ] **Step 3: Validate the frontmatter constraints**

Run:

```bash
node -e "
const fs=require('fs');
const s=fs.readFileSync('professor-orb/agents/rule-fixer.md','utf8');
const m=/^---\n([\s\S]*?)\n---/.exec(s);
const d=/description: \|\n([\s\S]*?)\ntools:/.exec(m[1]);
console.log('description chars:', d[1].length, d[1].length < 1500 ? 'OK' : 'TOO LONG');
console.log('color valid:', /color: (red|blue|green|yellow|purple|orange|pink|cyan)\b/.test(m[1]));
console.log('em dashes:', (s.match(/—/g)||[]).length);
"
```

Expected: description under 1500 chars (repo CLAUDE.md's Cowork constraint), color valid, em dashes `0`.

- [ ] **Step 4: Commit**

```bash
git add professor-orb/agents/rule-fixer.md
git commit -m "feat(professor-orb): add the rule-fixer agent

The interactive counterpart of the validation sweep's fixer prompt: one rule,
one file, one line back. It exists so the fix has judgment behind it. The
motivating rule bans em dashes, and Rolara's own CLAUDE.md lists four possible
remedies for one, which is the tell that no substitution is correct; a model
picks the punctuation that fits the sentence, a regex cannot.

Its scope discipline is the whole safety story: one rule, no rewording, no
code fences, and a reported miss rather than a guessed fix.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Hook timeout units

**Files:**
- Modify: `professor-orb/hooks/hooks.json`

**Interfaces:**
- Produces: `validate-write` capped at 10 seconds, `pipeline-next` at 5.

- [ ] **Step 1: Confirm the unit before changing anything**

Read the timeout row of the hooks reference at https://code.claude.com/docs/en/hooks.md. It reads: "Seconds before canceling. Defaults: 600 for `command`, `http`, and `mcp_tool`". The configured `10000` is therefore 2.8 hours, not 10 seconds.

- [ ] **Step 2: Fix both values**

In `hooks.json`, change `"timeout": 10000` to `"timeout": 10`, and `"timeout": 5000` to `"timeout": 5`.

- [ ] **Step 3: Validate the JSON and confirm the hook still runs inside the new budget**

```bash
node -e "JSON.parse(require('fs').readFileSync('professor-orb/hooks/hooks.json','utf8')); console.log('valid JSON')"
```

Then time the slowest realistic payload, a table-heavy index whose every wikilink triggers a full recursive KB walk:

```bash
node -e "
const {spawnSync}=require('child_process');
const path=require('path');
const R='C:\\\\Users\\\\jorda\\\\OneDrive\\\\Documents\\\\Claude\\\\Projects\\\\World of Rolara';
const t=Date.now();
const r=spawnSync('node',['professor-orb/hooks/validate-write.mjs'],{input:JSON.stringify({tool_name:'Edit',tool_input:{file_path:path.join(R,'rolara-kb','characters','Characters-INDEX.md')},cwd:R}),encoding:'utf8'});
console.log('exit',r.status,'in',Date.now()-t,'ms');
"
```

Expected: well under 10000 ms. If it is not, STOP: the 10 second cap would start killing real writes, and `checkWikilinkPolicy`'s per-target KB walk needs a cache first. Report the timing rather than raising the cap back.

- [ ] **Step 4: Commit**

```bash
git add professor-orb/hooks/hooks.json
git commit -m "fix(professor-orb): hook timeouts are in seconds, not milliseconds

The hooks reference reads 'Seconds before canceling', so the configured 10000
and 5000 were a 2.8 hour and a 1.4 hour ceiling, not 10s and 5s. Nothing has
gone wrong yet because the validator is normally fast, but checkWikilinkPolicy
walks the whole KB once per wikilink target, so a 43 link index triggers 43
recursive scans of 1637 files, and nothing would have cut that off.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Switch on the two Rolara rules (project config, outside this repo, no git)

**Files:**
- Modify: `C:\Users\jorda\OneDrive\Documents\Claude\Projects\World of Rolara\.professor-orb\conventions.json`

**Interfaces:**
- Consumes: the `autofix` field from Task 3, the agent from Task 4.
- NOTE: the installed hook is still 1.3.0 until Task 7 republishes, and 1.3.0 ignores unknown rule fields. The config is therefore inert until then, which is safe ordering.

- [ ] **Step 1: Add `autofix` to `contentNoEmDashes`**

Add this key to the rule, after `description`:

```json
      "autofix": "Replace each em dash or double hyphen with the punctuation that fits the sentence: a comma, a colon, or parentheses. In a heading, prefer a colon. Change only the punctuation and the spacing around it. Do not reword, reorder, or restructure any sentence. Never substitute a double hyphen. Leave anything inside a fenced code block untouched.",
```

- [ ] **Step 2: Add `autofix` to `contentSeeAlsoFooterProhibited`**

Add this key to the rule, after `description`:

```json
      "autofix": "Remove the manual See also reference. If the line contains only the See also footer, delete the line and any blank line it leaves behind. If the See also is part of a longer line (for example an entry count), remove only the See also segment and its separator, keeping the rest of the line and its formatting intact. Do not add a replacement: backlinks are generated automatically.",
```

- [ ] **Step 3: Validate**

```bash
node -e "
const c=JSON.parse(require('fs').readFileSync(String.raw\`C:\Users\jorda\OneDrive\Documents\Claude\Projects\World of Rolara\.professor-orb\conventions.json\`,'utf8'));
console.log('valid JSON');
for (const [id,r] of Object.entries(c.rules)) if (r.autofix) console.log('autofix on:', id, '(' + r.enforcement + ')');
"
```

Expected: `valid JSON`, then exactly `contentNoEmDashes (block)` and `contentSeeAlsoFooterProhibited (block)`.

- [ ] **Step 4: Confirm no em dash slipped into the guidance strings**

```bash
node -e "
const fs=require('fs');
const s=fs.readFileSync(String.raw\`C:\Users\jorda\OneDrive\Documents\Claude\Projects\World of Rolara\.professor-orb\conventions.json\`,'utf8');
console.log('em dashes in config:', (s.match(/—/g)||[]).length);
"
```

Expected: `0`. The `contentNoEmDashes` pattern is the escaped text `\u2014`, not the character; a literal one here would make the rule flag its own config if the file were ever a KB article, and reads as sloppy regardless.

---

### Task 7: Verify end to end, bump to 1.4.0, republish

**Files:**
- Modify: `professor-orb/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`

- [ ] **Step 1: All three suites green against the working tree**

Run in order: `node "<SCRATCH>\autofix-cases.mjs"`, `node "<SCRATCH>\run-cases.mjs"`, `node "<SCRATCH>\probes.mjs"`
Expected: `ALL PASS`, `ALL PASS`, `ALL PROBES PASS`.

- [ ] **Step 2: Drive one real dispatch and read the prose**

This is the step that cannot be asserted mechanically, and the one that matters most. Create a scratch article carrying all three em dash shapes from the spec's evidence table:

```bash
node -e "
const {mkdirSync,writeFileSync}=require('fs');
const p='<SCRATCH>\\\\prose-fixture';
mkdirSync(p+'\\\\kb',{recursive:true});
const em=String.fromCodePoint(0x2014);
writeFileSync(p+'\\\\kb\\\\Sample.md',
'---\ntype: Person\n---\n\n# Archfey ' + em + ' Characters Index\n\nThe city contracts private guard companies' + em + 'mercenary outfits and veteran-led bands.\n\nThrough it stepped a beleaguered mortal' + em + 'a sorcerer, with pride and ambition.\n','utf8');
console.log('written');
"
```

Dispatch the `rule-fixer` agent against it with the real guidance string from Task 6 Step 1, then Read the result. Judge by eye:
- The heading took a colon, not a comma.
- The appositive reads naturally.
- The third sentence did not become a comma pile-up.
- No wording changed anywhere.

If the prose is worse than the DM would write by hand, the guidance string is wrong, not the architecture. Tune the guidance in Task 6 and repeat. Record the before and after in the final report so the DM can judge the same call.

- [ ] **Step 3: Confirm the recursion guard on a real payload**

```bash
node -e "
const {spawnSync}=require('child_process');
const path=require('path');
const FIX='<SCRATCH>\\\\autofix-fixture';
const run=(extra)=>{
  const r=spawnSync('node',['professor-orb/hooks/validate-write.mjs'],{input:JSON.stringify({tool_name:'Write',tool_input:{file_path:path.join(FIX,'kb','Block.md')},cwd:FIX,...extra}),encoding:'utf8'});
  return (r.stderr||'').includes('AUTOFIX AVAILABLE');
};
console.log('outside fixer, asks for dispatch:', run({}));
console.log('inside fixer, asks for dispatch: ', run({agent_id:'s1',agent_type:'rule-fixer'}));
"
```

Expected: `true` then `false`.

- [ ] **Step 4: Invoke the `verify` skill** on the full change set, using Steps 2 and 3 as the end-to-end drive.

- [ ] **Step 5: Invoke the `code-review` skill** on the diff since the 1.3.0 bump commit. Apply or consciously reject each finding before bumping.

- [ ] **Step 6: Bump both manifests**

- `professor-orb/.claude-plugin/plugin.json`: `"version": "1.3.0"` to `"version": "1.4.0"`
- `.claude-plugin/marketplace.json`: `"version": "1.3.0"` to `"version": "1.4.0"`

Confirm they match:

```bash
node -e "
const a=JSON.parse(require('fs').readFileSync('professor-orb/.claude-plugin/plugin.json','utf8'));
const b=JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8'));
console.log(a.version, b.plugins[0].version, 'match:', a.version===b.plugins[0].version);
"
```

- [ ] **Step 7: Commit the bump**

```bash
git add professor-orb/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore(professor-orb): bump to 1.4.0, sync marketplace manifest

Minor bump: rules can opt into autofix, warn rules are visible to Claude for
the first time, and the new rule-fixer agent applies pre-approved fixes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Republish**

The marketplace is registered as a local directory source pointing at this repo (`known_marketplaces.json`: `"source": "directory"`), so no push is needed.

```bash
claude plugin marketplace update professor-orb-marketplace
cd "C:\Users\jorda\OneDrive\Documents\Claude\Projects\World of Rolara" && claude plugin update professor-orb@professor-orb-marketplace --scope project
```

The fully qualified `plugin@marketplace` name and `--scope project` are both required; the bare name at the default user scope reports "Plugin not found".

Confirm the cache holds 1.4.0:

```bash
ls ~/.claude/plugins/cache/professor-orb-marketplace/professor-orb/
```

Read-only inspection only. Never write to the cache.

- [ ] **Step 9: Report**

Tell the DM: what shipped, the before and after prose from Step 2, that a restart is needed to load 1.4.0, that seven warn rules will start speaking for the first time (expect a burst of previously invisible warnings, especially dead wikilinks), and which items remain deferred (widening the see-also rule to the 79 inline instances, autofix for the publish gate, the sweep's missing parity aggregation).

## Self-review notes

Checked against the spec:

- Every spec test case A1 to A8 maps to a harness case of the same id in Task 1.
- Spec sections "1. conventions.json" to "5. Rolara config" map to Tasks 3, 3, 4, 3, and 6 respectively; "Also in scope" (timeout) maps to Task 5; the warn-visibility consequence maps to Task 2.
- Types and names are consistent across tasks: `FIXER_AGENT` / `rule-fixer` (Task 3 and Task 4 agent `name:` frontmatter), `formatAutofixRequest(ruleId, guidance, ctx)`, `ctx.relProjectPath`, `autofixRequests`, `agentType`.
- Task 2 changes the same output block Task 3 then edits again; Task 3's step quotes Task 2's post-change text, not the 1.3.0 text.
- No placeholders. Every code step carries the code. Every command carries its expected output.
