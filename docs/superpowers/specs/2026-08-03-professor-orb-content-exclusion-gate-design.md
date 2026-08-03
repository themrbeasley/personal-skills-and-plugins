# Professor Orb Content Exclusion Gate: Design

**Date:** 2026-08-03
**Status:** Draft for DM review
**Scope:** professor-orb plugin only. Installation into the Rolara consumer project is config wiring. No content in any consumer project is moved, read, or reorganized by this work.

## The problem

Professor-orb's content-exclusion promise ("Claude cannot touch NSFW-tagged articles") is, today, entirely advisory. It exists as prose instructions in six skill and agent files telling the model to check frontmatter before reading. Nothing enforces it.

Verified state of the plugin as of this spec:

- `references/base-rules.json` ships **no** content-exclusion rule. The NSFW example in `conventions-schema.md` lines 678 and 683 is illustrative documentation, not shipped base data.
- `hooks/hooks.json` registers `PostToolUse` on `Write|Edit` and `Stop`. There is **no** hook on `Read`.
- The only NSFW-adjacent enforcement that exists is publish gating: `bodyImpliesFrontmatter` and `frontmatterImpliesFrontmatter` force `publish: false`. Those govern whether an article reaches a website. They do not govern whether Claude reads it.
- `skills/prep/SKILL.md` and `agents/rule-fixer.md` both read (and rule-fixer edits) KB articles and carry **no** content-exclusion instruction at all.

## Three findings that change the agreed design

These emerged from research after the design conversation and alter what can be promised.

### 1. OS-level enforcement is unavailable on this DM's platform

The permissions documentation states verbatim:

> Read and Edit deny rules apply to Claude's built-in file tools and to file commands Claude Code recognizes in Bash, such as `cat`, `head`, `tail`, and `sed`. They don't apply to arbitrary subprocesses that read or write files indirectly, like a Python or Node script that opens files itself. For OS-level enforcement that blocks all processes from accessing a path, enable the sandbox.

The sandbox is the documented answer to that gap. The sandboxing documentation states verbatim:

> The sandbox is built into Claude Code and runs on macOS, Linux, and WSL2. Native Windows is not supported. On Windows, run Claude Code inside a WSL2 distribution.

The DM runs native Windows 11. **The subprocess gap therefore cannot be closed on the current platform.** A Node or Python script that Claude writes and executes can open a denied file directly. Permission deny rules do not stop it, and the sandbox that would is not available natively.

This is stated plainly because the whole point of this work is to stop overstating a guarantee. Two honest options exist, and both are the DM's call:

- **Accept it.** Deny rules stop every ordinary access path (built-in tools, recognized Bash read commands, symlinks in either direction). The residual gap requires Claude to write and run a script that opens the file, which is not an accident mode.
- **Run Claude Code inside WSL2.** This makes `sandbox.filesystem.denyRead` available, which is OS-enforced on the process and all children. This is a workflow change well beyond this spec's scope and is named only so the option is on record.

The spec below assumes the first. Nothing in it claims subprocess-proof enforcement.

### 2. The validation sweep is itself a leak path, and it is not currently runnable

Two separate problems.

**It reads bodies unconditionally.** `workflows/validation-sweep.mjs` line 450 is the first instruction in the per-file loop: `'1. Read the file: frontmatter and body.'` There is no tag, frontmatter, or path gate before it. Worse, body text escapes the shard boundary: `mechanicallyFixable` and `needsJudgment` findings carry free-text `description`, `fix`, and `question` fields, and `prohibitedPattern` and `wikilinkPolicy` findings naturally quote offending body text into them. Those strings reach the DM-facing report and, for approved fixes, get re-sent to another subagent via `fixPrompt` (line 477).

A second body reader is non-obvious: the ownership claims pass (`claimsPrompt`, line 406) runs a `grep` whose output lines are raw body content from index files. That path uses Bash, so a `Read` deny rule does not cover it.

**Nothing invokes it.** There is no `/sweep` command. No skill, agent, or command runs the sweep. `commands/migrate.md:27` explicitly forbids starting one unasked, and `/migrate`'s Source 2 consumes sweep findings that nothing in the plugin ever produces. The only documented trigger (`README.md:37`, `skills/orb/SKILL.md:45`) is the DM manually invoking the Workflow tool.

Since the drift-detection half of this design depends on the sweep being both safe and runnable, both are in scope.

### 3. Two corrections to what was said during the design conversation

- **Do not write `Write(...)`, `Glob(...)`, or `NotebookEdit(...)` path rules.** The docs state: "Claude Code checks file permissions against `Edit(path)` and `Read(path)` rules only. If you write a path rule for `Write`, `NotebookEdit`, `Glob`, or the legacy `MultiEdit` tool instead, Claude Code accepts the rule but never consults it, and warns at startup." `Edit` rules cover all file-editing tools including Write. `Read` deny additionally blocks Edit on the same path.
- **Grep and Glob coverage is documented as best-effort, not guaranteed.** The docs say Claude "makes a best-effort attempt to apply `Read` rules to all built-in tools that read files like Grep and Glob." That hedge is the docs' own wording and is recorded here rather than rounded up.

## Architecture

Three layers, with honest labels for what each actually provides.

| Layer | Mechanism | What it guarantees |
|---|---|---|
| **Wall** | `permissions.deny` in the consumer's `.claude/settings.json` | Harness-enforced, evaluated before any tool runs. Blocks Read, Edit, Grep, Glob (best-effort on the latter two), and recognized Bash read commands. Deny beats allow at every settings scope. Symlinks blocked in either direction. Does not cover arbitrary subprocesses. |
| **Drift detector** | New `tagImpliesPath` check kind, run by the write-time hook and by the sweep | Catches an excluded-tag article sitting outside the protected path, where the wall does not reach it. |
| **Behavior** | New SHARED-PRINCIPLES Principle 13 | Stops a confused agent treating a permission denial as an obstacle to route around. Not enforcement; a guardrail against well-intentioned circumvention. |

### Layout

Per-type `nsfw/` subfolders. An excluded article lives beside its normal siblings, one level down:

```
settings/rolara/characters/nsfw/Some-Article.md
settings/rolara/locations/nsfw/Some-Place.md
```

Each `nsfw/` folder carries its own `-INDEX` per existing folder-index parity rules. This matters for more than tidiness: because the subfolder owns its own index, the parent index does not claim its articles, so excluding the whole folder from the sweep leaves `singleOwnership` math consistent. Excluding articles whose claims live in a still-scanned parent index would manufacture false orphan findings.

### The deny rules

Written to the consumer project's `.claude/settings.json` (tracked, not `.local.json`, so the rule travels with the repo):

```json
{
  "permissions": {
    "deny": [
      "Read(**/nsfw/**)",
      "Edit(**/nsfw/**)"
    ]
  }
}
```

Pattern rationale, from the docs' pattern table: `**/nsfw/**` matches a directory named `nsfw` at any depth in **any** rule type. A bare `nsfw/**` also matches at any depth for deny and ask rules specifically, but the explicit `**/` form does not depend on that rule-type distinction and is therefore less fragile. Both `Read` and `Edit` are listed because `Read` deny covers Edit but the reverse is not true, and listing both makes the intent legible to a human reading the file.

Windows note: paths are normalized to POSIX before matching, so this pattern works unchanged on the DM's platform.

### The `tagImpliesPath` check kind

New check kind for `hooks/validate-write.mjs`.

**Category:** `frontmatter` (the trigger is a frontmatter field, mirroring `frontmatterImpliesFrontmatter`).

**Params:**

```json
{
  "tags": ["NSFW"],
  "requiredSegment": "nsfw"
}
```

**Semantics:** If the article's frontmatter `tags` array contains any value in `params.tags`, the article's path must include a path segment exactly equal to `params.requiredSegment`. Otherwise the rule fails with a message naming the tag found and the folder the article belongs in.

**Implementation notes:**

- Anchor on `ctx.relPath` (prong-root-relative), not `ctx.relProjectPath`. A prong root that itself contains a segment named `nsfw` would otherwise produce a false pass.
- `ctx.relPath` comes from `path.relative` and therefore uses the **platform separator**. Split on both: `path.dirname(ctx.relPath).split(/[\\/]/)`.
- Compare segments case-insensitively. A folder named `NSFW` is the same folder.
- Return `null` (not applicable) when `params.tags` is missing or empty, or `params.requiredSegment` is absent. Guard params rather than relying on the hook's swallow-and-continue catch.
- Tag matching is case-insensitive against the frontmatter values, so `nsfw` and `NSFW` both trigger.

**Enforcement:** `block`.

**Where it ships:** as a rule in `references/base-rules.json` with `enforcement: "off"` by default, plus the check kind registered in `CHECKS`. Shipping it `off` means every consumer inherits the machinery without having a tag vocabulary imposed on them; the DM turns it on at setup and names their own tags. This follows the existing pattern where the base layer ships capability and the extras layer supplies project specifics.

**The four-way duplication obligation.** The comment above the `CHECKS` map is load-bearing and states the rule: adding a check kind requires matching edits in four places. All four are in scope:

1. `skills/setup/references/conventions-schema.md`, frontmatter rules table (normative catalog)
2. `hooks/validate-write.mjs`, the `CHECKS` map
3. `workflows/validation-sweep.mjs`, `checkerPrompt` line 455 (the frontmatter-category enumeration line)
4. `agents/kb-validator.md` Step 4, a new bullet under the **Frontmatter validation** header (bullets 76 to 81)

### Sweep exclusion

The sweep must never hand an excluded article to a checker subagent. The gate is placed in the **deterministic enumeration**, not in the checker prompt, because a prompt instruction to "check frontmatter before reading the body" is exactly the advisory pattern this whole spec exists to replace.

**Design:** before sharding, the enumerator reads each candidate file's frontmatter itself (the sweep already runs in Node and can parse frontmatter with the same subset parser the hook uses). Any file whose tags match the configured excluded set is:

- dropped from the shard lists entirely, so no subagent ever receives its path
- recorded in a separate `excluded` collection carrying **path and matched tag only, never body content**
- reported in the sweep report as a location finding if it sits outside the required segment, and as a silent skip if it is correctly placed

**Ownership math:** excluded files must be added to whatever collection `singleOwnership` treats as "articles that exist," so that an index claiming them does not produce a false orphan. Because correctly-placed excluded articles live in a folder whose own index is also excluded, the common case is that the whole folder drops out together and the math is undisturbed. The incorrectly-placed case (drift) is precisely the one the location finding surfaces.

**The claims-extraction path.** `claimsPrompt` runs a grep over index files whose output is raw body text. Its file list must be filtered by the same exclusion before the grep runs. This path uses Bash and is therefore not covered by the `Read` deny rule; the filter is the only thing protecting it.

**Known consequence, stated rather than hidden:** excluding these articles means `bodyImpliesFrontmatter`, `prohibitedPattern`, and `wikilinkPolicy` never run against them. The first of those is the publish leak guard. This is an accepted trade: the articles are contained by path and by deny rule, so the publish gate matters less for them than it does for an article Claude can actually reach. It is named here so the trade is visible rather than discovered later.

### The `/sweep` command

New command file, `professor-orb/commands/sweep.md`, following the shape of the existing five.

Rationale: the sweep currently has no invocation path, and `/migrate`'s Source 2 consumes findings nothing produces. The drift-detection half of this design depends on the sweep being runnable by the DM without knowing Workflow tool internals.

Responsibilities: resolve settings from `conventions.json`, run the scan phase (read-only), present the report, obtain batch approval for the mechanically-fixable bucket via AskUserQuestion, raise needs-judgment items individually, then invoke the fix phase with only the approved items. The two-phase covenant already documented at the top of `validation-sweep.mjs` is the contract; the command drives it rather than reimplementing it.

This closes the loop `/migrate` already assumes exists.

### SHARED-PRINCIPLES Principle 13

New principle: **a permission denial is final.** When a tool call is denied for a path, stop and report it. Do not retry with a different tool, do not route around it with Bash, do not write a script to read the file, and do not treat it as an obstacle to solve. A denial is the system working, not a failure to diagnose.

Two things this requires beyond appending the text:

- **Principle numbers are cross-referenced by number in over twenty places** (for example `skills/timeline/SKILL.md:22` cites "Principle 12"). Appending as 13 is safe. Inserting anywhere earlier is not, and must not be done.
- **The file's header under-declares its own reach.** Line 3 names only "debrief, prep, content, chronicler," but all nine skills, all four agents, and all five commands load this file. A permission principle needs the full reach, or the strictest readers (`lore`, `historian`, `rule-fixer`) could read themselves as out of scope. The header line gets corrected in the same change.

### Filling the two instruction gaps

`skills/prep/SKILL.md` and `agents/rule-fixer.md` read (and rule-fixer edits) KB articles and carry no content-exclusion instruction. Both get one, matching the wording already used in `chronicler`. This is belt-and-braces behind the deny rule, and it costs two lines.

## What ships where

**In this repo (the plugin):**

- `hooks/validate-write.mjs`: `checkTagImpliesPath` plus `CHECKS` registration
- `hooks/validate-write.test.mjs`: cases for tagged-and-correctly-placed (pass), tagged-and-misplaced (block), untagged-anywhere (pass), case-variant folder and tag (block/pass as appropriate), missing params (inert)
- `references/base-rules.json`: the new rule, shipped `enforcement: "off"`
- `skills/setup/references/conventions-schema.md`: catalog row, plus a new section documenting the settings.json deny provisioning
- `workflows/validation-sweep.mjs`: deterministic exclusion in enumeration and in the claims path, `checkerPrompt` line 455 addition
- `agents/kb-validator.md`: Step 4 frontmatter bullet
- `commands/sweep.md`: new
- `skills/SHARED-PRINCIPLES.md`: Principle 13, plus the header reach correction
- `skills/prep/SKILL.md`, `agents/rule-fixer.md`: content-exclusion instruction
- `skills/setup/SKILL.md`: new step provisioning `.claude/settings.json` deny rules, and a Step 11 interview question about excluded tags (setup currently asks nothing of the kind)
- `.claude-plugin/marketplace.json` and `professor-orb/.claude-plugin/plugin.json`: version bump (minor; new check kind plus new command)

**In the Rolara consumer project (config wiring only, done by me):**

- `.claude/settings.json`: the deny block
- `.professor-orb/conventions.json`: the `tagImpliesPath` rule at `enforcement: "block"`, hand-edited. **Never by running `professor-orb:setup`**, which regenerates the file wholesale and would discard hand-tuned rules. Set `generatedBy: "manual"`.

**Explicitly not in scope:**

- Moving, reading, reorganizing, or otherwise touching any article in Rolara's KB. The relocation into `nsfw/` subfolders is `/migrate`, run by the DM, on the DM's timeline, after this ships.

## Ordering

The deny rule must land **before** the DM relocates anything, so that the moment content arrives in a protected folder it is already protected. The `tagImpliesPath` rule can land at the same time; it will report every currently-misplaced article as drift, which is the correct and useful state until the migration runs.

## Testing

Node built-ins, no framework, matching the existing suites. `validate-write.test.mjs` gains the cases listed above and runs via `node professor-orb/hooks/validate-write.test.mjs`.

The deny rules themselves cannot be unit tested from inside this repo, because they are enforced by the harness rather than by plugin code. Verification is manual and must be done in a live session after install: attempt a Read of a file under a protected path and confirm the denial. That verification step is a deliverable, not an afterthought, precisely because this feature's entire value is that it actually works.

## Open questions for the DM

1. **Excluded tag vocabulary.** The spec assumes `NSFW` and folder segment `nsfw`. Any others, now or anticipated?
2. **The Windows subprocess gap.** Accept it as documented, or is WSL2 worth considering separately?
3. **Sweep exclusion reporting.** Should a correctly-placed excluded article appear in the sweep report at all (as a counted-but-unread line), or be entirely invisible?
