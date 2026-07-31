# Professor Orb 1.7.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/migrate`, a DM-scoped structural change command that drives the migration executor 1.6.0 built, so the five operations setup defers, the validation sweep's `needsJudgment` bucket, and the whole class of ordinary knowledge base restructuring all have somewhere to go.

**Architecture:** Four phases of one release. Phase 1 teaches `workflows/migrate.mjs` the operations a scoped plan needs (a generic path move, index rebuild, folder absorb, folder split, entity rename, prose path updates) and adds `buildScopedPlan` beside the existing `buildPlan`. Phase 2 adds the DM-facing surface: a proposal file that is both readable and machine-executable, a conventions updater, and `commands/migrate.md`. Phase 3 adds the setting lifecycle operations, which are compositions of phase 1's primitives plus phase 2's conventions updater. Phase 4 wires the command into the sweep, setup, and the three inventories, then bumps the version. The executor's apply half, its snapshot discipline, its link integrity assertion, and its per-operation accounting are all reused unchanged: this release supplies a different plan source and a different approval gate, not a second executor.

**Tech Stack:** Markdown instruction files, Node ESM built-ins only (no dependencies) for `workflows/`, standalone `*.test.mjs` scripts run directly with `node` (there is no test framework and none is being added).

**Spec:** `docs/superpowers/specs/2026-07-28-migrate-command-design.md`. Read it before starting Task 1, and re-read Part 5 before Phase 1 and Part 6 before Phase 3.

## Prerequisite, outside this plan

1.6.0 is merged but has never run against the reference consumer, which is still on 1.5.0. `/migrate` operates on the layout 1.6.0's setup migration produces, so the post-release verification checklist at the end of `docs/superpowers/plans/2026-07-28-professor-orb-1.6.0.md` should be worked through before 1.7.0 is trusted with real data. It is not a blocker for writing or testing this code, because every task here is verified against disposable fixtures.

## Global Constraints

- **No em dashes in any output**: code, comments, commit messages, rule descriptions, doc prose. `SHARED-PRINCIPLES.md` Principle 6. A double hyphen between words is not a substitute either. Verify with `grep -c '—'` returning 0 on every changed file. (The verification commands in this plan necessarily contain the character as their search pattern. Those are the only permitted occurrences, in this file and in `references/base-rules.json`'s `contentNoEmDashes` rule, where it is written as the escape `—`.)
- **Never edit anything under `C:\Users\jorda\.claude\plugins\cache\`.** That is a build artifact, replaced on update. The source of truth is `professor-orb/` in this repo.
- **Never run `professor-orb:setup` against the reference consumer project** during development. It regenerates `conventions.json` wholesale.
- **Node ESM built-ins only** in `workflows/`. No dependencies, no build step.
- **`migrate.mjs` must stay importable.** Its entry point is guarded on the workflow host's `args` global (`export default typeof args === "undefined" ? null : runFromArgs(args)`). An import must start nothing and touch no disk. Never add top-level `await` or a top-level call to anything in the apply half.
- **The plan phase mutates nothing.** Plan-half functions may call `readdirSync`, `readFileSync`, `statSync`, and `existsSync`, plus `git rev-parse --show-toplevel` and `git status --ignored --porcelain -z`. Every mutating call (`mkdirSync`, `writeFileSync`, `git mv`, `git rm`, `git add`, `git commit`) belongs to the apply half only. `migrate.plan.test.mjs` asserts this by comparing the fixture byte for byte across a `buildPlan` call; the same assertion must cover `buildScopedPlan`.
- **Every git pathspec carries `:(literal)` and `--`.** They fix different halves of the same line and neither substitutes for the other. Measured: `git rm -q -- "items/Weapons [OS]-INDEX.md"` also removed an unrelated `items/Weapons O-INDEX.md`. `gitMove`'s `git mv --` calls take paths rather than pathspecs and are deliberately exempt; a comment in the source already records why they must not gain the prefix.
- **Frontmatter `description` under 1500 characters** in `commands/migrate.md`. Cowork's content validator rejects the entire plugin with a "Plugin validation failed." toast if any is too long, and `claude plugin validate` does not catch it. For reference: `commands/log.md` is 1283, `commands/scribe.md` is 1238, `skills/orb/SKILL.md` is 961.
- **Version 1.6.0 to 1.7.0**, in both `professor-orb/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, in the same commit. Task 18 only.
- **Commit style:** `feat(professor-orb): ...` or `fix(professor-orb): ...` or `docs(professor-orb): ...`, a body paragraph, then `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **The reference consumer** is at `C:\Users\jorda\OneDrive\Documents\Claude\Projects\World of Rolara`. Read from it to check facts. Never write to it from this repo's work.
- **Regression suites that must pass before every commit:**
  - `node professor-orb/workflows/migrate.plan.test.mjs`
  - `node professor-orb/workflows/migrate.apply.test.mjs`
  - `node professor-orb/workflows/migrate.proposal.test.mjs` (exists from Task 8 onward)
  - `node professor-orb/workflows/validation-sweep.ownership.test.mjs`
  - `node professor-orb/hooks/validate-write.test.mjs`
  - `node professor-orb/hooks/pipeline-next.test.mjs`
  - `node professor-orb/commands/lane-staging.test.mjs`
  - `node docs/superpowers/specs/2026-07-28-mechanism-prototypes.mjs`

## File Structure

| File | Responsibility | Phase |
| --- | --- | --- |
| `professor-orb/workflows/migrate.mjs` | Gains `buildScopedPlan`, `APPLY_ORDER`, six executors, `parseProposal`, `renderProposal`, `conventionsAfterScope`. Stays one module: the apply half's safety properties are stated once at the top of it and splitting them from the executors they govern would separate the contract from the code that honors it | 1, 2, 3 |
| `professor-orb/workflows/migrate.plan.test.mjs` | Plan-phase cases, including the read-only assertion extended to scoped plans | 1, 3 |
| `professor-orb/workflows/migrate.apply.test.mjs` | Apply-phase cases against disposable git repositories | 1, 3 |
| `professor-orb/workflows/migrate.proposal.test.mjs` | New. Proposal round trip, hand-edit fidelity, conventions updates. Separate file because it exercises pure text and object transforms with no repository at all, and folding it into either existing suite would bury it under fixture machinery it does not need | 2 |
| `professor-orb/commands/migrate.md` | New. The command: scope negotiation, the plan file, the run order, the report | 2 |
| `professor-orb/workflows/validation-sweep.mjs` | `needsJudgment` gains a destination | 4 |
| `professor-orb/skills/setup/SKILL.md` | The after-action report names `/migrate` as where deferred items go | 4 |
| `professor-orb/CONTEXT.md`, `README.md`, `skills/orb/SKILL.md` | Inventories, command count, the real rebuild step | 4 |

---

# Phase 1: the executor learns scope-derived plans

### Task 1: `APPLY_ORDER`, `relocate-path`, and `buildScopedPlan`

**Files:**
- Modify: `professor-orb/workflows/migrate.mjs` (the order constants near `:27`, the `EXECUTORS` table at `:2193`, `findOutOfOrder`, and a new plan-half section)
- Modify: `professor-orb/workflows/migrate.plan.test.mjs`
- Modify: `professor-orb/workflows/migrate.apply.test.mjs`

**Interfaces:**
- Produces: `APPLY_ORDER`, the single dependency order every plan is ranked against, a superset of `OPERATION_ORDER` preserving its relative order.
- Produces: operation kind `relocate-path`, `{op: "relocate-path", from, to, reason}`, applied by the same function as `relocate-prong`.
- Produces: `buildScopedPlan({projectRoot, settings, baseRules, scope})` returning `{operations, declined, prechecks}`, the identical shape `buildPlan` returns and `applyPlan` consumes. Tasks 2 through 6 and 11 through 14 each add one `scope` key.
- Consumes: `runPrechecks({operations, projectRoot})` unchanged.

- [ ] **Step 1: Write the failing plan tests**

Append to `professor-orb/workflows/migrate.plan.test.mjs`, before the final report block, and add `buildScopedPlan` and `APPLY_ORDER` to the import list at `:18`:

```js
console.log("\n=== scoped plans: order and the generic move ===");

const scoped = (scope, projectRoot) =>
  buildScopedPlan({ projectRoot, settings: SETTINGS, baseRules: BASE_RULES, scope });

{
  // APPLY_ORDER is the one order findOutOfOrder ranks against, so it has to be
  // a superset of OPERATION_ORDER that preserves its relative order. A future
  // insertion that reorders the setup kinds would make every shipped setup plan
  // refuse as out of order, which no setup test would catch.
  const ranks = OPERATION_ORDER.map((k) => APPLY_ORDER.indexOf(k));
  check("every setup kind has a rank in APPLY_ORDER", ranks.every((r) => r >= 0), true);
  check("APPLY_ORDER preserves the setup order",
    ranks.slice().sort((a, b) => a - b), ranks);
}

{
  const r = scoped({
    pathMoves: [
      { from: "settings/rolara/misc/Old-Note.md", to: "settings/rolara/notes/Old-Note.md", reason: "DM scope" },
    ],
  });
  check("a path move plans one relocate-path", kindsOf(r.operations), ["relocate-path"]);
  check("it carries from and to verbatim",
    [r.operations[0].from, r.operations[0].to],
    ["settings/rolara/misc/Old-Note.md", "settings/rolara/notes/Old-Note.md"]);
}

{
  const r = scoped({});
  check("an empty scope plans nothing and declines nothing",
    [r.operations.length, r.declined.length], [0, 0]);
  check("an empty scope still returns prechecks", typeof r.prechecks, "object");
}

{
  // The read-only contract covers this entry point too, not only buildPlan.
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-scoped-ro-"));
  mkdirSync(path.join(root, "settings", "rolara"), { recursive: true });
  writeFileSync(path.join(root, "settings", "rolara", "A.md"), "---\ntype: Person\n---\n\nBody.\n");
  const before = snapshotTree(root);
  scoped({ pathMoves: [{ from: "settings/rolara/A.md", to: "settings/rolara/people/A.md", reason: "x" }] }, root);
  check("buildScopedPlan mutates nothing", snapshotTree(root), before);
  rmSync(root, { recursive: true, force: true });
}
```

`snapshotTree` already exists in this suite; if it is defined only in the apply suite, copy the identical function in rather than importing across suites, and note in a comment that the two copies must stay byte aligned, matching the precedent at `validation-sweep.ownership.test.mjs:7-9`.

- [ ] **Step 2: Run to verify they fail**

Run: `node professor-orb/workflows/migrate.plan.test.mjs`
Expected: FAIL at import, `buildScopedPlan` and `APPLY_ORDER` are not exported yet.

- [ ] **Step 3: Add the order constant**

In `professor-orb/workflows/migrate.mjs`, immediately after the `DEFERRED_OPERATIONS` declaration at `:42`, add:

```js
// The single dependency order EVERY plan is ranked against, setup's and
// /migrate's alike. OPERATION_ORDER above stays the setup subset, because
// buildPlan loops over it to decide which planners to run and a scoped-only
// kind has no setup planner to call. This constant is a superset of it that
// preserves its relative order, and migrate.plan.test.mjs pins that property:
// reordering the setup kinds here would make every setup plan refuse as out of
// order, and no setup-side test would notice.
//
// Placement reasoning for the six kinds this release adds:
//   relocate-path   beside relocate-prong: same mechanics, different meaning.
//   absorb-folder   before every index kind, because it changes which folder a
//   split-folder    file lives in, and an index built first would list the old
//                   membership.
//   rename-entity   beside rename-with-link-rewrite, and after normalize-type
//                   for the same reason that one is: a required suffix derives
//                   from a type, so renaming first computes it from a stale
//                   value.
//   rebuild-index   after create-index and merge-index, because it reads a
//                   folder's actual contents and both of those change them.
//   update-prose-paths last of the content kinds: it rewrites references TO
//                   paths, so every path it names has to have reached its
//                   destination first.
export const APPLY_ORDER = [
  "relocate-prong",
  "relocate-path",
  "absorb-folder",
  "split-folder",
  "normalize-type",
  "rename-with-link-rewrite",
  "rename-entity",
  "create-index",
  "merge-index",
  "rebuild-index",
  "repair-frontmatter",
  "update-prose-paths",
  "vault",
  "tag-registry",
];
```

- [ ] **Step 4: Rank against `APPLY_ORDER`**

Find `findOutOfOrder` and change the rank lookup from `OPERATION_ORDER` to `APPLY_ORDER`. Its refusal message stays as it is: the dependency reasoning it states is still the reasoning, and it now covers more kinds.

- [ ] **Step 5: Register the generic move**

In the `EXECUTORS` table at `:2193`, add one line beneath `"relocate-prong"`:

```js
  // Same implementation, deliberately a distinct kind. A prong root move is
  // "your whole knowledge base moved"; a path move is "these 40 articles moved".
  // The accounting and the DM-facing report have to be able to tell those apart,
  // and a shared kind would flatten them into one line.
  "relocate-path": applyRelocateProng,
```

- [ ] **Step 6: Add the scoped plan builder**

Add a new section to `migrate.mjs`'s plan half, after `proposeDeferred`:

```js
// ---------------------------------------------------------------------------
// Scope-derived plans (/migrate)
// ---------------------------------------------------------------------------
//
// buildPlan surveys the project against professor-orb's own schema, which is
// known and derivable, so its plan is not news to anyone. buildScopedPlan takes
// a scope the DM negotiated with the command and turns it into the same
// operation list. The difference that matters is the gate, not the machinery:
// the schema-derived plan runs unattended at setup, and this one is written to a
// proposal file the DM reads, may edit, and approves before anything runs.
//
// Every planner here is pure and read-only, exactly like the setup planners.

// Scope keys, in APPLY_ORDER's order. Each entry names the scope key the DM's
// negotiated scope carries and the planner that turns it into operations.
const SCOPED_PLANNERS = [
  ["pathMoves", planPathMoves],
];

/**
 * @param {{projectRoot: string, settings: Array, baseRules: object, scope: object}} input
 * @returns {{operations: Array, declined: Array, prechecks: object}}
 */
export function buildScopedPlan({ projectRoot, settings, baseRules, scope }) {
  const operations = [];
  const declined = [];
  const ctx = { projectRoot, settings: list(settings), baseRules, scope: scope || {} };

  for (const [key, planner] of SCOPED_PLANNERS) {
    const items = list(ctx.scope[key]);
    if (items.length === 0) continue;
    const out = planner(items, ctx);
    operations.push(...list(out.operations));
    declined.push(...list(out.declined));
  }

  // The result is sorted into APPLY_ORDER rather than trusted to arrive that
  // way, because SCOPED_PLANNERS is edited by hand and a planner added in the
  // wrong slot would produce a plan applyPlan refuses, with a message about
  // dependency order that would read as a bug in the DM's scope.
  operations.sort((a, b) => APPLY_ORDER.indexOf(a.op) - APPLY_ORDER.indexOf(b.op));

  return { operations, declined, prechecks: runPrechecks({ operations, projectRoot }) };
}

function planPathMoves(items, ctx) {
  const operations = [];
  const declined = [];
  for (const item of items) {
    const from = toPosix(item && item.from);
    const to = toPosix(item && item.to);
    if (!from || !to) {
      declined.push({
        op: "relocate-path",
        target: from || to || "(unnamed)",
        reason: "The scope entry is missing a source or a destination, so there is nothing to move.",
      });
      continue;
    }
    if (from === to) {
      declined.push({
        op: "relocate-path",
        target: from,
        reason: "Source and destination are the same path.",
      });
      continue;
    }
    operations.push({
      op: "relocate-path",
      from,
      to,
      reason: String((item && item.reason) || "Moved by a DM-approved /migrate scope."),
    });
  }
  return { operations, declined };
}
```

- [ ] **Step 7: Run the plan suite**

Run: `node professor-orb/workflows/migrate.plan.test.mjs`
Expected: every prior case still passes and the six new expectations pass.

- [ ] **Step 8: Write the failing apply test**

Append to `professor-orb/workflows/migrate.apply.test.mjs`, before the final report block:

```js
console.log("\n=== relocate-path ===");

withRepo(
  {
    "settings/rolara/misc/Old-Note.md": article("type: Concept", "Body."),
    "settings/rolara/notes/Keep-INDEX.md": article("type: Index", "- [[Old-Note]]"),
  },
  (root) => {
    const r = apply(root, [
      { op: "relocate-path", from: "settings/rolara/misc/Old-Note.md", to: "settings/rolara/notes/Old-Note.md", reason: "scope" },
    ]);
    check("relocate-path applies", [r.ok, first(r.applied).applied], [true, true]);
    check("the file is at its destination", has(root, "settings/rolara/notes/Old-Note.md"), true);
    check("and gone from its source", has(root, "settings/rolara/misc/Old-Note.md"), false);
    // Obsidian resolves a wikilink by stem, so moving a file inside one vault
    // does not break a link to it. This asserts the link was left ALONE, which
    // is the correct behavior and easy to regress into a needless rewrite.
    check("a wikilink to it is untouched",
      read(root, "settings/rolara/notes/Keep-INDEX.md").includes("[[Old-Note]]"), true);
    check("git recorded a rename, not a delete plus an untracked file",
      porcelain(root).some((l) => l.startsWith("R")), true);
  }
);

withRepo({ "settings/rolara/A.md": article("type: Person", "Body.") }, (root) => {
  const r = apply(root, [
    { op: "relocate-path", from: "settings/rolara/A.md", to: "settings/rolara/A.md", reason: "x" },
  ]);
  check("a no-op move is reported, not applied", first(r.applied || r.failed).applied, false);
});
```

- [ ] **Step 9: Run the apply suite**

Run: `node professor-orb/workflows/migrate.apply.test.mjs`
Expected: PASS. The executor is `applyRelocateProng`, which already exists, so these cases pass as soon as Step 5's table entry is in place. Confirm that by mutating Step 5's line out, re-running to see the `unknown-operation` refusal, then putting it back. A case that never failed proves nothing.

- [ ] **Step 10: Commit**

```bash
git add professor-orb/workflows/migrate.mjs professor-orb/workflows/migrate.plan.test.mjs professor-orb/workflows/migrate.apply.test.mjs
git commit -m "feat(professor-orb): add scope-derived plans and a generic path move

buildPlan surveys the project against professor-orb's schema; buildScopedPlan
takes a scope the DM negotiated and produces the same operation list, so the
apply half, its snapshot discipline, its link-integrity assertion, and its
per-operation accounting are all reused rather than rebuilt. The difference is
the gate, not the machinery.

APPLY_ORDER becomes the one dependency order findOutOfOrder ranks against, a
superset of OPERATION_ORDER that preserves its relative order, and the plan
suite pins that property: reordering the setup kinds inside it would make every
shipped setup plan refuse as out of order, and no setup-side test would catch
it. relocate-path shares an implementation with relocate-prong and stays a
distinct kind, because a prong root move and a forty-article move have to read
differently in the accounting the DM is handed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `rebuild-index`

This is `CONTEXT.md:157-165`'s "rebuild step", the component that entry has described since before 1.6.0 and which has never existed. It is also what retires the DM's ad-hoc Python rebuild scripts.

**Files:**
- Modify: `professor-orb/workflows/migrate.mjs` (`SCOPED_PLANNERS`, a new planner, a new executor, the `EXECUTORS` table)
- Modify: `professor-orb/workflows/migrate.plan.test.mjs`
- Modify: `professor-orb/workflows/migrate.apply.test.mjs`

**Interfaces:**
- Produces: operation `{op: "rebuild-index", to, folder, reason}` where `to` is the index file's path.
- Scope key: `rebuildIndexes: [{index: "<path to an existing index file>"}]`.

- [ ] **Step 1: Write the failing apply test**

The apply behavior is the whole point of this operation, so write that test first. Append to `professor-orb/workflows/migrate.apply.test.mjs`:

```js
console.log("\n=== rebuild-index ===");

withRepo(
  {
    "settings/rolara/items/Items-INDEX.md":
      "---\ntype: Index\npublish: false\n---\n\n# Items\n\nThe DM's own note about how this index is organised.\n\n- [[Sword]]\n- [[Gone-Article]]\n",
    "settings/rolara/items/Sword.md": article("type: Item", "Body."),
    "settings/rolara/items/Shield.md": article("type: Item", "Body."),
  },
  (root) => {
    const r = apply(root, [
      { op: "rebuild-index", to: "settings/rolara/items/Items-INDEX.md", folder: "settings/rolara/items", reason: "scope" },
    ]);
    const text = read(root, "settings/rolara/items/Items-INDEX.md");
    check("rebuild-index applies", [r.ok, first(r.applied).applied], [true, true]);
    check("an article present on disk but missing from the index is added", text.includes("[[Shield]]"), true);
    check("an article listed but no longer on disk is dropped", text.includes("[[Gone-Article]]"), false);
    check("an article that was already correct survives", text.includes("[[Sword]]"), true);
    // The DM's frontmatter and prose are not the index's link list and are not
    // this operation's business. A rebuild that regenerated the whole file would
    // silently delete publish: false and the note above the list, which is
    // exactly the "silent index rewrite" CONTEXT.md's avoid list names.
    check("the DM's frontmatter survives verbatim", text.includes("publish: false"), true);
    check("the DM's prose survives verbatim",
      text.includes("The DM's own note about how this index is organised."), true);
    check("the entries are sorted", text.indexOf("[[Shield]]") < text.indexOf("[[Sword]]"), true);
  }
);

withRepo(
  {
    "settings/rolara/items/Items-INDEX.md": article("type: Index", "# Items\n\n- [[Sword]]"),
    "settings/rolara/items/Sword.md": article("type: Item", "Body."),
    "settings/rolara/items/weapons/Weapons-INDEX.md": article("type: Index", "# Weapons"),
  },
  (root) => {
    const r = apply(root, [
      { op: "rebuild-index", to: "settings/rolara/items/Items-INDEX.md", folder: "settings/rolara/items", reason: "scope" },
    ]);
    const text = read(root, "settings/rolara/items/Items-INDEX.md");
    check("a sibling index is not listed as an article", text.includes("[[Weapons-INDEX]]"), false);
    // A subfolder is another index's territory, and listing its contents here
    // would put the same article in two indexes, violating singleOwnership.
    check("a subfolder's contents are not absorbed into the parent index",
      text.includes("[[Weapons]]"), false);
    check("the rebuild still applied", [r.ok, first(r.applied).applied], [true, true]);
  }
);

withRepo({ "settings/rolara/items/Sword.md": article("type: Item", "Body.") }, (root) => {
  const r = apply(root, [
    { op: "rebuild-index", to: "settings/rolara/items/Items-INDEX.md", folder: "settings/rolara/items", reason: "scope" },
  ]);
  // create-index is the operation that creates. Rebuilding a file that is not
  // there would quietly turn a stale plan into a new file the DM never approved.
  check("rebuilding an index that does not exist is reported, not created",
    [first(r.applied.concat(r.failed)).applied, has(root, "settings/rolara/items/Items-INDEX.md")],
    [false, false]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node professor-orb/workflows/migrate.apply.test.mjs`
Expected: FAIL. `applyPlan` refuses the whole run with `unknown-operation`, so every expectation in the block fails.

- [ ] **Step 3: Implement the executor**

Add to `migrate.mjs`'s apply half, beside `applyCreateIndex`:

```js
// Rebuild an EXISTING index's link list from its folder's actual contents.
//
// The list is replaced; everything else in the file is preserved byte for byte.
// That split is the whole design: an index carries the DM's own frontmatter and
// often prose explaining how the folder is organised, and regenerating the file
// wholesale would delete both. CONTEXT.md's avoid list names "silent index
// rewrites" for exactly this reason.
//
// The link list is identified as the maximal run of consecutive lines matching
// LINK_LINE, anchored at the FIRST such line. Prose after the list survives
// because the run stops at the first non-matching line.
const LINK_LINE = /^[ \t]*[-*][ \t]+\[\[[^\]]+\]\][ \t]*$/;

function applyRebuildIndex(op, ctx) {
  const entry = entryFor(op);
  const to = toPosix(op.to);
  const folder = toPosix(op.folder) || path.posix.dirname(to);
  entry.to = to;

  if (!existsSync(path.resolve(ctx.cwd, to))) {
    entry.detail =
      "No index at that path. create-index is the operation that creates one; rebuilding a file that is not there would turn a stale plan into a file the DM never approved.";
    return entry;
  }
  const readIndex = readText(ctx, to);
  if (!readIndex.ok) {
    entry.detail = `Could not read the index: ${readIndex.error}`;
    return entry;
  }

  const suffix = indexSuffixFor(ctx.settingForPath(folder), ctx.baseRules);
  const abs = path.resolve(ctx.cwd, folder);
  let names = [];
  try {
    names = readdirSync(abs).sort();
  } catch (err) {
    entry.detail = `Could not read the folder: ${err.message}`;
    return entry;
  }

  const stems = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".md")) continue;
    let st;
    try {
      st = statSync(path.join(abs, name));
    } catch {
      continue;
    }
    // isFile() is the subfolder guard as well as the junk guard: a subfolder is
    // another index's territory, and listing its articles here would put them in
    // two indexes at once, which is the singleOwnership violation the sweep
    // exists to find.
    if (!st.isFile()) continue;
    const stem = name.slice(0, -3);
    if (suffix && stem.endsWith(suffix)) continue; // Another index, not an article.
    stems.push(stem);
  }

  const doc = splitTextLines(readIndex.text);
  const rendered = stems.map((s) => `- [[${s}]]`);
  const firstLink = doc.lines.findIndex((l) => LINK_LINE.test(l));

  let before;
  let after;
  if (firstLink === -1) {
    // No list yet. Append one, keeping a blank line before it unless the file
    // already ends in one, so an index whose links were all deleted by hand can
    // still be rebuilt rather than refused.
    before = doc.lines.slice();
    while (before.length > 0 && before[before.length - 1].trim() === "") before.pop();
    before.push("");
    after = [""];
  } else {
    let last = firstLink;
    while (last + 1 < doc.lines.length && LINK_LINE.test(doc.lines[last + 1])) last++;
    before = doc.lines.slice(0, firstLink);
    after = doc.lines.slice(last + 1);
  }

  doc.lines = [...before, ...rendered, ...after];
  const written = writeText(ctx, to, joinTextLines(doc));
  if (!written.ok) {
    entry.detail = `Could not write the index: ${written.error}`;
    return entry;
  }
  entry.applied = true;
  entry.entries = stems.length;
  entry.detail = `Rebuilt the link list from ${stems.length} article(s) on disk; frontmatter and prose were preserved.`;
  return entry;
}
```

Register it in `EXECUTORS`: `"rebuild-index": applyRebuildIndex,`.

- [ ] **Step 4: Run the apply suite**

Run: `node professor-orb/workflows/migrate.apply.test.mjs`
Expected: all ten new expectations pass, every prior case unaffected.

- [ ] **Step 5: Write the failing plan test**

Append to `professor-orb/workflows/migrate.plan.test.mjs`:

```js
console.log("\n=== scoped plans: rebuild-index ===");

{
  const r = scoped({ rebuildIndexes: [{ index: "settings/rolara/items/Items-INDEX.md" }] });
  check("a rebuild scope plans one rebuild-index", kindsOf(r.operations), ["rebuild-index"]);
  check("the folder is derived from the index path",
    r.operations[0].folder, "settings/rolara/items");
}

{
  const r = scoped({
    rebuildIndexes: [{ index: "settings/rolara/items/Items-INDEX.md" }],
    pathMoves: [{ from: "settings/rolara/misc/A.md", to: "settings/rolara/items/A.md", reason: "x" }],
  });
  // The move has to land before the rebuild reads the folder, or the rebuild
  // lists yesterday's membership. This is APPLY_ORDER doing its job, asserted
  // here because a planner added to SCOPED_PLANNERS in the wrong slot is the
  // easy mistake and applyPlan would refuse the whole run rather than explain it.
  check("moves are ordered before rebuilds", kindsOf(r.operations), ["relocate-path", "rebuild-index"]);
}
```

- [ ] **Step 6: Implement the planner**

Add to `migrate.mjs`, and add `["rebuildIndexes", planRebuildIndexes],` to `SCOPED_PLANNERS`:

```js
function planRebuildIndexes(items, ctx) {
  const operations = [];
  const declined = [];
  for (const item of items) {
    const index = toPosix(item && item.index);
    if (!index) {
      declined.push({
        op: "rebuild-index",
        target: "(unnamed)",
        reason: "The scope entry names no index file.",
      });
      continue;
    }
    operations.push({
      op: "rebuild-index",
      to: index,
      folder: toPosix(item.folder) || path.posix.dirname(index),
      reason: String((item && item.reason) || "Rebuilt by a DM-approved /migrate scope."),
    });
  }
  return { operations, declined };
}
```

- [ ] **Step 7: Run both suites**

Run: `node professor-orb/workflows/migrate.plan.test.mjs` then `node professor-orb/workflows/migrate.apply.test.mjs`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add professor-orb/workflows/migrate.mjs professor-orb/workflows/migrate.plan.test.mjs professor-orb/workflows/migrate.apply.test.mjs
git commit -m "feat(professor-orb): build the index rebuild step

CONTEXT.md has described a rebuild step since before 1.6.0 and no such
component existed. This is it: regenerate an index's link list from the
articles actually on disk in its folder, adding what is missing and dropping
what is gone.

Only the link list is replaced. The DM's frontmatter and any prose explaining
how the folder is organised are preserved byte for byte, because an index is
not only a list and regenerating the whole file would delete both. A subfolder
is skipped rather than absorbed: its contents belong to its own index, and
listing them here would put an article in two indexes at once, which is the
single-ownership violation the sweep exists to find. An index that is not there
is reported rather than created; create-index is the operation that creates.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `absorb-folder`

Setup defers absorb permanently (`DEFERRED_OPERATIONS`), and `applyPlan` refuses any plan carrying an `absorb` operation. That refusal stays: it guards the unattended path. This task adds a distinct kind, `absorb-folder`, that only a scoped plan produces and only after the DM approved a proposal naming every file it moves.

**Files:**
- Modify: `professor-orb/workflows/migrate.mjs`
- Modify: `professor-orb/workflows/migrate.plan.test.mjs`
- Modify: `professor-orb/workflows/migrate.apply.test.mjs`

**Interfaces:**
- Produces: operation `{op: "absorb-folder", from, to, articles: [{from, to}], index, reason}`. `from` is the folder being dissolved, `to` its parent, `index` the folder's own index file (or null).
- Scope key: `absorbFolders: [{folder: "<path>"}]`.
- Produces: an `absorb-folder` scope entry ALSO emits a `rebuild-index` operation on the parent index, so the dissolved folder's own index stops being listed there.

- [ ] **Step 1: Write the failing plan test**

Append to `professor-orb/workflows/migrate.plan.test.mjs`:

```js
console.log("\n=== scoped plans: absorb-folder ===");

function absorbFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-absorb-"));
  const w = (rel, body) => {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  w("settings/rolara/Rolara-INDEX.md", "---\ntype: Index\n---\n\n- [[Misc-INDEX]]\n");
  w("settings/rolara/misc/Misc-INDEX.md", "---\ntype: Index\n---\n\n- [[Odds]]\n");
  w("settings/rolara/misc/Odds.md", "---\ntype: Concept\n---\n\nBody.\n");
  w("settings/rolara/misc/Ends.md", "---\ntype: Concept\n---\n\nBody.\n");
  return root;
}

{
  const root = absorbFixture();
  const r = scoped({ absorbFolders: [{ folder: "settings/rolara/misc" }] }, root);
  check("an absorb scope plans absorb then a parent rebuild",
    kindsOf(r.operations), ["absorb-folder", "rebuild-index"]);
  const op = r.operations[0];
  check("the destination is the parent folder", op.to, "settings/rolara");
  check("every article is enumerated by name, not left implicit",
    op.articles.map((a) => a.from).sort(),
    ["settings/rolara/misc/Ends.md", "settings/rolara/misc/Odds.md"]);
  check("the folder's own index is named for removal", op.index, "settings/rolara/misc/Misc-INDEX.md");
  // The parent index still carries [[Misc-INDEX]], which dies with the folder.
  // rebuild-index lists only articles, so running it on the parent is what
  // clears that link. Absorbing without it leaves a dead wikilink behind.
  check("the rebuild targets the parent index",
    r.operations[1].to, "settings/rolara/Rolara-INDEX.md");
  rmSync(root, { recursive: true, force: true });
}

{
  const root = absorbFixture();
  mkdirSync(path.join(root, "settings", "rolara", "misc", "deeper"), { recursive: true });
  const r = scoped({ absorbFolders: [{ folder: "settings/rolara/misc" }] }, root);
  check("a folder holding a subfolder is declined, not dissolved",
    [r.operations.length, r.declined.length], [0, 1]);
  check("and the reason says why", /leaf/i.test(r.declined[0].reason), true);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = absorbFixture();
  const r = scoped({ absorbFolders: [{ folder: "settings/rolara" }] }, root);
  // Dissolving a prong root would move a whole knowledge base into whatever
  // happens to sit above it. Permanently exempt, per the spec's operation
  // catalog, and not a judgment the DM can override in a scope.
  check("a prong root is permanently exempt",
    [r.operations.length, r.declined.length], [0, 1]);
  rmSync(root, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node professor-orb/workflows/migrate.plan.test.mjs`
Expected: FAIL on "an absorb scope plans absorb then a parent rebuild" with actual `[]`.

- [ ] **Step 3: Implement the planner**

Add to `migrate.mjs`, and add `["absorbFolders", planAbsorbFolders],` to `SCOPED_PLANNERS`:

```js
// Every prong root of every setting, plus every campaign folder, as a Set of
// posix paths. These are the folders absorb and split may never touch: a prong
// root holds a whole knowledge base, and a campaign folder is a lane boundary
// /log commits against.
function protectedFolders(settings) {
  const out = new Set();
  for (const setting of list(settings)) {
    for (const root of prongRootsOf(setting)) {
      if (root) out.add(toPosix(root));
    }
    for (const campaign of list(setting && setting.campaigns)) {
      const name = typeof campaign === "string" ? campaign : campaign && campaign.name;
      const reports = toPosix(setting && setting.sessionReportsRoot);
      if (name && reports) out.add(`${reports}/${name}`);
    }
  }
  return out;
}

function planAbsorbFolders(items, ctx) {
  const operations = [];
  const declined = [];
  const protectedSet = protectedFolders(ctx.settings);

  for (const item of items) {
    const folder = toPosix(item && item.folder);
    if (!folder) {
      declined.push({ op: "absorb-folder", target: "(unnamed)", reason: "The scope entry names no folder." });
      continue;
    }
    if (protectedSet.has(folder)) {
      declined.push({
        op: "absorb-folder",
        target: folder,
        reason:
          "This is a prong root or a campaign folder. Dissolving it would move a whole knowledge base, homebrew catalog, or campaign into whatever sits above it, so it is permanently exempt rather than a judgment call.",
      });
      continue;
    }

    const abs = path.resolve(ctx.projectRoot, folder);
    let names;
    try {
      names = readdirSync(abs).sort();
    } catch (err) {
      declined.push({ op: "absorb-folder", target: folder, reason: `Could not read the folder: ${err.message}` });
      continue;
    }

    const suffix = indexSuffixFor(settingForFolder(ctx.settings, folder), ctx.baseRules);
    const articles = [];
    let index = null;
    let hasSubfolder = false;
    for (const name of names) {
      let st;
      try {
        st = statSync(path.join(abs, name));
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        hasSubfolder = true;
        continue;
      }
      if (!name.toLowerCase().endsWith(".md")) continue;
      const stem = name.slice(0, -3);
      if (suffix && stem.endsWith(suffix)) {
        index = `${folder}/${name}`;
        continue;
      }
      articles.push({ from: `${folder}/${name}`, to: `${path.posix.dirname(folder)}/${name}` });
    }

    if (hasSubfolder) {
      declined.push({
        op: "absorb-folder",
        target: folder,
        reason:
          "Only a leaf folder is absorbed. This one holds a subfolder, and where that subfolder's contents belong is a separate judgment rather than something dissolving the parent answers.",
      });
      continue;
    }

    const parent = path.posix.dirname(folder);
    operations.push({
      op: "absorb-folder",
      from: folder,
      to: parent,
      articles,
      index,
      reason: String((item && item.reason) || "Absorbed by a DM-approved /migrate scope."),
    });

    // The parent index still lists the dissolved folder's index. rebuild-index
    // lists articles only, so rebuilding the parent is what clears that link.
    const parentIndex = existingIndexIn(ctx, parent, suffix);
    if (parentIndex) {
      operations.push({
        op: "rebuild-index",
        to: parentIndex,
        folder: parent,
        reason: `Rebuilt because ${folder} was absorbed into it.`,
      });
    }
  }
  return { operations, declined };
}

// The setting whose kbRoot, homebrewRoot, or sessionReportsRoot contains this
// folder, or null. Longest matching root wins, so a nested prong resolves to
// the setting that actually owns it rather than to whichever came first.
function settingForFolder(settings, folder) {
  let best = null;
  let bestLen = -1;
  for (const setting of list(settings)) {
    for (const root of prongRootsOf(setting)) {
      const r = toPosix(root);
      if (!r) continue;
      if ((folder === r || folder.startsWith(`${r}/`)) && r.length > bestLen) {
        best = setting;
        bestLen = r.length;
      }
    }
  }
  return best;
}

function existingIndexIn(ctx, folder, suffix) {
  if (!suffix) return null;
  let names;
  try {
    names = readdirSync(path.resolve(ctx.projectRoot, folder)).sort();
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".md")) continue;
    if (name.slice(0, -3).endsWith(suffix)) return `${folder}/${name}`;
  }
  return null;
}
```

- [ ] **Step 4: Run the plan suite**

Run: `node professor-orb/workflows/migrate.plan.test.mjs`
Expected: the eight new expectations pass.

- [ ] **Step 5: Write the failing apply test**

Append to `professor-orb/workflows/migrate.apply.test.mjs`:

```js
console.log("\n=== absorb-folder ===");

withRepo(
  {
    "settings/rolara/Rolara-INDEX.md": article("type: Index", "- [[Misc-INDEX]]"),
    "settings/rolara/misc/Misc-INDEX.md": article("type: Index", "- [[Odds]]"),
    "settings/rolara/misc/Odds.md": article("type: Concept", "Body."),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "absorb-folder",
        from: "settings/rolara/misc",
        to: "settings/rolara",
        articles: [{ from: "settings/rolara/misc/Odds.md", to: "settings/rolara/Odds.md" }],
        index: "settings/rolara/misc/Misc-INDEX.md",
        reason: "scope",
      },
    ]);
    check("absorb-folder applies", [r.ok, first(r.applied).applied], [true, true]);
    check("the article is in the parent", has(root, "settings/rolara/Odds.md"), true);
    check("the folder's index is gone", has(root, "settings/rolara/misc/Misc-INDEX.md"), false);
    check("the article moved by git mv, not copy plus delete",
      porcelain(root).some((l) => l.startsWith("R")), true);
    check("the folder itself is gone", has(root, "settings/rolara/misc"), false);
  }
);

withRepo(
  {
    "settings/rolara/misc/Odds.md": article("type: Concept", "Body."),
    "settings/rolara/Odds.md": article("type: Concept", "A different article that already lives here."),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "absorb-folder",
        from: "settings/rolara/misc",
        to: "settings/rolara",
        articles: [{ from: "settings/rolara/misc/Odds.md", to: "settings/rolara/Odds.md" }],
        index: null,
        reason: "scope",
      },
    ]);
    // runPrechecks catches this before anything moves. Asserting the refusal
    // here as well as in the plan suite is deliberate: a hand-edited proposal
    // reaches applyPlan without ever passing through the planner.
    check("a basename collision in the parent refuses the whole run", r.ok, false);
    check("and nothing moved",
      [has(root, "settings/rolara/misc/Odds.md"),
       read(root, "settings/rolara/Odds.md").includes("A different article")],
      [true, true]);
  }
);
```

- [ ] **Step 6: Implement the executor**

Add to `migrate.mjs`'s apply half and register `"absorb-folder": applyAbsorbFolder,` in `EXECUTORS`:

```js
// Dissolve a leaf folder into its parent. One accounting entry for the whole
// dissolution, on the same principle a rename carries its link rewrite: a folder
// reported as absorbed while one of its articles was left behind is the failure
// the accounting exists to prevent.
function applyAbsorbFolder(op, ctx) {
  const entry = entryFor(op);
  entry.moved = 0;
  const articles = list(op.articles);

  for (const a of articles) {
    const out = gitMove(ctx, toPosix(a.from), toPosix(a.to));
    if (!out.ok) {
      entry.detail = `git mv failed for ${a.from}: ${out.error}. ${entry.moved} of ${articles.length} article(s) had already moved; the snapshot is the undo.`;
      return entry;
    }
    entry.moved++;
  }

  if (op.index) {
    const removed = gitRemove(ctx, toPosix(op.index));
    if (!removed.ok) {
      entry.detail = `Articles moved but the folder's index could not be removed: ${removed.error}`;
      return entry;
    }
  }

  entry.applied = true;
  entry.detail = `Absorbed ${entry.moved} article(s) into ${op.to}${op.index ? " and removed the folder's own index" : ""}.`;
  return entry;
}
```

If `gitRemove` does not already exist beside `gitMove`, add it, with the pathspec guard the release's own findings mandate:

```js
// git rm takes a PATHSPEC, not a path. Measured: `git rm -q -- "Weapons [OS]-INDEX.md"`
// also removed an unrelated `Weapons O-INDEX.md`. :(literal) disables wildcard
// interpretation; `--` stops option parsing. They fix different halves of the
// same line and neither substitutes for the other.
export function gitRemove(ctx, target) {
  try {
    ctx.git(["rm", "-q", "--", `:(literal)${target}`]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: firstLine(err.message) };
  }
}
```

- [ ] **Step 7: Run both suites**

Run: `node professor-orb/workflows/migrate.plan.test.mjs` then `node professor-orb/workflows/migrate.apply.test.mjs`
Expected: both exit 0.

- [ ] **Step 8: Prove the collision case can fail**

Temporarily change `applyPlan`'s precheck branch to ignore `prechecks.ok`, re-run the apply suite, and confirm "a basename collision in the parent refuses the whole run" now FAILS. Put it back and confirm it passes again.

- [ ] **Step 9: Commit**

```bash
git add professor-orb/workflows/migrate.mjs professor-orb/workflows/migrate.plan.test.mjs professor-orb/workflows/migrate.apply.test.mjs
git commit -m "feat(professor-orb): absorb a leaf folder into its parent

Setup defers absorb permanently and applyPlan refuses any plan carrying the
deferred absorb kind. Both stay: they guard the unattended path. absorb-folder
is a separate kind only a scoped plan produces, and only after the DM approved
a proposal naming every file it moves.

The planner enumerates each article by name rather than leaving the folder's
contents implicit, so the proposal the DM reads is the list of files that will
actually move. A folder holding a subfolder is declined, because where those
contents belong is a separate judgment. A prong root or campaign folder is
permanently exempt, not a judgment the DM can override in a scope. Every absorb
also emits a rebuild of the parent index: the parent still lists the dissolved
folder's index, and that link dies with the folder.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `split-folder`

Setup defers split for the same reason it defers absorb: crossing a threshold says a folder should divide, and says nothing about how to partition it. The partition is the DM's, so it arrives in the scope as explicit buckets rather than being guessed here.

**Files:**
- Modify: `professor-orb/workflows/migrate.mjs`
- Modify: `professor-orb/workflows/migrate.plan.test.mjs`
- Modify: `professor-orb/workflows/migrate.apply.test.mjs`

**Interfaces:**
- Produces: operation `{op: "split-folder", from, buckets: [{folder, articles: [{from, to}]}], reason}`.
- Scope key: `splitFolders: [{folder, buckets: [{name, articles: ["<basename or path>"]}]}]`.
- Produces: one `create-index` operation per bucket, plus a `rebuild-index` on the folder being split.

- [ ] **Step 1: Write the failing plan test**

Append to `professor-orb/workflows/migrate.plan.test.mjs`:

```js
console.log("\n=== scoped plans: split-folder ===");

function splitFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-split-"));
  const w = (rel, body) => {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  w("settings/rolara/locations/Locations-INDEX.md", "---\ntype: Index\n---\n\n- [[Ashfall]]\n- [[Karsk]]\n");
  w("settings/rolara/locations/Ashfall.md", "---\ntype: Location\n---\n\nBody.\n");
  w("settings/rolara/locations/Karsk.md", "---\ntype: Location\n---\n\nBody.\n");
  return root;
}

{
  const root = splitFixture();
  const r = scoped(
    {
      splitFolders: [
        {
          folder: "settings/rolara/locations",
          buckets: [
            { name: "north", articles: ["Ashfall.md"] },
            { name: "south", articles: ["Karsk.md"] },
          ],
        },
      ],
    },
    root
  );
  check("a split plans the move, an index per bucket, then the parent rebuild",
    kindsOf(r.operations), ["split-folder", "create-index", "create-index", "rebuild-index"]);
  check("each article gets a full destination path",
    r.operations[0].buckets[0].articles,
    [{ from: "settings/rolara/locations/Ashfall.md", to: "settings/rolara/locations/north/Ashfall.md" }]);
  check("the bucket index lands inside the bucket",
    r.operations[1].to, "settings/rolara/locations/north/North-INDEX.md");
  check("the parent rebuild targets the folder's own index",
    r.operations[3].to, "settings/rolara/locations/Locations-INDEX.md");
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  const r = scoped(
    {
      splitFolders: [
        {
          folder: "settings/rolara/locations",
          buckets: [
            { name: "north", articles: ["Ashfall.md"] },
            { name: "south", articles: ["Ashfall.md"] },
          ],
        },
      ],
    },
    root
  );
  // One article, two destinations. Executing this would move it to the first
  // bucket and then fail to find it for the second, leaving a partition the DM
  // approved and a tree that does not match it.
  check("an article claimed by two buckets is declined",
    [r.operations.length, r.declined.length], [0, 1]);
  check("and the reason names the article", r.declined[0].reason.includes("Ashfall.md"), true);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  mkdirSync(path.join(root, "settings", "rolara", "locations", "north"), { recursive: true });
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  check("a bucket whose folder already exists is declined",
    [r.operations.length, r.declined.length], [0, 1]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  // Karsk.md is in no bucket. That is legitimate: a partial split leaves the
  // rest where it is. Asserting it explicitly stops a future "every article
  // must be assigned" rule from being added without anyone noticing it forbids
  // the ordinary case.
  check("an article in no bucket simply stays put",
    JSON.stringify(r.operations).includes("Karsk"), false);
  check("and the split still plans", r.declined.length, 0);
  rmSync(root, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node professor-orb/workflows/migrate.plan.test.mjs`
Expected: FAIL on the first case with actual `[]`.

- [ ] **Step 3: Implement the planner**

Add to `migrate.mjs`, and add `["splitFolders", planSplitFolders],` to `SCOPED_PLANNERS`:

```js
// Title Case for a bucket's index stem: "north" becomes "North-INDEX".
const indexStemFor = (name, suffix) =>
  `${String(name).charAt(0).toUpperCase()}${String(name).slice(1)}${suffix}`;

function planSplitFolders(items, ctx) {
  const operations = [];
  const declined = [];
  const protectedSet = protectedFolders(ctx.settings);

  for (const item of items) {
    const folder = toPosix(item && item.folder);
    if (!folder) {
      declined.push({ op: "split-folder", target: "(unnamed)", reason: "The scope entry names no folder." });
      continue;
    }
    if (protectedSet.has(folder)) {
      declined.push({
        op: "split-folder",
        target: folder,
        reason:
          "This is a prong root or a campaign folder. Splitting it would divide a whole knowledge base, homebrew catalog, or campaign, which is a setting-lifecycle operation rather than a folder split.",
      });
      continue;
    }

    const suffix = indexSuffixFor(settingForFolder(ctx.settings, folder), ctx.baseRules);
    const buckets = [];
    const claimed = new Map();
    let refused = false;

    for (const bucket of list(item.buckets)) {
      const name = String((bucket && bucket.name) || "").trim();
      if (!name) {
        declined.push({ op: "split-folder", target: folder, reason: "A bucket carries no name." });
        refused = true;
        break;
      }
      const dest = `${folder}/${name}`;
      if (existsSync(path.resolve(ctx.projectRoot, dest))) {
        declined.push({
          op: "split-folder",
          target: dest,
          reason:
            "That subfolder already exists. Moving articles into it would merge the split into an existing folder whose contents the proposal never listed.",
        });
        refused = true;
        break;
      }

      const articles = [];
      for (const raw of list(bucket.articles)) {
        const base = path.posix.basename(toPosix(raw));
        if (!base) continue;
        if (claimed.has(base)) {
          declined.push({
            op: "split-folder",
            target: folder,
            reason: `${base} is claimed by two buckets (${claimed.get(base)} and ${name}). An article has one home; pick which bucket owns it.`,
          });
          refused = true;
          break;
        }
        claimed.set(base, name);
        articles.push({ from: `${folder}/${base}`, to: `${dest}/${base}` });
      }
      if (refused) break;
      buckets.push({ folder: dest, name, articles });
    }
    if (refused) continue;
    if (buckets.length === 0) {
      declined.push({ op: "split-folder", target: folder, reason: "The scope entry carries no buckets." });
      continue;
    }

    operations.push({
      op: "split-folder",
      from: folder,
      buckets,
      reason: String((item && item.reason) || "Split by a DM-approved /migrate scope."),
    });

    for (const bucket of buckets) {
      operations.push({
        op: "create-index",
        to: `${bucket.folder}/${indexStemFor(bucket.name, suffix)}.md`,
        reason: `Created for the ${bucket.name} bucket of the ${folder} split.`,
      });
    }

    const parentIndex = existingIndexIn(ctx, folder, suffix);
    if (parentIndex) {
      operations.push({
        op: "rebuild-index",
        to: parentIndex,
        folder,
        reason: `Rebuilt because ${folder} was split into ${buckets.length} subfolder(s).`,
      });
    }
  }
  return { operations, declined };
}
```

- [ ] **Step 4: Run the plan suite**

Run: `node professor-orb/workflows/migrate.plan.test.mjs`
Expected: the eleven new expectations pass.

- [ ] **Step 5: Write the failing apply test**

Append to `professor-orb/workflows/migrate.apply.test.mjs`:

```js
console.log("\n=== split-folder ===");

withRepo(
  {
    "settings/rolara/locations/Locations-INDEX.md": article("type: Index", "- [[Ashfall]]\n- [[Karsk]]"),
    "settings/rolara/locations/Ashfall.md": article("type: Location", "Body."),
    "settings/rolara/locations/Karsk.md": article("type: Location", "See [[Ashfall]]."),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "split-folder",
        from: "settings/rolara/locations",
        buckets: [
          {
            folder: "settings/rolara/locations/north",
            name: "north",
            articles: [{ from: "settings/rolara/locations/Ashfall.md", to: "settings/rolara/locations/north/Ashfall.md" }],
          },
        ],
        reason: "scope",
      },
    ]);
    check("split-folder applies", [r.ok, first(r.applied).applied], [true, true]);
    check("the article is in its bucket", has(root, "settings/rolara/locations/north/Ashfall.md"), true);
    check("and gone from the parent", has(root, "settings/rolara/locations/Ashfall.md"), false);
    // Obsidian resolves by stem, so a link from a sibling that did not move
    // still resolves after the move. Left alone deliberately.
    check("a wikilink from an article that stayed is untouched",
      read(root, "settings/rolara/locations/Karsk.md").includes("[[Ashfall]]"), true);
    check("git recorded renames", porcelain(root).some((l) => l.startsWith("R")), true);
  }
);

withRepo(
  {
    "settings/rolara/locations/Ashfall.md": article("type: Location", "Body."),
    "settings/rolara/locations/Karsk.md": article("type: Location", "Body."),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "split-folder",
        from: "settings/rolara/locations",
        buckets: [
          {
            folder: "settings/rolara/locations/north",
            name: "north",
            articles: [
              { from: "settings/rolara/locations/Ashfall.md", to: "settings/rolara/locations/north/Ashfall.md" },
              { from: "settings/rolara/locations/Nope.md", to: "settings/rolara/locations/north/Nope.md" },
            ],
          },
        ],
        reason: "scope",
      },
    ]);
    // One entry for the whole split, on the same principle a rename carries its
    // link rewrite: a split reported as done with one article left behind is
    // exactly what the per-operation accounting exists to prevent.
    const e = first(r.applied.concat(r.failed));
    check("a missing article fails the whole split entry", e.applied, false);
    check("and the detail names how far it got", /1 of 2/.test(e.detail || ""), true);
  }
);
```

- [ ] **Step 6: Implement the executor**

Add to `migrate.mjs` and register `"split-folder": applySplitFolder,`:

```js
// Divide a folder into DM-named buckets. One accounting entry for the whole
// split: a partition applied halfway is worse than one not applied at all,
// because the DM approved a shape the tree no longer matches either way.
function applySplitFolder(op, ctx) {
  const entry = entryFor(op);
  entry.from = toPosix(op.from);
  entry.moved = 0;
  const all = list(op.buckets).flatMap((b) => list(b.articles));

  for (const a of all) {
    const out = gitMove(ctx, toPosix(a.from), toPosix(a.to));
    if (!out.ok) {
      entry.detail = `git mv failed for ${a.from}: ${out.error}. ${entry.moved} of ${all.length} article(s) had moved; the snapshot is the undo.`;
      return entry;
    }
    entry.moved++;
  }

  entry.applied = true;
  entry.buckets = list(op.buckets).map((b) => b.folder);
  entry.detail = `Split ${entry.moved} article(s) across ${entry.buckets.length} subfolder(s).`;
  return entry;
}
```

- [ ] **Step 7: Run both suites**

Run: `node professor-orb/workflows/migrate.plan.test.mjs` then `node professor-orb/workflows/migrate.apply.test.mjs`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add professor-orb/workflows/migrate.mjs professor-orb/workflows/migrate.plan.test.mjs professor-orb/workflows/migrate.apply.test.mjs
git commit -m "feat(professor-orb): split a folder into DM-named buckets

Crossing the split threshold says a folder should divide and says nothing about
how to partition it, which is why setup defers this permanently. The partition
arrives in the scope as explicit buckets and is never guessed here.

Three shapes are declined rather than executed: an article claimed by two
buckets, which would move once and then fail to be found for the second; a
bucket whose folder already exists, which would merge the split into a folder
whose contents the proposal never listed; and a prong root or campaign folder,
which is a setting-lifecycle operation rather than a folder split. An article in
no bucket simply stays put, and a test pins that so a future must-assign-every
-article rule cannot be added without noticing it forbids the ordinary case.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `rename-entity`

"Rename the Ashfall Compact to the Cinder Pact everywhere" is the scope the spec opens with, and it is the one that most naturally reads as including body prose. It does not. This operation renames the file, the frontmatter `name`, and every wikilink; the sentences that mention the faction are `chronicler`'s work, and Task 9 makes the command say so out loud whenever a scope crosses that line.

**Files:**
- Modify: `professor-orb/workflows/migrate.mjs`
- Modify: `professor-orb/workflows/migrate.plan.test.mjs`
- Modify: `professor-orb/workflows/migrate.apply.test.mjs`

**Interfaces:**
- Produces: operation `{op: "rename-entity", from, to, nameFrom, nameTo, links: [<paths>], reason}`.
- Scope key: `entityRenames: [{file, to, nameFrom, nameTo, links}]`.
- Consumes: `rewriteWikilinks(text, oldStem, newStem)` and `gitMove(ctx, from, to)`, both already exported.

- [ ] **Step 1: Write the failing apply test**

Append to `professor-orb/workflows/migrate.apply.test.mjs`:

```js
console.log("\n=== rename-entity ===");

withRepo(
  {
    "settings/rolara/factions/Ashfall-Compact.md":
      "---\ntype: Organization\nname: Ashfall Compact\npublish: false\n---\n\nThe Ashfall Compact holds the northern passes.\n",
    "settings/rolara/factions/Factions-INDEX.md": article("type: Index", "- [[Ashfall-Compact]]"),
    "settings/rolara/people/Thoric.md": article("type: Person", "Sworn to [[Ashfall-Compact|the Compact]]."),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "rename-entity",
        from: "settings/rolara/factions/Ashfall-Compact.md",
        to: "settings/rolara/factions/Cinder-Pact.md",
        nameFrom: "Ashfall Compact",
        nameTo: "Cinder Pact",
        links: ["settings/rolara/factions/Factions-INDEX.md", "settings/rolara/people/Thoric.md"],
        reason: "scope",
      },
    ]);
    const entry = first(r.applied);
    check("rename-entity applies", [r.ok, entry.applied], [true, true]);
    check("the file is renamed", has(root, "settings/rolara/factions/Cinder-Pact.md"), true);
    check("the frontmatter name is updated",
      read(root, "settings/rolara/factions/Cinder-Pact.md").includes("name: Cinder Pact"), true);
    check("a plain wikilink is rewritten",
      read(root, "settings/rolara/factions/Factions-INDEX.md").includes("[[Cinder-Pact]]"), true);
    check("a piped wikilink keeps its display text",
      read(root, "settings/rolara/people/Thoric.md").includes("[[Cinder-Pact|the Compact]]"), true);
    // The scope boundary, asserted rather than described. Renaming prose is
    // chronicler's job; doing it here would rewrite the DM's sentences under a
    // structural approval.
    check("body prose naming the old entity is NOT rewritten",
      read(root, "settings/rolara/factions/Cinder-Pact.md").includes("The Ashfall Compact holds"), true);
    check("both link rewrites are counted", entry.linksRewritten, 2);
  }
);

withRepo(
  {
    "settings/rolara/factions/Ashfall-Compact.md": article("type: Organization", "Body."),
    "settings/rolara/factions/Factions-INDEX.md": article("type: Index", "- [[Ashfall-Compact]]"),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "rename-entity",
        from: "settings/rolara/factions/Ashfall-Compact.md",
        to: "settings/rolara/factions/Cinder-Pact.md",
        nameFrom: "Ashfall Compact",
        nameTo: "Cinder Pact",
        links: ["settings/rolara/factions/Factions-INDEX.md", "settings/rolara/factions/Gone.md"],
        reason: "scope",
      },
    ]);
    // A rename and its link rewrites are ONE unit of work with one entry. A
    // dead wikilink is valid markdown that fails silently in Obsidian, so a
    // move reported as done while a rewrite was dropped is invisible without
    // this.
    const e = first(r.applied.concat(r.failed));
    check("an unreachable link file fails the whole entry", e.applied, false);
    check("even though the file did move", has(root, "settings/rolara/factions/Cinder-Pact.md"), true);
  }
);

withRepo(
  { "settings/rolara/factions/Ashfall-Compact.md": article("type: Organization", "Body.") },
  (root) => {
    const r = apply(root, [
      {
        op: "rename-entity",
        from: "settings/rolara/factions/Ashfall-Compact.md",
        to: "settings/rolara/factions/Cinder-Pact.md",
        nameFrom: "Ashfall Compact",
        nameTo: "Cinder Pact",
        links: [],
        reason: "scope",
      },
    ]);
    // No name field at all is normal: the base schema does not require one.
    // Renaming the file is still the operation's job, so this must not fail.
    check("a file with no name field still renames", [r.ok, first(r.applied).applied], [true, true]);
    check("and nothing is inserted",
      read(root, "settings/rolara/factions/Cinder-Pact.md").includes("name:"), false);
  }
);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node professor-orb/workflows/migrate.apply.test.mjs`
Expected: FAIL, `applyPlan` refuses with `unknown-operation`.

- [ ] **Step 3: Implement the executor**

Add to `migrate.mjs` beside `applyRenameWithLinkRewrite`, and register `"rename-entity": applyRenameEntity,`:

```js
// Rename an entity: the file, its frontmatter name, and every wikilink naming
// it, as ONE unit of work with one accounting entry. Modelled on
// applyRenameWithLinkRewrite and holding the same property for the same reason:
// a dead wikilink is valid markdown that fails silently in Obsidian, so a move
// reported as done with a dropped rewrite is invisible without this.
//
// BODY PROSE IS NOT TOUCHED. "Rename X to Y everywhere" reads as including the
// sentences that mention X, and it does not: rewriting those is chronicler's
// work, behind chronicler's own proposal gate. commands/migrate.md states this
// to the DM whenever a scope crosses the line. Doing it here would rewrite the
// DM's own writing under an approval they gave for a structural change.
function applyRenameEntity(op, ctx) {
  const entry = entryFor(op);
  entry.linksRewritten = 0;
  entry.linksExpected = list(op.links).length;

  const moved = gitMove(ctx, toPosix(op.from), toPosix(op.to));
  if (!moved.ok) {
    entry.detail = `git mv failed: ${moved.error}`;
    return entry;
  }

  // The frontmatter name, if the article carries one. Absence is normal: the
  // base schema does not require the field, so nothing is ever inserted.
  if (op.nameFrom != null && op.nameTo != null) {
    const read = readText(ctx, toPosix(op.to));
    if (!read.ok) {
      entry.detail = `The file moved but could not be read back: ${read.error}`;
      return entry;
    }
    const doc = splitTextLines(read.text);
    const bounds = frontmatterBounds(doc.lines);
    if (bounds) {
      for (let i = bounds.start; i < bounds.end; i++) {
        const m = /^(name[ \t]*:[ \t]*)(.*)$/.exec(doc.lines[i]);
        if (!m) continue;
        let rest = m[2];
        let comment = "";
        const c = inlineCommentIndex(rest);
        if (c !== -1) {
          comment = rest.slice(c);
          rest = rest.slice(0, c);
        }
        const { quote, value } = unquoteScalar(rest);
        if (value !== op.nameFrom) {
          entry.detail = `The file carries name ${JSON.stringify(value)}, not the ${JSON.stringify(
            op.nameFrom
          )} this plan was built against. The rename is incomplete; re-run the plan phase.`;
          return entry;
        }
        doc.lines[i] = `${m[1]}${quote}${op.nameTo}${quote}${comment}`;
        const written = writeText(ctx, toPosix(op.to), joinTextLines(doc));
        if (!written.ok) {
          entry.detail = `Could not write the frontmatter name: ${written.error}`;
          return entry;
        }
        entry.nameUpdated = true;
        break;
      }
    }
  }

  const oldStem = stemOf(op.from);
  const newStem = stemOf(op.to);
  for (const rel of list(op.links)) {
    const read = readText(ctx, toPosix(rel));
    if (!read.ok) {
      entry.detail = `The file and its frontmatter were updated, but ${rel} could not be read, so a wikilink to the old name may survive: ${read.error}`;
      return entry;
    }
    const rewritten = rewriteWikilinks(read.text, oldStem, newStem);
    if (rewritten.count === 0) continue;
    const written = writeText(ctx, toPosix(rel), rewritten.text);
    if (!written.ok) {
      entry.detail = `Could not rewrite wikilinks in ${rel}: ${written.error}`;
      return entry;
    }
    entry.linksRewritten += rewritten.count;
  }

  entry.applied = true;
  entry.detail = `Renamed to ${newStem}, ${
    entry.nameUpdated ? "frontmatter name updated" : "no frontmatter name to update"
  }, ${entry.linksRewritten} wikilink(s) rewritten. Body prose was not touched.`;
  return entry;
}
```

If `rewriteWikilinks` returns a bare string rather than `{text, count}`, use the shape it actually returns and count separately; check its signature at `migrate.mjs:1241` before writing this.

- [ ] **Step 4: Run the apply suite**

Run: `node professor-orb/workflows/migrate.apply.test.mjs`
Expected: the eleven new expectations pass.

- [ ] **Step 5: Write the failing plan test**

Append to `professor-orb/workflows/migrate.plan.test.mjs`:

```js
console.log("\n=== scoped plans: rename-entity ===");

{
  const r = scoped({
    entityRenames: [
      {
        file: "settings/rolara/factions/Ashfall-Compact.md",
        to: "settings/rolara/factions/Cinder-Pact.md",
        nameFrom: "Ashfall Compact",
        nameTo: "Cinder Pact",
        links: ["settings/rolara/factions/Factions-INDEX.md"],
      },
    ],
  });
  check("an entity rename plans one rename-entity", kindsOf(r.operations), ["rename-entity"]);
  check("the referring files ride along on the operation",
    r.operations[0].links, ["settings/rolara/factions/Factions-INDEX.md"]);
}

{
  const r = scoped({
    entityRenames: [{ file: "settings/rolara/factions/A.md", to: "settings/rolara/factions/A.md" }],
  });
  check("a rename to the same path is declined", [r.operations.length, r.declined.length], [0, 1]);
}
```

- [ ] **Step 6: Implement the planner**

Add `["entityRenames", planEntityRenames],` to `SCOPED_PLANNERS` and:

```js
function planEntityRenames(items, ctx) {
  const operations = [];
  const declined = [];
  for (const item of items) {
    const from = toPosix(item && item.file);
    const to = toPosix(item && item.to);
    if (!from || !to) {
      declined.push({ op: "rename-entity", target: from || to || "(unnamed)", reason: "The scope entry is missing a source or a destination." });
      continue;
    }
    if (from === to) {
      declined.push({ op: "rename-entity", target: from, reason: "Source and destination are the same path." });
      continue;
    }
    operations.push({
      op: "rename-entity",
      from,
      to,
      nameFrom: item.nameFrom == null ? null : String(item.nameFrom),
      nameTo: item.nameTo == null ? null : String(item.nameTo),
      links: list(item.links).map(toPosix).filter(Boolean),
      reason: String((item && item.reason) || "Renamed by a DM-approved /migrate scope."),
    });
  }
  return { operations, declined };
}
```

- [ ] **Step 7: Run both suites**

Run: `node professor-orb/workflows/migrate.plan.test.mjs` then `node professor-orb/workflows/migrate.apply.test.mjs`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add professor-orb/workflows/migrate.mjs professor-orb/workflows/migrate.plan.test.mjs professor-orb/workflows/migrate.apply.test.mjs
git commit -m "feat(professor-orb): rename an entity across the knowledge base

The filename, the frontmatter name, and every wikilink naming it, as one unit
of work with one accounting entry, on the same principle applyRenameWithLink
Rewrite already holds: a dead wikilink is valid markdown that fails silently in
Obsidian, so a move reported as done with a dropped rewrite is invisible
without it.

Body prose is deliberately not touched, and a test pins that rather than a
comment describing it. Rename X to Y everywhere reads as including the
sentences that mention X, and rewriting those under a structural approval would
be editing the DM's own writing. That work is chronicler's, behind chronicler's
proposal gate. An article with no name field still renames and has nothing
inserted; the base schema does not require the field.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: scope planners for the three operations the executor already has

Retype, frontmatter repair, and the deferred `-TIMELINE` and `-HISTORY` renames need no new executors. `normalize-type`, `repair-frontmatter`, and `rename-with-link-rewrite` already do the work; only setup knows how to ask for them. This task gives all three a scope planner, which is what makes the last two of setup's five deferrals reachable.

**Files:**
- Modify: `professor-orb/workflows/migrate.mjs`
- Modify: `professor-orb/workflows/migrate.plan.test.mjs`

**Interfaces:**
- Scope key `retypes: [{files: [<path>], typeFrom, typeTo, suffix}]`, planning one `normalize-type` per file plus one `rename-with-link-rewrite` per file when the new type requires a filename suffix the file does not carry.
- Scope key `frontmatterRepairs: [{file, reorder, insert}]`, planning `repair-frontmatter`.
- Scope key `suffixRenames: [{file, to, links}]`, planning `rename-with-link-rewrite`. This is the `-TIMELINE` and `-HISTORY` deferral.
- Produces: `retypeExtensions(scope)`, returning the `{typeTo}` values a retype introduces, so Task 10's conventions updater can fold them into `frontmatterTypeEnum.extendedBy`.

- [ ] **Step 1: Write the failing plan tests**

Append to `professor-orb/workflows/migrate.plan.test.mjs`:

```js
console.log("\n=== scoped plans: retype, repair, suffix renames ===");

{
  const r = scoped({
    retypes: [
      {
        files: ["settings/rolara/people/Thoric.md", "settings/rolara/people/Aria.md"],
        typeFrom: "Person",
        typeTo: "Character",
      },
    ],
  });
  check("a retype plans one normalize-type per file",
    kindsOf(r.operations), ["normalize-type", "normalize-type"]);
  check("each carries the from and to values the executor matches on",
    [r.operations[0].typeFrom, r.operations[0].typeTo], ["Person", "Character"]);
}

{
  const r = scoped({
    retypes: [
      {
        files: ["settings/rolara/history/First-Age.md"],
        typeFrom: "Concept",
        typeTo: "Chronology",
        suffix: "-CHRONOLOGY",
        links: { "settings/rolara/history/First-Age.md": ["settings/rolara/Master-INDEX.md"] },
      },
    ],
  });
  // Type first, then the rename: a required suffix derives from the type, so
  // renaming first computes it from a stale value. That is the reason
  // OPERATION_ORDER puts normalize-type ahead of rename-with-link-rewrite, and
  // it is why retype emits both rather than asking the DM to sequence them.
  check("a type whose suffix the file lacks also plans the rename",
    kindsOf(r.operations), ["normalize-type", "rename-with-link-rewrite"]);
  check("the rename target carries the suffix",
    r.operations[1].to, "settings/rolara/history/First-Age-CHRONOLOGY.md");
  check("and the referring files ride along",
    r.operations[1].links, ["settings/rolara/Master-INDEX.md"]);
}

{
  const r = scoped({
    retypes: [
      {
        files: ["settings/rolara/history/First-Age-CHRONOLOGY.md"],
        typeFrom: "Concept",
        typeTo: "Chronology",
        suffix: "-CHRONOLOGY",
      },
    ],
  });
  check("a file already carrying the suffix is not renamed to itself",
    kindsOf(r.operations), ["normalize-type"]);
}

{
  const r = scoped({
    frontmatterRepairs: [{ file: "settings/rolara/people/Aria.md", reorder: true, insert: [] }],
  });
  check("a repair scope plans one repair-frontmatter", kindsOf(r.operations), ["repair-frontmatter"]);
  // publish is never inserted by any unattended process, and a scope is not an
  // exception: the guard that forces publish false on DM-only content is a
  // project-scope check, so inserting a default in bulk would publish unmarked
  // secret lore. buildPlan already refuses this; buildScopedPlan must too.
  const p = scoped({
    frontmatterRepairs: [{ file: "settings/rolara/people/Aria.md", insert: ["publish"] }],
  });
  check("inserting publish is declined even when the DM's scope asks",
    [p.operations.length, p.declined.length], [0, 1]);
}

{
  const r = scoped({
    suffixRenames: [
      {
        file: "settings/rolara/history/First-Age-TIMELINE.md",
        to: "settings/rolara/history/First-Age-CHRONOLOGY.md",
        links: ["settings/rolara/history/History-INDEX.md"],
      },
    ],
  });
  check("a suffix rename plans one rename-with-link-rewrite",
    kindsOf(r.operations), ["rename-with-link-rewrite"]);
}

{
  check("retypeExtensions collects the new type values",
    retypeExtensions({
      retypes: [
        { files: ["a.md"], typeFrom: "Person", typeTo: "Character" },
        { files: ["b.md"], typeFrom: "Person", typeTo: "Character" },
        { files: ["c.md"], typeFrom: "Item", typeTo: "Relic" },
      ],
    }),
    ["Character", "Relic"]);
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `node professor-orb/workflows/migrate.plan.test.mjs`
Expected: FAIL at import on `retypeExtensions`, and FAIL on every new case.

- [ ] **Step 3: Implement the three planners**

Add to `migrate.mjs`, and add all three to `SCOPED_PLANNERS` in this order: `["retypes", planRetypes], ["frontmatterRepairs", planScopedRepairs], ["suffixRenames", planSuffixRenames],`.

```js
function planRetypes(items, ctx) {
  const operations = [];
  const declined = [];
  for (const item of items) {
    const typeFrom = item && item.typeFrom;
    const typeTo = item && item.typeTo;
    if (typeFrom == null || typeTo == null) {
      declined.push({ op: "normalize-type", target: "(unnamed)", reason: "The retype entry is missing typeFrom or typeTo." });
      continue;
    }
    const suffix = typeof item.suffix === "string" ? item.suffix : "";
    const linksByFile = (item && item.links) || {};

    for (const raw of list(item.files)) {
      const file = toPosix(raw);
      if (!file) continue;
      operations.push({
        op: "normalize-type",
        from: file,
        typeFrom: String(typeFrom),
        typeTo: String(typeTo),
        reason: String((item && item.reason) || `Retyped from ${typeFrom} to ${typeTo} by a DM-approved /migrate scope.`),
      });

      // The new type may require a filename suffix. Emitting the rename here,
      // rather than asking the DM to add a second scope entry, is what keeps
      // the two in the right order: a suffix derives from a type, so a rename
      // planned independently could be sequenced before the type it derives
      // from and compute the suffix from a stale value.
      if (!suffix) continue;
      const stem = stemOf(file);
      if (stem.endsWith(suffix)) continue;
      operations.push({
        op: "rename-with-link-rewrite",
        from: file,
        to: `${path.posix.dirname(file)}/${stem}${suffix}.md`,
        links: list(linksByFile[file] || linksByFile[stem]).map(toPosix).filter(Boolean),
        reason: `Renamed because type ${typeTo} requires the ${suffix} suffix.`,
      });
    }
  }
  return { operations, declined };
}

function planScopedRepairs(items, ctx) {
  const operations = [];
  const declined = [];
  for (const item of items) {
    const file = toPosix(item && item.file);
    if (!file) {
      declined.push({ op: "repair-frontmatter", target: "(unnamed)", reason: "The repair entry names no file." });
      continue;
    }
    const insert = list(item.insert).map(String);
    // buildPlan already refuses to insert publish, for a reason a DM-supplied
    // scope does not change: the guard that forces publish false on DM-only
    // content is a project-scope check kind, so inserting a default across a
    // batch would publish unmarked secret lore. The DM sets publish per
    // article, deliberately, or not at all.
    if (insert.includes("publish")) {
      declined.push({
        op: "repair-frontmatter",
        target: file,
        reason:
          "publish is never inserted by an unattended process, including one a scope asked for. Set it per article; the sweep reports which articles are missing it.",
      });
      continue;
    }
    operations.push({
      op: "repair-frontmatter",
      from: file,
      insert,
      reorder: item.reorder !== false,
      reason: String((item && item.reason) || "Frontmatter repaired by a DM-approved /migrate scope."),
    });
  }
  return { operations, declined };
}

function planSuffixRenames(items, ctx) {
  const operations = [];
  const declined = [];
  for (const item of items) {
    const from = toPosix(item && item.file);
    const to = toPosix(item && item.to);
    if (!from || !to || from === to) {
      declined.push({
        op: "rename-with-link-rewrite",
        target: from || "(unnamed)",
        reason: "The rename entry is missing a source or a destination, or they are the same path.",
      });
      continue;
    }
    operations.push({
      op: "rename-with-link-rewrite",
      from,
      to,
      links: list(item.links).map(toPosix).filter(Boolean),
      reason: String((item && item.reason) || "Renamed by a DM-approved /migrate scope."),
    });
  }
  return { operations, declined };
}

// The type values a retype scope introduces, deduplicated and in first-seen
// order. Task 10's conventions updater folds these into the base type enum's
// extendedBy, so an article retyped to a value the enum does not carry does not
// start failing the write-time hook the moment the migration lands.
export function retypeExtensions(scope) {
  const out = [];
  for (const item of list(scope && scope.retypes)) {
    const value = item && item.typeTo;
    if (value == null) continue;
    if (!out.includes(String(value))) out.push(String(value));
  }
  return out;
}
```

- [ ] **Step 4: Run the plan suite**

Run: `node professor-orb/workflows/migrate.plan.test.mjs`
Expected: the twelve new expectations pass.

- [ ] **Step 5: Confirm the executors need no change**

Run: `node professor-orb/workflows/migrate.apply.test.mjs`
Expected: exit 0, unchanged. This task adds no executor and must not have touched the apply half at all. Confirm with `git diff --stat` that only the plan half and the plan suite changed.

- [ ] **Step 6: Commit**

```bash
git add professor-orb/workflows/migrate.mjs professor-orb/workflows/migrate.plan.test.mjs
git commit -m "feat(professor-orb): plan retypes, frontmatter repairs, and suffix renames from a scope

Three of the spec's operation catalog need no new executor: normalize-type,
repair-frontmatter, and rename-with-link-rewrite already do the work, and only
setup knew how to ask for them. Each gains a scope planner, which makes the
last two of setup's five deferrals reachable.

A retype emits the type change and, when the new type requires a filename
suffix the file lacks, the rename as well. Emitting both from one entry is what
keeps them in the right order: a suffix derives from a type, and a rename
planned as a separate entry could be sequenced ahead of the type it derives
from and compute the suffix from a stale value. A file already carrying the
suffix is not renamed to itself.

Inserting publish is declined even when the scope asks for it, matching what
buildPlan already refuses and for the same reason: the guard that forces
publish false on DM-only content is a project-scope check, so a batch insert
would publish unmarked secret lore.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `update-prose-paths`, and ignored sources surfaced in the proposal

The last two of setup's five deferrals. Prose path references live in the consumer's `CLAUDE.md`, its conventions document, and the DM's separate wiki-website project, and every one of them went stale the moment 1.6.0's migration moved the prongs. Ignored files inside a prong are outside the snapshot, which is why setup will not move them; `/migrate` reports them and can move them only once the DM has un-ignored them, which puts them back inside it.

**Files:**
- Modify: `professor-orb/workflows/migrate.mjs`
- Modify: `professor-orb/workflows/migrate.plan.test.mjs`
- Modify: `professor-orb/workflows/migrate.apply.test.mjs`

**Interfaces:**
- Produces: operation `{op: "update-prose-paths", from, replacements: [{from, to}], reason}` where `from` is the file being edited.
- Scope key: `prosePathUpdates: [{file, replacements: [{from, to}]}]`.
- Produces: every scoped plan surfaces git-ignored sources as `declined` entries, so they reach the DM's proposal instead of being silently skipped at apply time.

- [ ] **Step 1: Write the failing apply test**

Append to `professor-orb/workflows/migrate.apply.test.mjs`:

```js
console.log("\n=== update-prose-paths ===");

withRepo(
  {
    "CLAUDE.md":
      "The knowledge base lives at `rolara-kb/`. Session reports go in rolara-kb/sessions/.\nSee rolara-kb/ for details.\n",
    "settings/rolara/A.md": article("type: Person", "Body."),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "update-prose-paths",
        from: "CLAUDE.md",
        replacements: [
          { from: "rolara-kb/sessions/", to: "session-reports/rolara/karsk/" },
          { from: "rolara-kb/", to: "settings/rolara/" },
        ],
        reason: "scope",
      },
    ]);
    const text = read(root, "CLAUDE.md");
    check("update-prose-paths applies", [r.ok, first(r.applied).applied], [true, true]);
    check("the longer path is replaced with its own destination",
      text.includes("session-reports/rolara/karsk/"), true);
    // Order matters and is the plan's, not this executor's: rolara-kb/ is a
    // prefix of rolara-kb/sessions/, so replacing the short one first would
    // turn the long one into settings/rolara/sessions/ and the second
    // replacement would then match nothing. The plan lists them longest first
    // and the executor applies them in the order given.
    check("the prefix replacement did not eat the longer one",
      text.includes("settings/rolara/sessions/"), false);
    check("the bare path is still replaced elsewhere",
      text.includes("See settings/rolara/ for details."), true);
    check("the replacement count is reported", first(r.applied).replacements, 3);
  }
);

withRepo({ "CLAUDE.md": "Nothing to see here.\n" }, (root) => {
  const r = apply(root, [
    { op: "update-prose-paths", from: "CLAUDE.md", replacements: [{ from: "rolara-kb/", to: "settings/rolara/" }], reason: "scope" },
  ]);
  // A stale reference the DM already fixed by hand is not a failure. Reporting
  // zero rather than failing keeps a re-run of an approved proposal harmless.
  check("a file with no match applies with a count of zero",
    [first(r.applied).applied, first(r.applied).replacements], [true, 0]);
});

withRepo({ "settings/rolara/A.md": article("type: Person", "Body.") }, (root) => {
  const r = apply(root, [
    { op: "update-prose-paths", from: "docs/Missing.md", replacements: [{ from: "a", to: "b" }], reason: "scope" },
  ]);
  check("a file that is not there is reported, not created",
    [first(r.applied.concat(r.failed)).applied, has(root, "docs/Missing.md")], [false, false]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node professor-orb/workflows/migrate.apply.test.mjs`
Expected: FAIL, `applyPlan` refuses with `unknown-operation`.

- [ ] **Step 3: Implement the executor**

Add to `migrate.mjs` and register `"update-prose-paths": applyUpdateProsePaths,`:

```js
// Rewrite stale path references in a file the DM named. This is the last of
// setup's five deferrals: the consumer's CLAUDE.md, its conventions document,
// and the DM's separate wiki-website project all name paths that went stale the
// moment the prongs moved, and none of them are knowledge base articles the
// migration would otherwise touch.
//
// Replacements are applied IN THE ORDER THE PLAN GIVES, as literal strings.
// Order is the planner's responsibility and it matters: "rolara-kb/" is a prefix
// of "rolara-kb/sessions/", so applying the short one first turns the long one
// into a path the second replacement can no longer match. planProsePathUpdates
// sorts longest first for exactly this reason, and a hand-edited proposal that
// reorders them gets what it asked for rather than a silent re-sort.
//
// Literal, not regex: a path carries "." and may carry "[" or "(", and treating
// a DM-supplied path as a pattern would match text it does not name.
function applyUpdateProsePaths(op, ctx) {
  const entry = entryFor(op);
  const target = toPosix(op.from);
  entry.replacements = 0;

  if (!existsSync(path.resolve(ctx.cwd, target))) {
    entry.detail =
      "No file at that path. A prose reference is only ever updated in a file that exists; creating one would invent a document the DM never named.";
    return entry;
  }
  const read = readText(ctx, target);
  if (!read.ok) {
    entry.detail = `Could not read the file: ${read.error}`;
    return entry;
  }

  let text = read.text;
  for (const r of list(op.replacements)) {
    const from = r && r.from;
    const to = r && r.to;
    if (typeof from !== "string" || from === "" || typeof to !== "string") continue;
    const parts = text.split(from);
    entry.replacements += parts.length - 1;
    text = parts.join(to);
  }

  if (text === read.text) {
    // Not a failure. A DM who already fixed a reference by hand should be able
    // to re-run an approved proposal without it reporting an error.
    entry.applied = true;
    entry.detail = "No stale reference found; the file was left byte for byte as it was.";
    return entry;
  }
  const written = writeText(ctx, target, text);
  if (!written.ok) {
    entry.detail = `Could not write the file: ${written.error}`;
    return entry;
  }
  entry.applied = true;
  entry.detail = `Replaced ${entry.replacements} stale path reference(s).`;
  return entry;
}
```

- [ ] **Step 4: Run the apply suite**

Run: `node professor-orb/workflows/migrate.apply.test.mjs`
Expected: the eight new expectations pass.

- [ ] **Step 5: Write the failing plan tests**

Append to `professor-orb/workflows/migrate.plan.test.mjs`:

```js
console.log("\n=== scoped plans: prose paths and ignored sources ===");

{
  const r = scoped({
    prosePathUpdates: [
      {
        file: "CLAUDE.md",
        replacements: [
          { from: "rolara-kb/", to: "settings/rolara/" },
          { from: "rolara-kb/sessions/", to: "session-reports/rolara/karsk/" },
        ],
      },
    ],
  });
  check("a prose scope plans one update-prose-paths", kindsOf(r.operations), ["update-prose-paths"]);
  // Longest first, regardless of the order the DM listed them. A shorter path
  // that is a prefix of a longer one would otherwise consume it.
  check("replacements are sorted longest source first",
    r.operations[0].replacements.map((x) => x.from),
    ["rolara-kb/sessions/", "rolara-kb/"]);
}

{
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-scoped-ign-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "t"], { cwd: root });
  mkdirSync(path.join(root, "settings", "rolara"), { recursive: true });
  writeFileSync(path.join(root, ".gitignore"), "settings/rolara/drafts/\n");
  mkdirSync(path.join(root, "settings", "rolara", "drafts"), { recursive: true });
  writeFileSync(path.join(root, "settings", "rolara", "drafts", "Sketch.md"), "---\ntype: Concept\n---\n\nBody.\n");
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });

  const r = scoped(
    {
      pathMoves: [
        { from: "settings/rolara/drafts/Sketch.md", to: "settings/rolara/Sketch.md", reason: "DM scope" },
      ],
    },
    root
  );
  // An ignored file is outside the snapshot, so moving it is unrecoverable.
  // The apply half already skips it. Surfacing it as a declined item is what
  // puts it in front of the DM in the proposal, with the one action that makes
  // it movable: un-ignore it, so it lands in the snapshot.
  check("an ignored source is declined in the plan, not left to be skipped later",
    r.declined.some((d) => d.target === "settings/rolara/drafts/Sketch.md"), true);
  check("and the reason names un-ignoring as the way forward",
    /gitignore|un-ignore|ignored/i.test(r.declined.find((d) => d.target === "settings/rolara/drafts/Sketch.md").reason),
    true);
  check("the operation itself is not planned", r.operations.length, 0);
  rmSync(root, { recursive: true, force: true });
}
```

- [ ] **Step 6: Implement the planner and the ignored-source pass**

Add `["prosePathUpdates", planProsePathUpdates],` to `SCOPED_PLANNERS` and:

```js
function planProsePathUpdates(items, ctx) {
  const operations = [];
  const declined = [];
  for (const item of items) {
    const file = toPosix(item && item.file);
    if (!file) {
      declined.push({ op: "update-prose-paths", target: "(unnamed)", reason: "The scope entry names no file." });
      continue;
    }
    const replacements = list(item.replacements)
      .filter((r) => r && typeof r.from === "string" && r.from !== "" && typeof r.to === "string")
      // Longest source first. A shorter path that is a prefix of a longer one
      // would otherwise consume it, leaving the longer replacement matching
      // nothing. Sorted here rather than in the executor so the proposal the DM
      // reads shows the order that will actually be applied.
      .sort((a, b) => b.from.length - a.from.length);
    if (replacements.length === 0) {
      declined.push({ op: "update-prose-paths", target: file, reason: "The scope entry carries no usable replacements." });
      continue;
    }
    operations.push({
      op: "update-prose-paths",
      from: file,
      replacements,
      reason: String((item && item.reason) || "Stale path references updated by a DM-approved /migrate scope."),
    });
  }
  return { operations, declined };
}
```

Then, in `buildScopedPlan`, after the sort and before the return, add the ignored-source pass:

```js
  // An ignored source is outside the snapshot, so moving it is unrecoverable,
  // and the apply half skips it by contract. Surfacing it HERE is what puts it
  // in the proposal the DM reads, rather than in a skipped list they see only
  // after the run. prechecks.ignored is Array OR null and null means the
  // question could not be answered, which is not the same as nothing being
  // ignored: on null the operations are left alone and applyPlan's own refusal
  // is what stops the run.
  const prechecks = runPrechecks({ operations, projectRoot });
  if (Array.isArray(prechecks.ignored) && prechecks.ignored.length > 0) {
    const ignored = new Set(prechecks.ignored.map(toPosix));
    for (let i = operations.length - 1; i >= 0; i--) {
      const source = toPosix(operations[i].from);
      if (!source || !ignored.has(source)) continue;
      declined.push({
        op: operations[i].op,
        target: source,
        reason:
          "This path is git-ignored, so it is not in the snapshot and moving it could not be undone. Un-ignore it in .gitignore and commit, which puts it in the snapshot, then re-run /migrate with the same scope.",
      });
      operations.splice(i, 1);
    }
  }

  return { operations, declined, prechecks: runPrechecks({ operations, projectRoot }) };
```

Replace the existing single-line return with the block above, so the prechecks that ship with the plan are computed against the operations that survived the pass rather than the ones that did not.

- [ ] **Step 7: Run both suites**

Run: `node professor-orb/workflows/migrate.plan.test.mjs` then `node professor-orb/workflows/migrate.apply.test.mjs`
Expected: both exit 0.

- [ ] **Step 8: Prove the ignored pass can fail**

Comment out the `operations.splice(i, 1)` line, re-run the plan suite, and confirm "the operation itself is not planned" FAILS with actual `1`. Restore it.

- [ ] **Step 9: Commit**

```bash
git add professor-orb/workflows/migrate.mjs professor-orb/workflows/migrate.plan.test.mjs professor-orb/workflows/migrate.apply.test.mjs
git commit -m "feat(professor-orb): update stale prose path references, and surface ignored sources

The last two of setup's five deferrals. The consumer's CLAUDE.md, its
conventions document, and the DM's separate wiki-website project all name paths
that went stale the moment the prongs moved, and none of them is a knowledge
base article the migration would otherwise touch.

Replacements are literal strings applied in the order the plan gives, and the
planner sorts them longest source first: rolara-kb/ is a prefix of
rolara-kb/sessions/, so applying the short one first turns the long one into a
path the second replacement can no longer match. Sorting in the planner rather
than the executor means the proposal the DM reads shows the order that will
actually run, and a hand-edited proposal that reorders them gets what it asked
for. A file with no match applies with a count of zero rather than failing, so
re-running an approved proposal after a hand fix stays harmless.

Ignored sources now reach the DM as declined items in the plan instead of as a
skipped list after the run, each carrying the one action that makes the file
movable: un-ignore it and commit, which puts it in the snapshot.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase 2: the proposal file, the conventions updater, and the command

### Task 8: `renderProposal` and `parseProposal`

The plan is a written artifact, not a chat dump, following the proposal-file convention `CONTEXT.md` already establishes for `chronicler`. The DM may edit the file directly, and `/migrate` executes exactly what the approved file says rather than re-deriving intent from the discussion. That property is mechanical, so it gets a mechanical test rather than a sentence of prose telling the implementer to be careful.

**Files:**
- Modify: `professor-orb/workflows/migrate.mjs`
- Create: `professor-orb/workflows/migrate.proposal.test.mjs`

**Interfaces:**
- Produces: `renderProposal({scope, plan, projectRoot, settings})` returning a markdown string with a human-readable summary and a fenced `json` block tagged `professor-orb:plan` carrying `{operations, declined}`.
- Produces: `parseProposal(text)` returning `{ok: true, plan: {operations, declined}}` or `{ok: false, reason}`.
- Consumes: the `{operations, declined, prechecks}` shape `buildScopedPlan` returns.

- [ ] **Step 1: Write the failing test suite**

Create `professor-orb/workflows/migrate.proposal.test.mjs`:

```js
#!/usr/bin/env node
// Regression suite for the /migrate proposal file: rendering, parsing, and the
// property that matters most, which is that execution follows the FILE.
//
// No repository and no fixture project: these are pure text and object
// transforms, and the two repository-backed suites would bury them under
// machinery they do not need.
//
// Run: node professor-orb/workflows/migrate.proposal.test.mjs

import { renderProposal, parseProposal } from "./migrate.mjs";

let passed = 0;
const failures = [];

function check(name, actual, expected) {
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

const PLAN = {
  operations: [
    { op: "relocate-path", from: "settings/rolara/misc/A.md", to: "settings/rolara/notes/A.md", reason: "DM scope" },
    { op: "rebuild-index", to: "settings/rolara/notes/Notes-INDEX.md", folder: "settings/rolara/notes", reason: "membership changed" },
  ],
  declined: [
    { op: "absorb-folder", target: "settings/rolara/drafts", reason: "git-ignored, so not in the snapshot" },
  ],
  prechecks: { ok: true, collisions: [], ignored: [] },
};

console.log("=== rendering ===");

{
  const text = renderProposal({
    scope: { summary: "Tidy the notes folder" },
    plan: PLAN,
    projectRoot: "C:/proj",
    settings: [{ name: "rolara" }],
  });
  check("the DM's scope summary appears", text.includes("Tidy the notes folder"), true);
  check("every operation is named by path", text.includes("settings/rolara/misc/A.md"), true);
  check("declined items appear with their reason", text.includes("git-ignored"), true);
  check("the machine-readable block is tagged", text.includes("professor-orb:plan"), true);
  // The prechecks ran while the plan was being built, so the DM reads their
  // outcome before approving rather than meeting a collision mid-run.
  check("the precheck outcome is stated", /precheck/i.test(text), true);
}

console.log("\n=== round trip ===");

{
  const text = renderProposal({ scope: {}, plan: PLAN, projectRoot: "C:/proj", settings: [] });
  const parsed = parseProposal(text);
  check("a rendered proposal parses", parsed.ok, true);
  check("the operations survive the round trip verbatim", parsed.plan.operations, PLAN.operations);
  check("the declined list survives too", parsed.plan.declined, PLAN.declined);
}

console.log("\n=== the DM edited the file ===");

{
  // THE PLAN-FIDELITY PROPERTY. The DM struck the rebuild and changed a
  // destination. Execution has to follow the file, not the conversation that
  // produced it, or "you may edit this file" is a lie.
  const text = renderProposal({ scope: {}, plan: PLAN, projectRoot: "C:/proj", settings: [] });
  const edited = text
    .replace('"to": "settings/rolara/notes/A.md"', '"to": "settings/rolara/archive/A.md"')
    .replace(/\{[^{}]*"op": "rebuild-index"[\s\S]*?\},?\n/, "");
  const parsed = parseProposal(edited);
  check("the edited file parses", parsed.ok, true);
  check("the edited destination is what comes back",
    parsed.plan.operations[0].to, "settings/rolara/archive/A.md");
  check("the struck operation is gone", parsed.plan.operations.length, 1);
}

console.log("\n=== refusals ===");

{
  check("a file with no plan block refuses",
    parseProposal("# A proposal\n\nJust prose.\n").ok, false);
  const broken = parseProposal("```json professor-orb:plan\n{ not json\n```\n");
  check("a malformed plan block refuses rather than guessing", broken.ok, false);
  check("and says the block is unreadable", /parse|json/i.test(broken.reason), true);
  check("a plan block with no operations array refuses",
    parseProposal('```json professor-orb:plan\n{"declined": []}\n```\n').ok, false);
  // Two blocks means two answers to "what did the DM approve". Refusing is the
  // only safe reading: picking one silently executes something they may have
  // struck by pasting a replacement above the original.
  const two =
    '```json professor-orb:plan\n{"operations": []}\n```\n\n```json professor-orb:plan\n{"operations": []}\n```\n';
  check("two plan blocks refuse", parseProposal(two).ok, false);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node professor-orb/workflows/migrate.proposal.test.mjs`
Expected: FAIL at import, neither function is exported yet.

- [ ] **Step 3: Implement both functions**

Add a new section to `migrate.mjs`, between the plan half and the apply half:

```js
// ---------------------------------------------------------------------------
// The proposal file
// ---------------------------------------------------------------------------
//
// /migrate's plan is a written artifact the DM reads, may edit, and approves,
// following the proposal-file convention CONTEXT.md establishes for chronicler.
// It is one file serving two readers: prose and tables for the DM, and one
// fenced block carrying the operations for the executor.
//
// Execution follows the FILE. The DM may strike an operation, change a
// destination, or reorder the list, and what runs is what the file says, never
// what the conversation that produced it said. applyPlan re-runs the prechecks
// against whatever arrives for exactly this reason, so a hand-edited plan is a
// designed path rather than a tolerated one.

const PLAN_FENCE_OPEN = "```json professor-orb:plan";
const PLAN_FENCE_CLOSE = "```";

export function renderProposal({ scope, plan, projectRoot, settings }) {
  const operations = list(plan && plan.operations);
  const declined = list(plan && plan.declined);
  const prechecks = (plan && plan.prechecks) || {};
  const summary = (scope && scope.summary) || "(no summary recorded)";

  const counts = new Map();
  for (const op of operations) counts.set(op.op, (counts.get(op.op) || 0) + 1);

  const lines = [];
  lines.push("# /migrate proposal");
  lines.push("");
  lines.push(`**Project:** ${projectRoot || "(unknown)"}`);
  lines.push(`**Settings:** ${list(settings).map((s) => (s && s.name) || "(unnamed)").join(", ") || "(none)"}`);
  lines.push("");
  lines.push("## Scope, as understood");
  lines.push("");
  lines.push(summary);
  lines.push("");
  lines.push("## What will happen");
  lines.push("");
  if (operations.length === 0) {
    lines.push("Nothing. No operation resolved from this scope.");
  } else {
    for (const [kind, n] of counts) lines.push(`- ${kind}: ${n}`);
    lines.push("");
    lines.push("| # | Operation | From | To | Why |");
    lines.push("| --- | --- | --- | --- | --- |");
    operations.forEach((op, i) => {
      lines.push(
        `| ${i + 1} | ${op.op} | ${op.from || ""} | ${op.to || ""} | ${String(op.reason || "").replace(/\|/g, "/")} |`
      );
    });
  }
  lines.push("");
  lines.push("## Declined");
  lines.push("");
  if (declined.length === 0) {
    lines.push("Nothing was declined.");
  } else {
    for (const d of declined) lines.push(`- **${d.target}** (${d.op}): ${d.reason}`);
  }
  lines.push("");
  lines.push("## Prechecks");
  lines.push("");
  lines.push(
    prechecks.ok === false
      ? "**These prechecks did not pass, so this plan cannot execute as written.** Resolve the items above and re-run /migrate."
      : "Prechecks passed. Destination collisions, unresolvable link targets, and ignored sources were all checked while this plan was built, not after approval."
  );
  lines.push("");
  lines.push("## Approval");
  lines.push("");
  lines.push(
    "Edit this file freely: strike an operation, change a destination, reorder the list. What runs is what this file says. Then tell /migrate to proceed."
  );
  lines.push("");
  lines.push(PLAN_FENCE_OPEN);
  lines.push(JSON.stringify({ operations, declined }, null, 2));
  lines.push(PLAN_FENCE_CLOSE);
  lines.push("");
  return lines.join("\n");
}

export function parseProposal(text) {
  const src = String(text == null ? "" : text);
  const starts = [];
  let at = src.indexOf(PLAN_FENCE_OPEN);
  while (at !== -1) {
    starts.push(at);
    at = src.indexOf(PLAN_FENCE_OPEN, at + PLAN_FENCE_OPEN.length);
  }
  if (starts.length === 0) {
    return { ok: false, reason: "No professor-orb:plan block in this file, so there is nothing to execute." };
  }
  if (starts.length > 1) {
    // Two blocks are two answers to "what did the DM approve". Picking one
    // silently executes something they may have struck by pasting a replacement
    // above the original.
    return {
      ok: false,
      reason: `${starts.length} professor-orb:plan blocks in this file. Leave exactly one; which of them is the approved plan is not something to guess at.`,
    };
  }

  const bodyStart = starts[0] + PLAN_FENCE_OPEN.length;
  const end = src.indexOf(`\n${PLAN_FENCE_CLOSE}`, bodyStart);
  if (end === -1) {
    return { ok: false, reason: "The professor-orb:plan block is never closed." };
  }

  let parsed;
  try {
    parsed = JSON.parse(src.slice(bodyStart, end));
  } catch (err) {
    return { ok: false, reason: `Could not parse the professor-orb:plan block as JSON: ${firstLine(err.message)}` };
  }
  if (!parsed || !Array.isArray(parsed.operations)) {
    return { ok: false, reason: "The professor-orb:plan block carries no operations array." };
  }
  return { ok: true, plan: { operations: parsed.operations, declined: list(parsed.declined) } };
}
```

- [ ] **Step 4: Run the suite**

Run: `node professor-orb/workflows/migrate.proposal.test.mjs`
Expected: `18 passed, 0 failed`.

- [ ] **Step 5: Prove the fidelity case can fail**

Change `parseProposal` to ignore its argument and return a frozen copy of the original plan, re-run, and confirm "the edited destination is what comes back" and "the struck operation is gone" both FAIL. Restore it. A plan-fidelity test that passes against an implementation that ignores the file proves nothing.

- [ ] **Step 6: Confirm the suite is in the standing set**

`node professor-orb/workflows/migrate.proposal.test.mjs` is already listed in this plan's Global Constraints and in Task 18's release checks. From here on it runs before every commit alongside the other two migrate suites.

- [ ] **Step 7: Commit**

```bash
git add professor-orb/workflows/migrate.mjs professor-orb/workflows/migrate.proposal.test.mjs docs/superpowers/plans/2026-07-29-professor-orb-1.7.0.md
git commit -m "feat(professor-orb): render and parse the /migrate proposal file

One file serving two readers: prose and a per-operation table for the DM, and a
single fenced professor-orb:plan block carrying the operations for the
executor. It follows the proposal-file convention CONTEXT.md already
establishes for chronicler.

Execution follows the file. The DM may strike an operation, change a
destination, or reorder the list, and a test asserts that a hand-edited
proposal is what comes back rather than the plan that was rendered. applyPlan
already re-runs the prechecks against whatever arrives, which is what makes the
hand-edited path designed rather than tolerated.

Three shapes refuse rather than guess: no plan block, a malformed one, and two
of them. The last is the interesting one. Two blocks are two answers to what
the DM approved, and picking one silently executes something they may have
struck by pasting a replacement above the original.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: `conventionsAfterScope`

Run order step 8 restores `conventions.json` from the aside, "updated if the scope changed anything it records". Three things a scope can change are recorded in that file: the type values in use, the prong roots, and the campaign list. Getting this wrong is quiet and expensive: a `conventions.json` whose `kbRoot` no longer exists makes `/scribe` refuse, the hook silent, and the sweep report every article as unattributed.

**Files:**
- Modify: `professor-orb/workflows/migrate.mjs`
- Modify: `professor-orb/workflows/migrate.proposal.test.mjs`

**Interfaces:**
- Produces: `conventionsAfterScope(conventions, scope)` returning `{conventions, changes: [<one sentence each>]}`. Never mutates its argument.
- Consumes: `retypeExtensions(scope)` from Task 6.
- Tasks 12 through 15 each add one case to this function and its test block.

- [ ] **Step 1: Write the failing tests**

Append to `professor-orb/workflows/migrate.proposal.test.mjs`, before the final report block, and add `conventionsAfterScope` to the import list:

```js
console.log("\n=== conventions after a scope ===");

const CONVENTIONS = {
  schemaVersion: 1,
  settings: [
    {
      name: "rolara",
      kbRoot: "settings/rolara",
      homebrewRoot: "homebrew/rolara",
      sessionReportsRoot: "session-reports/rolara",
      campaigns: ["karsk"],
      tagRegistryPath: ".professor-orb/tag-registry.rolara.json",
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
  const r = conventionsAfterScope(CONVENTIONS, {
    retypes: [{ files: ["a.md"], typeFrom: "Person", typeTo: "Character" }],
  });
  // frontmatterTypeEnum blocks. Retyping articles to a value the enum does not
  // carry would make every one of them fail the write-time hook on the next
  // edit, on output professor-orb's own migration produced.
  check("a retype extends the type enum",
    r.conventions.settings[0].rules.frontmatterTypeEnum.extendedBy, ["Character"]);
  check("the base values are untouched",
    r.conventions.settings[0].rules.frontmatterTypeEnum.params.values, ["Person", "Location"]);
  check("the change is reported in words", r.changes.length, 1);
  check("the input object is not mutated",
    CONVENTIONS.settings[0].rules.frontmatterTypeEnum.extendedBy, undefined);
}

{
  const withExisting = JSON.parse(JSON.stringify(CONVENTIONS));
  withExisting.settings[0].rules.frontmatterTypeEnum.extendedBy = ["Settlement"];
  const r = conventionsAfterScope(withExisting, {
    retypes: [
      { files: ["a.md"], typeFrom: "Person", typeTo: "Settlement" },
      { files: ["b.md"], typeFrom: "Person", typeTo: "Character" },
    ],
  });
  check("an existing extension is not duplicated",
    r.conventions.settings[0].rules.frontmatterTypeEnum.extendedBy, ["Settlement", "Character"]);
}

{
  const r = conventionsAfterScope(CONVENTIONS, {});
  check("an empty scope changes nothing", r.changes, []);
  check("and returns the file as it was", r.conventions, CONVENTIONS);
}

{
  const r = conventionsAfterScope(CONVENTIONS, {
    retypes: [{ files: ["a.md"], typeFrom: "Person", typeTo: "Location" }],
  });
  // Already a base value. Adding it to extendedBy would be noise in a file the
  // DM reads, and would imply the project contributed something it did not.
  check("a value already in the base enum is not added as an extension",
    r.conventions.settings[0].rules.frontmatterTypeEnum.extendedBy, undefined);
  check("and nothing is reported as changed", r.changes, []);
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `node professor-orb/workflows/migrate.proposal.test.mjs`
Expected: FAIL at import on `conventionsAfterScope`.

- [ ] **Step 3: Implement it**

Add to `migrate.mjs`, in the proposal section:

```js
// The conventions file as it should stand AFTER a scope has been applied.
//
// Three things a scope can change are recorded in conventions.json: the type
// values in use, the prong roots, and the campaign list. Leaving any of them
// stale is quiet and expensive. A kbRoot that no longer exists makes /scribe
// refuse to resolve its lane, leaves the write-time hook silent because no rule
// resolves, and makes the sweep report every article as unattributed. None of
// those announces itself as a conventions problem.
//
// Pure: the argument is never mutated, because the caller holds the file it
// moved aside and must be able to fall back to it unchanged if this returns
// something it does not like.
export function conventionsAfterScope(conventions, scope) {
  const changes = [];
  const next = JSON.parse(JSON.stringify(conventions || {}));
  const s = scope || {};

  // Retypes extend the type enum. frontmatterTypeEnum ships at enforcement
  // block, so an article retyped to a value the enum does not carry fails the
  // write-time hook on its next edit, on output the migration itself produced.
  const introduced = retypeExtensions(s);
  if (introduced.length > 0) {
    for (const setting of list(next.settings)) {
      const rule = setting && setting.rules && setting.rules.frontmatterTypeEnum;
      if (!rule) continue;
      const base = list(rule.params && rule.params.values).map(String);
      const existing = list(rule.extendedBy).map(String);
      const added = [];
      for (const value of introduced) {
        // A base value needs no extension. Adding it would be noise in a file
        // the DM reads and would imply the project contributed something it did
        // not.
        if (base.includes(value) || existing.includes(value)) continue;
        existing.push(value);
        added.push(value);
      }
      if (added.length === 0) continue;
      rule.extendedBy = existing;
      changes.push(
        `Extended ${setting.name || "(unnamed setting)"}'s type enum with ${added.join(", ")}, so the retyped articles do not start failing the write-time hook.`
      );
    }
  }

  // Tasks 12 through 15 add the setting-lifecycle cases here: a rename updates
  // settings[].name and all three prong roots, a retirement marks the entry
  // rather than deleting it, a campaign retirement updates campaigns, and a
  // split or merge adds or removes a settings entry.

  return { conventions: next, changes };
}
```

- [ ] **Step 4: Run the suite**

Run: `node professor-orb/workflows/migrate.proposal.test.mjs`
Expected: `27 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add professor-orb/workflows/migrate.mjs professor-orb/workflows/migrate.proposal.test.mjs
git commit -m "feat(professor-orb): update conventions.json to match what a scope changed

Run order step 8 restores the conventions file the run moved aside, updated if
the scope changed anything it records. This is the updater, and it is pure: the
caller holds the file it set aside and has to be able to fall back to it
unchanged.

A retype extends the type enum. frontmatterTypeEnum ships at enforcement block,
so articles retyped to a value the enum does not carry would fail the
write-time hook on their next edit, on output the migration itself produced. A
value already in the base enum is not added as an extension: that would be
noise in a file the DM reads and would imply the project contributed something
it did not.

Leaving any of this stale is quiet and expensive in a way that does not
announce itself. A kbRoot that no longer exists makes /scribe refuse its lane,
leaves the hook silent because no rule resolves, and makes the sweep report
every article as unattributed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: `commands/migrate.md`, the front half

**Files:**
- Create: `professor-orb/commands/migrate.md`

**Interfaces:**
- Produces: the command file's frontmatter, its framing, and Steps 1 through 4. Task 11 appends Steps 5 through 10 and the closing sections to the same file.
- Consumes: `buildScopedPlan`, `renderProposal`, `parseProposal` from Tasks 1 through 8.

- [ ] **Step 1: Write the frontmatter and framing**

Create `professor-orb/commands/migrate.md`. Keep the `description` under 1500 characters; the draft below is roughly 1290, in line with `/log` at 1283.

```markdown
---
description: "Restructure a knowledge base to a scope the DM states, or to one of the two places professor-orb already records outstanding structural work: setup's deferred items and the validation sweep's needs-judgment findings. Resolves the scope into a concrete plan, writes it to .professor-orb/proposals/ as a file the DM may edit, and executes exactly what the approved file says. Every run requires a clean tree, takes its own snapshot commit, moves conventions.json aside so the write-time hook stays silent through the run, asserts that every wikilink resolving before still resolves after, and lands as one commit whose undo is one git revert. Performs structural operations only: it moves, renames, merges, splits, absorbs, rebuilds indexes, retypes, and repairs frontmatter, and never rewrites body prose, which is chronicler's work. Not a lane command: it restructures across prongs by nature and commits its own work rather than deferring to /scribe, /log, or /catalog. Use for a folder cleanup, an entity rename, a threshold split, an index rebuild, or a setting or campaign lifecycle change."
argument-hint: "[optional: what to migrate, in your own words]"
---

# /migrate: DM-scoped structural change

> **Before you begin:** read `../skills/SHARED-PRINCIPLES.md` (relative to this plugin) and apply its rules throughout this workflow.

You are restructuring the DM's knowledge base to a scope they state. Setup's initial migration applies professor-orb's own schema, which is known and derivable, so its plan is not news to anyone. This command's target is DM intent, which is not derivable, so the resolved plan is the only place a misreading becomes visible before it costs anything. That is why this one proposes and setup does not.

This command is **standalone**. It is not part of the debrief, prep, content, chronicler, kb-validator session pipeline and never writes `.professor-orb/pipeline-state.json`.

## What this command is not

- **Not a second executor.** It drives `workflows/migrate.mjs`, the same module setup's migration runs. The snapshot discipline, the git-ignored skip, the per-operation accounting, and the link-integrity assertion are all that module's and are not reimplemented here.
- **Not a content tool.** It performs structural operations. Renaming a faction updates the filename, the frontmatter `name`, and every wikilink to it; it does not rewrite the sentences that mention the faction. Prose changes are `chronicler`'s job.
- **Not a lane command.** `/scribe`, `/log`, and `/catalog` each commit one prong and never cross. `/migrate` restructures across prongs by nature, so it commits its own work in one commit. This is the one exception to the lane rule, and it is stated here so it does not read as a violation of it.
- **Not an index author.** Rebuilding an index regenerates its link list from the articles actually in its folder. The DM's frontmatter and any prose in that index are preserved.
```

- [ ] **Step 2: Write Step 1, the three sources of work**

Append to `professor-orb/commands/migrate.md`:

```markdown
## Step 1: Offer the work that already exists

Invoked with no argument, do **not** ask "what would you like to migrate?" Two components already record outstanding structural work, and both currently produce output nothing consumes. Read them and offer what they hold, alongside the option of a scope the DM states themselves.

**Source 1: setup's deferred items.** Setup's after-action report names them: absorb candidates, split proposals, `-TIMELINE` and `-HISTORY` files, git-ignored files inside a prong, prose path references, and anything the prong-mapping confirmation excluded. **Re-derive these from the current tree rather than trusting the report**, which may be months old and may name work the DM has since done by hand.

**Source 2: the validation sweep's needs-judgment findings**, if a sweep has run in this project. Each carries a `question` field, which is exactly the input scope negotiation needs. Ownership conflicts, ambiguous types, and multi-index folders all land there. If no sweep has run, say so in one line and do not run one unasked: a sweep is a long operation and the DM did not ask for it.

**Source 3: a scope the DM states**, in their own words.

Present the first two as a structured pick-one-or-several menu with AskUserQuestion, with counts, plus an option for stating something else. If neither source holds anything and the DM gave no argument, say the knowledge base has no outstanding structural work recorded and ask what they had in mind.

## Step 2: Resolve the scope

The scope arrives as free text: "clean up items/", "rename the Ashfall Compact to the Cinder Pact everywhere", "split my continent article into one per region", "retire the Karsk campaign", "start a second setting".

Resolution is a conversation, not a parse. **Restate the scope as you understood it, name what it would touch, and ask about anything genuinely ambiguous.** Do not interrogate: one clarifying exchange, then a plan.

**State the prose boundary whenever the scope crosses it.** "Rename X to Y everywhere" naturally reads as including body text, and it does not include it. Say which half they are getting, in one sentence, and name `chronicler` as what handles the other half. Do this when the scope crosses the line, not on every run.

**Creating a setting is out of scope.** If the DM asks to start a second world, say that `/migrate` performs lifecycle operations on settings that exist (rename, retire, split, merge) and that creating one is not built yet. Do not improvise a creation path: a half-created setting with no conventions entry is worse than none.

**Refuse a scope that resolves to nothing** with a plain sentence. No snapshot, no commit, no proposal file.

## Step 3: Require a clean tree

Run `git status --porcelain`. If anything is uncommitted, **stop**. Report what is outstanding, and offer to commit it first through whichever lane command owns it (`/scribe`, `/log`, `/catalog`) or as the DM prefers. `/migrate` will not fold unrelated changes into its snapshot: the snapshot is the DM's only undo, and a snapshot containing their unrelated work in progress cannot be reverted without taking that work with it.

If the project has no version control (`.professor-orb/versioning.json` mode is `changelog`, or no marker exists at all), see Step 9's no-git branch before going any further. There is no snapshot and no undo on that path, and the DM has to know that before they approve a plan, not after.

## Step 4: Build the plan, run the prechecks, write the proposal

Build the scope into the structure `buildScopedPlan` takes, then call it through the workflow:

- `pathMoves`, `absorbFolders`, `splitFolders`, `entityRenames`, `retypes`, `frontmatterRepairs`, `suffixRenames`, `prosePathUpdates`, and the setting-lifecycle keys.
- Every article, every destination, and every referring file is named explicitly. The proposal the DM reads is the list of files that will actually move, not a description of a rule that will be applied to files they cannot see.

**The prechecks run while the plan is being built, before the DM ever sees it.** A plan that cannot execute is worse than no plan. Destination collisions, unresolvable link targets, git-ignored sources, and case-only renames on a case-insensitive filesystem are all detected here and appear in the proposal as declined items rather than surfacing as failures mid-run.

Write the proposal with `renderProposal` to `.professor-orb/proposals/migrate-<short-slug>.md`, following the same proposal-file convention `chronicler` uses. Give the DM a summary and a pointer to the file in chat; do not paste the whole plan into the conversation.

**Then wait.** The DM may approve, or edit the file and then approve. Say plainly that editing it is expected and that what runs is what the file says.
```

- [ ] **Step 3: Check the description length**

Run:
```bash
node -e "const l=require('fs').readFileSync('professor-orb/commands/migrate.md','utf8').split(/\r?\n/).find(x=>x.startsWith('description:'));console.log(l.length)"
```
Expected: a number under 1500. If it is over, cut sentences from the middle of the description, never the first sentence (which is what the DM sees in a command list) and never the lane-exception sentence.

- [ ] **Step 4: Check for em dashes**

Run: `grep -c '—' professor-orb/commands/migrate.md`
Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git add professor-orb/commands/migrate.md
git commit -m "feat(professor-orb): add /migrate, scope resolution and the proposal

The front half of the command: what it is, what it is not, and Steps 1 through
4. Invoked bare it does not ask what the DM would like to migrate. It reads the
two places the plugin already records outstanding structural work, setup's
deferred items and the sweep's needs-judgment findings, and offers them. Both
of those have produced output nothing consumed since they were written.

Setup's deferred items are re-derived from the current tree rather than read
out of a report that may be months old and may name work the DM has since done
by hand.

The prose boundary is stated to the DM whenever a scope crosses it. Rename X to
Y everywhere reads as including body text and does not include it, and which
half they are getting is not something to discover afterward.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: `commands/migrate.md`, the run order and the report

**Files:**
- Modify: `professor-orb/commands/migrate.md` (append)

**Interfaces:**
- Consumes: `parseProposal` and `conventionsAfterScope` from Tasks 8 and 9, and `applyPlan`'s result shape (`ok`, `refused`, `applied`, `failed`, `dropped`, `skipped`, `ignoredEdits`, `ignoredMoved`, `linkIntegrity`, `messages`).

- [ ] **Step 1: Write Steps 5 through 10**

Append to `professor-orb/commands/migrate.md`:

```markdown
## Step 5: Take the snapshot

Re-read the proposal file from disk. **Execute what the file says, never what the conversation said.** Parse it with `parseProposal`. If it refuses (no plan block, a malformed one, or two of them), report the reason and stop; do not reconstruct a plan from the discussion to work around it.

Then commit the snapshot:

```
git commit --allow-empty -qm "chore: pre-migration snapshot before /migrate"
```

Verify the tree is clean afterward and **print the hash**. This hash is the DM's undo, and it appears again in Step 10's report. Every later step refers to this hash, never to whatever the executor reports as its own `snapshot` field.

## Step 6: Move `conventions.json` aside

Move `.professor-orb/conventions.json` to `.professor-orb/conventions.json.pre-migration` for the duration of the run, exactly as setup's Step 6 does and for the same reason: the write-time hook fires on every write, and a run touching hundreds of files would otherwise storm the DM with violations for a structure that is mid-move and correct at neither end.

## Step 7: Execute

Run `workflows/migrate.mjs` in apply mode with the parsed plan and `"commit": false`, because Step 10 makes the single commit.

**What the executor guarantees, and what you carry into the report rather than restate as your own:** every relocation goes through `git mv`; an operation whose source is git-ignored is skipped and reported rather than moved, because the snapshot does not contain it; per-operation `applied` true or false accounting means a dropped worker is never counted as done; and it reports `ignoredEdits` and `ignoredMoved`, the edits and moves the snapshot cannot undo.

If `result.refused` is set, the run touched nothing. Report the refusal's `detail` verbatim and stop. A hand-edited proposal reaches this point without ever passing through the planner, so a refusal here is the expected way an inconsistent edit surfaces, not a bug.

## Step 8: Restore `conventions.json`, updated

Call `conventionsAfterScope` with the file you moved aside and the scope. Write the result back to `.professor-orb/conventions.json` and delete the aside. Report every entry in its `changes` array to the DM in Step 10: a silently updated conventions file is exactly the kind of change that is discovered three sessions later.

If the run failed at Step 7 or fails at Step 9, **restore the aside unchanged** rather than the updated version. The conventions file describes a structure that no longer happened.

## Step 9: Assert link integrity

Every wikilink that resolved before the run must resolve after it. This must pass **before** the commit.

Read `linkIntegrity.coverage` before writing anything; it distinguishes two outcomes that need two different reports.

- **`coverage: "ok"` with a non-empty `dead` array.** Report the dead links with their containing files, exactly as the executor returned them. Do not commit.
- **`coverage: "no-links-checked"` with `dead` empty.** The run rewrote at least one wikilink, so this knowledge base demonstrably has them, and the assertion then walked the roots in `linkIntegrity.roots` and found none. Saying "no dead links were found" here would invert what happened. Report `linkIntegrity.roots` and `filesChecked` verbatim, set them against each setting's prong roots, and name the mismatch. Do not re-run unchanged; nothing about a second run moves those roots.

In both cases point at Step 5's snapshot hash and stop without committing.

## Step 10: Commit and report

One commit carries the whole run, including the conventions update:

```
git add -A
git commit -qm "migrate: <one line naming the scope>"
```

`git add -A` is correct here and is the one place in this plugin where it is. The lane commands use narrow literal pathspecs because each owns one prong; `/migrate` restructures across prongs by nature, Step 3 guaranteed the tree held nothing else, and Step 5's snapshot is the boundary of what this commit can contain.

Then report:

```
## /migrate Report

### Scope
[the scope as understood, one or two sentences]
**Proposal:** [path to the proposal file]

### Applied
Files moved: N. Renamed: N. Created: N. Merged: N. Absorbed: N. Deleted: N.
Indexes rebuilt: N. Wikilinks rewritten: N.

### Edited
Files whose contents were edited: N, broken down by the operation that edited
each one (type normalization, link rewriting, index merging, index rebuilding,
frontmatter repair, prose path updates).
[Any edit the executor reported as outside the snapshot, which restoring will not undo.]

### Declined
[Every declined item with its reason, including anything the DM struck from the
proposal by hand.]

### Failed
[operation and error, or "None"]

### Conventions
[Every entry from conventionsAfterScope's changes array, or "Unchanged".]

### Git
**Snapshot:** [Step 5's hash]
**Migration:** [Step 10's commit hash]
**Undo:** git -C [project] revert [Step 10's commit hash]

### Next
Re-run the validation sweep to confirm the knowledge base is clean after a
structural change.
```

**Undo is `git revert` of the migration commit, not a reset to the snapshot.** The snapshot is one commit behind, so a reset discards it too, and reverting keeps the history readable. Say the command, do not run it.
```

- [ ] **Step 2: Write the closing sections**

Append:

```markdown
## Things to never do

- **Never execute anything the approved proposal file does not carry.** Not an operation from the conversation, not a repaired guess at an inconsistent edit, not an obviously beneficial extra.
- **Never rewrite body prose.** Filenames, frontmatter fields, and wikilinks only. Prose is `chronicler`'s.
- **Never run without a clean tree** and never fold the DM's unrelated work into the snapshot.
- **Never commit when the link-integrity assertion failed.**
- **Never use the executor's own `snapshot` field or its printed restore line** in the report. Step 5's hash is the one the DM needs.
- **Never delete a setting's entry from `conventions.json`.** Retiring marks it; deleting destroys the record of a world that existed.
- **Never create a setting.** Lifecycle operations act on settings that exist.
- **Never auto-resume an interrupted run.** The per-item accounting makes a partial application diagnosable and the snapshot is the undo; resuming would apply operations against a tree that no longer matches the plan.
- **Never write `.professor-orb/pipeline-state.json`.** This command is outside the session pipeline.
- **Never push.** `/migrate` commits; pushing is the DM's call through a lane command or by hand.

## Edge cases

- **Scope resolves to nothing.** Say so. No snapshot, no commit, no proposal.
- **Scope resolves to something enormous** (a rename touching 800 files). Execute it, but state the count in the proposal before approval. "Rename X everywhere" does not feel like 800 files until it is.
- **No git.** `versioning.json` mode is `changelog`, so there is no snapshot and no undo. State that plainly and require an explicit second confirmation naming the absence of an undo, the same posture setup takes. If the DM declines, stop; do not offer to initialize a repository here, which is setup's job.
- **A plan the DM edited into something inconsistent.** `applyPlan` re-runs the prechecks against what actually arrives and refuses. Report why it cannot execute and stop. Never a repaired guess.
- **Interrupted run.** The report names what applied and what did not, and the snapshot hash is the undo. Do not auto-resume.
- **Scope crossing settings.** Supported, and treated as a link-boundary operation: outgoing wikilinks from a moved article are enumerated in the proposal, because they will not resolve on the far side.
- **A file the DM struck from the proposal.** It is not applied and it appears under Declined, so the report and the file agree.
- **The proposal file is gone when the DM approves.** Do not regenerate it silently. Say it is missing and rebuild it from the same scope, then ask for approval again.

## How this command connects to the others

- **Fed by `setup`**, whose after-action report names the deferred items this command re-derives and offers.
- **Fed by the validation sweep**, whose `needsJudgment` findings become candidate scopes. That bucket had no consumer before this command.
- **Shares `workflows/migrate.mjs`** with setup. Setup supplies a schema-derived plan and no gate; `/migrate` supplies a scope-derived plan and a gate.
- **Hands back to the sweep.** The report recommends re-running it, which is the natural verification after a structural change.
- **Not a lane command**, and the only component that commits across prongs. `/scribe`, `/log`, and `/catalog` keep their one-prong guarantee.
```

- [ ] **Step 3: Verify the file**

Run: `grep -c '—' professor-orb/commands/migrate.md`
Expected: `0`.

Run: `grep -n "git add -A" professor-orb/commands/migrate.md`
Expected: exactly one hit, in Step 10, with the paragraph justifying it directly beneath.

Run: `grep -rn "reset --hard" professor-orb/commands/migrate.md`
Expected: no hits. Undo on this command is a revert.

- [ ] **Step 4: Commit**

```bash
git add professor-orb/commands/migrate.md
git commit -m "feat(professor-orb): give /migrate its run order and report

Steps 5 through 10, the never-do list, and the edge cases. The run re-reads the
proposal from disk and executes what the file says, so a DM who struck an
operation gets a run without it and a DM who edited one into an inconsistent
state gets applyPlan's refusal rather than a repaired guess.

Undo is a revert of the migration commit rather than a reset to the snapshot.
The snapshot is one commit behind, so a reset discards it too, and a revert
keeps the history readable.

git add -A appears once, in Step 10, with the reasoning directly beneath it:
the lane commands use narrow literal pathspecs because each owns one prong,
and this command restructures across prongs by nature, having already required
a clean tree and taken a snapshot that bounds what the commit can contain.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase 3: the setting lifecycle

The 1.6.0 layout supports N settings and nothing in the plugin manages them. These four tasks are compositions of Phase 1's primitives plus Task 9's conventions updater; none of them adds an executor.

**A note on testing this phase honestly.** Nothing creates a second setting yet, so every multi-setting case here is exercised against fixtures rather than against the reference consumer. Say so in the release notes rather than implying these paths have been used in anger. The single-setting operations (rename, retire a campaign) are the ones Rolara can actually exercise.

### Task 12: rename a setting, retire a setting, retire a campaign

**Files:**
- Modify: `professor-orb/workflows/migrate.mjs`
- Modify: `professor-orb/workflows/migrate.plan.test.mjs`
- Modify: `professor-orb/workflows/migrate.proposal.test.mjs`

**Interfaces:**
- Scope key `settingRenames: [{from: "<setting name>", to: "<new name>"}]`, planning one `relocate-prong` per prong root that exists.
- Scope key `settingRetirements: [{setting: "<name>", archiveRoot: "archive"}]`, planning one `relocate-prong` per prong root into `<archiveRoot>/<name>/`.
- Scope key `campaignRetirements: [{setting, campaign, archiveRoot}]`, planning one `relocate-path`.
- Extends: `conventionsAfterScope` with the three matching cases.

- [ ] **Step 1: Write the failing plan tests**

Append to `professor-orb/workflows/migrate.plan.test.mjs`:

```js
console.log("\n=== scoped plans: setting lifecycle ===");

const LIFECYCLE_SETTINGS = [
  {
    name: "rolara",
    kbRoot: "settings/rolara",
    homebrewRoot: "homebrew/rolara",
    sessionReportsRoot: "session-reports/rolara",
    campaigns: ["karsk", "ember"],
  },
];

const lifecycle = (scope) =>
  buildScopedPlan({ projectRoot: "C:/proj", settings: LIFECYCLE_SETTINGS, baseRules: BASE_RULES, scope });

{
  const r = lifecycle({ settingRenames: [{ from: "rolara", to: "rolara-prime" }] });
  check("a setting rename moves all three prongs",
    r.operations.map((o) => [o.from, o.to]),
    [
      ["settings/rolara", "settings/rolara-prime"],
      ["homebrew/rolara", "homebrew/rolara-prime"],
      ["session-reports/rolara", "session-reports/rolara-prime"],
    ]);
  check("each is a prong relocation, not a bare path move",
    kindsOf(r.operations), ["relocate-prong", "relocate-prong", "relocate-prong"]);
  // The Obsidian vault lives at <kbRoot>/.obsidian, inside the root that just
  // moved, so it rides along and needs no operation of its own. Asserted so a
  // future "also move the vault" addition cannot double-move it.
  check("the vault is not moved separately",
    JSON.stringify(r.operations).includes(".obsidian"), false);
}

{
  const r = lifecycle({ settingRenames: [{ from: "nope", to: "x" }] });
  check("renaming a setting that is not in conventions.json is declined",
    [r.operations.length, r.declined.length], [0, 1]);
}

{
  const r = lifecycle({ settingRetirements: [{ setting: "rolara", archiveRoot: "archive" }] });
  check("retiring a setting moves its prongs into the archive",
    r.operations.map((o) => o.to),
    ["archive/rolara/settings", "archive/rolara/homebrew", "archive/rolara/session-reports"]);
}

{
  const r = lifecycle({ campaignRetirements: [{ setting: "rolara", campaign: "karsk", archiveRoot: "archive" }] });
  check("retiring a campaign moves one folder",
    [kindsOf(r.operations), r.operations[0].from, r.operations[0].to],
    [["relocate-path"], "session-reports/rolara/karsk", "archive/rolara/session-reports/karsk"]);
}

{
  const r = lifecycle({ campaignRetirements: [{ setting: "rolara", campaign: "nope" }] });
  check("retiring a campaign the setting does not list is declined",
    [r.operations.length, r.declined.length], [0, 1]);
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `node professor-orb/workflows/migrate.plan.test.mjs`
Expected: FAIL on the first lifecycle case with actual `[]`.

- [ ] **Step 3: Implement the three planners**

Add to `migrate.mjs`, and add `["settingRenames", planSettingRenames], ["settingRetirements", planSettingRetirements], ["campaignRetirements", planCampaignRetirements],` to `SCOPED_PLANNERS`:

```js
// The three prong roots of a setting, as {kind, root} pairs, skipping any the
// conventions entry does not record.
const PRONG_FIELDS = [
  ["kb", "kbRoot", "settings"],
  ["homebrew", "homebrewRoot", "homebrew"],
  ["sessionReports", "sessionReportsRoot", "session-reports"],
];

const settingNamed = (settings, name) =>
  list(settings).find((s) => s && String(s.name) === String(name)) || null;

function planSettingRenames(items, ctx) {
  const operations = [];
  const declined = [];
  for (const item of items) {
    const from = String((item && item.from) || "");
    const to = String((item && item.to) || "");
    const setting = settingNamed(ctx.settings, from);
    if (!setting) {
      declined.push({
        op: "relocate-prong",
        target: from || "(unnamed)",
        reason: "No setting by that name in conventions.json. Renaming one that is not recorded would move folders the file still points elsewhere.",
      });
      continue;
    }
    if (!to || to === from) {
      declined.push({ op: "relocate-prong", target: from, reason: "The new name is missing or identical to the old one." });
      continue;
    }
    for (const [kind, field] of PRONG_FIELDS) {
      const root = toPosix(setting[field]);
      if (!root) continue;
      const parent = path.posix.dirname(root);
      operations.push({
        op: "relocate-prong",
        prong: kind,
        from: root,
        // The vault at <kbRoot>/.obsidian sits inside the root being moved, so
        // it travels with it. No separate operation, and none should be added:
        // a second move of a path already inside the first would fail.
        to: `${parent}/${to}`,
        reason: `Setting ${from} renamed to ${to}.`,
      });
    }
  }
  return { operations, declined };
}

function planSettingRetirements(items, ctx) {
  const operations = [];
  const declined = [];
  for (const item of items) {
    const name = String((item && item.setting) || "");
    const archiveRoot = toPosix((item && item.archiveRoot) || "archive");
    const setting = settingNamed(ctx.settings, name);
    if (!setting) {
      declined.push({ op: "relocate-prong", target: name || "(unnamed)", reason: "No setting by that name in conventions.json." });
      continue;
    }
    for (const [kind, field, folder] of PRONG_FIELDS) {
      const root = toPosix(setting[field]);
      if (!root) continue;
      operations.push({
        op: "relocate-prong",
        prong: kind,
        from: root,
        to: `${archiveRoot}/${name}/${folder}`,
        reason: `Setting ${name} retired to ${archiveRoot}/.`,
      });
    }
  }
  return { operations, declined };
}

function planCampaignRetirements(items, ctx) {
  const operations = [];
  const declined = [];
  for (const item of items) {
    const name = String((item && item.setting) || "");
    const campaign = String((item && item.campaign) || "");
    const archiveRoot = toPosix((item && item.archiveRoot) || "archive");
    const setting = settingNamed(ctx.settings, name);
    if (!setting) {
      declined.push({ op: "relocate-path", target: `${name}/${campaign}`, reason: "No setting by that name in conventions.json." });
      continue;
    }
    const campaigns = list(setting.campaigns).map((c) => (typeof c === "string" ? c : c && c.name));
    if (!campaigns.includes(campaign)) {
      declined.push({
        op: "relocate-path",
        target: `${name}/${campaign}`,
        reason: `${name} does not list a campaign called ${campaign}. Retiring a folder the conventions file does not record would leave the file describing a campaign that is no longer where it says.`,
      });
      continue;
    }
    const reports = toPosix(setting.sessionReportsRoot);
    operations.push({
      op: "relocate-path",
      from: `${reports}/${campaign}`,
      to: `${archiveRoot}/${name}/session-reports/${campaign}`,
      reason: `Campaign ${campaign} retired.`,
    });
  }
  return { operations, declined };
}
```

- [ ] **Step 4: Extend `conventionsAfterScope`**

Replace the placeholder comment in `conventionsAfterScope` with:

```js
  for (const item of list(s.settingRenames)) {
    const setting = settingNamed(next.settings, item && item.from);
    const to = String((item && item.to) || "");
    if (!setting || !to) continue;
    for (const [, field] of PRONG_FIELDS) {
      if (!setting[field]) continue;
      setting[field] = `${path.posix.dirname(toPosix(setting[field]))}/${to}`;
    }
    if (typeof setting.tagRegistryPath === "string") {
      setting.tagRegistryPath = setting.tagRegistryPath.split(setting.name).join(to);
    }
    setting.name = to;
    changes.push(`Renamed setting ${item.from} to ${to} and repointed all three prong roots.`);
  }

  for (const item of list(s.settingRetirements)) {
    const setting = settingNamed(next.settings, item && item.setting);
    if (!setting) continue;
    const archiveRoot = toPosix((item && item.archiveRoot) || "archive");
    for (const [, field, folder] of PRONG_FIELDS) {
      if (!setting[field]) continue;
      setting[field] = `${archiveRoot}/${setting.name}/${folder}`;
    }
    // MARKED, never deleted. Deleting the entry destroys the record that this
    // world existed, and every session report, article, and homebrew entry
    // under the archive would then belong to no setting at all: unattributed to
    // the sweep, unresolvable to the lane commands.
    setting.retired = true;
    changes.push(`Marked setting ${setting.name} retired and repointed its roots into ${archiveRoot}/. The entry is kept, not deleted.`);
  }

  for (const item of list(s.campaignRetirements)) {
    const setting = settingNamed(next.settings, item && item.setting);
    const campaign = String((item && item.campaign) || "");
    if (!setting || !campaign) continue;
    const before = list(setting.campaigns);
    setting.campaigns = before.filter((c) => (typeof c === "string" ? c : c && c.name) !== campaign);
    setting.retiredCampaigns = [...list(setting.retiredCampaigns), campaign];
    changes.push(`Moved campaign ${campaign} out of ${setting.name}'s campaigns and into retiredCampaigns.`);
  }
```

- [ ] **Step 5: Test the conventions cases**

Append to `professor-orb/workflows/migrate.proposal.test.mjs`:

```js
{
  const r = conventionsAfterScope(CONVENTIONS, { settingRenames: [{ from: "rolara", to: "rolara-prime" }] });
  const s = r.conventions.settings[0];
  check("a rename repoints every root and the name",
    [s.name, s.kbRoot, s.homebrewRoot, s.sessionReportsRoot],
    ["rolara-prime", "settings/rolara-prime", "homebrew/rolara-prime", "session-reports/rolara-prime"]);
  check("and the tag registry path follows the name",
    s.tagRegistryPath, ".professor-orb/tag-registry.rolara-prime.json");
}

{
  const r = conventionsAfterScope(CONVENTIONS, { settingRetirements: [{ setting: "rolara" }] });
  const s = r.conventions.settings[0];
  check("retiring marks the entry rather than deleting it",
    [r.conventions.settings.length, s.retired], [1, true]);
  check("and repoints the roots into the archive", s.kbRoot, "archive/rolara/settings");
}

{
  const r = conventionsAfterScope(CONVENTIONS, {
    campaignRetirements: [{ setting: "rolara", campaign: "karsk" }],
  });
  const s = r.conventions.settings[0];
  check("a retired campaign leaves the active list", s.campaigns, []);
  check("and is recorded rather than forgotten", s.retiredCampaigns, ["karsk"]);
}
```

- [ ] **Step 6: Run all three suites**

Run each of `migrate.plan.test.mjs`, `migrate.apply.test.mjs`, `migrate.proposal.test.mjs`.
Expected: all three exit 0.

- [ ] **Step 7: Commit**

```bash
git add professor-orb/workflows/migrate.mjs professor-orb/workflows/migrate.plan.test.mjs professor-orb/workflows/migrate.proposal.test.mjs
git commit -m "feat(professor-orb): rename, retire a setting, and retire a campaign

The 1.6.0 layout supports N settings and nothing managed them. All three
operations are compositions of relocate-prong and relocate-path plus a
conventions update; no new executor.

A rename moves all three prong roots and repoints the name, the roots, and the
tag registry path. The Obsidian vault is not moved separately: it lives inside
kbRoot and travels with it, and a test pins that so a later also-move-the-vault
addition cannot double-move a path already inside the first move.

Retiring MARKS the settings entry rather than deleting it. Deleting destroys
the record that the world existed, and every article beneath the archive would
then belong to no setting at all: unattributed to the sweep, unresolvable to
the lane commands. A retired campaign leaves the active list and is recorded in
retiredCampaigns for the same reason.

Renaming or retiring something conventions.json does not record is declined
rather than executed, because moving folders the file still points elsewhere is
how a knowledge base ends up half-described.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: split a setting

The hard one. Wikilink resolution is per setting, so an article moving to a new setting takes its incoming and outgoing links across a boundary they cannot cross. That cost is the whole operation, and it belongs in the proposal before approval rather than in the report afterward.

**Files:**
- Modify: `professor-orb/workflows/migrate.mjs`
- Modify: `professor-orb/workflows/migrate.plan.test.mjs`
- Modify: `professor-orb/workflows/migrate.proposal.test.mjs`

**Interfaces:**
- Produces: `crossBoundaryLinks({projectRoot, movingFiles, stayingRoot})` returning `[{file, target, direction}]` where `direction` is `"outgoing"` (a moving article links to one that stays) or `"incoming"` (an article that stays links to one that moves).
- Scope key `settingSplits: [{from, to, name, kbRoot, homebrewRoot, sessionReportsRoot, files: [<path>]}]`.
- Extends: `conventionsAfterScope` with a new settings entry for the created setting.

- [ ] **Step 1: Write the failing tests for the link enumeration**

Append to `professor-orb/workflows/migrate.plan.test.mjs`:

```js
console.log("\n=== setting split: the boundary cost ===");

function splitSettingFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-setsplit-"));
  const w = (rel, body) => {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  w("settings/rolara/Ashfall.md", "---\ntype: Location\n---\n\nNorth of [[Karsk]], allied with [[Thoric]].\n");
  w("settings/rolara/Karsk.md", "---\ntype: Location\n---\n\nSouth of [[Ashfall]].\n");
  w("settings/rolara/Thoric.md", "---\ntype: Person\n---\n\nLives in [[Ashfall]].\n");
  return root;
}

{
  const root = splitSettingFixture();
  const links = crossBoundaryLinks({
    projectRoot: root,
    movingFiles: ["settings/rolara/Ashfall.md"],
    stayingRoot: "settings/rolara",
  });
  const outgoing = links.filter((l) => l.direction === "outgoing").map((l) => l.target).sort();
  const incoming = links.filter((l) => l.direction === "incoming").map((l) => l.file).sort();
  check("outgoing links from the moving article are enumerated", outgoing, ["Karsk", "Thoric"]);
  check("incoming links from articles that stay are enumerated too",
    incoming, ["settings/rolara/Karsk.md", "settings/rolara/Thoric.md"]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitSettingFixture();
  const links = crossBoundaryLinks({
    projectRoot: root,
    movingFiles: ["settings/rolara/Ashfall.md", "settings/rolara/Karsk.md"],
    stayingRoot: "settings/rolara",
  });
  // Ashfall and Karsk link to each other and both move, so that link does not
  // cross anything. Counting it would inflate the cost the DM is shown and make
  // a clean split look expensive.
  check("a link between two articles that both move is not a boundary crossing",
    links.some((l) => l.target === "Karsk" || (l.file || "").endsWith("Karsk.md")), false);
  check("the genuine crossings survive",
    links.filter((l) => l.direction === "outgoing").map((l) => l.target), ["Thoric"]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitSettingFixture();
  const r = buildScopedPlan({
    projectRoot: root,
    settings: LIFECYCLE_SETTINGS,
    baseRules: BASE_RULES,
    scope: {
      settingSplits: [
        {
          from: "rolara",
          name: "ashlands",
          kbRoot: "settings/ashlands",
          files: ["settings/rolara/Ashfall.md"],
        },
      ],
    },
  });
  check("a split plans one move per file", kindsOf(r.operations), ["relocate-path"]);
  check("to the new setting's kbRoot", r.operations[0].to, "settings/ashlands/Ashfall.md");
  // The cost lands in declined, which is what renderProposal prints under
  // "Declined" and therefore what the DM reads before approving. Putting it in
  // the report instead would tell them after it had already happened.
  check("every boundary crossing is declined into the proposal",
    r.declined.filter((d) => d.op === "cross-boundary-link").length >= 3, true);
  rmSync(root, { recursive: true, force: true });
}
```

Add `crossBoundaryLinks` and `buildScopedPlan` to the suite's import list.

- [ ] **Step 2: Run to verify they fail**

Run: `node professor-orb/workflows/migrate.plan.test.mjs`
Expected: FAIL at import on `crossBoundaryLinks`.

- [ ] **Step 3: Implement the enumeration**

Add to `migrate.mjs`'s plan half:

```js
// Every wikilink that will stop resolving when movingFiles leave stayingRoot.
//
// Wikilink resolution is per setting, which is what makes this the whole cost
// of a split rather than a detail of it. Two directions, both of which break
// and each of which the DM has to see:
//
//   outgoing: a moving article links to one that stays.
//   incoming: an article that stays links to one that moves.
//
// A link between two articles that BOTH move crosses nothing and is excluded.
// Counting it would inflate the cost and make a clean split look expensive.
//
// Read-only: readdirSync, readFileSync, statSync only.
export function crossBoundaryLinks({ projectRoot, movingFiles, stayingRoot }) {
  const moving = new Set(list(movingFiles).map(toPosix));
  const movingStems = new Set([...moving].map((f) => stemOf(f).toLowerCase()));
  const out = [];

  const walk = (rel) => {
    let names;
    try {
      names = readdirSync(path.resolve(projectRoot, rel)).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const childRel = `${rel}/${name}`;
      let st;
      try {
        st = statSync(path.resolve(projectRoot, childRel));
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(childRel);
        continue;
      }
      if (!name.toLowerCase().endsWith(".md")) continue;

      let text;
      try {
        text = readFileSync(path.resolve(projectRoot, childRel), "utf8");
      } catch {
        continue;
      }
      const targets = wikilinkTargetsIn(text);
      const isMoving = moving.has(childRel);

      for (const target of targets) {
        const stem = String(target).toLowerCase();
        const targetMoves = movingStems.has(stem);
        if (isMoving && !targetMoves) {
          out.push({ file: childRel, target, direction: "outgoing" });
        } else if (!isMoving && targetMoves) {
          out.push({ file: childRel, target, direction: "incoming" });
        }
        // Both moving, or neither: nothing crosses.
      }
    }
  };

  walk(toPosix(stayingRoot));
  return out;
}
```

`wikilinkTargetsIn` already exists at `migrate.mjs:1258`; check whether it returns bare stems or dissected targets and adapt the comparison rather than reimplementing it.

- [ ] **Step 4: Implement the planner**

Add `["settingSplits", planSettingSplits],` to `SCOPED_PLANNERS` and:

```js
function planSettingSplits(items, ctx) {
  const operations = [];
  const declined = [];
  for (const item of items) {
    const from = String((item && item.from) || "");
    const source = settingNamed(ctx.settings, from);
    const name = String((item && item.name) || "");
    const kbRoot = toPosix(item && item.kbRoot);
    if (!source || !name || !kbRoot) {
      declined.push({
        op: "relocate-path",
        target: from || "(unnamed)",
        reason: "A split needs an existing source setting, a name for the new one, and its kbRoot.",
      });
      continue;
    }

    const files = list(item.files).map(toPosix).filter(Boolean);
    for (const file of files) {
      operations.push({
        op: "relocate-path",
        from: file,
        to: `${kbRoot}/${path.posix.basename(file)}`,
        reason: `Split out of ${from} into ${name}.`,
      });
    }

    // The cost, in the proposal, before approval. renderProposal prints
    // declined items, so this is what the DM reads while deciding, rather than
    // what they learn from the report once it has happened.
    for (const link of crossBoundaryLinks({
      projectRoot: ctx.projectRoot,
      movingFiles: files,
      stayingRoot: toPosix(source.kbRoot),
    })) {
      declined.push({
        op: "cross-boundary-link",
        target: `${link.file} -> [[${link.target}]]`,
        reason:
          link.direction === "outgoing"
            ? `This article is moving to ${name} and links to [[${link.target}]], which stays in ${from}. Wikilinks resolve per setting, so it will stop resolving. Nothing here fixes it; the article's text is the DM's to change if they want it changed.`
            : `This article stays in ${from} and links to [[${link.target}]], which is moving to ${name}. It will stop resolving for the same reason.`,
      });
    }
  }
  return { operations, declined };
}
```

- [ ] **Step 5: Extend `conventionsAfterScope`**

Add, before the `return`:

```js
  for (const item of list(s.settingSplits)) {
    const source = settingNamed(next.settings, item && item.from);
    const name = String((item && item.name) || "");
    if (!source || !name) continue;
    if (settingNamed(next.settings, name)) {
      changes.push(`A setting called ${name} is already recorded, so no entry was added for the split.`);
      continue;
    }
    next.settings.push({
      name,
      kbRoot: toPosix(item.kbRoot),
      homebrewRoot: toPosix(item.homebrewRoot) || `homebrew/${name}`,
      sessionReportsRoot: toPosix(item.sessionReportsRoot) || `session-reports/${name}`,
      campaigns: [],
      tagRegistryPath: `.professor-orb/tag-registry.${name}.json`,
      // The rules are the source setting's: a split divides one world's
      // material, and the extras layer that world accumulated describes the
      // articles on both sides of the division.
      rules: JSON.parse(JSON.stringify(source.rules || {})),
    });
    changes.push(`Added a settings entry for ${name}, carrying ${source.name}'s rules, with an empty campaign list.`);
  }
```

- [ ] **Step 6: Test the conventions case**

Append to `professor-orb/workflows/migrate.proposal.test.mjs`:

```js
{
  const r = conventionsAfterScope(CONVENTIONS, {
    settingSplits: [{ from: "rolara", name: "ashlands", kbRoot: "settings/ashlands", files: [] }],
  });
  check("a split adds a settings entry", r.conventions.settings.map((s) => s.name), ["rolara", "ashlands"]);
  check("the new setting gets defaulted sibling prongs",
    [r.conventions.settings[1].homebrewRoot, r.conventions.settings[1].sessionReportsRoot],
    ["homebrew/ashlands", "session-reports/ashlands"]);
  check("and carries the source setting's rules, not an empty set",
    Object.keys(r.conventions.settings[1].rules), ["frontmatterTypeEnum"]);
  check("the source setting is untouched", r.conventions.settings[0].kbRoot, "settings/rolara");
}
```

- [ ] **Step 7: Run all three suites**

Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add professor-orb/workflows/migrate.mjs professor-orb/workflows/migrate.plan.test.mjs professor-orb/workflows/migrate.proposal.test.mjs
git commit -m "feat(professor-orb): split a setting, with the boundary cost in the proposal

Wikilink resolution is per setting, so an article moving to a new setting takes
its incoming and outgoing links across a boundary they cannot cross. That cost
is the whole operation, and it lands in the plan's declined list, which
renderProposal prints, so the DM reads it while deciding rather than learning
it from the report afterward.

Both directions are enumerated, because both break: a moving article linking to
one that stays, and an article that stays linking to one that moves. A link
between two articles that both move crosses nothing and is excluded, since
counting it would inflate the cost and make a clean split look expensive.

Nothing rewrites those links. The article text is the DM's, and rewriting it
would be chronicler's work done under a structural approval.

The new settings entry carries the source setting's rules rather than an empty
set: a split divides one world's material, and the extras layer that world
accumulated describes the articles on both sides of the division.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: merge two settings

The inverse of a split, and the case where basename collisions are near certain: two worlds legitimately holding a `Tavern.md` collide the moment they share a vault. Every collision appears in the plan with a proposed rename, so the DM approves the resolution rather than discovering it.

**Files:**
- Modify: `professor-orb/workflows/migrate.mjs`
- Modify: `professor-orb/workflows/migrate.plan.test.mjs`
- Modify: `professor-orb/workflows/migrate.proposal.test.mjs`

**Interfaces:**
- Produces: `mergeCollisions({projectRoot, sourceRoot, targetRoot, suffix})` returning `[{from, basename, proposed}]`.
- Scope key `settingMerges: [{from, into}]`.
- Extends: `conventionsAfterScope`, folding the source's campaigns and `extendedBy` values into the target and marking the source merged.

- [ ] **Step 1: Write the failing plan tests**

Append to `professor-orb/workflows/migrate.plan.test.mjs`:

```js
console.log("\n=== setting merge: collisions ===");

function mergeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-setmerge-"));
  const w = (rel, body) => {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  w("settings/rolara/Tavern.md", "---\ntype: Location\n---\n\nRolara's tavern.\n");
  w("settings/rolara/Ashfall.md", "---\ntype: Location\n---\n\nBody.\n");
  w("settings/karsk/Tavern.md", "---\ntype: Location\n---\n\nKarsk's tavern.\n");
  w("settings/karsk/Emberhold.md", "---\ntype: Location\n---\n\nBody.\n");
  return root;
}

const MERGE_SETTINGS = [
  { name: "rolara", kbRoot: "settings/rolara", homebrewRoot: "homebrew/rolara", sessionReportsRoot: "session-reports/rolara", campaigns: ["ember"] },
  { name: "karsk", kbRoot: "settings/karsk", homebrewRoot: "homebrew/karsk", sessionReportsRoot: "session-reports/karsk", campaigns: ["deeps"] },
];

{
  const root = mergeFixture();
  const collisions = mergeCollisions({
    projectRoot: root,
    sourceRoot: "settings/karsk",
    targetRoot: "settings/rolara",
    suffix: "-INDEX",
  });
  check("only the genuine collision is reported", collisions.map((c) => c.basename), ["Tavern.md"]);
  check("and it carries a proposed rename that disambiguates by source",
    collisions[0].proposed, "settings/rolara/Tavern-karsk.md");
  rmSync(root, { recursive: true, force: true });
}

{
  const root = mergeFixture();
  const r = buildScopedPlan({
    projectRoot: root,
    settings: MERGE_SETTINGS,
    baseRules: BASE_RULES,
    scope: { settingMerges: [{ from: "karsk", into: "rolara" }] },
  });
  const moves = r.operations.filter((o) => o.op === "relocate-path");
  check("every source article gets a move",
    moves.map((o) => o.from).sort(),
    ["settings/karsk/Emberhold.md", "settings/karsk/Tavern.md"]);
  check("the non-colliding article keeps its name",
    moves.find((o) => o.from.endsWith("Emberhold.md")).to, "settings/rolara/Emberhold.md");
  // The collision resolves by RENAMING, not by overwriting and not by refusing.
  // Both articles are real and the DM wants both worlds in one vault.
  check("the colliding article moves to its proposed name",
    moves.find((o) => o.from.endsWith("Tavern.md")).to, "settings/rolara/Tavern-karsk.md");
  check("and the rename is surfaced so the DM sees it before approving",
    r.declined.some((d) => d.op === "merge-collision" && d.target.includes("Tavern.md")), true);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = mergeFixture();
  const r = buildScopedPlan({
    projectRoot: root,
    settings: MERGE_SETTINGS,
    baseRules: BASE_RULES,
    scope: { settingMerges: [{ from: "karsk", into: "karsk" }] },
  });
  check("merging a setting into itself is declined", [r.operations.length, r.declined.length], [0, 1]);
  rmSync(root, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `node professor-orb/workflows/migrate.plan.test.mjs`
Expected: FAIL at import on `mergeCollisions`.

- [ ] **Step 3: Implement collision detection**

Add to `migrate.mjs`'s plan half:

```js
// Basenames that exist in BOTH roots, each with a proposed disambiguating name.
//
// Two worlds legitimately holding a Tavern.md is not a mistake, and it becomes
// a collision only when they share a vault. The resolution is a rename, not an
// overwrite and not a refusal: both articles are real and the DM asked for both
// worlds in one place.
//
// The proposal suffixes the SOURCE setting's name, so the article that was
// already at the destination keeps the name every existing wikilink uses and
// only the incoming one needs its links looked at.
export function mergeCollisions({ projectRoot, sourceRoot, targetRoot, suffix }) {
  const namesIn = (rel) => {
    const out = new Set();
    let names;
    try {
      names = readdirSync(path.resolve(projectRoot, rel));
    } catch {
      return out;
    }
    for (const name of names) {
      if (!name.toLowerCase().endsWith(".md")) continue;
      let st;
      try {
        st = statSync(path.resolve(projectRoot, `${rel}/${name}`));
      } catch {
        continue;
      }
      if (st.isFile()) out.add(name);
    }
    return out;
  };

  const source = toPosix(sourceRoot);
  const target = toPosix(targetRoot);
  const label = path.posix.basename(source);
  const existing = namesIn(target);
  const out = [];

  for (const name of [...namesIn(source)].sort()) {
    if (!existing.has(name)) continue;
    const stem = name.slice(0, -3);
    // An index colliding with an index is a merge-index job, not a rename:
    // renaming would leave two indexes claiming one folder, which is the
    // multi-index violation the sweep reports.
    if (suffix && stem.endsWith(suffix)) continue;
    out.push({
      from: `${source}/${name}`,
      basename: name,
      proposed: `${target}/${stem}-${label}.md`,
    });
  }
  return out;
}
```

- [ ] **Step 4: Implement the planner**

Add `["settingMerges", planSettingMerges],` to `SCOPED_PLANNERS` and:

```js
function planSettingMerges(items, ctx) {
  const operations = [];
  const declined = [];
  for (const item of items) {
    const from = String((item && item.from) || "");
    const into = String((item && item.into) || "");
    const source = settingNamed(ctx.settings, from);
    const target = settingNamed(ctx.settings, into);
    if (!source || !target) {
      declined.push({ op: "relocate-path", target: `${from} into ${into}`, reason: "Both settings must be recorded in conventions.json." });
      continue;
    }
    if (from === into) {
      declined.push({ op: "relocate-path", target: from, reason: "A setting cannot be merged into itself." });
      continue;
    }

    const sourceRoot = toPosix(source.kbRoot);
    const targetRoot = toPosix(target.kbRoot);
    const suffix = indexSuffixFor(target, ctx.baseRules);
    const collisions = mergeCollisions({ projectRoot: ctx.projectRoot, sourceRoot, targetRoot, suffix });
    const renamed = new Map(collisions.map((c) => [c.from, c.proposed]));

    let names = [];
    try {
      names = readdirSync(path.resolve(ctx.projectRoot, sourceRoot)).sort();
    } catch (err) {
      declined.push({ op: "relocate-path", target: sourceRoot, reason: `Could not read the source setting: ${err.message}` });
      continue;
    }
    for (const name of names) {
      if (!name.toLowerCase().endsWith(".md")) continue;
      const rel = `${sourceRoot}/${name}`;
      let st;
      try {
        st = statSync(path.resolve(ctx.projectRoot, rel));
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      operations.push({
        op: "relocate-path",
        from: rel,
        to: renamed.get(rel) || `${targetRoot}/${name}`,
        reason: renamed.has(rel)
          ? `Merged from ${from}, renamed because ${name} already exists in ${into}.`
          : `Merged from ${from} into ${into}.`,
      });
    }

    for (const c of collisions) {
      declined.push({
        op: "merge-collision",
        target: `${c.from} collides with ${targetRoot}/${c.basename}`,
        reason: `Both settings hold a ${c.basename}. The incoming one is renamed to ${path.posix.basename(c.proposed)} so the article already at the destination keeps the name every existing wikilink uses. Edit this proposal if you want the other name, or a different one.`,
      });
    }
  }
  return { operations, declined };
}
```

- [ ] **Step 5: Extend `conventionsAfterScope`**

Add before the `return`:

```js
  for (const item of list(s.settingMerges)) {
    const source = settingNamed(next.settings, item && item.from);
    const target = settingNamed(next.settings, item && item.into);
    if (!source || !target || source === target) continue;

    const campaigns = list(target.campaigns);
    for (const c of list(source.campaigns)) if (!campaigns.includes(c)) campaigns.push(c);
    target.campaigns = campaigns;

    // The source's type extensions describe articles that now live in the
    // target. Dropping them would make every merged article of an extended type
    // fail the target's enum, which blocks.
    const targetRule = target.rules && target.rules.frontmatterTypeEnum;
    const sourceRule = source.rules && source.rules.frontmatterTypeEnum;
    if (targetRule && sourceRule) {
      const base = list(targetRule.params && targetRule.params.values).map(String);
      const merged = list(targetRule.extendedBy).map(String);
      for (const v of list(sourceRule.extendedBy).map(String)) {
        if (!base.includes(v) && !merged.includes(v)) merged.push(v);
      }
      if (merged.length > 0) targetRule.extendedBy = merged;
    }

    source.mergedInto = target.name;
    source.retired = true;
    changes.push(
      `Merged ${source.name} into ${target.name}: campaigns and type extensions folded in, and the ${source.name} entry marked merged rather than deleted.`
    );
  }
```

- [ ] **Step 6: Test the conventions case**

Append to `professor-orb/workflows/migrate.proposal.test.mjs`, building a two-setting fixture from `CONVENTIONS`:

```js
{
  const two = JSON.parse(JSON.stringify(CONVENTIONS));
  two.settings.push({
    name: "karsk",
    kbRoot: "settings/karsk",
    homebrewRoot: "homebrew/karsk",
    sessionReportsRoot: "session-reports/karsk",
    campaigns: ["deeps"],
    rules: {
      frontmatterTypeEnum: {
        provenance: "professor-orb",
        category: "frontmatter",
        check: "enum",
        enforcement: "block",
        description: "type must be recognized.",
        extendedBy: ["Settlement"],
        params: { field: "type", values: ["Person", "Location"] },
      },
    },
  });
  const r = conventionsAfterScope(two, { settingMerges: [{ from: "karsk", into: "rolara" }] });
  const rolara = r.conventions.settings[0];
  const karsk = r.conventions.settings[1];
  check("campaigns are folded in", rolara.campaigns, ["karsk", "deeps"]);
  check("the source's type extensions come across", rolara.rules.frontmatterTypeEnum.extendedBy, ["Settlement"]);
  check("the merged entry is marked, not deleted",
    [r.conventions.settings.length, karsk.mergedInto, karsk.retired], [2, "rolara", true]);
}
```

- [ ] **Step 7: Run all three suites**

Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add professor-orb/workflows/migrate.mjs professor-orb/workflows/migrate.plan.test.mjs professor-orb/workflows/migrate.proposal.test.mjs
git commit -m "feat(professor-orb): merge two settings, with every collision named first

Two worlds legitimately holding a Tavern.md is not a mistake, and it becomes a
collision only when they share a vault. Every one appears in the proposal with
a proposed rename, so the DM approves the resolution rather than discovering
it.

The resolution renames rather than overwriting or refusing: both articles are
real and the DM asked for both worlds in one place. The suffix goes on the
incoming article, so the one already at the destination keeps the name every
existing wikilink uses and only the incoming article's links need looking at.
An index colliding with an index is skipped, because that is a merge-index job:
renaming would leave two indexes claiming one folder.

The source's type extensions are folded into the target, since they describe
articles that now live there and the enum blocks. The merged entry is marked
rather than deleted, for the same reason a retired one is.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase 4: wiring and release

### Task 15: the sweep's judgment bucket gets a destination

`validation-sweep.mjs` returns findings in two buckets. The fix phase applies only `mechanicallyFixable`. The judgment items are printed and forgotten, which has been true since the sweep was written.

**Files:**
- Modify: `professor-orb/workflows/validation-sweep.mjs` (the `nextStep` string in the scan phase's return, and the checker prompt's `needsJudgment` description)
- Modify: `professor-orb/agents/kb-validator.md`

- [ ] **Step 1: Read the current text**

Run: `grep -n "resolve each needs-judgment item individually" professor-orb/workflows/validation-sweep.mjs`
Expected: one hit, inside the `nextStep` string in the scan phase's return object.

- [ ] **Step 2: Point `nextStep` at the command**

In that string, replace `resolve each needs-judgment item individually (including the single-ownership and index-parity findings)` with:

```
resolve each needs-judgment item individually (including the single-ownership and index-parity findings), which is what /migrate takes as a scope: invoking it with no argument offers this bucket directly, so an ownership conflict or a multi-index folder can be resolved as a structural change rather than by hand
```

Leave the rest of the sentence, including the `args.mode "fix"` mechanics, exactly as it is. The fix phase still owns `mechanicallyFixable`; this adds a destination for the other bucket and takes nothing away from the first.

- [ ] **Step 3: Say the same thing where the buckets are described**

Find the checker prompt line describing what a `needsJudgment` item carries (the `'Return structured data only: ...'` line, which names `needsJudgment (array of objects with file, ruleId, description, question)`). Leave that shape alone; a checker producing a different shape would break aggregation.

Instead, add one line to the scan phase's `log(...)` summary, after the aggregation count, so it appears in the run output as well as the return value:

```js
  if (needsJudgment.length > 0) {
    log(
      needsJudgment.length +
        ' needs-judgment item(s) carry a question each. /migrate offers this bucket as a scope when it is invoked with no argument, so these can be resolved as one approved structural change rather than one at a time by hand.',
    )
  }
```

- [ ] **Step 4: Correct kb-validator's dead end**

`agents/kb-validator.md` reports findings the DM then has to act on by hand. Add one sentence to its report section naming `/migrate` as where a structural finding can go, in the same place it already tells the DM what to do with a finding. Do not give the agent an instruction to invoke anything: it is read-only and stays read-only.

- [ ] **Step 5: Verify**

Run: `grep -c '—' professor-orb/workflows/validation-sweep.mjs professor-orb/agents/kb-validator.md`
Expected: `0` for both.

Run: `node professor-orb/workflows/validation-sweep.ownership.test.mjs`
Expected: PASS. This task touches only strings; the ownership suite must be unaffected.

- [ ] **Step 6: Commit**

```bash
git add professor-orb/workflows/validation-sweep.mjs professor-orb/agents/kb-validator.md
git commit -m "fix(professor-orb): give the sweep's judgment bucket somewhere to go

The scan phase has always returned two buckets and the fix phase has always
applied one of them. Ownership conflicts, ambiguous types, and multi-index
folders landed in needsJudgment, were printed, and were forgotten, which is
where they have gone since the sweep was written.

nextStep and the run summary now name /migrate, which offers that bucket
directly when invoked with no argument, so a judgment finding can be resolved
as one approved structural change instead of by hand one at a time. The fix
phase keeps mechanicallyFixable unchanged; this adds a destination for the
other bucket rather than moving anything.

kb-validator gains the same pointer and stays read-only.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: setup hands its deferrals forward

1.6.0's last release commit had to edit `migrate.mjs`'s deferred-operation reasons to stop naming `/migrate`, because the command did not ship. It ships now, and those strings go back.

**Files:**
- Modify: `professor-orb/workflows/migrate.mjs` (the two deferred-operation reason strings in `proposeDeferred`)
- Modify: `professor-orb/skills/setup/SKILL.md:217-220` (the report's Declined section) and `:242` (Closing this run)

- [ ] **Step 1: Find the strings**

Run: `grep -n "for the DM to decide" professor-orb/workflows/migrate.mjs`
Expected: two hits, in the split and absorb branches of `proposeDeferred`.

- [ ] **Step 2: Name the command again**

In each, replace the "reported for the DM to decide" clause with a clause naming `/migrate` as where the decision gets executed, keeping the underlying split or absorb fact intact. For example, the absorb reason keeps its entry count and threshold and gains: `Run /migrate to dissolve it into its parent once you have decided that is what you want.`

Leave the maintainer-facing code comment above `DEFERRED_OPERATIONS` as it is: it already says this work "belongs to /migrate once the DM has scoped it", and it was correct before the command existed and is correct now.

- [ ] **Step 3: Point setup's report at the command**

At `professor-orb/skills/setup/SKILL.md:217-220`, the report's **Declined** section lists what was not done: git-ignored files, absorb candidates, split proposals, `-TIMELINE` and `-HISTORY` files, articles missing `publish`, prose path references. Add one sentence beneath that list:

```
Every item in this section except the missing `publish` values is something `/migrate` can execute once you scope it. Run `/migrate` with no argument and it will offer them, re-derived from the tree as it stands rather than read back out of this report.
```

The `publish` exception is deliberate and must be stated: nothing in the plugin ever inserts a `publish` value, `/migrate` included, and a sentence implying otherwise would promise a bulk fix that Task 6's planner explicitly declines.

- [ ] **Step 4: Add it to the closing**

At `professor-orb/skills/setup/SKILL.md:242`, the closing paragraph points the DM at the session pipeline as a next action. Add `/migrate` as the next action **for the deferred items specifically**, distinct from the pipeline recommendation. Do not replace the pipeline pointer: a DM finishing setup most often wants to run a session, not restructure.

- [ ] **Step 5: Verify**

Run: `grep -rn "a command that does not ship\|does not ship in this release" professor-orb/`
Expected: no hits. That wording was 1.6.0's accommodation and is now false.

Run: `grep -c '—' professor-orb/workflows/migrate.mjs professor-orb/skills/setup/SKILL.md`
Expected: `0` for both.

Run: `node professor-orb/workflows/migrate.plan.test.mjs`
Expected: PASS. If a case asserts on a deferred reason's exact text, update the expectation in the same commit.

- [ ] **Step 6: Commit**

```bash
git add professor-orb/workflows/migrate.mjs professor-orb/skills/setup/SKILL.md
git commit -m "fix(professor-orb): setup's deferrals point at /migrate again

1.6.0's last release commit edited these strings to stop naming /migrate,
because naming a command that did not ship would have sent the DM after
something that was not there. It ships now, so they go back, and setup's report
gains a sentence telling the DM that every declined item except the missing
publish values is something /migrate can execute once scoped.

The publish exception is stated rather than left implicit. Nothing in the
plugin ever inserts a publish value, /migrate included, and a sentence implying
otherwise would promise a bulk fix the scoped planner explicitly declines.

Setup's closing keeps its pipeline pointer and gains /migrate as the next
action for the deferred items specifically. A DM finishing setup most often
wants to run a session, not restructure.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 17: the three inventories

Three files list what the plugin ships and all three are wrong the moment `/migrate` exists. `README.md` says "three commands"; `skills/orb/SKILL.md`'s table has no row for the `migrate` workflow at all, which was already true before this release; `CONTEXT.md`'s index-maintenance entry still says the rebuild step is "not yet built".

**Files:**
- Modify: `professor-orb/README.md:7`, `:34`, the component table, `:56`
- Modify: `professor-orb/skills/orb/SKILL.md:3` (description), `:22`, the component table, `:58`
- Modify: `professor-orb/CONTEXT.md:108-119` (lane model), `:157-166` (index maintenance)

- [ ] **Step 1: README**

At `:7`, "three commands" becomes "four commands".

Add a `/migrate` row to the component table, directly after `/log`:

```
| /migrate | Command | Restructures the knowledge base to a DM-stated scope, or to setup's deferred items and the sweep's needs-judgment findings. Writes a proposal the DM may edit, then executes exactly what the approved file says, as one revertible commit | `/migrate`, "clean up items/", "rename X to Y everywhere", "retire the Karsk campaign" |
```

Update the `migrate` workflow row at `:34` so it stops implying setup is its only caller: it is driven by setup's onboarding migration **and** by `/migrate`.

At `:56`, the standalone-components list gains `/migrate`.

**Do not add `/migrate` to the list of components that write to the knowledge base at `:62`.** That list is about authoring, and the distinction was drawn deliberately in 1.6.0 when `/scribe` and `/log` were kept off it. `/migrate` moves and renames what other components authored; it writes no article. Add it instead to the sentence describing the sweep's two-phase covenant, since it holds the same one: a plan phase that mutates nothing, then an apply phase that applies only what was approved.

- [ ] **Step 2: orb**

At `:3`, add `/migrate` to the description's standalone list. Check the length afterward:

```bash
node -e "const l=require('fs').readFileSync('professor-orb/skills/orb/SKILL.md','utf8').split(/\r?\n/).find(x=>x.startsWith('description:'));console.log(l.length)"
```
Expected: under 1500. It is 961 today, so there is room for one clause and not for a sentence.

At `:22`, add `/migrate` to the standalone list. At `:58`, add it to the same list in the "What to run next" section.

Add both missing workflow rows to the component table: `migrate` (which was never listed) and `/migrate` the command. Two rows, not one; they are a workflow script and a command and the table distinguishes those everywhere else.

**Do not add `/migrate` to `:18`'s list of components that write to the knowledge base**, for the reason in Step 1.

- [ ] **Step 3: CONTEXT**

At `:157-166`, the **index maintenance** entry says "regenerating them is not yet built. Phase 2 ships that rebuild step as a migration executor, propose-then-execute like chronicler." Rewrite it to describe what now exists: the sweep detects index violations, `/migrate`'s `rebuild-index` regenerates an index's link list from its folder's actual contents, and the DM's ad-hoc Python scripts retire. Keep the `_Avoid_` line, and keep "silent index rewrites" on it: the rebuild preserving frontmatter and prose is exactly that constraint being honored, not an argument for dropping it.

At `:108-119`, the **lane model** entry describes three prongs, three commands, and a commit that never mixes them. Add the exception rather than leaving `/migrate` to contradict it silently:

```
`/migrate` is the one component outside this model, and deliberately: it restructures across prongs by nature, so it commits its own work in one commit rather than deferring to the three. It is bounded instead by a clean-tree requirement and its own snapshot, which fix the same problem the lane split fixes, that a commit should contain one intelligible change.
```

Add a `/migrate` entry to `CONTEXT.md`'s component list in the same shape as its neighbours, with its own `_Avoid_` line: `_Avoid_: executing anything the approved proposal does not carry, rewriting body prose, running on a dirty tree`.

- [ ] **Step 4: Verify**

Run: `grep -rn "three commands" professor-orb/`
Expected: no hits.

Run: `grep -c '—' professor-orb/README.md professor-orb/CONTEXT.md professor-orb/skills/orb/SKILL.md`
Expected: `0` for each.

Run: `grep -rn "not yet built" professor-orb/`
Expected: no hits.

- [ ] **Step 5: Commit**

```bash
git add professor-orb/README.md professor-orb/CONTEXT.md professor-orb/skills/orb/SKILL.md
git commit -m "docs(professor-orb): put /migrate in the three inventories

Four commands, not three. The orb skill's table was also missing a row for the
migrate workflow entirely, which was already true before this release, so both
it and the command are added there.

CONTEXT.md's index-maintenance entry said regenerating indexes was not yet
built and pointed at a future phase. It is built, so the entry describes it,
and silent index rewrites stay on the avoid list: the rebuild preserving
frontmatter and prose is that constraint being honored rather than an argument
for dropping it.

The lane model entry gains /migrate as its stated exception, so the one
component that commits across prongs does not read as a violation of the rule
it sits outside. Neither README nor orb adds /migrate to the list of components
that write to the knowledge base: that list is about authoring, and this
command moves and renames what others authored.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 18: version bump and release verification

**Files:**
- Modify: `professor-orb/.claude-plugin/plugin.json` (version only)
- Modify: `.claude-plugin/marketplace.json` (version only)

- [ ] **Step 1: Bump both manifests**

Set `"version": "1.7.0"` in `professor-orb/.claude-plugin/plugin.json` and in the `professor-orb` entry of `.claude-plugin/marketplace.json`. Change nothing else in either file: the descriptions were rewritten in 1.6.0 and are still accurate.

- [ ] **Step 2: Confirm they agree**

```bash
node -e "const p=require('./professor-orb/.claude-plugin/plugin.json'),m=require('./.claude-plugin/marketplace.json');const v=m.plugins.find(x=>x.name==='professor-orb').version;console.log(p.version===v&&p.version==='1.7.0'?'version OK '+p.version:'MISMATCH '+p.version+' vs '+v)"
```
Expected: `version OK 1.7.0`.

- [ ] **Step 3: Run every suite**

```bash
node professor-orb/workflows/migrate.plan.test.mjs
node professor-orb/workflows/migrate.apply.test.mjs
node professor-orb/workflows/migrate.proposal.test.mjs
node professor-orb/workflows/validation-sweep.ownership.test.mjs
node professor-orb/hooks/validate-write.test.mjs
node professor-orb/hooks/pipeline-next.test.mjs
node professor-orb/commands/lane-staging.test.mjs
node docs/superpowers/specs/2026-07-28-mechanism-prototypes.mjs
```
Expected: every one exits 0.

- [ ] **Step 4: Run the release checks**

```bash
grep -rc '—' professor-orb/ | grep -v ':0$'
```
Expected: no output.

```bash
grep -rn "three commands\|not yet built\|does not ship in this release" professor-orb/
```
Expected: no hits.

```bash
node -e "const {readFileSync}=require('fs');for(const f of ['commands/migrate.md','commands/scribe.md','commands/log.md','commands/catalog.md','skills/orb/SKILL.md']){const l=readFileSync('professor-orb/'+f,'utf8').split(/\r?\n/).find(x=>x.startsWith('description:'));console.log(f, l?l.length:'none')}"
```
Expected: every number under 1500. Over that and Cowork rejects the whole plugin with a toast that names no file.

- [ ] **Step 5: Confirm the module is still importable**

```bash
node -e "import('./professor-orb/workflows/migrate.mjs').then(m=>console.log('importable, exports:', Object.keys(m).length))"
```
Expected: it prints a count and exits 0 without touching the working tree. If it hangs or writes anything, the entry guard has been broken.

- [ ] **Step 6: Commit**

```bash
git add professor-orb/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "feat(professor-orb): release 1.7.0

/migrate ships: four commands instead of three, a scope-derived plan beside
setup's schema-derived one, six new operations, and the setting lifecycle.

The two components that produced output nothing consumed now have consumers.
Setup's deferred items and the validation sweep's needs-judgment bucket are
both offered as scopes when /migrate is invoked with no argument, and the
rebuild step CONTEXT.md has described since before 1.6.0 exists.

Version goes to 1.7.0 in plugin.json and marketplace.json together.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Post-release verification against the reference consumer

Not part of the release commit, and blocked on 1.6.0's own verification checklist, which has not been run.

- [ ] Install: `claude plugin marketplace update professor-orb-marketplace` then `claude plugin update professor-orb@professor-orb-marketplace --scope project`.
- [ ] Take a manual git tag in the reference consumer as a restore point beyond `/migrate`'s own snapshot.
- [ ] Run `/migrate` with no argument and confirm it offers setup's deferred items, re-derived from the tree rather than read from the report.
- [ ] Approve a small scope first (one index rebuild). Confirm the proposal file lands in `.professor-orb/proposals/`, the snapshot hash is printed, the commit is one commit, and `git revert` of it restores the tree exactly.
- [ ] Hand-edit a proposal: strike one operation, then approve. Confirm the struck operation did not run and appears under Declined.
- [ ] Run an entity rename and confirm in Obsidian that the graph is intact and that body prose naming the old entity was left alone.
- [ ] On a run touching many files, confirm the write-time hook stayed silent throughout and that `.professor-orb/conventions.json` is back at its own path afterward with no `.pre-migration` aside left behind. This is the spec's one verification item no unit test covers, because the aside is the command's behavior rather than the executor's.
- [ ] Run an absorb on a real small folder and confirm the parent index no longer lists the dissolved folder's index.
- [ ] Re-run the validation sweep and confirm the finding count dropped by what the run reported.
- [ ] Confirm `/scribe`, `/log`, and `/catalog` see nothing outstanding afterward, since `/migrate` committed its own work.

## Notes for the implementer

- **Phase 1 is where the risk is.** Every task in it touches a module that moves the DM's files. Run all three migrate suites after every task, not only the one you edited.
- **The apply half's header comment is a contract, not commentary.** It states four properties (the snapshot precedes every mutation, an ignored source is skipped, a rename and its rewrite are one unit, every relocation goes through `git mv`). Each new executor either holds them or explains in a comment why it is outside them. `applyUpdateProsePaths` is the one that needs the explanation: it edits a file rather than moving one.
- **Two suites hold byte-alignment obligations** (`validation-sweep.ownership.test.mjs:7-9` and any copy of `snapshotTree` Task 1 introduces). If you copy a helper between suites, add the same note.
- **When a test passes on the first run, make it fail before believing it.** Several tasks say so explicitly; it applies to the ones that do not, too.
