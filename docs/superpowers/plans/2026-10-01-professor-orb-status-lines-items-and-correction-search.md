# professor-orb 1.22.0: status lines, items, one lore agent, correction search. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Act on the 2026-10-01 field report: keep present status out of staged articles (prose plus a blocking validator rule), record items only when they were in the story, drop the lore fan-out that cannot run, and make the correction hook match strictly enough to stop flooding the DM.

**Architecture:** One new validator `scope` value (`"staged"`) gates a new base rule that reuses the existing `prohibitedPattern` check, which gains an optional `message`. Everything else is prose in the skill, agent, and glossary files, plus a one-line floor change and new wording in the correction hook.

**Tech Stack:** Node built-in test scripts (no framework), Markdown skill and agent files, JSON base rules.

**Spec:** `docs/superpowers/specs/2026-10-01-professor-orb-status-lines-items-and-correction-search-design.md` (approved 2026-10-01).

**Working copy:** `.claude/worktrees/professor-orb-report-1001`, branch `claude/professor-orb-report-1001`. Every path below is relative to that folder. Lands with `/land`.

## Status

Update a row to `done` as each task's commit lands, so progress survives a context reset.

| Task | What | State |
| --- | --- | --- |
| 0 | Commit spec and plan | done (2e1647d) |
| 1 | Validator: `"staged"` scope and `message` param | done, reviewed (lane A) |
| 2 | The status rule, its docs, sweep and kb-validator scope handling | done, reviewed (lane A) |
| 3 | Present status in chronicler, lore agent, Principle 14 | done, reviewed (lane C) |
| 4 | Items in the story: debrief and lore agent | done, reviewed (lane C) |
| 5 | One lore agent: drop the fan-out | done, reviewed (lane C) |
| 6 | Correction hook: half-the-words floor and new wording | done, reviewed (lane B) |
| 7 | Version 1.22.0, all suites, live checks on rolara | done |
| After landing | Rolara rollout (DM approves each) | not started |

## Global Constraints

- No em dash characters and no double-hyphen substitutes in any prose or comment written by this plan.
- Every skill, agent, and command keeps its opening `SHARED-PRINCIPLES.md` preamble.
- The `"staged"` scope matches a file in the owning setting's `sessionReportsRoot` whose name does not end in `-REPORT.md` or `-PREP.md`, compared case-insensitively.
- Rule ID `contentStagedNoPresentStatus`, `check: "prohibitedPattern"`, `scope: "staged"`, `enforcement: "block"`, no `autofix`.
- Version `1.22.0` in both `professor-orb/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests are run with `node <file>`; each exits non-zero on failure.

## Review Focus

1. A session report or prep brief that legitimately says "as of Day N" must never be blocked: the `-REPORT.md` / `-PREP.md` exemption (pinned in Task 1, both suffixes, plus a lowercase-suffix case).
2. Vault articles keep their Current Status sections: the hook skips `"staged"` rules under `kbRoot` (Task 1), the sweep drops them (Task 2), and kb-validator honors `scope` (Task 2).
3. A writer blocked by the rule must be told to delete, not rename: the message reaches the writer with the offending line (Task 1 pins `Found: "..."`).
4. The em dash rule's output must not change: `prohibitedPattern` with no `message` keeps `Prohibited pattern (...) found in body.` (Task 1).
5. The correction hook's founding 09-18 case must still find both copies under the stricter bar: the existing "lane search" block stays green unchanged (Task 6).

---

### Task 0: Commit the spec and plan

**Files:**
- Add: `docs/superpowers/specs/2026-10-01-professor-orb-status-lines-items-and-correction-search-design.md`
- Add: `docs/superpowers/plans/2026-10-01-professor-orb-status-lines-items-and-correction-search.md`

- [ ] **Step 1: Commit**

```bash
git add docs/superpowers/specs/2026-10-01-professor-orb-status-lines-items-and-correction-search-design.md docs/superpowers/plans/2026-10-01-professor-orb-status-lines-items-and-correction-search.md
git commit -m "docs(professor-orb): spec and plan for the 2026-10-01 field report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Validator: the `"staged"` scope and the `message` param

**Files:**
- Modify: `professor-orb/hooks/validate-write.mjs` (`checkProhibitedPattern` near line 538; `prongContaining` near line 1168; scope gate near line 1360)
- Test: `professor-orb/hooks/validate-write.test.mjs` (new block after the "scope gate against a real prongKind" block, which ends near line 285)

**Interfaces:**
- Produces: `isStaged(ctx)` (module-private), true when `ctx.prongKind === "session-reports"` and `ctx.fileName` does not match `/-(?:REPORT|PREP)\.md$/i`. `checkProhibitedPattern` honors `params.message` (string): on a match it returns `` `${message.trim()} Found: "${line}"` `` where `line` is the matched line, trimmed, cut to 120 characters with a trailing `…`.

- [ ] **Step 1: Write the failing tests**

Insert this block in `validate-write.test.mjs` directly after the closing `}` of the third case in "scope gate against a real prongKind" (the case named `'scope "kb" rule does run for a file in the kb prong'`):

```js
console.log('\n=== scope "staged" and the prohibitedPattern message ===');

// A stand-in for the shipped status rule, with a simple pattern: this block
// pins the gate and the message. The shipped pattern is pinned against the
// artifact in "base rules artifact".
function stagedV3({ message } = {}) {
  const params = { pattern: "^## Current Status$", flags: "im", appliesTo: "body" };
  if (message) params.message = message;
  return {
    version: 3,
    settings: [
      {
        name: "rolara",
        kbRoot: "settings/rolara",
        homebrewRoot: "homebrew/rolara",
        sessionReportsRoot: "session-reports/rolara",
        rules: {
          contentStagedNoPresentStatus: {
            provenance: "professor-orb",
            category: "content",
            check: "prohibitedPattern",
            scope: "staged",
            enforcement: "block",
            description: "A staged article carries no present-status heading.",
            params,
          },
        },
      },
    ],
  };
}

const STATUS_BODY = "---\ntype: Person\n---\n\n# Aethon\n\n## Current Status\n\nAboard the Vigil.\n";
const MSG = "A staged article carries no present status. Delete it.";

{
  const target = "session-reports/rolara/Big-Guys-Gang/npcs/Aethon.md";
  const r = runHook({ conventions: stagedV3({ message: MSG }), files: { [target]: STATUS_BODY }, targetRel: target });
  check('a "staged" rule blocks a staged article', r.code, 2);
  check("the block carries the rule's message", r.err.includes(MSG), true);
  check("the block quotes the matched line", r.err.includes('Found: "## Current Status"'), true);
}

for (const target of [
  "session-reports/rolara/Big-Guys-Gang/reports/2026-09-30-Zelexs-Gambit-REPORT.md",
  "session-reports/rolara/Big-Guys-Gang/prep/2026-10-07-Next-PREP.md",
  "session-reports/rolara/Big-Guys-Gang/reports/2026-09-30-lowercase-report.md",
  "settings/rolara/npcs/Aethon.md",
  "homebrew/rolara/items/Aethon.md",
]) {
  const r = runHook({ conventions: stagedV3({ message: MSG }), files: { [target]: STATUS_BODY }, targetRel: target });
  check(`a "staged" rule skips ${target}`, r.code, 0);
}

{
  // Control: a "staged" rule with no message keeps the bare-pattern output the
  // em dash rule relies on.
  const target = "session-reports/rolara/Big-Guys-Gang/npcs/Plain.md";
  const r = runHook({ conventions: stagedV3(), files: { [target]: STATUS_BODY }, targetRel: target });
  check("with no message, the bare-pattern output is unchanged", r.err.includes("Prohibited pattern (^## Current Status$) found in body."), true);
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node professor-orb/hooks/validate-write.test.mjs`
Expected: FAIL. The message and `Found:` checks fail (no `message` support), and the `-REPORT.md`, `-PREP.md`, `lowercase-report.md`, `settings/`, and `homebrew/` skip checks fail with code 2 (the rule runs everywhere because `"staged"` is not gated). Note: `2026-09-30-lowercase-report.md` ends in `-report.md`, which the case-insensitive suffix test exempts.

- [ ] **Step 3: Implement the `message` param**

In `checkProhibitedPattern`, change the destructuring line to:

```js
  const { pattern, appliesTo = "body", excludeTableDelimiters = false, flags = "u", message } = params;
```

and replace the final block

```js
  if (re.test(text)) {
    return `Prohibited pattern (${pattern}) found in ${appliesTo}.`;
  }
  return true;
```

with

```js
  const found = re.exec(text);
  if (!found) return true;
  // A rule whose pattern a reader cannot parse at a glance carries a message
  // instead, plus the line it caught. A writer handed only a regex can satisfy
  // it by renaming the heading it matched, which is the wrong fix.
  if (typeof message === "string" && message.trim() !== "") {
    const lineStart = text.lastIndexOf("\n", found.index) + 1;
    const line = text.slice(lineStart).split("\n")[0].trim();
    return `${message.trim()} Found: "${line.length > 120 ? line.slice(0, 119) + "…" : line}"`;
  }
  return `Prohibited pattern (${pattern}) found in ${appliesTo}.`;
```

- [ ] **Step 4: Implement the `"staged"` scope gate**

Directly after the closing `}` of `prongContaining`, add:

```js
// A staged article: a file in the session-reports prong that is not a session
// report or a prep brief. Those two are told apart by professor-orb's filename
// suffixes rather than by `type`, because a project may extend the report and
// prep types (rolara uses "Report" and "Prep") while keeping the suffixes.
const REPORT_OR_PREP = /-(?:REPORT|PREP)\.md$/i;
function isStaged(ctx) {
  return ctx.prongKind === "session-reports" && !REPORT_OR_PREP.test(ctx.fileName);
}
```

and directly after the existing line

```js
    if (rule.scope === "kb" && ctx.prongKind && ctx.prongKind !== "kb") continue;
```

add

```js
    // scope "staged" restricts a rule to staged articles; see isStaged.
    if (rule.scope === "staged" && !isStaged(ctx)) continue;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node professor-orb/hooks/validate-write.test.mjs`
Expected: PASS, every expectation met, exit 0.

- [ ] **Step 6: Commit**

```bash
git add professor-orb/hooks/validate-write.mjs professor-orb/hooks/validate-write.test.mjs
git commit -m "feat(professor-orb): a staged-only rule scope and a readable pattern message

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The status rule, its docs, and scope handling in the sweep and kb-validator

**Files:**
- Modify: `professor-orb/references/base-rules.json`
- Test: `professor-orb/hooks/validate-write.test.mjs` ("base rules artifact" block, near line 112)
- Modify: `professor-orb/workflows/validation-sweep.mjs` (near line 820)
- Modify: `professor-orb/agents/kb-validator.md` (Step 2, near line 63)
- Modify: `professor-orb/skills/setup/references/conventions-schema.md` ("Note on `scope`" near line 301; reconciliation table row near line 375; `prohibitedPattern` catalog row near line 519)
- Modify: `professor-orb/CONTEXT.md` ("staging area" entry, near line 205)

**Interfaces:**
- Consumes: the `"staged"` gate and `message` param from Task 1.
- Produces: base rule `contentStagedNoPresentStatus`, which Task 3's chronicler text names.

- [ ] **Step 1: Write the failing test**

In the "base rules artifact" block of `validate-write.test.mjs`, after the last `check(...)` (the one named `"the type enum carries both groups"`) and before the block's closing `}`, add:

```js
  const status = base.rules.contentStagedNoPresentStatus;
  check("the staged status rule ships scoped, blocking, with a message",
    status && [status.check, status.scope, status.enforcement, typeof status.params.message, status.autofix],
    ["prohibitedPattern", "staged", "block", "string", undefined]);
  if (status) {
    const statusRe = new RegExp(status.params.pattern, status.params.flags);
    const caught = ["## Current Status", "### Status", "**Status:** Free", "- **Status:** Free",
      "**Status**: Free", "where as of Day 293 he occupies an apartment"];
    const nearMisses = ["## Status Effects", "the status of the treaty", "as of the Day of Ash", "## History"];
    check("the status pattern catches every present-status form",
      caught.filter((s) => !statusRe.test(`intro\n${s}\nmore`)), []);
    check("the status pattern passes the near misses",
      nearMisses.filter((s) => statusRe.test(`intro\n${s}\nmore`)), []);
  }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node professor-orb/hooks/validate-write.test.mjs`
Expected: FAIL on "the staged status rule ships scoped, blocking, with a message" (actual `undefined`).

- [ ] **Step 3: Add the rule**

In `references/base-rules.json`, change `"schemaVersion": 2` to `"schemaVersion": 3`, and add after the `contentPronounConsistency` entry (put a comma after its closing `}`):

```json
    "contentStagedNoPresentStatus": {
      "provenance": "professor-orb",
      "category": "content",
      "check": "prohibitedPattern",
      "scope": "staged",
      "enforcement": "block",
      "description": "A staged article carries no present-status heading, Status field, or as-of-Day sentence.",
      "params": {
        "pattern": "^#{1,6}[ \\t]*(?:current[ \\t]+)?status[ \\t]*:?[ \\t]*$|^[ \\t]*(?:[-*][ \\t]+)?\\*\\*(?:current[ \\t]+)?status:?\\*\\*|\\bas of day[ \\t]+\\d",
        "flags": "im",
        "appliesTo": "body",
        "message": "A staged article carries no present status: where its subject is now, what it is doing now, or its condition now. That lives in the campaign's session reports and prep briefs. Delete the heading or field and the status under it rather than renaming or moving it; a past event that sat under it belongs in History."
      }
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node professor-orb/hooks/validate-write.test.mjs`
Expected: PASS, exit 0.

- [ ] **Step 5: Drop `"staged"` rules in the sweep**

In `workflows/validation-sweep.mjs`, inside `settingConfigsRaw.forEach`, directly after the line `if (!rules || typeof rules !== 'object') rules = {}`, add (this file uses no semicolons):

```js
    // The sweep checks vault articles only, and a scope "staged" rule governs
    // staged articles alone, which sit outside the sweep. Handing one to a
    // checker shard would hold the vault to it, and rolara's vault keeps
    // Current Status sections on purpose.
    for (const ruleId of Object.keys(rules)) if (rules[ruleId] && rules[ruleId].scope === 'staged') delete rules[ruleId]
```

- [ ] **Step 6: Teach kb-validator the two scopes**

In `agents/kb-validator.md` Step 2, directly after the paragraph that begins `**An article inside a campaign's \`articles/\` folder is staged, not published.**`, add a new paragraph:

```markdown
**A rule's `scope` limits where it applies.** A `scope: "kb"` rule applies only to articles under `kbRoot`. A `scope: "staged"` rule applies only to files in a campaign folder under `sessionReportsRoot` whose name does not end in `-REPORT.md` or `-PREP.md` (compared case-insensitively). A rule with no `scope` applies to every article in scope for this run. A vault article keeping a Current Status section is therefore not a finding.
```

- [ ] **Step 7: Update the schema reference**

In `skills/setup/references/conventions-schema.md`, replace the paragraph

```markdown
**Note on `scope`:** the only value is `"kb"`, and it restricts the rule to the
setting knowledge base. It is how a rule that only makes sense against KB
articles avoids being applied to material held elsewhere in the project. A rule
with no `scope` applies wherever the component checking it looks. Several base
rules ship with `scope: "kb"`.
```

with

```markdown
**Note on `scope`:** two values. `"kb"` restricts the rule to the setting
knowledge base. It is how a rule that only makes sense against KB articles
avoids being applied to material held elsewhere in the project, and several base
rules ship with it. `"staged"` restricts the rule to staged articles: files in
the setting's `sessionReportsRoot` whose name does not end in `-REPORT.md` or
`-PREP.md`, compared case-insensitively. Those suffixes are professor-orb's names
for session reports and prep briefs, and they are matched instead of `type`
because a project may extend those types. `contentStagedNoPresentStatus` ships
with it. `/sweep` checks vault articles only, so it drops every `"staged"` rule.
A rule with no `scope` applies wherever the component checking it looks.
```

Replace the reconciliation table row

```markdown
| `prohibitedPattern` | `contentNoEmDashes` | check kind alone; `params.pattern` and `params.appliesTo` are compared, not matched on |
```

with

```markdown
| `prohibitedPattern` | `contentNoEmDashes`, `contentStagedNoPresentStatus` | `scope`: a rule carrying `scope: "staged"` is `contentStagedNoPresentStatus`; any other is `contentNoEmDashes`, as before (no v1 file predates the `"staged"` scope). `params.pattern` and `params.appliesTo` are compared, not matched on |
```

In the `prohibitedPattern` row of the check catalog, change the params cell's `` `excludeTableDelimiters` (bool, body only, default false) `` to `` `excludeTableDelimiters` (bool, body only, default false), `message` (string, optional) ``, and append this sentence to the end of the row's last cell, before its closing ` |`:

```markdown
 When `message` is set, a failure reports it followed by the matching line, trimmed to 120 characters, instead of the bare pattern; a rule whose pattern a reader cannot parse at a glance sets one
```

- [ ] **Step 8: Update the glossary**

In `CONTEXT.md`, "staging area" entry, replace

```markdown
when the DM promotes it. Staged articles sit outside `/sweep` and every `scope: "kb"`
validator rule until promotion; an unscoped rule applies to them as it does anywhere.
```

with

```markdown
when the DM promotes it. Staged articles sit outside `/sweep` and every `scope: "kb"`
validator rule until promotion; an unscoped rule applies to them as it does anywhere,
and a `scope: "staged"` rule applies to them alone. One such rule,
`contentStagedNoPresentStatus`, keeps present status (where the subject is now, what it
is doing now, its condition now) out of them: that lives in the campaign's session
reports and prep briefs.
```

- [ ] **Step 9: Run the suites this task touches**

Run: `node professor-orb/hooks/validate-write.test.mjs && node professor-orb/workflows/validation-sweep.ownership.test.mjs && node professor-orb/workflows/migrate.plan.test.mjs`
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add professor-orb/references/base-rules.json professor-orb/hooks/validate-write.test.mjs professor-orb/workflows/validation-sweep.mjs professor-orb/agents/kb-validator.md professor-orb/skills/setup/references/conventions-schema.md professor-orb/CONTEXT.md
git commit -m "feat(professor-orb): block present status in a staged article

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Present status in chronicler, the lore agent, and Principle 14

**Files:**
- Modify: `professor-orb/skills/chronicler/SKILL.md` (lines 33, 42-44, 75)
- Modify: `professor-orb/agents/lore.md` (Step 2; Step 6)
- Modify: `professor-orb/skills/SHARED-PRINCIPLES.md` (Principle 14, line 102)

**Interfaces:**
- Consumes: rule ID `contentStagedNoPresentStatus` from Task 2.

- [ ] **Step 1: Chronicler's positive instruction**

In `skills/chronicler/SKILL.md`, replace `what it is, what it does, where it sits, who it is connected to, what has happened to it.` with `what it is, what it does, where it is fixed in place (a fortress's site, an order's seat), who it is connected to, what has happened to it.`

- [ ] **Step 2: Chronicler's fifth kind**

Insert this paragraph after the paragraph that begins `**The test is the sentence's subject, not your judgment about sensitivity.**` and before `**One carve-out: temporal declarations.**`:

```markdown
**In a staged article, one more kind: the present.** Where the subject is now, what it is doing now, and its condition now. It takes three forms: a `Current Status` or `Status` section, a `**Status:**` field, and a sentence that places the subject as of now ("She is aboard the *Stone of Endurance*," "as of Day 293 he occupies an apartment"). The campaign's session reports and prep briefs hold the present, session by session. An article changes only when this skill runs, so a present-tense status in it freezes on the day it was written; on 2026-09-30 one sent a wrong location to the table mid-session. Write the events that led to the present state into History and leave the state itself to the reports. When a Lore Candidate asks to update a staged article's status, delete the status passage instead. The `contentStagedNoPresentStatus` validator rule refuses a status heading, a Status field, or an "as of Day N" sentence in a staged article; a sentence that places the subject is yours to catch. Articles in `kbRoot` follow the project's own style on this.
```

- [ ] **Step 3: Chronicler's Eyes-Only line**

Replace `The four categories in "What an article is" stay out whether hidden or not.` with `The campaign kinds in "What an article is" stay out whether hidden or not.`

- [ ] **Step 4: Lore agent Step 2**

In `agents/lore.md` Step 2, after the sentence `Extract every factual claim: entity locations, statuses, relationships, new canon established, canon discovered, lore candidates.`, add: ` The reports are the record of where each entity is now and what condition it is in; a staged article (one under \`sessionReportsRoot\`) holds no copy of that record (see Step 6).`

- [ ] **Step 5: Lore agent Step 6**

In Step 6, change the first two contradiction bullets to:

```markdown
- Location contradictions (report places an entity somewhere a `kbRoot` article does not)
- Status contradictions (report treats an entity as alive, free, or allied when a `kbRoot` article says otherwise)
```

Then, after the paragraph that begins `Distinguish contradictions from updates.`, add:

```markdown
**Present status in a staged article: propose deleting it.** When a staged article (one under `sessionReportsRoot`) states where its subject is now, what it is doing now, or its condition now (a Current Status section, a Status field, a sentence placing the subject as of now), put the deletion of that passage in the edit bucket of Step 8, quoting it. Compare nothing against it and raise no contradiction over it: the reports hold present status, and the article's copy is the defect.
```

- [ ] **Step 6: Principle 14**

In `skills/SHARED-PRINCIPLES.md`, after the sentence `The lookup covers those files, for the questions at hand.`, add: ` Where something is now and what condition it is in come from the campaign's most recent session report and prep brief, not from an article.`

- [ ] **Step 7: Check for em dashes and commit**

Run: `grep -n $'\xe2\x80\x94' professor-orb/skills/chronicler/SKILL.md professor-orb/agents/lore.md professor-orb/skills/SHARED-PRINCIPLES.md`
Expected: no output.

```bash
git add professor-orb/skills/chronicler/SKILL.md professor-orb/agents/lore.md professor-orb/skills/SHARED-PRINCIPLES.md
git commit -m "fix(professor-orb): present status lives in reports, never in a staged article

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Items in the story

**Files:**
- Modify: `professor-orb/skills/debrief/SKILL.md` (interview item 5, line 57; report outline, line 81)
- Modify: `professor-orb/agents/lore.md` (Step 6)

- [ ] **Step 1: Debrief interview item 5**

Replace

```markdown
5. **Notable inventory updates.** Items gained, lost, destroyed, transformed. Magic items identified. Consumables used that matter narratively.
```

with

```markdown
5. **Items in the story.** An item that took part in a scene this session: bought, found, lost, destroyed, transformed, identified, or used in a way that mattered (the party buying a ship). Ask about an item only when it came up in the session and what the DM said leaves its fate unclear. A blanket answer ("everything he carried went with him") settles every item it covers. A character's kit belongs to the table and the character sheet, so the rest of it stays out of the interview.
```

- [ ] **Step 2: Debrief report outline**

In the "Draft the report" paragraph, replace `NPCs and factions, locations, inventory, lore revelations` with `NPCs and factions, locations, items in the story, lore revelations`.

- [ ] **Step 3: Lore agent items rule**

In `agents/lore.md` Step 6, after the "Present status in a staged article" paragraph added in Task 3, add:

```markdown
**Items: report what an item is and what it does.** Who holds an item and where it is now belong to the table and the character sheets. They produce no question, contradiction, edit, or Deferred / Flagged item; a report line such as "everything he carried went with him" already settles them.
```

- [ ] **Step 4: Check for em dashes and commit**

Run: `grep -n $'\xe2\x80\x94' professor-orb/skills/debrief/SKILL.md professor-orb/agents/lore.md`
Expected: no output.

```bash
git add professor-orb/skills/debrief/SKILL.md professor-orb/agents/lore.md
git commit -m "fix(professor-orb): record an item when it was in the story, never audit a kit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: One lore agent, reading one entity at a time

**Files:**
- Modify: `professor-orb/agents/lore.md` (frontmatter description and first example; Steps 3, 4, 5; output Scope; Rules)
- Modify: `professor-orb/skills/debrief/SKILL.md` (Phase 4 opening, lines 106-110; "Spawns" line 169)
- Modify: `professor-orb/CONTEXT.md` ("lore fan-out" entry, line 355)

- [ ] **Step 1: Lore agent frontmatter**

Replace the description's second paragraph and first example, from `Spawned by debrief's Phase 4 with the report path and tracked entity list. Fans` through the first `</example>`, with:

```markdown
  Spawned by debrief's Phase 4 with the report path and tracked entity list. Reads
  the report and each listed entity's article(s), one entity at a time, and merges
  the findings into one proposal. Also useful on demand.

  <example>
  Context: Debrief wrote a report touching six entities
  user: (debrief spawns this agent with the report path and entity list)
  assistant: "Six entities. I'll check each one's article against the report in turn and merge the findings into one proposal."
  <commentary>Matches debrief's Phase 4 handoff.</commentary>
  </example>
```

- [ ] **Step 2: Lore agent Steps 3 to 5**

Replace everything from `### Step 3: Decide whether to fan out` up to (not including) `### Step 6: Contradiction analysis and quote anchoring` with:

```markdown
### Step 3: Locate each entity's articles

For each entity on the list, find its KB article(s) via the folder structure and cross-reference format learned in Step 1. Before reading one, check it against the project's content-exclusion tags (per the conventions learned in Step 1); skip an excluded article and surface it only in the Deferred / Flagged bucket, without reading its content. An entity with no article goes under Entities Without Articles rather than being guessed at.

### Step 4: Compare each entity in turn

Claude Code gives a subagent no way to start subagents, so you do the per-entity work yourself, one entity at a time: read that entity's article(s) and compare them with the report under the rules in Steps 6 and 7. Read nothing wider. The report and the listed entities' articles are the whole scope; an entity the report mentions that is not on the list goes under Entities Without Articles or Non-obvious Connections, not into a fresh read.

### Step 5: Merge

Combine the per-entity findings into one structured proposal, never a per-entity dump. Deduplicate: the same index update, or the same contradiction reached from two entities, becomes one entry. Resolve cross-entity interactions (a relationship update touching two entities, a location that gates a faction's status) from what you have already read.
```

- [ ] **Step 3: Lore agent output and Rules**

In the output format's Scope block, delete the line `**Mode:** Fan-out (N subagents) or Direct analysis (fewer entities or fan-out unavailable)`.

In Rules, replace `- **Keep subagent scope narrow.** One entity, the report, that entity's article(s). Nothing wider.` with `- **Read narrowly.** The report and the listed entities' articles. Nothing wider.`

Then run: `grep -n -i 'subagent\|fan' professor-orb/agents/lore.md`
Expected: only the Step 4 sentence that explains why there are no subagents.

- [ ] **Step 4: Debrief Phase 4**

In `skills/debrief/SKILL.md`, replace

```markdown
Once the report is written, spawn the `lore` agent with fan-out instructions:

- Pass the report's file path and the full entity list you tracked in Phases 1 and 2.
- Instruct the agent to fan out: one subagent per entity touched in the session, each subagent reading only the session report and that entity's KB article(s). The lore agent fans out per entity when the session touched three or more entities; smaller sessions are analyzed directly.
- The parent `lore` agent merges the subagents' findings into a single structured proposal: non-obvious connections, contradictions, lore candidates, and entities without articles.
```

with

```markdown
Once the report is written, spawn the `lore` agent with the report's file path and the full entity list you tracked in Phases 1 and 2. It checks each entity's article against the report in turn and returns one structured proposal: non-obvious connections, contradictions, lore candidates, and entities without articles.
```

and replace `- **Spawns:** The \`lore\` agent at the start of Phase 4 for KB cross-referencing, fanned out per entity.` with `- **Spawns:** The \`lore\` agent at the start of Phase 4 for KB cross-referencing.`

- [ ] **Step 5: Glossary entry**

In `CONTEXT.md`, replace the whole "lore fan-out" entry (from `**lore fan-out**:` through its `_Avoid_:` line) with:

```markdown
**lore check**:
The lore agent's pass over one session: a single agent that reads the session report
and each listed entity's article(s), one entity at a time, and merges its findings into
one proposal. Claude Code gives a subagent no way to start subagents, so the earlier
one-subagent-per-entity design never ran. Default model (contradiction checking is
judgment work; haiku is for the mechanical sweep). Every contradiction flag is
quote-anchored: the exact existing KB sentence and the exact session-report claim, side
by side, never a paraphrase of either. False contradictions become visible because the
quotes don't actually conflict. Flags feed temporal triage, the same flow as the
historian's; one inconsistency flow, not two.
_Avoid_: "lore fan-out" (it cannot fan out), paraphrased contradiction reports, haiku for lore judgment calls
```

- [ ] **Step 6: Check for leftovers and em dashes, then commit**

Run: `grep -rn -i 'fan out\|fan-out\|fans out\|fanned' professor-orb --include=*.md | grep -v 'commands/log.md'`
Expected: only the `_Avoid_` line in `CONTEXT.md`.
Run: `grep -n $'\xe2\x80\x94' professor-orb/agents/lore.md professor-orb/skills/debrief/SKILL.md professor-orb/CONTEXT.md`
Expected: no output.

```bash
git add professor-orb/agents/lore.md professor-orb/skills/debrief/SKILL.md professor-orb/CONTEXT.md
git commit -m "fix(professor-orb): one lore agent reads each entity in turn; drop the fan-out it cannot run

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Correction hook: half the words, and say less

**Files:**
- Modify: `professor-orb/hooks/dm-correction.mjs` (header comment lines 2-3; `STOPWORDS` near line 84; `findHits` comment and floor near lines 159-190; output in `main()` near lines 295-310)
- Modify: `professor-orb/skills/SHARED-PRINCIPLES.md` (Principle 3, line 43)
- Test: `professor-orb/hooks/dm-correction.test.mjs`

**Interfaces:**
- Produces: hit header `` `${n} line(s) in this project mention it:` ``; no-hit text beginning `No line in this project matched it.`; instruction containing `only the lines that repeat`.

- [ ] **Step 1: Write the failing tests**

In `dm-correction.test.mjs`, add two cases to the `cases` array of the "lane search" block (after `["carries a file:line pointer", ...]`):

```js
    ["names what it searched", out.includes("in this project mention it"), true],
    ["asks only about copies", out.includes("only the lines that repeat"), true],
```

In the "a correction the hook cannot locate still speaks" block, change `out.includes("No line in the campaign lane matched")` to `out.includes("No line in this project matched")` and add the case:

```js
    ["covers a claim made only in chat", out.includes("something you said in chat"), true],
```

Then add this block directly after the "lane search" block's closing `})();`:

```js
console.log("words a correction shares with unrelated lines are not a match:");
(function () {
  // 2026-09-30: "every" and "single" matched an amulet and a deity, twenty
  // lines in all, none of them about the claim. Eight search words now need
  // four in one line.
  const dir = project(
    "commonwords",
    [{ name: "rolara", kbRoot: "settings/rolara", homebrewRoot: "homebrew/rolara", sessionReportsRoot: "session-reports/rolara" }],
    {
      "homebrew/rolara/magic-items/Amulet.md": md("magic-item", "Every amulet guards against a single form of harm, set when it is made."),
      "settings/rolara/deities/Sun.md": md("Person", "Every temple, every prayer, every sunrise is hers."),
      "session-reports/rolara/BGG/reports/2026-09-30-Gambit-REPORT.md": md("Session Report", "Aethon stayed aboard the Vigil."),
    }
  );
  const out = runHook(
    "Every single report since he was encountered at the underwater temple has tracked his status and location without fail, so you're wrong there.",
    dir
  );
  const cases = [
    ["still reads as a correction", out.includes(MARKER), true],
    ["lists no line", /:\d+\s\s/.test(out), false],
    ["says nothing in the project matched", out.includes("No line in this project matched"), true],
  ];
  report(cases, out);
  rmSync(dir, { recursive: true, force: true });
})();
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node professor-orb/hooks/dm-correction.test.mjs`
Expected: FAIL on "names what it searched", "asks only about copies", "says nothing matched" (renamed text), "covers a claim made only in chat", "lists no line", and "says nothing in the project matched".

- [ ] **Step 3: Header comment and stoplist**

Change the header's second and third lines to:

```js
// UserPromptSubmit hook: catches a DM correction and, in Task 2, searches the
// project for every copy of what they corrected.
```

Replace the `STOPWORDS` declaration with:

```js
const STOPWORDS = new Set([
  "that", "this", "never", "happened", "happen", "wrong", "incorrect", "said",
  "told", "about", "there", "their", "they", "them", "with", "from", "have",
  "what", "when", "where", "which", "were", "was", "and", "the", "for", "not",
  "didnt", "doesnt", "actually", "really", "just", "only", "also", "fucking",
  // Contractions, after the tokenizer strips the apostrophe. "you're wrong" is
  // one of the correction patterns, so "youre" was a search word in nearly
  // every correction, matched nothing, and only raised the bar for the rest.
  "youre", "thats", "dont", "isnt", "wasnt", "arent", "werent", "theyre",
  "theres", "cant", "wont", "hasnt", "havent",
]);
```

- [ ] **Step 4: The floor**

Replace the first paragraph of the comment above `findHits`:

```js
// Every markdown line under roots holding at least two search terms, or one
// when the correction yielded only one term. Two is the floor because a single
// common noun ("reporter") matches half a campaign, and the DM reads this list.
```

with

```js
// Every markdown line under roots holding at least half the search terms,
// rounded up and never fewer than two, or one when the correction yielded only
// one term. Half, not a flat two: on 2026-09-30 an eight-word correction matched
// twenty lines that shared only "every" and "single" with it, while a real copy
// of a claim shares most of its words. The 2026-09-18 correction yields four
// terms, so its bar stays at two and both of its copies are still found.
```

and replace `const floor = terms.length === 1 ? 1 : 2;` with:

```js
  const floor = terms.length === 1 ? 1 : Math.max(2, Math.ceil(terms.length / 2));
```

- [ ] **Step 5: The output**

In `main()`, replace

```js
    out.push("No line in the campaign lane matched it. Find what they corrected yourself,");
    out.push("then fix every copy before anything else this turn.");
```

with

```js
    out.push("No line in this project matched it. Find what they corrected yourself,");
    out.push("then fix every copy before anything else this turn. When what they corrected");
    out.push("was something you said in chat, no file holds it and nothing needs fixing.");
```

replace

```js
    out.push(`${hits.length} line${hits.length === 1 ? "" : "s"} in the campaign lane mention it:`);
```

with

```js
    out.push(`${hits.length} line${hits.length === 1 ? "" : "s"} in this project mention it:`);
```

and replace

```js
    out.push("Report this list to the DM and ask once whether to fix them all.");
    out.push("A correction is not closed while a copy survives.");
```

with

```js
    out.push("Read each line against what the DM corrected. Put to the DM only the lines that repeat");
    out.push("the corrected claim, and ask once whether to fix them all. A line that shares words with");
    out.push("the correction without repeating the claim is not a copy. When no line repeats it, say");
    out.push("nothing about this search. A correction is not closed while a copy survives.");
```

- [ ] **Step 6: Principle 3 wording**

In `skills/SHARED-PRINCIPLES.md`, replace `which searches the lane itself before this file is even read.` with `which searches the project itself before this file is even read.`

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node professor-orb/hooks/dm-correction.test.mjs`
Expected: PASS, every expectation met (the existing "lane search", "snippet", starvation, and file-crowding blocks unchanged and green), exit 0.

- [ ] **Step 8: Commit**

```bash
git add professor-orb/hooks/dm-correction.mjs professor-orb/hooks/dm-correction.test.mjs professor-orb/skills/SHARED-PRINCIPLES.md
git commit -m "fix(professor-orb): a correction search needs half its words in one line

Finishes the 2026-09-29 report's hook item, which d4e6717 left half done:
common words still matched unrelated lines, and the output called a
project-wide search the campaign lane.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Version 1.22.0, all suites, live checks on rolara

**Files:**
- Modify: `professor-orb/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Bump both versions**

Change `"version": "1.21.1"` to `"version": "1.22.0"` in `professor-orb/.claude-plugin/plugin.json` and in the professor-orb entry of `.claude-plugin/marketplace.json` (the foundryvtt entry stays `1.0.2`).

Run: `grep -n '"version"' professor-orb/.claude-plugin/plugin.json .claude-plugin/marketplace.json`
Expected: `1.22.0` twice, `1.0.2` once.

- [ ] **Step 2: Run all suites**

Run: `for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" > /dev/null || { echo "FAILED: $f"; break; }; done; echo done`
Expected: `done` with no `FAILED:` line.

- [ ] **Step 3: Live check, correction hook on rolara**

Run each, from the working copy:

```bash
node -e 'process.stdout.write(JSON.stringify({prompt:process.argv[1],cwd:"C:/Users/jorda/GitHub/rolara-project"}))' "Every single report since he was encountered at the underwater temple has tracked his status and location without fail, so you're wrong there." | node professor-orb/hooks/dm-correction.mjs
```

Expected: the "No line in this project matched it." text and no listed lines.

```bash
node -e 'process.stdout.write(JSON.stringify({prompt:process.argv[1],cwd:"C:/Users/jorda/GitHub/rolara-project"}))' "No, Aethon was aboard the Twilight's Vigil, not at the Stone of Endurance. You're wrong." | node professor-orb/hooks/dm-correction.mjs
```

Expected: a list in which every line names Aethon, the Vigil, or the Stone of Endurance.

```bash
node -e 'process.stdout.write(JSON.stringify({prompt:process.argv[1],cwd:"C:/Users/jorda/GitHub/rolara-project"}))' "That NEVER happened, the reporter never asked what the team was called" | node professor-orb/hooks/dm-correction.mjs
```

Expected: the same 13 lines the 1.21.1 hook lists for this message (four search words, so the bar is unchanged).

- [ ] **Step 4: Live check, the status rule on rolara's staged files**

Run:

```bash
node -e '
const fs=require("fs"),path=require("path"),{execSync}=require("child_process");
const rule=require("./professor-orb/references/base-rules.json").rules.contentStagedNoPresentStatus;
const re=new RegExp(rule.params.pattern,rule.params.flags);
const root="C:/Users/jorda/GitHub/rolara-project";
const files=execSync("git ls-files session-reports",{cwd:root,encoding:"utf8"}).split("\n").filter(f=>f.endsWith(".md")&&!/-(REPORT|PREP)\.md$/i.test(f));
const hits=files.filter(f=>re.test(fs.readFileSync(path.join(root,f),"utf8").split(/^---$/m).slice(2).join("---")));
console.log(files.length+" staged files; "+hits.length+" flagged: "+hits.join(", "));'
```

Expected: exactly one flagged file, `session-reports/rolara/Big-Guys-Gang/content/references/Deck-of-Many-Things-Rolara-Provenance.md`.

- [ ] **Step 5: Update the Status table in this plan, then commit**

Set every task row to `done`.

```bash
git add professor-orb/.claude-plugin/plugin.json .claude-plugin/marketplace.json docs/superpowers/plans/2026-10-01-professor-orb-status-lines-items-and-correction-search.md
git commit -m "chore(professor-orb): 1.22.0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After landing: rolara rollout

Each step changes the rolara repo and waits for the DM's go-ahead. None of it is part of this branch.

1. **Put the rule in rolara's `conventions.json`.** The DM picks one way: a full setup resync, or adding the `contentStagedNoPresentStatus` entry from `references/base-rules.json` to both settings' `rules` by hand and setting `generatedBy` to `"manual"`. The hand edit is the lighter path for one rule.
2. **`CLAUDE.md` line 154:** mark "Current Status" as a header for vault articles only.
3. **The Deck file:** remove the Current Status section (line 65) and the status lede ("Currently depleted of the cards pulled by the party") from `session-reports/rolara/Big-Guys-Gang/content/references/Deck-of-Many-Things-Rolara-Provenance.md`, after showing the DM the text being removed.
4. **Confirm in a fresh rolara session** that the plugin reports 1.22.0 behavior: saving a staged article with a `## Current Status` heading is refused with the rule's message.
