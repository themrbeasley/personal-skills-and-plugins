---
description: "Run the KB-wide validation sweep: a read-only scan across every setting's knowledge base, sharded in parallel, checked against conventions.json. Presents violations sorted into mechanically fixable (exact fix stated) and needs judgment (exact question stated), gets one batch approval for the whole mechanically-fixable bucket, resolves needs-judgment items individually, then applies only what was approved. Drives workflows/validation-sweep.mjs, the same module setup's onboarding migration and /migrate share the base rule set with. Mutates nothing until the DM approves. Use for a periodic health check, or after a structural change to confirm the KB came out clean."
argument-hint: "[optional: a specific setting name to scope the sweep to]"
---

# /sweep: KB-wide validation sweep

> **Before you begin:** read `../skills/SHARED-PRINCIPLES.md` (relative to this plugin) and apply its rules throughout this workflow.

You are running professor-orb's whole-KB audit. Until this command existed, the sweep had no invocation path at all: `agents/kb-validator.md` describes itself as "a narrower, lighter alternative to the validation-sweep workflow," and `/migrate`'s Source 2 consumes needs-judgment findings that nothing in the plugin produced. This command is what produces them.

## What this command is not

- **Not a second executor.** It drives `workflows/validation-sweep.mjs` via the Workflow tool, from `.claude/workflows/validation-sweep.mjs` (copied there by `setup`). The two-phase covenant documented at the top of that file, scan mutates nothing, fix applies only what `args.approvedFixes` names, is that module's contract, not reimplemented here.
- **Not a lane command.** It reads across every setting; it writes nothing until Step 4, and even then only through the fix phase's own workers.
- **Not a content tool.** Findings are structural: frontmatter, filename, structural, and content-category rule violations. It does not rewrite prose.
- **Not `/migrate`.** A finding whose fix is a file move (a `tagImpliesPath` location violation, for example) is reported here as needing judgment and resolved by running `/migrate` afterward. This command never moves a file.

## Step 1: Confirm conventions exist

If `.professor-orb/conventions.json` is missing, say plainly that setup has not run and stop. There is nothing to sweep against.

## Step 2: Run the scan phase

Invoke the Workflow tool by name, `validation-sweep`, with no `args` (or `args: { mode: "scan" }`, equivalent). If the DM named a setting in the invocation, note it for Step 3's presentation, but let the scan run across all settings regardless: the report is cheap to filter and a DM who asked about one world may still want to know another has drift.

This phase is read-only. It shards every setting's KB across parallel haiku checkers, verifies enumeration by an independent census before scanning anything, and returns one merged report. Nothing is written.

**If `result.enumerationVerified` is false,** the scan aborted before checking anything, rather than risk certifying a partial KB as clean. Report `result.nextStep` verbatim and stop. Do not retry silently.

## Step 3: Present the report

Summarize for the DM, filtered to the setting they named if they named one:

- **Coverage.** `filesScanned`, `shardsChecked`, `shardsDropped` (a dropped shard's files were not verified; name them if any).
- **Mechanically fixable.** Count, and the rule IDs involved. Do not list every instance in chat; point at the count.
- **Needs judgment.** Each one, individually, with its stated `question`. A `tagImpliesPath` location violation says explicitly that the article sits outside the folder the project's permission deny rule covers, so nothing is currently protecting it; surface that framing verbatim rather than softening it, since it is the most urgent class of finding this sweep can produce.
- **Unattributed files**, if `filesUnattributed` is greater than zero: files no index claims. Name the sample.
- **Tag registry.** One proposed replacement per setting, only if the DM wants to update it now.

## Step 4: Resolve

**Mechanically fixable bucket:** present it as one batch. A single yes from the DM approves the whole bucket; do not ask per finding. Build `args.approvedFixes` from exactly the items the DM approved, in the shape the fix phase expects: `{ file, ruleId, description, fix }`.

**Needs-judgment bucket:** raise each individually via AskUserQuestion. A finding whose resolution is a structural change (a move, a rename, an index rebuild) is not something this command applies; tell the DM to run `/migrate` with that scope afterward, and do not fold it into `args.approvedFixes`.

**Tag registry:** if the DM approves a proposed replacement for a setting, pass `args.approvedTagRegistry` and `args.tagRegistryPath` for that one setting. A setting sharing a `tagRegistryPath` with another whose scan marked `conflict: true` needs `conventions.json` fixed first; do not write either registry in that state.

If nothing was approved (no mechanical fixes, no tag registry), do not invoke the fix phase at all.

## Step 5: Run the fix phase, if anything was approved

Invoke the Workflow tool again, same name, with `args = { mode: "fix", approvedFixes: [...], approvedTagRegistry: {...}, tagRegistryPath: "..." }`, only the fields that apply. This phase writes: each approved fix goes through the `rule-fixer` agent, which reads, edits, and re-verifies the single file it was given, and which stops rather than fixes if that file is denied by a permission rule (SHARED-PRINCIPLES Principle 13).

Report what the fix phase returns: how many fixes succeeded, how many failed and why, and whether the tag registry write confirmed.

## Step 6: Report

```
## /sweep Report

### Coverage
Files scanned: N. Shards checked: N. Shards dropped: N (name them, or "None").

### Applied
Mechanical fixes applied: N, by rule ID.
Tag registry: [updated for <setting>, or "Unchanged"].

### Still needs judgment
[Every needs-judgment item not resolved this run, with its question. "None" if empty.]

### Unattributed
[Files no index claims, or "None".]

### Next
[If any tagImpliesPath location findings remain: name them specifically and
recommend /migrate to relocate them, since those are unprotected until moved.
Otherwise: recommend re-running after any structural change.]
```

## Things to never do

- **Never invoke the fix phase with a fix the DM did not approve.** Not a repaired guess, not an "obviously correct" extra.
- **Never apply a needs-judgment finding as a mechanical fix.** The bucketing in the scan report is authoritative; do not recategorize one because the fix looks simple.
- **Never treat a `tagImpliesPath` finding as anything but urgent.** It names an article a permission rule is not currently covering.
- **Never run this from inside `/migrate`.** `commands/migrate.md` explicitly declines to start a sweep unasked; this command is what the DM reaches for instead, on their own terms.

## How this command connects to the others

- **Fills the gap `/migrate` already assumes is filled.** Its Source 2 (needs-judgment findings) had no producer before this command existed.
- **Feeds `/migrate`.** A location violation resolved here as "run /migrate" is exactly the kind of scope `/migrate`'s Step 1 offers back as outstanding structural work.
- **Uses the `rule-fixer` agent** for every approved mechanical fix, one file at a time, same as any other fix path in the plugin.
