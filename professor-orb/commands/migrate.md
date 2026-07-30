---
description: "Restructure a knowledge base to a scope the DM states, or to one of the two places professor-orb already records outstanding structural work: setup's deferred items and the validation sweep's needs-judgment findings. Resolves the scope into a concrete plan, writes it to .professor-orb/proposals/ as a file the DM may edit, and executes exactly what the approved file says. Every run requires version control, requires a clean tree, takes its own snapshot commit, moves conventions.json aside behind its own preparation commit so the write-time hook stays silent through the run, asserts that every wikilink resolving before still resolves after, and lands its own work as a preparation commit and a migration commit whose combined undo is two git reverts, migration first. Performs structural operations only: it moves, renames, splits, absorbs, rebuilds indexes, retypes, repairs frontmatter, and updates path references, and never rewrites body prose, which is chronicler's work. Not a lane command: it restructures across prongs by nature and commits its own work rather than deferring to /scribe, /log, or /catalog. Use for a folder cleanup, an entity rename, a threshold split, an index rebuild, or a setting or campaign lifecycle change."
argument-hint: "[optional: what to migrate, in your own words]"
---

# /migrate: DM-scoped structural change

> **Before you begin:** read `../skills/SHARED-PRINCIPLES.md` (relative to this plugin) and apply its rules throughout this workflow.

You are restructuring the DM's knowledge base to a scope they state. Setup's initial migration applies professor-orb's own schema, which is known and derivable, so its plan is not news to anyone. This command's target is DM intent, which is not derivable, so the resolved plan is the only place a misreading becomes visible before it costs anything. That is why this one proposes and setup does not.

This command is **standalone**. It is not part of the debrief, prep, content, chronicler, kb-validator session pipeline and never writes `.professor-orb/pipeline-state.json`.

## What this command is not

- **Not a second executor.** It drives `workflows/migrate.mjs`, the same module setup's migration runs. The snapshot discipline, the git-ignored decline and skip, the per-operation accounting, and the link-integrity assertion are all that module's and are not reimplemented here.
- **Not a content tool.** It performs structural operations. Renaming a faction updates the filename, the frontmatter `name`, and every wikilink to it; it does not rewrite the sentences that mention the faction. Prose changes are `chronicler`'s job.
- **Not a lane command.** `/scribe`, `/log`, and `/catalog` each commit one prong and never cross. `/migrate` restructures across prongs by nature, so it commits its own work in one commit. This is the one exception to the lane rule, and it is stated here so it does not read as a violation of it.
- **Not an index author.** Rebuilding an index regenerates its link list from the articles actually in its folder. The DM's frontmatter and any prose in that index are preserved.

## Step 1: Offer the work that already exists

Invoked with no argument, do **not** ask "what would you like to migrate?" Two components already record outstanding structural work, and both currently produce output nothing consumes. Read them and offer what they hold, alongside the option of a scope the DM states themselves.

**Source 1: setup's deferred items.** Setup's after-action report names them: git-ignored files inside a prong, absorb candidates, split proposals, `-TIMELINE` and `-HISTORY` files, articles missing `publish`, and prose path references in `CLAUDE.md` or elsewhere. **Re-derive these from the current tree rather than trusting the report**, which may be months old and may name work the DM has since done by hand.

**Source 2: the validation sweep's needs-judgment findings**, if a sweep has run in this project. Each carries a `question` field, which is exactly the input scope negotiation needs. Ownership conflicts, ambiguous types, and multi-index folders all land there. If no sweep has run, say so in one line and do not run one unasked: a sweep is a long operation and the DM did not ask for it.

**Source 3: a scope the DM states**, in their own words.

Present the first two as a structured pick-one-or-several menu with AskUserQuestion, with counts, plus an option for stating something else. If neither source holds anything and the DM gave no argument, say the knowledge base has no outstanding structural work recorded and ask what they had in mind.

## Step 2: Resolve the scope

The scope arrives as free text: "clean up items/", "rename the Ashfall Compact to the Cinder Pact everywhere", "split my continent article into one per region", "retire the Karsk campaign", "start a second setting".

Resolution is a conversation, not a parse. **Restate the scope as you understood it, name what it would touch, and ask about anything genuinely ambiguous.** Do not interrogate: one clarifying exchange, then a plan.

**State the prose boundary whenever the scope crosses it.** "Rename X to Y everywhere" naturally reads as including body text, and it does not include it. Say which half they are getting, in one sentence, and name `chronicler` as what handles the other half. Do this when the scope crosses the line, not on every run.

**Creating a setting is out of scope for this release.** If the DM asks to start a second world, say that `/migrate` performs lifecycle operations on a setting that already exists (a rename, a retirement, a split, or a merge) and that creating one is not part of what it does. Do not improvise a creation path: a half-created setting with no `conventions.json` entry is worse than none.

**Refuse a scope that resolves to nothing** with a plain sentence. No snapshot, no commit, no proposal file.

## Step 3: Require a clean tree

Run `git status --porcelain`. If anything is uncommitted, **stop**. Report what is outstanding, and offer to commit it first through whichever lane command owns it (`/scribe`, `/log`, `/catalog`) or as the DM prefers. `/migrate` will not fold unrelated changes into its snapshot: the snapshot is the DM's only undo, and a snapshot containing their unrelated work in progress cannot be reverted without taking that work with it.

`/migrate` requires version control. If the project has none (`.professor-orb/versioning.json` mode is `changelog`, no marker exists at all, or the project is simply not a git repository), **stop** here rather than continue. There is no confirmation that makes this path runnable: the executor cannot determine which sources are git-ignored without a repository to ask, and it refuses the whole run on that alone before it ever reaches the snapshot check, having done nothing. Say so plainly, and point the DM at `setup`, which is what establishes version control for a project. Do not offer to initialize a repository here yourself; that is setup's job, not this command's.

## Step 4: Build the plan, run the prechecks, write the proposal

Build the scope into the structure `buildScopedPlan` takes: `{projectRoot, settings, baseRules, scope}`. `scope`'s keys are `pathMoves`, `absorbFolders`, `splitFolders`, `entityRenames`, `rebuildIndexes`, `retypes`, `frontmatterRepairs`, `suffixRenames`, and `prosePathUpdates`, one per registered planner, for structural changes inside a setting's own folders, and a setting rename, a setting retirement, a campaign retirement, a setting split, or a setting merge for a change to the settings themselves. Every article, every destination, and every referring file is named explicitly. The proposal the DM reads is the list of files that will actually move, not a description of a rule that will be applied to files they cannot see.

**The prechecks run while the plan is being built, before the DM ever sees it.** A plan that cannot execute is worse than no plan. Destination collisions are checked before anything moves, both between two operations in this plan and against what already exists on disk. A path the scope names that neither exists now nor is created earlier in the plan is declined with that exact path quoted back, rather than passing cleanly and failing after the snapshot; the same check applies to a referring file the scope names for a wikilink rewrite that is not actually there. A git-ignored source declines its whole scope entry together, every operation that entry would have emitted, not only the operation naming the ignored file, because applying the rest would leave the project matching neither its old shape nor the one the DM approved. The missing-path decline and the ignored-source decline both appear in the proposal's Declined section. A destination collision does not: it renders in its own Prechecks section instead, and it means the plan cannot execute as written.

**If a collision is found, say so instead of asking for approval as though the plan will run.** Write the proposal as usual so the DM can see exactly what collided and where, but do not present it for approval: name the colliding path or pair, point at the file's Prechecks section, and ask the DM to change the scope (rename one side, exclude the colliding path, or point at a different destination) so the plan can be rebuilt without the collision. Return to the top of this step once the scope changes; do not carry a plan with failed prechecks forward into Step 5.

Write the proposal with `renderProposal` to `.professor-orb/proposals/migrate-<short-slug>.md`, following the same proposal-file convention `chronicler` uses: the DM may edit the file on disk, and execution reads that file rather than the conversation. Give the DM a summary and a pointer to the file in chat; do not paste the whole plan into the conversation.

**Then wait.** The DM may approve, or edit the file and then approve. Say plainly that editing it is expected and that what runs is what the file says.

## Step 5: Take the snapshot

Re-read the proposal file from disk. **Execute what the file says, never what the conversation said.** Parse it with `parseProposal`. If it refuses (no `professor-orb:plan` block, a block that will not parse as JSON or is never closed, two blocks in the same file, or a block whose parsed JSON carries no operations array), report the reason and stop; do not reconstruct a plan from the discussion to work around it.

Then commit the snapshot:

```
git commit --allow-empty -qm "chore: pre-migration snapshot before /migrate"
```

Verify the tree is clean afterward and **print the hash**. This hash is half of the DM's undo (Step 6 captures the other half), and it appears again in Step 10's report. Every later step refers to this hash, never to whatever the executor reports as its own `snapshot` field, for a reason Step 6 makes concrete.

## Step 6: Move `conventions.json` aside, and commit that move on its own

Move `.professor-orb/conventions.json` to `.professor-orb/conventions.json.pre-migration` with `git mv`, for the duration of the run, exactly as setup's Step 6 does and for the same reason: the write-time hook fires on every write, and a run touching hundreds of files would otherwise storm the DM with violations for a structure that is mid-move and correct at neither end.

**Commit this move by itself, before Step 7 runs anything:**

```
git commit -qm "chore: migration preparation for /migrate"
```

`applyPlan` does not merely assume a snapshot exists; it verifies one at the moment it is called, reading `git status --porcelain` itself and refusing to start on a dirty tree, because a commit at HEAD that does not contain the current state has nothing to restore to. Moving `conventions.json` aside is itself a change to the tree, so without this commit **every** `/migrate` run would refuse at Step 7 having done nothing but rename one file.

**Print this commit's hash too.** By the time Step 10 runs, this commit is already settled history, so Step 10's own staging never touches it, but its hash still has two jobs ahead of it: Step 10's undo needs it alongside Step 5's hash, and Step 8 needs it if Step 7 refuses.

This is also why the executor's own `snapshot` field is not Step 5's hash. `applyPlan` reads `git rev-parse HEAD` at the moment it runs, which by now is this preparation commit, not Step 5's. Whatever the executor returns or prints as `snapshot`, or whatever restore line it builds from it, do not copy it into the report. Step 5's hash and this commit's hash, both printed above, are the ones the DM needs, and Step 10 uses them and only them.

## Step 7: Execute

Call `applyPlan` (`workflows/migrate.mjs`'s apply mode) with the parsed plan and `"commit": false`, because Step 10 makes the single commit.

**What the executor guarantees, and what you carry into the report rather than restate as your own:** every relocation goes through `git mv`; a scope entry naming a git-ignored source is skipped whole, every operation it emitted, and reported in `result.skipped` rather than moved, because the snapshot does not contain it; every operation that does run lands in exactly one of `applied`, `failed`, or `dropped` (`result.dropped` is a worker that threw or returned nothing, never silently counted as done); and it reports `ignoredEdits` and `ignoredMoved`, the edits and moves the snapshot cannot undo (Step 10 explains both). Read every entry in `result.messages` too, not only the ones already described here: it also carries less common notes, among them a disclosure for an operation that ran even though a sibling in its own scope entry was skipped. Nothing in `result.messages` is noise; surface anything found there. `result.skipped` is never pushed to `messages`, so it reaches the DM only if Step 10's report carries it directly.

If `result.refused` is set, the run touched nothing. The reasons cluster into a few shapes: no project root to work from; a plan carrying no operations array, or one that is malformed, out of the required dependency order, or naming an operation kind the executor has no worker for; a plan carrying a literal `absorb` or `split` operation, never the scoped `absorb-folder` or `split-folder` kinds a real plan uses (those run fine); whether a source is git-ignored could not be determined; the prechecks found a destination collision; or there is no verified snapshot to fall back on, because HEAD cannot be resolved or the tree is not clean, which is exactly the failure Step 6's preparation commit exists to prevent. Report `refused.detail` verbatim and stop. A hand-edited proposal reaches this point without ever passing back through the planner, so a refusal here is the expected way an inconsistent edit surfaces, not a bug.

## Step 8: Restore `conventions.json`, updated to what actually ran

Call `conventionsAfterScope` with three arguments: the file you moved aside, the scope, and Step 7's `result.applied`. Write the result's `conventions` back to `.professor-orb/conventions.json` and delete the aside file. `conventionsAfterScope` never mutates the copy you hand it, so if anything below still goes wrong you still hold the original, untouched. Report every entry in its `changes` array to the DM in Step 10: a silently updated conventions file is exactly the kind of change that is discovered three sessions later.

**The third argument is what keeps the file honest, so never omit it.** The scope is what the DM asked for; `result.applied` is what happened, and the two differ whenever an entry was declined at plan time or skipped at apply time. Handed the applied operations, each setting-lifecycle case records only what those operations demonstrate: a rename or a retirement none of whose moves ran leaves that setting's entry exactly as it was, and a prong root that did not move stays recorded where it still is. Omitted, the function has to assume the whole scope ran, which is how a rename whose git-ignored prong root declined the whole entry still repoints all three roots at folders nothing created. Retypes are recorded either way, because extending the type enum records the values the scope introduced rather than a folder that moved. The `changes` lines name the roots that did not move as well as the ones that did, so Step 10 reports a partial result as a partial one.

If Step 7 refused, or Step 9's read of `linkIntegrity` fails, **restore the aside unchanged** rather than the updated version. The conventions file describes a structure that no longer happened.

**If Step 7 refused, clean up before you stop.** `result.refused` means the run touched nothing else, so the only thing standing between here and a clean tree is Step 6's preparation commit. Revert it: `git revert --no-edit [Step 6's preparation commit hash]`. Its own diff was exactly the aside move, and nothing has changed since, so the revert applies cleanly, restores `conventions.json` to its normal path with its original content in the same step, and leaves no uncommitted rename behind for Step 3's next clean-tree check to trip over. Report the refusal reason to the DM and say plainly that the tree is clean again and the run can be retried once the cause is fixed. Step 9's own failure below needs a different cleanup, because by then real operations have already changed the tree beyond the aside file; its own instruction (reset to Step 5's snapshot) is what applies there, not this revert.

## Step 9: Assert link integrity

Every wikilink that resolved before the run must resolve after it. Step 7's single call to `applyPlan` already computed this, before it ever considered committing anything; this step reads `result.linkIntegrity`, it does not run a second check.

Read `linkIntegrity.coverage` before writing anything; it distinguishes two outcomes that need two different reports.

- **`coverage: "ok"` with a non-empty `dead` array.** Report the dead links exactly as the executor returned them: each entry carries `file` (the article holding the dead link) and `target` (the wikilink target that no longer resolves). Do not commit.
- **`coverage: "no-links-checked"` with `dead` empty.** The run rewrote at least one wikilink, so this knowledge base demonstrably has them, and the assertion then walked the roots in `linkIntegrity.roots` and found none. Saying "no dead links were found" here would invert what happened. Report `linkIntegrity.roots` and `filesChecked` verbatim, set them against each setting's prong roots, and name the mismatch. Do not re-run unchanged; nothing about a second run moves those roots.

In both cases point at Step 5's snapshot hash and stop without committing. Resetting to it discards Step 6's preparation commit along with it, which holds nothing the DM needs kept.

## Step 10: Commit and report

One commit carries the whole run, including the conventions update:

```
git add -A
git commit -qm "migrate: <one line naming the scope>"
```

This is correct here, and it is the one place in this plugin where it is. The lane commands use narrow literal pathspecs because each owns one prong; `/migrate` restructures across prongs by nature, Step 3 already guaranteed the tree held nothing else, and Step 5's snapshot bounds what this commit can contain. (Step 6's own move is already committed by this point, so this stages only what Steps 7 and 8 actually changed.)

Then report:

```
## /migrate Report

### Scope
[the scope as understood, one or two sentences]
**Proposal:** [path to the proposal file]

### Applied
Files moved: N. Renamed: N. Created: N. Absorbed: N. Split: N. Deleted: N.
Indexes rebuilt: N. Wikilinks rewritten: N.

### Skipped
[Every entry from result.skipped: the scope entry it came from, the operations
it covered, and the git-ignored file that triggered it. "None" if empty. This
is the bucket the DM most needs told, since nothing in result.messages
mentions it: un-ignoring the file, or excluding it from the scope, and
re-running /migrate is how these get picked back up.]

### Edited
Files whose contents were edited: N, broken down by the operation that edited
each one (type normalization, link rewriting, index merging, index rebuilding,
frontmatter repair, prose path updates).
[Any edit the executor reported as outside the snapshot: ignoredEdits (a
git-ignored referring file whose wikilinks were rewritten in place rather than
skipped) and ignoredMoved (a git-ignored file carried along inside a moved
directory). Restoring the snapshot will not undo either.]

### Declined
[Every declined item with its reason, including anything the DM struck from the
proposal by hand.]

### Failed
[operation and error, or "None"]

### Dropped
[Every entry from result.dropped: the operation whose worker failed or
returned nothing, so it is not confirmed applied. "None" if empty. Distinct
from Failed: a failed worker ran and reported why; a dropped one threw or
returned nothing, so there is no reason beyond "unconfirmed, needs a manual
look."]

### Conventions
[Every entry from conventionsAfterScope's changes array, or "Unchanged".]

### Git
**Snapshot:** [Step 5's hash]
**Preparation:** [Step 6's hash]
**Migration:** [Step 10's commit hash]
**Undo:** git -C [project] revert [Step 10's commit hash] [Step 6's hash]

### Next
Re-run the validation sweep to confirm the knowledge base is clean after a
structural change.
```

**Undo is two `git revert`s, migration commit first, not a reset to the snapshot.** By the time this commit lands, Step 5's snapshot sits behind both Step 6's preparation commit and this one, so reverting only the migration commit does not reach the snapshot: it lands the tree on Step 6's preparation commit instead, where `conventions.json` is still sitting under its `.pre-migration` name. That is not a safe place to stop. `/scribe` and `/log` both refuse to resolve a lane without `conventions.json` at its normal path, and the write-time hook goes silent rather than erroring, so nothing announces the problem. Revert both commits, migration first, then preparation: both touch `conventions.json`, so reverting them in the other order conflicts, because the older commit's diff no longer matches what the newer one left behind; reverting the migration commit first returns the tree to exactly what the preparation commit produced, and only then does reverting the preparation commit apply as its own clean inverse, landing the tree exactly on Step 5's snapshot with `conventions.json` back where it belongs. A hard reset to the snapshot would discard both commits, and anything the DM has committed since, along with the migration itself. Two reverts leave the rest of the history, including the snapshot and the now-reverted preparation and migration commits, exactly as it was, and keep the run auditable. State both commands, in that order, in the report. Never run them.

## Things to never do

- **Never execute anything the approved proposal file does not carry.** Not an operation from the conversation, not a repaired guess at an inconsistent edit, not an obviously beneficial extra.
- **Never rewrite body prose.** Filenames, frontmatter fields, and wikilinks only. Prose is `chronicler`'s.
- **Never run without a clean tree** (Step 3), and never fold the DM's unrelated work into the snapshot.
- **Never call the executor before Step 6's preparation commit lands.** `applyPlan` refuses on a dirty tree by design, and the file just moved aside is exactly what would dirty it.
- **Never commit when Step 9's read of `linkIntegrity` failed.**
- **Never use the executor's own `snapshot` field or its printed restore line in the report.** By the time Step 7 runs it names Step 6's preparation commit, not Step 5's, and either way the DM needs both hashes for the two-revert undo, not the one the executor happens to report.
- **Never delete a setting's entry from `conventions.json`.** Retiring marks it; deleting destroys the record of a world that existed.
- **Never create a setting.** Lifecycle operations act on settings that exist.
- **Never auto-resume an interrupted run.** The per-item accounting makes a partial application diagnosable, and Step 5's snapshot hash together with Step 6's preparation-commit hash are the undo; resuming would apply operations against a tree that no longer matches the plan.
- **Never write `.professor-orb/pipeline-state.json`.** This command is outside the session pipeline.
- **Never push.** `/migrate` commits; pushing is the DM's call.

## Edge cases

- **Scope resolves to nothing.** Say so. No snapshot, no commit, no proposal.
- **Scope resolves to something enormous** (a rename touching 800 files). Execute it, but state the count in the proposal before approval. "Rename X everywhere" does not feel like 800 files until it is.
- **No git.** `versioning.json` mode is `changelog`, no marker exists at all, or the project simply is not a git repository. `/migrate` cannot run on this path at any confirmation level: the executor refuses outright when it cannot determine what is git-ignored, before it ever reaches the snapshot check. State that plainly at Step 3 and point the DM at `setup`, which is what establishes version control. Do not offer to initialize a repository here yourself; that is setup's job.
- **A plan the DM edited into something inconsistent.** `applyPlan` re-runs the prechecks against what actually arrives and refuses. Report why it cannot execute and stop. Never a repaired guess.
- **Interrupted run.** The report names what applied and what did not, and Step 5's snapshot hash together with Step 6's preparation-commit hash are the undo. Do not auto-resume.
- **Scope crossing settings.** Supported, and treated as a link-boundary operation: outgoing wikilinks from a moved article are enumerated in the proposal, because they will not resolve on the far side.
- **A file the DM struck from the proposal.** It is not applied and it appears under Declined, so the report and the file agree.
- **The proposal file is gone when the DM approves.** Do not regenerate it silently. Say it is missing and rebuild it from the same scope, then ask for approval again.

## How this command connects to the others

- **Fed by `setup`**, whose after-action report names the deferred items this command re-derives and offers.
- **Fed by the validation sweep**, whose `needsJudgment` findings become candidate scopes. That bucket had no consumer before this command.
- **Shares `workflows/migrate.mjs` with setup.** Setup supplies a schema-derived plan and no gate; `/migrate` supplies a scope-derived plan and a gate. Both call the same `applyPlan`, which is why Step 6's preparation commit mirrors setup's own preparation commit before its migration step: the same clean-tree requirement applies either way.
- **Hands back to the sweep.** The report recommends re-running it, which is the natural verification after a structural change.
- **Not a lane command**, and the only component that commits across prongs. `/scribe`, `/log`, and `/catalog` keep their one-prong guarantee.
