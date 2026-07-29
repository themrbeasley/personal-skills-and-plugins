# Professor Orb 1.6.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make professor-orb's organizational schema the plugin's own, apply it to a consumer project through a revertible migration, and give each of the three prongs a command that commits it.

**Architecture:** Three phases of one release, implemented in order. Phase 1 defines the schema and corrects the ~50 sentences that say the plugin has no opinion. Phase 2 lays down a multi-setting layout, puts git underneath it, and migrates the consumer via a new workflow script. Phase 3 adds `/scribe` and `/log` and collapses `/catalog`'s versioning step. The three do not ship separately: phase 1 alone declares a schema nothing instantiates, and phase 2 runs `git init` at the project root, which is why phase 2 itself deletes `/catalog`'s repo-presence check.

**Tech Stack:** Markdown instruction files, Node ESM built-ins only (no dependencies) for `hooks/` and `workflows/`, standalone `*.test.mjs` scripts run directly with `node` (there is no test framework and none is being added).

**Specs:** `docs/superpowers/specs/2026-07-28-canonical-schema-design.md` (phase 1), `-apply-the-schema-design.md` (phase 2), `-lane-commands-design.md` (phase 3). Read the phase's spec before starting its first task.

## Global Constraints

- **No em dashes in any output**: code, comments, commit messages, rule descriptions, doc prose. `SHARED-PRINCIPLES.md` Principle 6. A double hyphen between words is not a substitute either. Verify with `grep -c '—'` returning 0 on every changed file. (The verification commands in this plan necessarily contain the character as their search pattern. Those are the only permitted occurrences, in this file and in `references/base-rules.json`'s `contentNoEmDashes` rule, where it is written as the escape `—`.)
- **Never edit anything under `C:\Users\jorda\.claude\plugins\cache\`.** That is a build artifact, replaced on update. The source of truth is `professor-orb/` in this repo.
- **Never run `professor-orb:setup` against the reference consumer project** during development. It regenerates `conventions.json` wholesale.
- **Node ESM built-ins only** in `hooks/` and `workflows/`. No dependencies, no build step.
- **The hook must never crash a write.** Every check stays inside the existing try/catch contract at `hooks/validate-write.mjs:766-771`.
- **Version 1.5.1 to 1.6.0**, in both `professor-orb/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, in the same commit. Task 21 only.
- **Commit style:** `feat(professor-orb): ...` or `fix(professor-orb): ...` or `docs(professor-orb): ...`, a body paragraph, then `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **The reference consumer** is at `C:\Users\jorda\OneDrive\Documents\Claude\Projects\World of Rolara`. Read from it to check facts. Never write to it from this repo's work.
- **Regression suites that must pass before every commit:**
  - `node professor-orb/workflows/validation-sweep.ownership.test.mjs`
  - `node docs/superpowers/specs/2026-07-28-mechanism-prototypes.mjs`
  - `node professor-orb/hooks/validate-write.test.mjs` (created in Task 1)

---

# Phase 1: the schema is professor-orb's

### Task 1: Hook regression harness

**Files:**
- Create: `professor-orb/hooks/validate-write.test.mjs`

**Interfaces:**
- Produces: `node professor-orb/hooks/validate-write.test.mjs` prints one `PASS`/`FAIL` per case and exits 0/1. Every later hook task adds cases to this file.
- Produces: helper `runHook({ conventions, files, targetRel })` returning `{ code, out, err }`.

- [ ] **Step 1: Write the harness with two cases that pass against today's hook**

Write to `professor-orb/hooks/validate-write.test.mjs`:

```js
#!/usr/bin/env node
// Regression suite for the PostToolUse write-time validator.
//
// Drives the real hook with real PostToolUse payloads against a disposable
// fixture project. Node built-ins only, no test framework.
//
// Run: node professor-orb/hooks/validate-write.test.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "validate-write.mjs");

let passed = 0;
const failures = [];

export function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failures.push(name);
    console.log(`  [FAIL] ${name}`);
    console.log(`         expected: ${JSON.stringify(expected)}`);
    console.log(`         actual:   ${JSON.stringify(actual)}`);
  }
}

// Builds a disposable project, writes the given files and conventions, then
// fires the hook at targetRel as though a Write had just landed there.
export function runHook({ conventions, files, targetRel }) {
  const dir = path.join(os.tmpdir(), `orb-hook-${process.pid}-${Math.abs(hashOf(targetRel))}`);
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

  const payload = JSON.stringify({
    cwd: dir,
    tool_name: "Write",
    tool_input: { file_path: path.join(dir, targetRel) },
  });

  try {
    const out = execFileSync("node", [HOOK], { input: payload, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "").trim(), err: (e.stderr || "").trim() };
  }
}

// Deterministic per-target temp dir so parallel cases do not collide.
function hashOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export function report() {
  console.log(`\n${passed}/${passed + failures.length} expectations met.`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

const ENUM_RULE = {
  frontmatterTypeEnum: {
    category: "frontmatter",
    check: "enum",
    enforcement: "block",
    description: 'type must be one of the recognized article types.',
    params: { field: "type", values: ["Person", "Location"] },
  },
};

console.log("=== baseline: today's behavior ===");

{
  const r = runHook({
    conventions: null,
    files: { "kb/Bad.md": "---\ntype: Nope\n---\n\nbody\n" },
    targetRel: "kb/Bad.md",
  });
  check("no conventions.json: silent, exit 0", [r.code, r.out, r.err], [0, "", ""]);
}

{
  const r = runHook({
    conventions: { version: 1, kbRoot: "kb", rules: ENUM_RULE },
    files: { "kb/Bad.md": "---\ntype: Nope\n---\n\nbody\n" },
    targetRel: "kb/Bad.md",
  });
  check("v1 file, bad enum value: blocks with exit 2", r.code, 2);
}

report();
```

- [ ] **Step 2: Run it and confirm both cases pass**

Run: `node professor-orb/hooks/validate-write.test.mjs`
Expected: `2/2 expectations met.` and exit 0.

- [ ] **Step 3: Commit**

```bash
git add professor-orb/hooks/validate-write.test.mjs
git commit -m "feat(professor-orb): add a regression harness for the write-time hook

Drives the real hook with real PostToolUse payloads against a disposable
fixture. Node built-ins only, matching the existing standalone test script
pattern. Every later hook change adds cases here.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Ship the base rule set as an artifact

**Files:**
- Create: `professor-orb/references/base-rules.json`
- Modify: `professor-orb/hooks/validate-write.test.mjs` (append cases)

**Interfaces:**
- Produces: `references/base-rules.json`, an object with `schemaVersion` (number) and `rules` (object keyed by rule id, each entry carrying `provenance: "professor-orb"`, `category`, `check`, `enforcement`, `description`, `params`, and optionally `scope` and `autofix`). Tasks 3, 4, and 16 read it.

- [ ] **Step 1: Write the artifact**

Write to `professor-orb/references/base-rules.json`. Values come from the phase 1 spec's Part 2 tables; the two type groups are the canonical list.

```json
{
  "schemaVersion": 1,
  "rules": {
    "structuralIndexParity": {
      "provenance": "professor-orb",
      "category": "structural",
      "check": "indexParity",
      "enforcement": "warn",
      "scope": "kb",
      "description": "Every folder with content has exactly one owning -INDEX file.",
      "params": { "indexSuffix": "-INDEX" }
    },
    "structuralSingleOwnership": {
      "provenance": "professor-orb",
      "category": "structural",
      "check": "singleOwnership",
      "enforcement": "warn",
      "scope": "kb",
      "description": "An article's wikilink appears in exactly one index. Checked by the validation sweep, not at write time.",
      "params": {}
    },
    "structuralSplitThreshold": {
      "provenance": "professor-orb",
      "category": "structural",
      "check": "splitThreshold",
      "enforcement": "warn",
      "scope": "kb",
      "description": "A folder holding six or more articles earns its own subfolder and index.",
      "params": { "minEntries": 6, "indexSuffix": "-INDEX" }
    },
    "structuralAbsorbThreshold": {
      "provenance": "professor-orb",
      "category": "structural",
      "check": "absorbThreshold",
      "enforcement": "warn",
      "scope": "kb",
      "description": "A leaf folder holding fewer than four articles is absorbed into its parent.",
      "params": { "maxEntries": 4, "indexSuffix": "-INDEX" }
    },
    "frontmatterRequiredSubset": {
      "provenance": "professor-orb",
      "category": "frontmatter",
      "check": "requiredFields",
      "enforcement": "block",
      "description": "Frontmatter must include type.",
      "params": {
        "requiredSubset": ["type"]
      }
    },
    "frontmatterFieldOrder": {
      "provenance": "professor-orb",
      "category": "frontmatter",
      "check": "requiredFields",
      "enforcement": "warn",
      "description": "Frontmatter lists publish, type, tags in that order when present.",
      "params": {
        "fields": ["publish", "type", "tags"],
        "orderMatters": true
      }
    },
    "frontmatterPublishPresence": {
      "provenance": "professor-orb",
      "category": "frontmatter",
      "check": "requiredFields",
      "enforcement": "warn",
      "description": "publish should be present and explicit.",
      "params": {
        "requiredSubset": ["publish"]
      }
    },
    "frontmatterTypeEnum": {
      "provenance": "professor-orb",
      "category": "frontmatter",
      "check": "enum",
      "enforcement": "block",
      "description": "type must be one of the recognized article types or homebrew artifact keys.",
      "params": {
        "field": "type",
        "values": [
          "Person", "Location", "Organization", "Item", "Creature", "Concept",
          "Index", "Session Report", "Session Prep", "Chronology",
          "spell", "magic-item", "feat", "feature", "monster", "npc",
          "species", "subclass", "class", "other"
        ]
      }
    },
    "frontmatterTagsFormat": {
      "provenance": "professor-orb",
      "category": "frontmatter",
      "check": "format",
      "enforcement": "warn",
      "description": "tags, when present, must be an array of strings.",
      "params": { "field": "tags", "format": "string-array", "optional": true }
    },
    "filenameSuffixByType": {
      "provenance": "professor-orb",
      "category": "filename",
      "check": "suffixByType",
      "enforcement": "block",
      "description": "Index, session report, and session prep articles carry a mandatory filename suffix.",
      "params": {
        "mapping": [
          { "type": "Index", "suffix": "-INDEX" },
          { "type": "Session Report", "suffix": "-REPORT" },
          { "type": "Session Prep", "suffix": "-PREP" }
        ]
      }
    },
    "filenameSuffixChronology": {
      "provenance": "professor-orb",
      "category": "filename",
      "check": "suffixByType",
      "enforcement": "warn",
      "description": "Chronology articles carry the -CHRONOLOGY suffix.",
      "params": { "mapping": [{ "type": "Chronology", "suffix": "-CHRONOLOGY" }] }
    },
    "filenameCharset": {
      "provenance": "professor-orb",
      "category": "filename",
      "check": "charset",
      "enforcement": "warn",
      "description": "Filenames use letters, digits, and hyphens only.",
      "params": { "pattern": "^[A-Za-z0-9-]+$" }
    },
    "contentNoEmDashes": {
      "provenance": "professor-orb",
      "category": "content",
      "check": "prohibitedPattern",
      "enforcement": "warn",
      "description": "Body prose does not use em dashes.",
      "params": { "pattern": "\u2014", "appliesTo": "body" }
    }
  }
}
```

Note the deliberate omissions, each required by the phase 1 spec: no `publish` **default** rule (nothing in the plugin ever inserts or changes a `publish` value), no `autofix` string on either filename rule (the sweep's fix workers cannot rename a file), and `singleOwnership` at `warn` rather than `off`. Its check function returns `null` unconditionally at write time, since only the validation sweep has enough context to run it, so the hook is silent on this rule by function, not by enforcement level. That leaves `off` free to mean checked by nothing at all, and recording a sweep-scope rule as `off` would now silence it everywhere, including in the sweep that is supposed to catch it.

`frontmatterPublishPresence` is not an exception to the first omission. It reports at `warn` when the field is absent and stops there; it never supplies a value. Those are two different things and the spec asks for both: `canonical-schema-design.md:218` carries `publish` should be present and explicit at `warn`, never auto-inserted. That is also why the spec's frontmatter table becomes three rules rather than one: `frontmatterRequiredSubset` blocks, while `frontmatterFieldOrder` and `frontmatterPublishPresence` only warn, and a single rule cannot hold two enforcement levels.

- [ ] **Step 2: Add a loader case to the harness**

Append to `professor-orb/hooks/validate-write.test.mjs`, before `report()`:

```js
console.log("\n=== base rules artifact ===");

{
  const { readFileSync } = await import("node:fs");
  const raw = readFileSync(
    new URL("../references/base-rules.json", import.meta.url),
    "utf8"
  );
  const base = JSON.parse(raw);
  const ids = Object.keys(base.rules);
  check("base-rules.json parses and carries a schemaVersion", typeof base.schemaVersion, "number");
  check("every base rule carries provenance professor-orb",
    ids.every((id) => base.rules[id].provenance === "professor-orb"), true);
  check("no base rule ships an autofix on a filename rule",
    ids.filter((id) => base.rules[id].category === "filename")
       .every((id) => base.rules[id].autofix === undefined), true);
  check("publish is not in the blocking required subset",
    base.rules.frontmatterRequiredSubset.params.requiredSubset, ["type"]);
  // The three frontmatter required-fields rules exist separately because they
  // sit at two different enforcement levels. Pin each one: a later edit that
  // folds them back together would silently promote publish to blocking.
  check("the required subset blocks",
    base.rules.frontmatterRequiredSubset.enforcement, "block");
  check("field order only warns",
    base.rules.frontmatterFieldOrder.enforcement, "warn");
  check("publish presence only warns",
    base.rules.frontmatterPublishPresence.enforcement, "warn");
  check("the type enum carries both groups",
    base.rules.frontmatterTypeEnum.params.values.includes("Person") &&
    base.rules.frontmatterTypeEnum.params.values.includes("magic-item"), true);
}
```

- [ ] **Step 3: Run and confirm**

Run: `node professor-orb/hooks/validate-write.test.mjs`
Expected: `10/10 expectations met.`

- [ ] **Step 4: Commit**

```bash
git add professor-orb/references/base-rules.json professor-orb/hooks/validate-write.test.mjs
git commit -m "feat(professor-orb): ship the base rule set as a machine-readable artifact

The schema stops being prose in a reference document and becomes
references/base-rules.json, which setup writes out, the hook reads, and every
fallback path can point at. Three deliberate omissions: no publish default rule,
because nothing in the plugin ever inserts or changes a publish value, no autofix
on the filename rules because the sweep's workers cannot rename a file, and
singleOwnership at warn rather than off. Its check function returns null
unconditionally at write time, so the hook is silent on it by function, not by
enforcement level. That leaves off free to mean checked by nothing at all, and
recording a sweep-scope rule as off would now silence it everywhere.

frontmatterPublishPresence is not a fourth exception to the first of those. It
reports at warn when publish is absent and supplies nothing, which is exactly
what the spec's frontmatter table asks: present and explicit, warn, never
auto-inserted. That table is also why required-fields ships as three rules rather
than one. frontmatterRequiredSubset blocks, frontmatterFieldOrder and
frontmatterPublishPresence warn, and one rule cannot carry two levels.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Hook honors `extendedBy` and `scope`

**Files:**
- Modify: `professor-orb/hooks/validate-write.mjs:236-244` (`checkEnum`)
- Modify: `professor-orb/hooks/validate-write.mjs:761-798` (the rule loop)
- Modify: `professor-orb/hooks/validate-write.test.mjs`

**Interfaces:**
- Consumes: `references/base-rules.json` shape from Task 2.
- Produces: a rule may carry `extendedBy` (array of extra permitted values, unioned into `enum` values) and `scope` (`"kb"` restricts the check to the setting KB root; absent means all prongs). Task 11 uses `scope`.

- [ ] **Step 1: Write the failing tests**

Append to `professor-orb/hooks/validate-write.test.mjs`, before `report()`:

```js
console.log("\n=== extendedBy and scope ===");

const EXTENDED_ENUM = {
  frontmatterTypeEnum: {
    provenance: "professor-orb",
    category: "frontmatter",
    check: "enum",
    enforcement: "block",
    extendedBy: ["Settlement"],
    description: "type must be recognized.",
    params: { field: "type", values: ["Person", "Location"] },
  },
};

{
  const r = runHook({
    conventions: { version: 2, kbRoot: "kb", rules: EXTENDED_ENUM },
    files: { "kb/A.md": "---\ntype: Settlement\n---\n\nbody\n" },
    targetRel: "kb/A.md",
  });
  check("extendedBy value is accepted", r.code, 0);
}

{
  const r = runHook({
    conventions: { version: 2, kbRoot: "kb", rules: EXTENDED_ENUM },
    files: { "kb/B.md": "---\ntype: Person\n---\n\nbody\n" },
    targetRel: "kb/B.md",
  });
  check("base value still accepted alongside extendedBy", r.code, 0);
}

{
  const r = runHook({
    conventions: { version: 2, kbRoot: "kb", rules: EXTENDED_ENUM },
    files: { "kb/C.md": "---\ntype: Nope\n---\n\nbody\n" },
    targetRel: "kb/C.md",
  });
  check("a value in neither list still blocks", r.code, 2);
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `node professor-orb/hooks/validate-write.test.mjs`
Expected: FAIL on "extendedBy value is accepted" with actual `2` (the hook does not know the field yet).

- [ ] **Step 3: Implement `extendedBy` in `checkEnum`**

In `professor-orb/hooks/validate-write.mjs`, replace the body of `checkEnum` so it unions `params.values` with the rule's `extendedBy`. The check functions receive `(params, ctx)`, so pass the extension through `params` at the call site instead of changing the signature. In the rule loop (Step 4) build the effective params; in `checkEnum` read `params.values` as today. Concretely, `checkEnum` needs no change; only the loop does. Leave `checkEnum` alone.

- [ ] **Step 4: Implement the loop change**

In `professor-orb/hooks/validate-write.mjs`, inside the `for (const ruleId of Object.keys(conventions.rules))` loop, replace:

```js
    let result;
    try {
      result = checkFn(rule.params || {}, ctx);
    } catch {
```

with:

```js
    // A base rule may be extended by the project: extra permitted enum values
    // live in rule.extendedBy, unioned into the rule's enum values only, so
    // the project never needs a second rule of the same check kind on the
    // same field, which would fail every article against one of the two.
    // Mapping-based rules (suffixByType) are deliberately not extended here:
    // params.mapping holds {type, suffix} objects, matched by
    // mapping.find((m) => m.type === type), so splicing a bare string from
    // extendedBy in would create an entry that can never match, silently
    // disabling the rule for the extended type instead of enforcing it.
    let effectiveParams = rule.params || {};
    if (Array.isArray(rule.extendedBy) && rule.extendedBy.length > 0) {
      if (Array.isArray(effectiveParams.values)) {
        effectiveParams = {
          ...effectiveParams,
          values: [...effectiveParams.values, ...rule.extendedBy],
        };
      }
    }

    // scope "kb" restricts a rule to the setting knowledge base. Phase 2 gives
    // ctx.prongKind a value; until then every path inside kbRoot reads as "kb".
    if (rule.scope === "kb" && ctx.prongKind && ctx.prongKind !== "kb") continue;

    let result;
    try {
      result = checkFn(effectiveParams, ctx);
    } catch {
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node professor-orb/hooks/validate-write.test.mjs`
Expected: `13/13 expectations met.`

- [ ] **Step 6: Commit**

```bash
git add professor-orb/hooks/validate-write.mjs professor-orb/hooks/validate-write.test.mjs
git commit -m "feat(professor-orb): let a base rule carry project extensions and a prong scope

A project extends a base rule through extendedBy rather than adding a second
rule of the same check kind on the same field, which would have failed every
article against one of the two. scope kb restricts the structural rules to the
setting knowledge base, since the homebrew and session-report prongs take their
shape from the layout rather than from content volume.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Sweep honors enforcement and extensions

**Files:**
- Modify: `professor-orb/workflows/validation-sweep.mjs:174-203` (`checkerPrompt`)
- Modify: `professor-orb/workflows/validation-sweep.mjs` (the `phase('Aggregate')` section: `singleOwnershipFindings` and `indexParityFindings`)
- Modify: `professor-orb/workflows/validation-sweep.ownership.test.mjs` (enforcement-off regression case)
- Modify: `professor-orb/skills/setup/references/conventions-schema.md:257` (the `off` row)
- Modify: `professor-orb/hooks/validate-write.mjs` (the check-semantics duplication note)
- Modify: `professor-orb/agents/kb-validator.md` (the check-semantics duplication note)

**Interfaces:**
- Consumes: rules carrying `enforcement` and `extendedBy` from Tasks 2 and 3.
- Produces: no finding from an `off` rule ever reaches `mechanicallyFixable` or `needsJudgment`, including the whole-KB `singleOwnership` and `indexParity` checks computed centrally in the Aggregate phase, not only the per-shard checks the checker prompt covers.

- [ ] **Step 1: Add the enforcement filter to the checker prompt**

In `professor-orb/workflows/validation-sweep.mjs`, in the `checkerPrompt` array, insert a new line immediately before the existing line that begins `'4. Check every frontmatter category rule against this file:'`:

```js
    'Before checking anything: skip every rule whose enforcement is "off". The DM turned it off deliberately, and off is the only lever they have over a rule professor-orb ships rather than one they wrote. An off rule produces no finding of any kind, and in particular never a mechanicallyFixable one, because that bucket is applied wholesale on a single approval.',
    'A rule may carry extendedBy, an array of additional permitted values contributed by the project. Treat params.values and extendedBy as one combined list; a value in either is valid.',
```

- [ ] **Step 2: Bring the normative reference into line**

Step 1 makes `off` mean fully silent. The reference document says otherwise. `professor-orb/skills/setup/references/conventions-schema.md:257` is the `off` row of the enforcement table, and its third column currently reads "Documented for the DM's and the sweep's benefit only. The sweep may still choose to report `off` rules informationally, but never fails on them."

Rewrite that third column so it matches: an `off` rule is not evaluated at write time and is not checked by the sweep either, so it produces no finding of any kind and in particular never enters `mechanicallyFixable`. It stays in the file so the DM can see what they turned off and turn it back on.

The phase 1 spec (`canonical-schema-design.md:379-388`) permits either behavior, so Step 1's choice of full silence is legitimate and this file is what moves. Do this in the same task rather than later: Step 3 declares this document normative for check semantics, and a normative document contradicting the prompt it governs is worse than either behavior alone.

- [ ] **Step 3: Record the four-way duplication obligation**

Check semantics exist in four places and must agree. Add this note near the top of each, adjusting the wording to the file:

> Check semantics are duplicated four ways: `skills/setup/references/conventions-schema.md`'s check catalog (normative), the `CHECKS` table in `hooks/validate-write.mjs`, this prompt, and `agents/kb-validator.md` Step 4. The base rule *data* is single-sourced at `references/base-rules.json`; the *semantics* are not. Changing one requires changing the other three.

Add it to `workflows/validation-sweep.mjs` above `checkerPrompt`, to `hooks/validate-write.mjs` above the `CHECKS` table at `:633`, to `agents/kb-validator.md` above Step 4, and to `conventions-schema.md` above its check catalog. This mirrors the existing precedent at `workflows/validation-sweep.ownership.test.mjs:7-9`, which already carries a byte-alignment obligation.

- [ ] **Step 4: Verify the surrounding numbering still reads correctly**

Run: `grep -n "Check every frontmatter category rule" professor-orb/workflows/validation-sweep.mjs`
Expected: the numbered step list still runs 1 through 8 with the two new unnumbered lines above step 4.

- [ ] **Step 5: Run the existing ownership guard**

Run: `node professor-orb/workflows/validation-sweep.ownership.test.mjs`
Expected: PASS. This task does not touch aggregation, so it must be unaffected.

- [ ] **Step 6: Commit**

```bash
git add professor-orb/workflows/validation-sweep.mjs professor-orb/hooks/validate-write.mjs professor-orb/agents/kb-validator.md professor-orb/skills/setup/references/conventions-schema.md
git commit -m "fix(professor-orb): make enforcement off actually silence the sweep

The hook honored off at validate-write.mjs:763; the sweep did not. It handed
workers rulesJson verbatim and told them to check every frontmatter and filename
rule with no enforcement filter, so findings from a rule the DM had turned off
still landed in mechanicallyFixable, the bucket one yes applies wholesale.
conventions-schema.md:257 previously permitted the sweep to report off rules
informationally. This release makes off mean fully silent, and that row is
rewritten to say so, so the hook, the sweep, and the normative reference now
agree. Under a plugin-owned schema, off is the DM's only lever, so it has to work
everywhere.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Aggregation also honors enforcement**

Step 1 only reached the shard-level checker prompt. The scan phase also computes two whole-KB checks centrally, outside any shard: the `singleOwnershipFindings` loop and the `indexParityFindings` loop in `professor-orb/workflows/validation-sweep.mjs`'s `phase('Aggregate')` section. The checker prompt's step 7 explicitly tells shards NOT to evaluate these two ("handled centrally after every shard reports back"), so the skip-off instruction Step 1 adds to that prompt can never reach them. Neither loop read `rules[ruleId].enforcement`, so a DM who set `structuralIndexParity` or `structuralSingleOwnership` to `off` still received sweep findings for it: the exact defect Steps 1 and 2 exist to close, surviving in the half of the file nobody looked at.

Add a `singleOwnershipOff` guard, read from `rules[singleOwnershipRuleId] && rules[singleOwnershipRuleId].enforcement === 'off'`, and wrap the `singleOwnershipFindings` loop in `if (!singleOwnershipOff)`. Add the matching `indexParityOff` guard keyed on `indexParityRuleId` and fold it into the existing `if (indexSuffix)` condition that guards the `indexParityFindings` loop. Both guards must be robust to a missing rule entry: `rules[ruleId]` being absent is not the same as `enforcement: "off"`, only the literal string suppresses. Comment each guard with why it exists, since the reasoning is not obvious from the code alone: the shard-level skip-off instruction cannot cover these two checks, because shards are told not to evaluate them.

Add a regression case to `professor-orb/workflows/validation-sweep.ownership.test.mjs`: a fixture carrying a genuine single-ownership violation with that rule's `enforcement` set to `"off"`, asserting no finding is emitted, plus a case confirming an absent rule entry does NOT suppress findings. Run the new case before the source fix to confirm it fails, and after to confirm it passes; a case that never failed proves nothing.

Run: `node professor-orb/workflows/validation-sweep.ownership.test.mjs`
Expected: all assertions PASS, including the new off-enforcement and absent-rule-entry cases.

Run: `node professor-orb/hooks/validate-write.test.mjs` and `node docs/superpowers/specs/2026-07-28-mechanism-prototypes.mjs`
Expected: both suites unaffected by this change, since it touches only the sweep's Aggregate phase, not the hook.

- [ ] **Step 8: Commit**

```bash
git add professor-orb/workflows/validation-sweep.mjs professor-orb/workflows/validation-sweep.ownership.test.mjs professor-orb/skills/setup/references/conventions-schema.md docs/superpowers/plans/2026-07-28-professor-orb-1.6.0.md
git commit -m "fix(professor-orb): sweep aggregation also honors enforcement off

Step 1 taught the shard checker prompt to skip off rules, but the scan
phase's Aggregate section computes singleOwnership and indexParity
centrally, precisely because shards are told not to evaluate either one
themselves. That path never read rules[ruleId].enforcement, so an off
structuralSingleOwnership or structuralIndexParity rule still produced
sweep findings, the exact bug Task 4 exists to fix, surviving in the half
of the file the shard-level fix could not reach.

Both aggregation loops now check the resolved rule's enforcement before
emitting anything, skipping entirely on the literal string off and never
treating an absent rule entry as off. A regression case in
validation-sweep.ownership.test.mjs exercises both: it fails against the
prior aggregation and passes after this fix.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Rule provenance in the autofix path

**Files:**
- Modify: `professor-orb/agents/rule-fixer.md:4-5`, `:16`, `:35`
- Modify: `professor-orb/hooks/validate-write.mjs:667`
- Modify: `professor-orb/skills/setup/references/conventions-schema.md:277-279`

**Interfaces:**
- Consumes: `provenance` on every rule, from Task 2.

- [ ] **Step 1: Read the three rule-fixer sites**

Run: `sed -n '1,20p;30,40p' professor-orb/agents/rule-fixer.md`
Expected: the description at lines 4-5 and line 16 both assert the DM wrote the guidance, as does line 35.

- [ ] **Step 2: Rewrite all three sites**

Replace the phrase at `agents/rule-fixer.md:4-5`, "using guidance the DM wrote into that rule", with "using the guidance recorded on that rule".

Replace `:16`, "The DM pre-approved this fix class by configuring autofix on the rule, so the fix is applied without asking.", with: "This fix class is pre-approved: for a rule the DM wrote, by their authoring it; for a rule professor-orb ships, by the enforcement level the DM confirmed at setup. Either way the fix is applied without asking."

Replace `:35`'s "This is authoritative. It came from the project's conventions file, which the DM wrote. Follow it literally." with: "This is authoritative. Follow it literally. Check the rule's `provenance`: `project` means the DM wrote this guidance; `professor-orb` means the plugin did, and the DM's approval comes from the enforcement level they confirmed at setup rather than from authorship. Apply it either way, and never describe plugin-authored guidance as the DM's."

- [ ] **Step 3: Rewrite the hook's message**

In `professor-orb/hooks/validate-write.mjs`, at line 667, replace the string `"The DM pre-approved this fix class by setting autofix on the rule, so apply it without asking."` with:

```js
    "This fix class is pre-approved, by the DM authoring the rule or by the enforcement level they confirmed at setup, so apply it without asking.",
```

- [ ] **Step 4: Rewrite the schema reference**

In `professor-orb/skills/setup/references/conventions-schema.md:277-279`, replace "its presence is the DM's standing approval for that class of fix" with "its presence marks the fix class as pre-approved: by the DM's authorship for a `project` rule, and by the enforcement level they confirmed at setup for a `professor-orb` rule".

- [ ] **Step 5: Verify no site still misattributes**

Run: `grep -rn "the DM wrote" professor-orb/`
Expected: no hit that refers to autofix guidance on a plugin-authored rule.

- [ ] **Step 6: Commit**

```bash
git add professor-orb/agents/rule-fixer.md professor-orb/hooks/validate-write.mjs professor-orb/skills/setup/references/conventions-schema.md
git commit -m "fix(professor-orb): stop attributing plugin-authored guidance to the DM

Five statements asserted that every rule's autofix guidance was written by the
DM, and those statements are what authorize edits without asking. They become
false the moment professor-orb ships its own rules. Each now keys on provenance:
a project rule is the DM's and their standing approval; a professor-orb rule is
the plugin's, and the approval comes from the enforcement level the DM confirmed
at setup. The fixer applies both, and says so honestly.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Correct catalog-entry detection

**Files:**
- Modify: `professor-orb/workflows/validation-sweep.mjs:190`
- Modify: `professor-orb/agents/kb-validator.md:65`
- Modify: `professor-orb/agents/kb-validator.md:155`
- Modify: `professor-orb/CONTEXT.md:89-91`

**Interfaces:**
- Produces: a catalog entry is an article whose frontmatter `type` is one of the ten artifact keys, matched case-sensitively.

> **This may already be landed.** A standalone task was spun off for it. Run
> `git log --oneline -- professor-orb/workflows/validation-sweep.mjs | head -5`
> first; if a commit already fixes this, verify with Step 4 and skip to Step 5.

- [ ] **Step 1: Confirm the defect against the reference consumer**

Run:
```bash
node -e "const fs=require('fs'),p=require('path');const R='C:/Users/jorda/OneDrive/Documents/Claude/Projects/World of Rolara/homebrew';const c={};for(const f of fs.readdirSync(R).filter(f=>f.endsWith('.md'))){const t=fs.readFileSync(p.join(R,f),'utf8').split(/\r?\n/);const e=t.indexOf('---',1);const ty=(t.slice(1,e<0?12:e).find(l=>/^type:/i.test(l))||'(none)').trim();c[ty]=(c[ty]||0)+1}console.log(c)"
```
Expected: counts across `type: magic-item`, `type: monster`, `type: spell`, `type: npc`, `type: other`, `type: feature`, `type: species`, `type: feat`, `type: Index`. No `type: Homebrew`.

- [ ] **Step 2: Fix the sweep's discriminator**

In `professor-orb/workflows/validation-sweep.mjs:190`, replace `'3. Decide whether it is a catalog entry: frontmatter type is exactly "Homebrew".'` with:

```js
    '3. Decide whether it is a catalog entry: frontmatter type is exactly one of spell, magic-item, feat, feature, monster, npc, species, subclass, class, other (lowercase, matched case-sensitively, so a KB article of type "Species" is NOT a catalog entry while a homebrew entry of type "species" is). Catalog entries ARE subject to index ownership checks (a real index should still list them), but are EXEMPT from wikilink and orphan checks: never flag a catalog entry for having no outgoing wikilinks or for not being linked to from other article bodies. That is correct structure for a catalog entry, not a violation.',
```

- [ ] **Step 3: Fix the validator agent and CONTEXT**

In `professor-orb/agents/kb-validator.md:65`, replace the `type: Homebrew` identification with the same artifact-key rule, in prose.

Apply the identical correction at `professor-orb/agents/kb-validator.md:155`, in the never-do list, which today reads "**Catalog entries are exempt from graph checks by design**, not by an exception you are inventing. `type: Homebrew` entries have no wikilinks in or out; that is correct." Whatever detection wording you settle on at `:65` is the wording `:155` must use, so the agent cannot identify an entry one way in its procedure and another way in its rules. This is not optional cleanup: `:155` matches Step 4's grep verbatim, so skipping it fails this task's own gate.

In `professor-orb/CONTEXT.md:89-91`, replace "(`type: Homebrew`, `publish: false` default)" with "(`type` holds the artifact key: `spell`, `magic-item`, `monster` and the rest; `publish: false` default)".

- [ ] **Step 4: Verify no component still looks for `type: Homebrew`**

Run: `grep -rn 'type: Homebrew\|type is exactly "Homebrew"\|exactly `Homebrew`' professor-orb/`
Expected: no hits.

- [ ] **Step 5: Commit**

```bash
git add professor-orb/workflows/validation-sweep.mjs professor-orb/agents/kb-validator.md professor-orb/CONTEXT.md
git commit -m "fix(professor-orb): identify catalog entries by artifact key, not by type Homebrew

The sweep identified a catalog entry by frontmatter type being exactly
\"Homebrew\", which matches no real entry: a survey of all 71 in the reference
consumer found magic-item 36, monster 12, spell 7, npc 5, other 4, feature 2,
species 2, feat 1, plus one Index. So the exemption sparing catalog entries from
wikilink and orphan checks has never fired, and every sweep run has reported the
whole catalog as orphaned articles. catalog-type-templates.md:21 was right that
type holds the artifact type key; the detectors were wrong.

Matching stays case-sensitive: a KB article of type Species and a homebrew entry
of type species are different things.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: One fallback statement replacing ten

**Files:**
- Modify: `professor-orb/skills/SHARED-PRINCIPLES.md` (add Principle 11; rewrite Principle 9's framing at `:51`)
- Modify: `professor-orb/skills/debrief/SKILL.md:16`, `:29`
- Modify: `professor-orb/skills/prep/SKILL.md:16`, `:30`
- Modify: `professor-orb/skills/content/SKILL.md:14`
- Modify: `professor-orb/skills/chronicler/SKILL.md:16`, `:31`
- Modify: `professor-orb/skills/timeline/SKILL.md:18`, `:30`
- Modify: `professor-orb/skills/homebrew/SKILL.md:18`
- Modify: `professor-orb/commands/catalog.md:41`, `:110`, `:112`
- Modify: `professor-orb/agents/lore.md:45`
- Modify: `professor-orb/agents/historian.md:55`
- Modify: `professor-orb/agents/kb-validator.md:55`

**Interfaces:**
- Produces: `SHARED-PRINCIPLES.md` Principle 11, referenced by all ten components.

- [ ] **Step 1: Add the shared principle**

Append to `professor-orb/skills/SHARED-PRINCIPLES.md`:

```markdown
## 11. Missing conventions file means apply the base schema

When `.professor-orb/conventions.json` is absent, apply professor-orb's base schema, which ships at `references/base-rules.json`, and say that setup has not run. Do not infer structural conventions from the project's prose or from its existing articles, and never invent conventions on the spot: two components inventing independently will disagree.

Structure means folder layout, index rules, frontmatter schema, filename conventions, and wikilink format. The project's `CLAUDE.md` remains authoritative for campaign facts and content, never for structure.
```

- [ ] **Step 2: Correct Principle 9's framing at `SHARED-PRINCIPLES.md:51`**

The phase 1 spec lists this line explicitly among the sites that move (`canonical-schema-design.md:482`): "| `skills/SHARED-PRINCIPLES.md` | Shared fallback statement; Principle 9's \"derivation\" framing at `:51` |". `:51` currently reads:

> For structural checks, skills read `.professor-orb/conventions.json` rather than re-deriving rules from CLAUDE.md each time. The conventions file is a machine-checkable derivation maintained by the setup skill; when it exists, prefer it over re-inferring structure from prose. If it is missing or looks stale, say so and suggest running setup rather than guessing.

Rewrite it so the conventions file is described as instantiated from professor-orb's base rule set and authoritative for structural checks, not derived from the consumer's prose. Keep the rest of the principle's practical guidance intact: prefer the file over re-inferring structure, and if it is missing or looks stale, say so and suggest running setup rather than guessing.

This is not cosmetic. Every pipeline skill reads `SHARED-PRINCIPLES.md` at the start of every run, so shipping 1.6.0 with Principle 9 still calling `conventions.json` a "derivation" puts the contradiction in front of every component on every run, and it contradicts Task 8 directly: Task 8 rewrites `conventions-schema.md:25` to say "instantiated from professor-orb's base rule set, and authoritative for structural checks".

It has to be corrected here because nothing else in the plan would catch it. Task 8's verification greps for the phrase "derived, not authoritative", and `:51` does not use those words.

- [ ] **Step 3: Replace each of the ten fallback paragraphs**

In each file listed above, replace the sentence that routes to `CLAUDE.md` for schema inference with: "If it is missing, apply professor-orb's base schema per SHARED-PRINCIPLES Principle 11 and note that setup has not run."

Delete outright the four "establish conventions as you go" sentences at `debrief/SKILL.md:29`, `prep/SKILL.md:30`, `chronicler/SKILL.md:31`, and `timeline/SKILL.md:30`. Do not replace them; Principle 11 covers the case.

Preserve in every file any adjacent sentence about campaign facts, VTT platform, or content craft. Those are content-side deference and stay.

- [ ] **Step 4: Take structural deference out of `commands/catalog.md:110` and `:112`**

The phase 1 spec groups these two lines with `:41` as one unit (`canonical-schema-design.md:489`): "| `commands/catalog.md` | Fallback at `:41`; index format and ownership deference at `:110`; the split-threshold clause of `:112` only, since its AskUserQuestion gate survives |". The governing principle is at `:418-420`: "**Deference on structure is wrong and changes.** Folder layout, index naming and ownership, split and absorb thresholds, frontmatter schema and field order, filename conventions, wikilink format." Both lines defer exactly those things.

At `:110`, replace "following whatever index format and ownership rule the project already uses" with a statement that the index format and the single-ownership rule come from the conventions file's structural rules, which professor-orb owns. Leave the rest of the line standing: the sentence establishing that an entry's link belongs in exactly one index and is never duplicated across indexes, and the revision behavior that adds the link only if it is not already listed and does not duplicate the index line on re-capture.

At `:112`, replace "per the project's split threshold convention, if one exists" with a reference to the `structuralSplitThreshold` rule, and delete the "Absent a clear threshold or an obvious existing split pattern" fallback outright. That fallback existed to cover a project with no threshold; `structuralSplitThreshold` is a base rule, so a threshold always exists.

**Leave the AskUserQuestion gate intact.** The phase 2 spec confirms it survives (`apply-the-schema-design.md:474-477`): `catalog.md:136`'s "Never invent a new sub-index split without proposing it to the DM first via AskUserQuestion" stands, and only the split-threshold clause of `:112` changes, never the gate. Where the threshold comes from is a structural question and moves; whether the DM is asked before a split happens is an approval question and does not.

- [ ] **Step 5: Verify no component still infers structure from prose**

Run: `grep -rn "establish conventions as you go\|establish minimal conventions\|infer the schema" professor-orb/`
Expected: no hits.

Run: `grep -rn "Principle 11" professor-orb/ | wc -l`
Expected: 11 or more (the principle itself plus ten references).

- [ ] **Step 6: Commit**

```bash
git add professor-orb/skills professor-orb/agents professor-orb/commands/catalog.md
git commit -m "docs(professor-orb): fold ten copies of the fallback paragraph into one principle

Ten components carried near-identical text telling them to derive the schema
from the consumer's CLAUDE.md and existing articles when conventions.json is
missing, and four went further and authorized inventing conventions on the spot,
which guarantees two components disagree. All ten now reference SHARED-PRINCIPLES
Principle 11: apply the base schema and say setup has not run. Content-side
deference in the same paragraphs is preserved untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Setup and schema-reference posture

**Files:**
- Modify: `professor-orb/skills/setup/SKILL.md:12`, `:33`, `:37`, `:38`, `:39`, `:43`, `:47`, `:81`
- Modify: `professor-orb/skills/setup/references/conventions-schema.md:5`, `:25`, `:37`, `:40`, `:228-246`, `:272`, `:466`, `:479`

**Interfaces:**
- Produces: setup's intake described as base plus extras, which Task 16 restructures into steps.

- [ ] **Step 1: Rewrite setup's posture sentences**

At `setup/SKILL.md:12`, delete "This skill discovers and derives; it never imposes a schema the project does not already use." and "Any example values you see in the reference file (article types, filename suffixes) belong to one consumer project and are illustrations only." Replace with: "This skill applies professor-orb's schema and derives only what that schema does not cover. The base rule set ships at `references/base-rules.json`; the extras layer is discovered from this project."

At `:33`, `:37`, `:38`, `:39`: the three tiers stop being three ways to derive a rule set. Rewrite the tier intro as: "Every project starts from the same base rule set. The tiers differ only in where the project-specific extras come from: an existing conventions document is the richest source, scattered prose is next, and an interview is the fallback when nothing is written down."

At `:43`, keep the enforcement-scope classification and add: "A base rule may be whole-KB scope; `structuralSingleOwnership` ships that way, carrying `enforcement: \"warn\"` and a check function that returns not applicable at write time. The hook is therefore silent on it by function rather than by level, and the validation sweep is what actually checks it."

Do not write `enforcement: "off"` here. A sweep-scope rule recorded as `off` is skipped by the sweep too, which would leave it checked by nothing at all. Task 4 made `off` mean exactly that, deliberately, because `off` is the DM's only lever over a rule professor-orb ships rather than one they wrote.

At `:47`, change "present the full derived rule set" to "present the full rule set, base and extras". Keep the single-markup-pass mechanics and the DM-wins rule for content, and delete "you never argue that the DM's structure is wrong".

At `:81`, change the greenfield branch to build from professor-orb's canonical layout rather than "the conventions agreed in Step 2".

- [ ] **Step 2: Rewrite the schema reference's framing**

At `conventions-schema.md:5`, `:25`, `:37`, `:40`: the file describes professor-orb's schema instantiated for a project, plus that project's extras. `:25`'s "derived, not authoritative" becomes "instantiated from professor-orb's base rule set, and authoritative for structural checks". `:37` and `:40` stop saying two consumers should differ structurally.

At `:272`, change "the levels above are guidance, not defaults baked into the schema itself" to "the levels above are the defaults the base rules ship with, which the DM may change".

At `:466` and `:479`, rewrite the tier mechanics to match Step 1.

At `:228-246`, the Enforcement scopes section, add that a base rule may be sweep scope and carry `provenance: "professor-orb"`.

- [ ] **Step 3: Document `provenance`, `extendedBy`, `schemaVersion`, and `scope`**

Add to `conventions-schema.md`'s rule-entry documentation: `provenance` (required, `professor-orb` or `project`), `extendedBy` (optional array of project-contributed values unioned into the rule's enum `values`, and ONLY into `values`), `scope` (optional, `kb` restricts to the setting KB), and top-level `schemaVersion` (which base rule set version the file was generated against). Include the reconciliation rule for a v1 file: a provenance-less rule matching a base rule's check kind and target folds into that base rule's `extendedBy` and carries its enforcement level; one with no base counterpart survives as `provenance: "project"`.

- [ ] **Step 4: Verify**

Run: `grep -c '—' professor-orb/skills/setup/SKILL.md professor-orb/skills/setup/references/conventions-schema.md`
Expected: 0 for both.

Run: `grep -n "never imposes\|derived, not authoritative" professor-orb/`
Expected: no hits.

- [ ] **Step 5: Commit**

```bash
git add professor-orb/skills/setup
git commit -m "docs(professor-orb/setup): the schema is the plugin's, the extras are the project's

setup/SKILL.md:12 said the skill never imposes a schema the project does not
already use. CONTEXT.md:108 says folder-index parity is the convention
professor-orb introduces, and setup's own Step 6 imposes it eleven paragraphs
below the sentence forbidding imposition. The sentence was invented rather than
designed, and it is why the plugin handles new material well and existing
material badly: every component meeting an established KB was told to
reverse-engineer that KB's conventions and conform to them.

The three intake tiers survive, but they now differ only in where the extras
come from. conventions-schema.md gains provenance, extendedBy, scope,
schemaVersion, and the reconciliation rule for a v1 file whose rules carry no
provenance at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Public surfaces and false claims

**Files:**
- Modify: `professor-orb/README.md:3`, `:11`, `:12`, `:14`, `:57`, `:59`, `:70`
- Modify: `professor-orb/CONTEXT.md:28`, `:34-35`, `:44`, `:49`, `:52`, `:95-96`, `:118-119`, `:125-127`
- Modify: `professor-orb/.claude-plugin/plugin.json:3`
- Modify: `.claude-plugin/marketplace.json` (description only, not version)
- Modify: `professor-orb/skills/timeline/SKILL.md:34`, `:128`, `:191`
- Modify: `professor-orb/skills/orb/SKILL.md:18`
- Modify: `professor-orb/agents/kb-validator.md:11-12`, `:46`, `:61`, `:116`
- Modify: `professor-orb/agents/lore.md:30`, `:181`

- [ ] **Step 1: Rewrite the README's governing facts**

`README.md:11` and `:12` are the two facts the README says govern everything. `:11` currently names folder layout, frontmatter schema, and filename convention as consumer-owned; rewrite it to say professor-orb brings the structural schema and the consumer project is the source of truth for campaign facts and content. `:12` currently says setup produces the file "by deriving rules from the consumer project"; rewrite to base plus extras.

`README.md:57` is a separate Design-philosophy paragraph. Its full clause is "No skill hardcodes a path, a folder name, or a frontmatter field." **Keep "No skill hardcodes a path", delete "a folder name, or a frontmatter field."** Paths stay resolved from `conventions.json`, which is what makes phase 3's lane commands possible.

`README.md:3` drops "all against whichever knowledge base structure the DM already uses". `:14` stops saying setup never drafts a conventions document. `:70` mentions that setup migrates.

- [ ] **Step 2: Rewrite CONTEXT.md**

`:28` "The plugin ships no templates or schemas" is deleted; the plugin ships `references/base-rules.json`. `:44` and `:49` stop calling `conventions.json` a derivation of the consumer's conventions. `:52` describes the base-plus-extras intake. `:95-96` stops deferring catalog sub-index structure to the KB's existing conventions. `:125-127` describes what exists and points forward to phase 2's migration executor for the "rebuild step" that does not exist.

`:34-35` "Only the chronicler skill mutates it, and only after DM approval" is false: `debrief`, `prep`, `content`, `timeline`, and `/catalog` all write inside `kbRoot`. Rewrite to name the actual writers. Apply the same correction at `README.md:59`, `skills/orb/SKILL.md:18`, `agents/lore.md:30` and `:181`, and `agents/kb-validator.md:37` and `:151`.

`:118-119` promises the reference consumer that the parity migration will be a proposal with DM approval. Phase 2 changes that; leave this line for Task 16, which rewrites it alongside the other approval-gate sites.

- [ ] **Step 3: Fix timeline's self-contradiction**

`skills/timeline/SKILL.md:34` says the skill "never writes a KB article itself even after approval: chronicler is always the writer", and `:191` says "Never write KB articles itself." Phase 6 at `:177-178` writes the document and updates indexes, and `:203` confirms it. Make Phase 6's behavior the stated rule: timeline writes chronology documents and their indexes, after DM approval, and hands other article types to chronicler.

- [ ] **Step 4: Capitalize the type in timeline's document template**

`skills/timeline/SKILL.md:128` emits `type: chronology` in the template for the document timeline writes, lowercase and inconsistent with every other capitalized type. The base enum Task 2 ships carries `Chronology`, and `frontmatterTypeEnum` is `enforcement: "block"`. Comparison is case-sensitive, which the phase 1 spec states outright. So the first chronology document written after this release would be blocked by professor-orb's own hook, on output professor-orb's own skill produced.

Change `:128` to emit `type: Chronology`.

The phase 1 spec requires this (`canonical-schema-design.md:289-294`) and identifies it as the `chronology` to `Chronology` item deferred from the 1.3.0 plan, now unavoidable because the base enum makes the mismatch a `block` violation. This change covers newly written documents only; lowercase values already on disk are normalized by phase 2's migration.

- [ ] **Step 5: Fix kb-validator's orchestration claim**

`agents/kb-validator.md:46` claims the sweep "orchestrates you at scale across the whole KB, sharding the work and consolidating your reports". The sweep builds its own `checkerPrompt` and dispatches anonymous agents; `validation-sweep.mjs:45` names kb-validator only as the lighter alternative. Correct `:46`, the description at `:11-12`, and the two dependent sentences at `:61` and `:116`.

- [ ] **Step 6: Rewrite the marketplace descriptions**

`professor-orb/.claude-plugin/plugin.json:3` currently ends "Reads your project's conventions for campaign-specific rules." Replace that sentence with "Applies its own knowledge base structure and keeps your campaign in version control." Copy the same description into `.claude-plugin/marketplace.json`. **Do not change either version field in this task.**

- [ ] **Step 7: Verify**

Run: `for f in professor-orb/README.md professor-orb/CONTEXT.md professor-orb/skills/timeline/SKILL.md professor-orb/agents/kb-validator.md; do echo "$f: $(grep -c '—' $f)"; done`
Expected: 0 for each. `CONTEXT.md` has eleven em dashes today (lines 46, 76, 104, 115, 138, 152, 164, 182, 183, 194, 204) and this task removes them.

Run: `grep -n "only chronicler and /catalog write\|Only the chronicler skill mutates" professor-orb/`
Expected: no hits.

- [ ] **Step 8: Commit**

```bash
git add professor-orb/README.md professor-orb/CONTEXT.md professor-orb/.claude-plugin/plugin.json .claude-plugin/marketplace.json professor-orb/skills professor-orb/agents
git commit -m "docs(professor-orb): correct the public surfaces and four false claims

README's two governing facts and the marketplace card all said the plugin reads
the consumer's conventions rather than bringing its own. README:57's clause
survives only in part: no skill hardcodes a path stays, because paths are still
resolved from conventions.json, but a folder name and a frontmatter field are now
professor-orb's.

Four statements were simply untrue. CONTEXT.md:34 said only chronicler mutates
the KB; five components write inside kbRoot. timeline contradicted itself 140
lines apart, saying it never writes KB articles while its Phase 6 writes the
document and updates indexes. kb-validator claimed the validation sweep
orchestrates it, which it does not. And CONTEXT.md described a rebuild step that
exists nowhere in the plugin.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase 2: apply the schema

### Task 10: Conventions resolver accepting v1, v2, and v3

**Files:**
- Modify: `professor-orb/hooks/validate-write.mjs:717` and the block following it
- Modify: `professor-orb/hooks/validate-write.test.mjs`

**Interfaces:**
- Produces: `resolveSettings(conventions)` returning an array of `{ name, kbRoot, homebrewRoot, sessionReportsRoot, campaigns, rules, tagRegistryPath }`. A v3 file yields its setting objects unchanged, so `campaigns` is present. A v1 or v2 file yields one entry from its bare `kbRoot` with the other prong roots `null` and no `campaigns` at all, which is part of why lane resolution refuses that shape rather than guessing at it. Tasks 11, 12, 16, and 17 consume it, and Task 17's Principle 12 reads `settings[].campaigns` specifically.

- [ ] **Step 1: Write the failing test**

Append to `professor-orb/hooks/validate-write.test.mjs`, before `report()`:

```js
console.log("\n=== v3 conventions shape ===");

const V3 = {
  version: 3,
  settings: [
    {
      name: "rolara",
      kbRoot: "settings/rolara",
      homebrewRoot: "homebrew/rolara",
      sessionReportsRoot: "session-reports/rolara",
      rules: {
        frontmatterTypeEnum: {
          provenance: "professor-orb",
          category: "frontmatter",
          check: "enum",
          enforcement: "block",
          description: "type must be recognized.",
          params: { field: "type", values: ["Person", "Location"] },
        },
      },
    },
  ],
};

{
  const r = runHook({
    conventions: V3,
    files: { "settings/rolara/Bad.md": "---\ntype: Nope\n---\n\nbody\n" },
    targetRel: "settings/rolara/Bad.md",
  });
  check("v3 file: hook still blocks a bad enum value", r.code, 2);
}

{
  const r = runHook({
    conventions: V3,
    files: { "settings/rolara/Good.md": "---\ntype: Person\n---\n\nbody\n" },
    targetRel: "settings/rolara/Good.md",
  });
  check("v3 file: a valid article passes", r.code, 0);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node professor-orb/hooks/validate-write.test.mjs`
Expected: FAIL on "v3 file: hook still blocks a bad enum value" with actual `0`. The guard at `:717` requires a top-level `kbRoot` and exits silently without it, disabling all validation. This is the defect `docs/superpowers/specs/2026-07-28-mechanism-prototypes.mjs` records.

- [ ] **Step 3: Implement the resolver**

In `professor-orb/hooks/validate-write.mjs`, replace:

```js
  if (!conventions || typeof conventions !== "object" || !conventions.kbRoot || !conventions.rules) {
    process.exit(0);
  }

  const kbRootAbs = path.resolve(projectRoot, conventions.kbRoot);
  const absFilePath = path.resolve(projectRoot, filePath);

  const relToKb = path.relative(kbRootAbs, absFilePath);
  const isInsideKb =
    relToKb !== "" && !relToKb.startsWith("..") && !path.isAbsolute(relToKb);
  if (!isInsideKb) {
    process.exit(0);
  }
```

with:

```js
  if (!conventions || typeof conventions !== "object") {
    process.exit(0);
  }

  // v3 carries a settings array; v1 and v2 carry a bare kbRoot. Both shapes
  // must resolve, because a consumer's file is only rewritten when setup next
  // runs. A v3 file reaching the old guard exited 0 and silently disabled all
  // validation, which is why this accepts either shape explicitly.
  const settings = resolveSettings(conventions);
  if (settings.length === 0) {
    process.exit(0);
  }

  const absFilePath = path.resolve(projectRoot, filePath);

  // The owning setting is the one whose prong roots contain this file. Rules
  // are per setting, so the wrong owner means the wrong rule set.
  let owner = null;
  let prongKind = null;
  for (const s of settings) {
    const kind = prongContaining(projectRoot, s, absFilePath);
    if (kind) {
      owner = s;
      prongKind = kind;
      break;
    }
  }
  if (!owner || !owner.rules) {
    process.exit(0);
  }

  const kbRootAbs = path.resolve(projectRoot, owner.kbRoot);

  // The deleted block was the only definition of relToKb, and the ctx literal
  // still reads it as relPath. It must be reintroduced here or main() throws an
  // uncaught ReferenceError on every write: main() is invoked bare at the bottom
  // of the file, and the only try/catch in the check loop wraps individual check
  // functions, not this.
  //
  // Anchor it to the prong root that owns the file rather than to kbRoot.
  // relPath feeds only the human-readable folder label in the three structural
  // checks, and a homebrew or session-reports file measured from kbRoot would
  // render as a "../" label.
  const prongRoots = {
    kb: owner.kbRoot,
    homebrew: owner.homebrewRoot,
    "session-reports": owner.sessionReportsRoot,
  };
  const prongRootAbs = path.resolve(projectRoot, prongRoots[prongKind] || owner.kbRoot);
  const relToProng = path.relative(prongRootAbs, absFilePath);
```

Then replace every later use of `conventions.rules` in `main()` with `owner.rules`, and every later use of `conventions.tagRegistryPath` with `owner.tagRegistryPath || conventions.tagRegistryPath`.

Also change `relPath: relToKb,` in the `ctx` literal to `relPath: relToProng,`. `relToKb` does not survive this replacement, and leaving the reference is the ReferenceError described above. Leave `kbRootAbs` in the `ctx` literal alone: `wikilinkTargetExists` still resolves link targets against it.

Add these two functions above `main()`:

```js
// ---------------------------------------------------------------------------
// Settings resolution
// ---------------------------------------------------------------------------

// Normalizes v1, v2, and v3 conventions files to one shape. A v1 or v2 file
// has a bare kbRoot and a top-level rules object; it reads as a single unnamed
// setting whose other prong roots are unknown. That is enough for validation
// and deliberately not enough for lane resolution, which refuses this shape.
function resolveSettings(conventions) {
  if (Array.isArray(conventions.settings) && conventions.settings.length > 0) {
    return conventions.settings.filter((s) => s && typeof s.kbRoot === "string");
  }
  if (typeof conventions.kbRoot === "string" && conventions.rules) {
    return [
      {
        name: null,
        kbRoot: conventions.kbRoot,
        homebrewRoot: null,
        sessionReportsRoot: null,
        rules: conventions.rules,
        tagRegistryPath: conventions.tagRegistryPath,
      },
    ];
  }
  return [];
}

// Which prong of a setting contains this path, if any. Returns "kb",
// "homebrew", "session-reports", or null.
function prongContaining(projectRoot, setting, absFilePath) {
  const prongs = [
    ["kb", setting.kbRoot],
    ["homebrew", setting.homebrewRoot],
    ["session-reports", setting.sessionReportsRoot],
  ];
  for (const [kind, root] of prongs) {
    if (typeof root !== "string" || root.length === 0) continue;
    const rootAbs = path.resolve(projectRoot, root);
    const rel = path.relative(rootAbs, absFilePath);
    if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) return kind;
  }
  return null;
}
```

Finally, add `prongKind` to the `ctx` object so Task 3's `scope` gate has a value:

```js
  const ctx = {
    projectRoot,
    toolName,
    prongKind,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node professor-orb/hooks/validate-write.test.mjs`
Expected: `15/15 expectations met.` All earlier v1 and v2 cases must still pass.

- [ ] **Step 5: Flip the prototype expectation**

In `docs/superpowers/specs/2026-07-28-mechanism-prototypes.mjs`, the case named "v3 file (settings array, no top-level kbRoot): hook is SILENT (DEFECT, must be fixed)" now describes fixed behavior. Change its name to "v3 file (settings array, no top-level kbRoot): hook emits a violation", change its expected value from `false` to `true`, and delete the "When it does, flip this expectation to true" sentence from its note.

Run: `node docs/superpowers/specs/2026-07-28-mechanism-prototypes.mjs`
Expected: `17/17 expectations met.`

- [ ] **Step 6: Commit**

```bash
git add professor-orb/hooks/validate-write.mjs professor-orb/hooks/validate-write.test.mjs docs/superpowers/specs/2026-07-28-mechanism-prototypes.mjs
git commit -m "feat(professor-orb): resolve v1, v2, and v3 conventions shapes in the hook

validate-write.mjs:717 required a top-level kbRoot and exited 0 without one, so
a settings-array file would have silently disabled every write-time check with no
error. Measured before the fix: a v2 file exits 2 with a violation, the v3 file
exits 0 with no output.

The resolver normalizes all three shapes, picks the setting whose prong roots
contain the file being written, and evaluates that setting's rules. A v1 or v2
file reads as one unnamed setting, which is enough for validation and
deliberately not enough for lane resolution.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Prong scoping, per-setting search root, and honest entry counts

**Files:**
- Modify: `professor-orb/hooks/validate-write.mjs:408-433` (`searchForFileStat`, `wikilinkTargetExists`)
- Modify: `professor-orb/hooks/validate-write.mjs:376-406` (`checkSplitThreshold`, `checkAbsorbThreshold`)
- Modify: `professor-orb/hooks/validate-write.test.mjs`

**Interfaces:**
- Consumes: `ctx.prongKind` and the owning setting from Task 10.
- Produces: wikilink resolution searches the union of the owning setting's prong roots.

- [ ] **Step 1: Write the failing tests**

Append to `professor-orb/hooks/validate-write.test.mjs`, before `report()`:

```js
console.log("\n=== prong scoping and entry counts ===");

{
  // A session report linking to a KB article must resolve: the search root is
  // the union of the setting's prongs, not its kbRoot alone.
  const conventions = {
    version: 3,
    settings: [{
      name: "r",
      kbRoot: "settings/r",
      homebrewRoot: "homebrew/r",
      sessionReportsRoot: "session-reports/r",
      rules: {
        contentWikilinks: {
          provenance: "professor-orb",
          category: "content",
          check: "wikilinkPolicy",
          enforcement: "block",
          description: "wikilink targets must exist.",
          params: { requireExistingTarget: true, requireDisplayText: false },
        },
      },
    }],
  };
  const r = runHook({
    conventions,
    files: {
      "settings/r/Thoric.md": "---\ntype: Person\n---\n\nbody\n",
      "session-reports/r/c/S1-REPORT.md": "---\ntype: Session Report\n---\n\nMet [[Thoric]].\n",
    },
    targetRel: "session-reports/r/c/S1-REPORT.md",
  });
  check("a report-to-KB wikilink resolves across prongs", r.code, 0);
}

{
  // A folder of 3 articles plus 3 subfolders is not 6 articles.
  const conventions = {
    version: 3,
    settings: [{
      name: "r",
      kbRoot: "settings/r",
      homebrewRoot: null,
      sessionReportsRoot: null,
      rules: {
        structuralSplitThreshold: {
          provenance: "professor-orb",
          category: "structural",
          check: "splitThreshold",
          enforcement: "block",
          scope: "kb",
          description: "folder is over the split threshold.",
          params: { minEntries: 6, indexSuffix: "-INDEX" },
        },
      },
    }],
  };
  const files = {
    "settings/r/items/A.md": "---\ntype: Item\n---\n\nx\n",
    "settings/r/items/B.md": "---\ntype: Item\n---\n\nx\n",
    "settings/r/items/C.md": "---\ntype: Item\n---\n\nx\n",
    "settings/r/items/items-INDEX.md": "---\ntype: Index\n---\n\nx\n",
    "settings/r/items/sub1/X.md": "---\ntype: Item\n---\n\nx\n",
    "settings/r/items/sub2/Y.md": "---\ntype: Item\n---\n\nx\n",
    "settings/r/items/sub3/Z.md": "---\ntype: Item\n---\n\nx\n",
  };
  const r = runHook({ conventions, files, targetRel: "settings/r/items/C.md" });
  check("three articles plus three subfolders does not trip the split threshold", r.code, 0);
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `node professor-orb/hooks/validate-write.test.mjs`
Expected: both new cases FAIL. The first because `searchForFileStat` walks `kbRoot` only; the second because `:384` counts every non-dot `readdirSync` entry, so 3 articles plus 3 subfolders plus 1 index reads as 7.

- [ ] **Step 3: Widen the wikilink search root**

Change `wikilinkTargetExists(kbRootAbs, target)` to `wikilinkTargetExists(searchRoots, target)`, taking an array, and have it try `searchForFileStat` under each root in turn. At the call site in `checkWikilinkPolicy`, pass the owning setting's resolved prong roots. Add `ctx.searchRoots` in `main()`:

```js
  const searchRoots = ["kbRoot", "homebrewRoot", "sessionReportsRoot"]
    .map((k) => owner[k])
    .filter((r) => typeof r === "string" && r.length > 0)
    .map((r) => path.resolve(projectRoot, r));
```

- [ ] **Step 4: Narrow the entry counts, in one shared helper**

The line `const count = entries.filter((f) => !f.startsWith(".")).length;` occurs **twice**, at `:384` inside `checkSplitThreshold` and at `:400` inside `checkAbsorbThreshold`. Do not paste the replacement into both. Define the counting logic once, as a helper named `countArticles`, above both checks:

```js
// Articles only. The raw directory listing includes subfolders, images, and
// the folder's own index, so a folder of 3 articles plus 3 subfolders would
// otherwise read as 6 and wrongly earn a split. Shared by both threshold
// checks: they ask the same question of the same directory and must never
// answer it differently.
function countArticles(dirAbs, entries, params) {
  const indexSuffix = typeof params.indexSuffix === "string" ? params.indexSuffix.toLowerCase() : null;
  return entries.filter((f) => {
    if (f.startsWith(".")) return false;
    if (!f.toLowerCase().endsWith(".md")) return false;
    const base = f.slice(0, -3).toLowerCase();
    if (indexSuffix && base.endsWith(indexSuffix)) return false;
    let isDir = false;
    try {
      isDir = statSync(path.join(dirAbs, f)).isDirectory();
    } catch {
      isDir = false;
    }
    return !isDir;
  }).length;
}
```

Then in each check, replace the filter line with a call:

```js
  const count = countArticles(dir, entries, params);
```

Two details to check against the file rather than assume. First, `dir` above is a placeholder for whatever the surrounding function already calls the directory it read with `readdirSync`; use the existing variable name at both call sites. Second, confirm `statSync` is in the `node:fs` import list at the top of the file and add it if not. A `.md` extension check is safe here because `readdirSync` returns names, and a directory named `foo.md` would still be excluded by the `isDirectory` test.

- [ ] **Step 5: Fix the absorb threshold's comparison and its message**

In `checkAbsorbThreshold`, change `if (count <= maxEntries)` to `if (count < maxEntries)`.

With `maxEntries: 4` the `<=` fires on a folder holding exactly four articles. The rule's own shipped description says "A leaf folder holding fewer than four articles is absorbed into its parent", and the phase 1 spec says "Under 4 entries dissolves the folder". Four is not under four, so the operator is off by one against both.

The violation message built just below it currently reads `(at most ${maxEntries})`, which after this change states a threshold the code no longer uses. Rewrite it to state the real one, so the message agrees with the description sitting beside it in `base-rules.json`.

Leave `checkSplitThreshold`'s `count >= minEntries` alone. With `minEntries: 6` and a description saying "six or more", that one is already correct.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node professor-orb/hooks/validate-write.test.mjs`
Expected: `17/17 expectations met.`

- [ ] **Step 7: Commit**

```bash
git add professor-orb/hooks/validate-write.mjs professor-orb/hooks/validate-write.test.mjs
git commit -m "fix(professor-orb): scope wikilink search per setting and count only articles

Moving session reports and the homebrew catalog out of kbRoot would have made
every cross-prong wikilink report as dead, because the search root was kbRoot
alone. It becomes the union of the owning setting's prong roots, which keeps the
per-setting vault boundary intact while letting a report link to a KB article.

The split and absorb thresholds counted every non-dot directory entry, so three
articles plus three subfolders plus an index read as seven and earned a split
nothing asked for. They now count markdown articles, excluding indexes and
subdirectories.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Sweep understands settings

**Files:**
- Modify: `professor-orb/workflows/validation-sweep.mjs:61-74` (`SCOUT_SCHEMA`), `:162-172` (scout prompt), `:167`, `:169`, `:181`, `:243`, `:353`, `:450-459` (`toOwnershipKey`), `:500-513`, `:569`, `:588-589`, `:612`, `:622`
- Modify: `professor-orb/workflows/validation-sweep.ownership.test.mjs`

**Interfaces:**
- Produces: ownership and collision keys are `<setting>/<basename>`; the tag registry is per setting.

- [ ] **Step 1: Update the ownership test first**

In `professor-orb/workflows/validation-sweep.ownership.test.mjs`, change `toOwnershipKey` to take a setting name and prefix the key, and add a case asserting two settings may each hold a `Tavern.md` without colliding:

```js
const toOwnershipKey = (raw, setting) => {
  let s = String(raw).trim()
  s = s.replace(/^\[\[|\]\]$/g, '')
  s = s.replace(/\\\|/g, '|')
  s = s.split('|')[0]
  s = s.split('#')[0]
  s = s.replace(/\\/g, '/').replace(/\/+$/, '')
  const base = s.slice(s.lastIndexOf('/') + 1)
  return (setting ? setting + '/' : '') + base.replace(/\.md$/i, '').trim().toLowerCase()
}
```

**Then update the three call sites inside the test's own `aggregateNew`.** This file deliberately does not import `validation-sweep.mjs`, for the reason its header at `:3-9` gives: the module uses top-level await and workflow-runtime globals, so importing it would execute `run()` and throw. The test therefore mirrors the logic locally, which means changing the source file cannot affect it. `aggregateNew` calls `toOwnershipKey` with one argument at three places (`:57`, `:63`, `:76`); thread the owning setting through each. Skip this and the second parameter is `undefined` everywhere, the key comes out unprefixed exactly as before, and Step 4's expected PASS is unreachable no matter what Step 3 does to the source.

Add a case: two shards from different settings, each with a `Tavern.md` owned by its own index, must produce two distinct keys and zero multi-owner findings.

- [ ] **Step 2: Run to verify the new case fails**

Run: `node professor-orb/workflows/validation-sweep.ownership.test.mjs`
Expected: FAIL on the cross-setting case, because the shipped key is global.

- [ ] **Step 3: Apply the same change in the source**

Update `validation-sweep.mjs:450-459`'s `toOwnershipKey` identically, and thread the owning setting through the aggregation at `:515-538` and the collision detector at `:500-513`. `SCOUT_SCHEMA` gains a `prongRoots` array, each entry `{ setting, kind, path }`, replacing the single `kbRoot` field. The scout prompt at `:162-172` enumerates every prong root. The tag-registry sites at `:243`, `:353`, `:588-589`, and `:622` resolve per setting.

- [ ] **Step 4: Run both suites**

Run: `node professor-orb/workflows/validation-sweep.ownership.test.mjs`
Expected: PASS including the cross-setting case.

Run: `node professor-orb/hooks/validate-write.test.mjs`
Expected: still `17/17`.

- [ ] **Step 5: Commit**

```bash
git add professor-orb/workflows/
git commit -m "feat(professor-orb): make the sweep setting-aware

toOwnershipKey reduced every path to a bare lowercased basename in one global
namespace. Under the per-setting vault boundary two settings are entitled to
their own Tavern.md, which is the entire justification for the setting level, so
a global key would have merged their owner lists and asked the DM which index
from the wrong world should own the file. The same detector is the migration's
collision precheck, so the first legitimate cross-setting duplicate would have
aborted the run.

The key becomes setting-qualified, SCOUT_SCHEMA carries prong roots with their
owning setting instead of a single kbRoot, and the tag registry resolves per
setting so one world's vocabulary is never suggested inside another's.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: `versioning.json` and its one-time conversion

**Files:**
- Modify: `professor-orb/commands/catalog.md:49`, `:50`, `:55`, `:56`, `:146`
- Modify: `professor-orb/skills/setup/SKILL.md` (conversion step)

**Interfaces:**
- Produces: `.professor-orb/versioning.json` with `mode` (`github` | `git` | `changelog`), `decided` (never rewritten), optional `remote` and `githubPending`. Tasks 16, 18, 19, and 20 read it.

- [ ] **Step 1: Delete the repo-presence check and flip the precedence**

In `professor-orb/commands/catalog.md`, delete the whole of Step 3's numbered item 1 at `:49` ("Is the catalog folder already inside a git repository?"). Renumber the remaining items so the marker check is first. Under phase 2 setup runs `git init` at the project root, so leaving the check live would put every consumer into git mode from ambient state with no recorded decision.

- [ ] **Step 2: Rename the marker at all four sites**

Replace `.professor-orb/catalog-versioning.json` with `.professor-orb/versioning.json` at `:50`, `:55`, `:56`, and `:146`.

- [ ] **Step 3: Specify the conversion**

Add to Step 3, as its first instruction: "If `.professor-orb/catalog-versioning.json` exists and `.professor-orb/versioning.json` does not, copy its `mode` and `decided` values unchanged into the new file and mention the conversion in passing. Never rewrite `decided`: the decision was made when it was made. Do not delete the old file here; setup deletes it after its snapshot commit captures it."

Add the same conversion to `setup/SKILL.md` as run-order step 4 (Task 16 places it).

- [ ] **Step 4: Verify**

Run: `grep -rn "catalog-versioning.json" professor-orb/`
Expected: hits only in the conversion instructions, never as a path being read as primary.

Run: `grep -n "already inside a git repository" professor-orb/`
Expected: no hits.

- [ ] **Step 5: Commit**

```bash
git add professor-orb/commands/catalog.md professor-orb/skills/setup/SKILL.md
git commit -m "fix(professor-orb): read the recorded versioning decision before anything else

/catalog Step 3 asked whether the catalog folder sits inside a git repository and
concluded git mode if so. That conflated two facts which used to coincide, when a
catalog folder was its own repository, and no longer do. Phase 2 runs git init at
the project root, which would have made the check true for every consumer and
suppressed the one-time offer universally, so the check is deleted rather than
made more precise.

The marker is renamed to versioning.json, since the decision covers the whole
project rather than the catalog alone, with a one-time conversion that preserves
the original decision date.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Migration executor, plan phase

**Files:**
- Create: `professor-orb/workflows/migrate.mjs`
- Create: `professor-orb/workflows/migrate.plan.test.mjs`

**Interfaces:**
- Produces: `buildPlan({ projectRoot, settings, baseRules, discovered })` returning `{ operations, declined, prechecks }`. `operations` is an ordered array of `{ op, from, to, reason }`. Task 15 consumes it.
- Produces: `runPrechecks(plan)` returning `{ ok, collisions, caseRenames, ignored }`.

- [ ] **Step 1: Write the failing test**

Write `professor-orb/workflows/migrate.plan.test.mjs` with cases asserting: the operation order is relocate, normalize types, rename with link rewrite, create indexes, merge indexes, repair frontmatter, vault, tag registry; that `split` and `absorb` never appear in `operations` and always appear in `declined`; that a destination-directory basename collision sets `prechecks.ok = false`; and that a legitimate cross-setting duplicate basename does not.

- [ ] **Step 2: Run to verify it fails**

Run: `node professor-orb/workflows/migrate.plan.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the plan phase**

Write `professor-orb/workflows/migrate.mjs`. Unlike `validation-sweep.mjs`, which cannot be imported because it uses top-level await and workflow globals, this module must be importable so its planning half is testable. Put the workflow entry point behind a guard.

```js
#!/usr/bin/env node
// Migration executor for professor-orb.
//
// Two phases, the same covenant validation-sweep.mjs documents: a plan phase
// that mutates nothing and returns an ordered operation list, then an apply
// phase that applies ONLY what the plan carries and never invents an operation.
//
// Importable: buildPlan and runPrechecks are pure and exported so
// migrate.plan.test.mjs can exercise them without starting a workflow run.
//
// Node built-ins only.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

// Normative operation order. Type normalization precedes renames because a
// file's required suffix derives from its type, so renaming first would compute
// suffixes from stale values and leave the corrected files mis-suffixed.
export const OPERATION_ORDER = [
  "relocate-prong",
  "normalize-type",
  "rename-with-link-rewrite",
  "create-index",
  "merge-index",
  "repair-frontmatter",
  "vault",
  "tag-registry",
];

// Never executed on the first run. Crossing a threshold says a folder should
// divide or dissolve; it does not say how to partition it or where its contents
// belong. That is a judgment about the DM's own material, and it belongs to
// /migrate once the DM has scoped it.
export const DEFERRED_OPERATIONS = ["split", "absorb"];

/**
 * @param {{projectRoot: string, settings: Array, baseRules: object, discovered: object}} input
 * @returns {{operations: Array<{op: string, from?: string, to?: string, reason: string}>,
 *            declined: Array<{op: string, target: string, reason: string}>,
 *            prechecks: object}}
 */
export function buildPlan({ projectRoot, settings, baseRules, discovered }) {
  const operations = [];
  const declined = [];

  for (const opKind of OPERATION_ORDER) {
    operations.push(...planOperation(opKind, { projectRoot, settings, baseRules, discovered }));
  }
  for (const opKind of DEFERRED_OPERATIONS) {
    declined.push(...proposeDeferred(opKind, { projectRoot, settings, baseRules, discovered }));
  }

  // publish is never inserted by any unattended process: the guard that forces
  // publish false on DM-only content is a project-scope check kind, so writing a
  // default here would publish unmarked secret lore in bulk.
  declined.push(...reportMissingPublish({ projectRoot, settings }));

  return { operations, declined, prechecks: runPrechecks({ operations, projectRoot }) };
}

/**
 * @returns {{ok: boolean, collisions: Array, caseRenames: Array, ignored: Array}}
 */
export function runPrechecks({ operations, projectRoot }) {
  const collisions = findDestinationCollisions(operations);
  const caseRenames = operations.filter(
    (o) => o.from && o.to && o.from.toLowerCase() === o.to.toLowerCase() && o.from !== o.to
  );
  const ignored = findIgnoredSources(operations, projectRoot);
  // Only collisions abort. An ignored file is skipped and reported, never moved,
  // so it must not fail the run: one ignored file inside a prong would otherwise
  // stop the whole migration. ignored still rides along because the after-action
  // report has to name every file the run declined to touch.
  return { ok: collisions.length === 0, collisions, caseRenames, ignored };
}

// Collisions are scoped to each DESTINATION DIRECTORY, which is what a move can
// actually overwrite. Two settings legitimately holding a Tavern.md is not a
// collision, and aborting on it would abort for the exact duplication the
// per-setting layout exists to permit.
function findDestinationCollisions(operations) {
  const byDir = new Map();
  const hits = [];
  for (const o of operations) {
    if (!o.to) continue;
    const dir = path.dirname(o.to);
    const base = path.basename(o.to).toLowerCase();
    const key = `${dir}::${base}`;
    if (byDir.has(key)) hits.push({ a: byDir.get(key), b: o.to });
    else byDir.set(key, o.to);
  }
  return hits;
}
```

Implement `planOperation`, `proposeDeferred`, `reportMissingPublish`, and `findIgnoredSources` to satisfy the Step 1 tests. `findIgnoredSources` shells out to `git status --ignored --porcelain` and returns any operation whose source is ignored, because an ignored file is not in the snapshot and therefore must never be moved.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node professor-orb/workflows/migrate.plan.test.mjs`
Expected: all cases PASS.

- [ ] **Step 5: Commit**

```bash
git add professor-orb/workflows/migrate.mjs professor-orb/workflows/migrate.plan.test.mjs
git commit -m "feat(professor-orb): add the migration executor's plan phase

Nothing in the plugin could move a file: rule-fixer is granted Read and Edit,
kb-validator is read-only, and the sweep's fix workers use Write or Edit. The
executor is a workflow script distributed the way validation-sweep.mjs already
is, and this commit lands its pure planning half.

Type normalization runs before the rename pass, because a file's required suffix
derives from its type, so renaming first would compute suffixes from stale values.
Split and absorb never enter operations: crossing a threshold says a folder should
divide, not how to partition it, which is a judgment about the DM's material and
belongs to /migrate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Migration executor, apply phase

**Files:**
- Modify: `professor-orb/workflows/migrate.mjs`
- Create: `professor-orb/workflows/migrate.apply.test.mjs`

**Interfaces:**
- Consumes: `buildPlan` output from Task 14.
- Produces: `applyPlan(plan, { cwd })` returning `{ applied, failed, dropped }`, one entry per operation.

- [ ] **Step 1: Write the failing test**

Write `professor-orb/workflows/migrate.apply.test.mjs` building a disposable git repo and asserting: every relocation uses `git mv` and leaves `git status --porcelain` showing a staged rename rather than a delete plus untracked pair; a rename and its link rewrite land as one unit with one accounting entry; an index merge preserves headings and prose from every source file; a frontmatter reorder preserves a YAML comment and a quoted `"false"`; and `publish` is never inserted.

- [ ] **Step 2: Run to verify it fails**

Run: `node professor-orb/workflows/migrate.apply.test.mjs`
Expected: FAIL, `applyPlan` not exported.

- [ ] **Step 3: Implement the apply phase**

Per-operation workers are dispatched with a `Bash` tool grant, which differs from `validation-sweep.mjs`'s Read/Edit/Write workers and is required: a Write-only worker can only copy a file to its new path, leaving the original tracked, which for a suffix rename produces two files claiming one article. Every relocation goes through `git mv`. Case-only renames use `git mv` directly, falling back to a two-step through a temporary name only if `git mv` reports an error.

Frontmatter reordering is a line-move on the raw text, never parse-and-regenerate: `parseYamlLines` is a documented subset that drops comments and nested maps, and `parseScalar` strips quoting, which would erase a quoted `"false"` that `conventions-schema.md:209` calls a real bug worth surfacing.

Reuse `validation-sweep.mjs:276-289`'s dropped-worker accounting so a half-applied run is never reported as complete.

- [ ] **Step 4: Assert link integrity before the migration commit**

The phase 2 spec makes this a safety rail (`apply-the-schema-design.md:447`): "| Post-migration link-integrity assertion must pass before the migration commit | Catches any rename whose rewrite was dropped |". It pairs with `:437`, "| Rename and its link rewrite are one unit of work | A dead wikilink is valid markdown and fails silently |", and the verification fixture at `:567-568` asserts that every wikilink resolves after the run, including report-to-report and report-to-article.

The spec names the rail but specifies no mechanism, so the mechanism below is derived from the rail rather than quoted from the spec. An implementer who finds a better one may substitute it, provided the assertion still gates the commit.

Run it after every rename and every link rewrite has been applied and before the migration commit is made. Walk every markdown file under every prong root of every setting, extract every wikilink target, and assert that each one resolves to a file that exists. Resolution is filename-based, not path-based, because Obsidian wikilinks are filename-based, which is the same property that makes the folder moves safe in the first place. On any unresolved link the run does not commit: report the dead links with their containing files and point at the snapshot for restoration.

The rail exists precisely because the dropped-worker accounting reused in Step 3 reports a drop only after the fact: by that point the repository already carries dead wikilinks, and a dead wikilink is valid markdown that fails silently in Obsidian rather than erroring. Reuse that same accounting here rather than building a parallel one alongside it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node professor-orb/workflows/migrate.apply.test.mjs`
Expected: all cases PASS.

- [ ] **Step 6: Commit**

```bash
git add professor-orb/workflows/migrate.mjs professor-orb/workflows/migrate.apply.test.mjs
git commit -m "feat(professor-orb): add the migration executor's apply phase

Workers are granted Bash and move files with git mv. Measured: a Write-only
worker can only copy content to the new path, leaving the original tracked, which
for a suffix rename produces two files claiming one article and a guaranteed
basename collision. A plain filesystem rename leaves a delete plus an untracked
file, coherent only if both sides are staged. git mv records one staged rename,
and handles case-only renames in a single step on a case-insensitive filesystem.

Frontmatter reordering moves raw lines rather than parsing and regenerating,
because the hook's YAML parser is a documented subset that drops comments and
nested maps and strips quoting.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: Setup's run order

**Files:**
- Modify: `professor-orb/skills/setup/SKILL.md` (substantial rewrite)
- Modify: `professor-orb/skills/setup/references/conventions-schema.md:56-91` (the `## Top-level shape` section) and its `## Example conventions.json` block
- Modify: `professor-orb/skills/SHARED-PRINCIPLES.md` (Principle 2 and 8 carve-outs)
- Modify: `professor-orb/CONTEXT.md:118-119`

**Interfaces:**
- Consumes: `migrate.mjs` from Tasks 14 and 15, `versioning.json` from Task 13.

- [ ] **Step 1: Rewrite setup's steps against the run-order table**

The phase 2 spec's Part 1 table is normative: sixteen run-order items mapped onto setup steps. Restate `setup/SKILL.md`'s steps in full against it rather than shifting numbers by one. The critical orderings:

- The clean-tree gate precedes anything that writes a file, including the marker conversion.
- The snapshot commit precedes every mutation, and its hash is asserted and printed before the migration runs.
- Any existing `conventions.json` is moved aside after the snapshot and restored at artifact-writing time, so the hook is silent through the migration on **resync** as well as first run.
- The rule-set draft and the enforcement-level `AskUserQuestion` happen **after** the migration, because it runs at base defaults and the extras derive from the post-migration KB.
- Nested `.git` directories below the project root are detected before the snapshot, because their contents cannot be captured by it.

- [ ] **Step 2: Write the approval carve-outs**

`setup/SKILL.md:14` currently requires DM approval for every mutation. Rewrite it to enumerate: the schema migration is exempt; `conventions.json` contents, enforcement levels, the CLAUDE.md pointer paragraph, predecessor removal, and conventions-doc retirement keep their gates. Replace `:80`'s approval clause while keeping its scan definition verbatim, and `:83`'s "migrations stay proposals" while keeping its prohibition on asserting migrations inside `conventions.json`.

Add a narrow carve-out to `SHARED-PRINCIPLES.md` Principle 2: setup's schema migration is exempt because a verified snapshot commit is the gate; every pipeline skill remains gated. Add a Principle 8 carve-out naming the migration manifest as required by professor-orb's own conventions.

Rewrite `CONTEXT.md:118-119`, which promises the reference consumer that the parity migration will be a proposal with DM approval, to describe the snapshot-and-report model.

**The carve-out is conditional.** With `versioning.json` mode `changelog`, or if the snapshot assertion fails, there is no verified hash and therefore no gate to replace: the manifest is presented as a proposal and execution waits for approval.

- [ ] **Step 3: Write the `.gitignore` policy**

Ignored: `.professor-orb/pipeline-state.json`, `.professor-orb/proposals/`, `.professor-orb/tag-registry*.json`, `**/.obsidian/workspace*.json`, `**/.obsidian/plugins/`. The `**/` prefix is required: a pattern with a mid-string slash anchors to the repo root and would match nothing under `settings/<setting>/`.

Tracked: `.professor-orb/conventions.json`, `.professor-orb/versioning.json`, the migration manifest.

The large-and-sensitive-material interview runs at step 14, **before** the migration commit at step 15, so that the `git rm --cached` removals it produces are captured by that commit rather than left sitting uncommitted in the tree.

It must still run **after** the snapshot at step 5. That is the genuine constraint: asking the DM what to exclude before anything is captured invites them to exclude exactly the material the migration is about to move, and it would then be excluded from the only restore point they have.

Note that the phase 2 spec's Part 6 prose at `:339-340` is stale here. It says step 12, after the migration commit, which contradicts the Part 1 table and names the wrong step number besides, since step 12 is writing the `.professor-orb/` artifacts. `apply-the-schema-design.md:90` declares the table normative, so the table governs and the prose does not.

- [ ] **Step 4: Write the after-action report section**

The DM approved the prong mapping and nothing else, so the report is the whole accountability surface. It reuses the KB Validation Report shape at `agents/kb-validator.md:118-147` and states:

- The layout before and after.
- Every file moved, renamed, created, merged, or deleted, by count, with the manifest path.
- **Every file whose contents were edited, by count and by which operation edited it.** An earlier draft enumerated only location changes, which left the two operations that rewrite article contents absent from the report entirely.
- Every link rewritten.
- Which vault to reopen in Obsidian.
- Everything declined and why: ignored files, absorb candidates, split proposals, `-TIMELINE` and `-HISTORY` files, articles missing `publish`, prose path references.
- Anything that failed, with file and error.
- The git state: snapshot hash, migration hash, and the exact undo command.

On the no-version-control path the undo instruction is replaced by a plain statement that the restructure cannot be reversed automatically.

- [ ] **Step 5: Rewrite the schema reference's top-level shape to v3**

`professor-orb/skills/setup/references/conventions-schema.md:56-91` is a `## Top-level shape` section documenting v1: `"version": 1` with a flat `"kbRoot"`, a top-level `"rules"` object, and a top-level `"tagRegistryPath"`. Nothing else in this release touches it. At release the hook, the sweep, setup, the path consumers, and both new lane commands all consume a v3 settings array, while setup's own normative reference, the document setup generates `conventions.json` from, still documents only v1.

The same applies to that file's `## Example conventions.json` block, which is also still a v1 file. Update both in this step, to the same shape.

While rewriting the example, do not carry across its `structuralSingleOwnership` description. It currently runs three sentences of mechanism narration with an enforcement instruction embedded in it, which violates the description discipline stated in the same document and repeated in `setup/SKILL.md`: a terse sentence naming what the rule checks and nothing else. The artifact already ships the correct terse form at `references/base-rules.json`; use that. The example block is the style setup copies from, so a bad description there propagates into every consumer's file. Task 8 deliberately left the example at `"version": 1` and labelled it as a v1 file rather than bumping it to 2, because the phase 1 spec's "version goes to 2 at this phase, and to 3 in phase 2" would have meant churning the same example twice within one release that never ships those phases separately. Going straight to v3 here is the intended end state. If you leave the example behind, the document contradicts itself: a v3 top-level shape above a v1 example, in the file every consumer's `conventions.json` is generated from.

Replace that section with the v3 shape the phase 2 spec gives at `apply-the-schema-design.md:159-180`:

```json
{
  "version": 3,
  "schemaVersion": 1,
  "settings": [
    {
      "name": "rolara",
      "kbRoot": "settings/rolara",
      "homebrewRoot": "homebrew/rolara",
      "sessionReportsRoot": "session-reports/rolara",
      "campaigns": ["ashes-of-the-first-crown"],
      "tagRegistryPath": ".professor-orb/tag-registry.rolara.json",
      "rules": {}
    }
  ],
  "generatedBy": "setup",
  "generatedAt": "2026-07-28T00:00:00Z",
  "sourceConventionsDoc": null
}
```

Carry the spec's two explanations across with it. At `:182-187`: "**`rules` and `tagRegistryPath` move inside each setting.** A second world must be able to carry its own article types and its own tag vocabulary." At `:229-231`: "**`campaigns` is a cache, not the authority.** Lane resolution enumerates the filesystem under `sessionReportsRoot`; the array disambiguates and orders."

The documented shape must match `resolveSettings` from Task 10 field for field. Check the two side by side rather than trusting that both were written from the same spec: a mismatch between what the generator's reference documents and what the resolver accepts is exactly the class of defect this release exists to remove.

- [ ] **Step 6: Verify**

Run: `grep -c '—' professor-orb/skills/setup/SKILL.md professor-orb/skills/SHARED-PRINCIPLES.md professor-orb/CONTEXT.md`
Expected: 0 for each.

Run: `grep -n 'Every mutation in this workflow' professor-orb/skills/setup/SKILL.md`
Expected: the sentence now enumerates which mutations keep their gate.

- [ ] **Step 7: Commit**

```bash
git add professor-orb/skills/setup/SKILL.md professor-orb/skills/setup/references/conventions-schema.md professor-orb/skills/SHARED-PRINCIPLES.md professor-orb/CONTEXT.md
git commit -m "feat(professor-orb/setup): git first, migrate second, report after

The run order is the safety design. git init alone provides zero revertibility,
because an untracked working tree has no restore point, so the snapshot commit
precedes every mutation and its hash is asserted and printed before the migration
starts. Any existing conventions.json is moved aside after the snapshot, which is
what makes the write-time hook silent through the migration on resync, the only
path the reference consumer takes and the one an earlier draft did not cover.

The approval carve-out is conditional on that verified hash: with no version
control there is no gate to replace, so the manifest becomes a proposal and
execution waits for approval. Four other statements of the same approval rule are
rewritten alongside setup's own, including the one promising the reference
consumer this exact migration would be proposed first.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 17: Downstream path consumers

**Files:**
- Modify: `professor-orb/skills/debrief/SKILL.md:20`, `:79`, `:81`
- Modify: `professor-orb/skills/content/SKILL.md:16`
- Modify: `professor-orb/skills/prep/SKILL.md`, `chronicler/SKILL.md`, `timeline/SKILL.md:21`
- Modify: `professor-orb/commands/catalog.md` (Step 2)
- Modify: `professor-orb/skills/SHARED-PRINCIPLES.md` (setting-resolution rule)

- [ ] **Step 1: Add the shared setting-resolution rule**

Append to `SHARED-PRINCIPLES.md`:

```markdown
## 12. Resolving the setting and campaign

Paths come from `conventions.json`'s `settings` array, never from a hardcoded default. With one setting there is no ambiguity. With several, the DM usually names it; otherwise infer from context and confirm with a single AskUserQuestion.

`settings[].campaigns` is a cache for disambiguation and ordering. Enumerate the filesystem under `sessionReportsRoot` for the authoritative list, so a campaign created since the last setup run is still visible.
```

- [ ] **Step 2: Retarget the seven consumers**

`debrief/SKILL.md:20` currently defaults session reports to `session-reports/[Campaign-Name]/` **at the KB root**. Left alone, the next debrief re-creates the old nesting inside the KB and quietly undoes the migration. Change it to resolve `sessionReportsRoot` per Principle 12, with the canonical `session-reports/<setting>/<campaign>/` as fallback.

`content/SKILL.md:16` defaults content to a `content/` subdirectory inside the campaign's session-reports folder. Keep that relationship, resolved from `sessionReportsRoot`.

`debrief:79` and `:81` make index updates conditional on the project using them; under folder-index parity they are not optional.

`timeline/SKILL.md:21` places chronology documents wherever a convention exists; they live in the setting KB under the canonical layout.

`catalog.md` Step 2 resolves `homebrewRoot`.

- [ ] **Step 3: Verify**

Run: `grep -rn "at the KB root" professor-orb/skills/`
Expected: no hit that places session reports or homebrew inside the KB.

- [ ] **Step 4: Commit**

```bash
git add professor-orb/skills professor-orb/commands/catalog.md
git commit -m "fix(professor-orb): resolve prong paths from the settings array

debrief defaulted session reports to session-reports/<campaign>/ at the KB root
and content to a content/ subdirectory inside that. Left alone, the first debrief
after a migration would have re-created the old nesting inside the KB and quietly
undone the relocation. All seven path consumers now resolve from the settings
array under one shared rule, with the canonical layout as fallback and never the
old nesting.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase 3: lane commands

### Task 18: Stop hook lane clauses

**Files:**
- Modify: `professor-orb/hooks/pipeline-next.mjs:14-24`
- Create: `professor-orb/hooks/pipeline-next.test.mjs`

**Interfaces:**
- Produces: the base next-step sentence always emits; only the appended lane clause is conditional on `versioning.json`.

- [ ] **Step 1: Write the failing test**

Write `professor-orb/hooks/pipeline-next.test.mjs` driving the hook with a fixture `pipeline-state.json` and asserting: with `lastStep: "chronicler"` and a `versioning.json` in git mode, the output contains both the existing kb-validator suggestion and `/scribe`; with no `versioning.json`, the output still contains the existing suggestion and does **not** contain `/scribe`; with `lastStep: "prep"`, output is unchanged from today.

- [ ] **Step 2: Run to verify it fails**

Run: `node professor-orb/hooks/pipeline-next.test.mjs`
Expected: FAIL, no `/scribe` in the chronicler message.

- [ ] **Step 3: Implement**

In `professor-orb/hooks/pipeline-next.mjs`, keep `NEXT_STEP_MESSAGES` as the always-emitted base and add a second map of lane clauses appended only when a `versioning.json` with mode `github` or `git` exists:

```js
const LANE_CLAUSES = {
  debrief: " /log can commit the session report.",
  content: " /log can commit the recap and handouts.",
  chronicler: " /scribe can commit the KB changes.",
};
```

A `timeline` entry was briefly added here during a plan repair and has been REMOVED. It was unreachable: `NEXT_STEP_MESSAGES` has no timeline key, `timeline/SKILL.md` never writes `lastStep: timeline`, and the phase 3 spec's Part 6 table lists exactly three rows and says two messages gain a lane command and one gains the other. Three modifications, full stop. The DM's settled wording, The phase 3 spec names timeline as a `/scribe` feeder but its clause table omits the row. The DM settled it: "/scribe can commit the chronology document", chosen to parallel the other three in form and to match Part 3's statement that `/scribe` owns "the chronology documents `timeline` writes". Task 19 Step 4 applies the identical wording to `timeline/SKILL.md`; the two must not drift.

Read `.professor-orb/versioning.json` with the same fail-silent contract the hook already uses for `pipeline-state.json`. Treat a lone `catalog-versioning.json` as a valid marker for reading; the hook never performs the conversion, because it must stay silent, non-interactive, and non-mutating.

- [ ] **Step 4: Run to verify it passes**

Run: `node professor-orb/hooks/pipeline-next.test.mjs`
Expected: all cases PASS.

- [ ] **Step 5: Commit**

```bash
git add professor-orb/hooks/pipeline-next.mjs professor-orb/hooks/pipeline-next.test.mjs
git commit -m "feat(professor-orb): suggest the lane command after a pipeline step

debrief and content gain a /log clause, chronicler a /scribe clause. The
versioning gate suppresses only the appended clause: the existing next-step
sentence always emits, so a project that has not run setup keeps the suggestions
it already had. The hook never converts the versioning marker, because it must
stay silent, non-interactive, and non-mutating.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 19: `/scribe` and `/log`

**Files:**
- Create: `professor-orb/commands/scribe.md`
- Create: `professor-orb/commands/log.md`
- Create: `professor-orb/commands/lane-staging.test.mjs`
- Modify: `professor-orb/skills/chronicler/SKILL.md` (handoff to `/scribe`)
- Modify: `professor-orb/skills/debrief/SKILL.md` (handoff to `/log`)
- Modify: `professor-orb/skills/content/SKILL.md` (handoff to `/log`)

**Interfaces:**
- Consumes: `versioning.json` (Task 13), the settings array (Task 10), Principle 12 (Task 17).

- [ ] **Step 1: Write the staging test first**

Write `professor-orb/commands/lane-staging.test.mjs` building a disposable repo with uncommitted work in all three lanes, a modified file at the repo root, **and an out-of-lane path already staged**. Assert that `git add -- <lane>` followed by `git commit --only -- <lane>` commits exactly the lane's new and modified files, that the pre-staged foreign path is neither committed nor unstaged, and that other lanes and the root stay dirty. Add a case where the lane holds **only** new files and assert a real commit results.

Run: `node professor-orb/commands/lane-staging.test.mjs`
Expected: PASS. This encodes the mechanism the commands must follow, verified in `docs/superpowers/specs/2026-07-28-mechanism-prototypes.mjs`.

- [ ] **Step 2: Write `commands/scribe.md`**

Frontmatter `description` names the lane and the feeder skills. Body follows the phase 3 spec's Part 2 sequence. The staging mechanism is stated explicitly, with the reason: `git commit --only` with a pathspec and no prior `git add` silently omits new files, and a bare `git commit` after `git add <lane>` commits the entire index including anything staged from another lane.

State that `/scribe` authors no KB content but does perform the `versioning.json` conversion, so "writes nothing" would be false.

- [ ] **Step 3: Write `commands/log.md`**

Same shape, lane `sessionReportsRoot`, feeders `debrief` and `content`, plus the unfinished-report guard: a report missing required frontmatter or carrying empty sections is set aside by name and the rest is committed.

- [ ] **Step 4: Add the feeder-skill handoffs**

The phase 3 spec lists four feeder skills among the files this work touches (`lane-commands-design.md:257-258`): "| `skills/chronicler/SKILL.md`, `skills/timeline/SKILL.md` | Hand off to `/scribe` |" and "| `skills/debrief/SKILL.md`, `skills/content/SKILL.md` | Hand off to `/log` |". No other task in this release edits them, so without this step the four skills that produce the material never name the command that commits it. This repo's `CLAUDE.md` treats those description-level handoff references as load-bearing: each skill's description names the upstream skill it consumes from and the downstream step it feeds, and the pipeline breaks when they go stale.

Three of the four have spec-supplied wording, from the Stop-hook clause table at `lane-commands-design.md:190-194`. Use it as written:

- `skills/debrief/SKILL.md`: "`/log` can commit the session report"
- `skills/content/SKILL.md`: "`/log` can commit the recap and handouts"
- `skills/chronicler/SKILL.md`: "`/scribe` can commit the KB changes"

The fourth had no spec-supplied wording and was settled by the DM rather than composed:

- `skills/timeline/SKILL.md`: "`/scribe` can commit the chronology document"

The phase 3 spec names `timeline` as a `/scribe` feeder at `:257` and again at `:136-137` ("Fed by `chronicler` and `timeline`"), but its Stop-hook clause table has no timeline row, so no wording for it exists anywhere in the spec. The chosen clause parallels the other three in form and matches Part 3's statement that `/scribe` owns "the chronology documents `timeline` writes".

Task 18's `LANE_CLAUSES` map carries the same entry, added there under the same decision. It was one gap in two places and both resolve to this identical wording. If you find them disagreeing, that is a defect, not a choice.

- [ ] **Step 5: Verify**

Run: `grep -c '—' professor-orb/commands/scribe.md professor-orb/commands/log.md professor-orb/skills/debrief/SKILL.md professor-orb/skills/content/SKILL.md professor-orb/skills/chronicler/SKILL.md`
Expected: 0 for both.

Run: `grep -n 'git add -A\|git add \.\|commit -a' professor-orb/commands/`
Expected: no hits.

- [ ] **Step 6: Commit**

```bash
git add professor-orb/commands/scribe.md professor-orb/commands/log.md professor-orb/commands/lane-staging.test.mjs professor-orb/skills/chronicler/SKILL.md professor-orb/skills/debrief/SKILL.md professor-orb/skills/content/SKILL.md
git commit -m "feat(professor-orb): add /scribe and /log

Committing becomes a command rather than a background behavior, matching the
plugin's existing posture that capture is a command, not a reminder. Three
commands because the three prongs are separate concerns and a commit mixing them
is a commit nobody can read later.

The staging mechanism is specified rather than left to the implementer, because
both obvious approaches are wrong. git commit --only with a pathspec and no prior
add silently omits new files, which are the primary artifact of every lane. A bare
git commit after git add commits the entire index, including anything the DM
staged from another lane. The verified mechanism is git add with the lane
pathspec followed by git commit --only with the same pathspec.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 20: `/catalog` joins the lane model

**Files:**
- Modify: `professor-orb/commands/catalog.md` Step 3, Step 7, Step 9, and the never-do list at `:138`

- [ ] **Step 1: Collapse Step 3**

Three cases remain, checked in this order:

1. `.professor-orb/versioning.json` exists: read `mode` and carry it to Step 7.
2. `versioning.json` is absent but the legacy `.professor-orb/catalog-versioning.json` exists: convert it per Task 13, copying `mode` and `decided` unchanged into the new file and mentioning the conversion in passing. `decided` is never rewritten.
3. Neither exists: `/catalog` genuinely ran before `setup`, so say so, point at setup, and offer the choice inline.

Case 2 is not a variant of case 3 and must not be folded into it. Collapsing them re-asks a DM a decision they already made, and writing a fresh `decided` destroys the original decision date, which is the one field the conversion exists to preserve.

**The inline offer covers `changelog` only.** The existing behavior at `:55` runs `git init` **in the catalog root**, which under the canonical layout is `homebrew/<setting>/` inside the project repository, and would plant a nested repository that setup's state detection has no case for. Delete that `git init`. If the DM wants git or GitHub, point at setup.

- [ ] **Step 2: Add staging language to Step 7**

Stage exactly the entry file and the owning index, by path. Never a directory-wide add, never `-A`, never `-a`. The commit message gains the setting scope: `catalog(<setting>): <entry> v<version>`.

- [ ] **Step 3: Extend Step 9's report**

Add the unpushed-commit count when a remote exists, and a cross-lane notice naming any other lane with uncommitted work and its owning command. `/catalog` does not gain the surprise guard, since it commits only what it just authored.

- [ ] **Step 4: Update the never-do list**

`:138` says the git offer in Step 3 is made once and never repeated. Update it: the offer lives in setup, and `/catalog`'s inline fallback is the exception. Keep the prohibition on remote creation, authentication, and pushing.

- [ ] **Step 5: Verify**

Run: `grep -n 'git init' professor-orb/commands/catalog.md`
Expected: no hits.

- [ ] **Step 6: Commit**

```bash
git add professor-orb/commands/catalog.md
git commit -m "fix(professor-orb): finish /catalog's Step 3 and give it lane staging

Step 3 collapses to three cases now that setup records the versioning decision:
read the recorded mode, convert the legacy marker when that is all there is, or
offer the choice inline when neither file exists.
The inline fallback loses its git init: under the canonical layout the catalog
root is homebrew/<setting>/ inside the project repository, so running git init
there would plant a nested repository setup's state detection has no case for.
Deleting the repo-presence check without also removing the repo-creation
behavior would have left that trap in place.

Step 7 gains explicit staging by path and the setting-scoped commit message, and
Step 9 gains the unpushed count and the cross-lane notice, so all three lane
commands report alike.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 21: Discovery wiring, version bump, and release verification

**Files:**
- Modify: `professor-orb/README.md:7`, `:31`, `:53`, `:59`
- Modify: `professor-orb/skills/orb/SKILL.md:3`, `:18`, `:22`, `:39`, `:56`
- Modify: `professor-orb/CONTEXT.md` (new entries)
- Modify: `professor-orb/.claude-plugin/plugin.json:4`
- Modify: `.claude-plugin/marketplace.json` (version)

- [ ] **Step 1: Update the component inventories**

`README.md:7` says "one command"; there are now three. `README.md:31` and `skills/orb/SKILL.md:39` gain `/scribe` and `/log` rows with trigger phrases. The standalone-component lists at `README.md:53` and `skills/orb/SKILL.md:3`, `:22`, `:56` gain both.

`README.md:59` and `skills/orb/SKILL.md:18` were corrected in Task 9 to name the real KB writers. **Do not re-break them** by adding `/scribe` and `/log` to a list of writers: they touch the KB without authoring in it, and the corrected sentence draws that distinction.

- [ ] **Step 2: Add CONTEXT.md entries**

Add vocabulary entries for the lane model, `/scribe`, and `/log`, alongside the existing catalog-command entry at `:101`. Follow the file's existing format: bold term, definition, `_Avoid_:` line.

- [ ] **Step 3: Bump the version in both files, in this commit only**

`professor-orb/.claude-plugin/plugin.json`: `"version": "1.5.1"` becomes `"version": "1.6.0"`.
`.claude-plugin/marketplace.json`: the `professor-orb` entry's `"version": "1.5.1"` becomes `"version": "1.6.0"`.

- [ ] **Step 4: Run every suite**

```bash
node professor-orb/hooks/validate-write.test.mjs
node professor-orb/hooks/pipeline-next.test.mjs
node professor-orb/workflows/validation-sweep.ownership.test.mjs
node professor-orb/workflows/migrate.plan.test.mjs
node professor-orb/workflows/migrate.apply.test.mjs
node professor-orb/commands/lane-staging.test.mjs
node docs/superpowers/specs/2026-07-28-mechanism-prototypes.mjs
```
Expected: every one exits 0.

- [ ] **Step 5: Run the release checks**

```bash
grep -rc '—' professor-orb/ | grep -v ':0$'
```
Expected: no output. Any hit is an em dash that must be removed.

```bash
grep -rn "never imposes\|derived, not authoritative\|establish conventions as you go\|type is exactly \"Homebrew\"\|already inside a git repository" professor-orb/
```
Expected: no hits.

```bash
node -e "const p=require('./professor-orb/.claude-plugin/plugin.json'),m=require('./.claude-plugin/marketplace.json');const v=m.plugins.find(x=>x.name==='professor-orb').version;console.log(p.version===v&&p.version==='1.6.0'?'version OK '+p.version:'MISMATCH '+p.version+' vs '+v)"
```
Expected: `version OK 1.6.0`.

- [ ] **Step 6: Commit**

```bash
git add professor-orb .claude-plugin/marketplace.json
git commit -m "feat(professor-orb): release 1.6.0

Three commands instead of one, and the component inventories in README and the
orb skill now list /scribe and /log alongside /catalog. Neither is added to the
list of components that write to the knowledge base: they touch it without
authoring in it, and that distinction was corrected earlier in this release.

Version goes to 1.6.0 in plugin.json and marketplace.json together, one bump for
all three phases.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Post-release verification against the reference consumer

Not part of the release commit. Run after 1.6.0 is installed, before trusting it with real data.

- [ ] Install the updated plugin: `claude plugin marketplace update professor-orb-marketplace` then `claude plugin update professor-orb@professor-orb-marketplace --scope project`.
- [ ] Take a manual git tag in the reference consumer as a second restore point beyond setup's own snapshot.
- [ ] Run a validation sweep **before** any resync and record the finding count. The catalog-entry fix in Task 6 should collapse the orphan count by roughly 71.
- [ ] Run the resync. Confirm the report names the snapshot hash, the undo command, an edited-file count, and the deferred items (absorb candidates, split proposals, `-TIMELINE` and `-HISTORY` files, articles missing `publish`).
- [ ] Confirm the layout moved to `settings/rolara/`, `homebrew/rolara/`, `session-reports/rolara/<campaign>/`.
- [ ] Open the vault in Obsidian and confirm the link graph is intact.
- [ ] Run a debrief and confirm the report lands under the canonical path rather than re-creating the old nesting.
- [ ] Run `/scribe`, `/log`, and `/catalog` and confirm each commit contains only its own lane.
