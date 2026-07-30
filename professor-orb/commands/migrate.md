---
description: "Restructure a knowledge base to a scope the DM states, or to one of the two places professor-orb already records outstanding structural work: setup's deferred items and the validation sweep's needs-judgment findings. Resolves the scope into a concrete plan, writes it to .professor-orb/proposals/ as a file the DM may edit, and executes exactly what the approved file says. Every run requires a clean tree, takes its own snapshot commit, moves conventions.json aside so the write-time hook stays silent through the run, asserts that every wikilink resolving before still resolves after, and lands as one commit whose undo is one git revert. Performs structural operations only: it moves, renames, splits, absorbs, rebuilds indexes, retypes, repairs frontmatter, and updates path references, and never rewrites body prose, which is chronicler's work. Not a lane command: it restructures across prongs by nature and commits its own work rather than deferring to /scribe, /log, or /catalog. Use for a folder cleanup, an entity rename, a threshold split, an index rebuild, or a setting or campaign lifecycle change."
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

If the project has no version control (`.professor-orb/versioning.json` mode is `changelog`, or no marker exists at all), there is no snapshot and no undo on this path. Say so plainly and require an explicit second confirmation naming that absence before going any further; do not offer to initialize a repository here, which is setup's job.

## Step 4: Build the plan, run the prechecks, write the proposal

Build the scope into the structure `buildScopedPlan` takes: `{projectRoot, settings, baseRules, scope}`. `scope`'s keys are `pathMoves`, `absorbFolders`, `splitFolders`, `entityRenames`, `rebuildIndexes`, `retypes`, `frontmatterRepairs`, `suffixRenames`, and `prosePathUpdates`, one per registered planner, for structural changes inside a setting's own folders, and a setting rename, a setting retirement, a campaign retirement, a setting split, or a setting merge for a change to the settings themselves. Every article, every destination, and every referring file is named explicitly. The proposal the DM reads is the list of files that will actually move, not a description of a rule that will be applied to files they cannot see.

**The prechecks run while the plan is being built, before the DM ever sees it.** A plan that cannot execute is worse than no plan. Destination collisions are checked before anything moves, both between two operations in this plan and against what already exists on disk. A path the scope names that neither exists now nor is created earlier in the plan is declined with that exact path quoted back, rather than passing cleanly and failing after the snapshot; the same check applies to a referring file the scope names for a wikilink rewrite that is not actually there. A git-ignored source declines its whole scope entry together, every operation that entry would have emitted, not only the operation naming the ignored file, because applying the rest would leave the project matching neither its old shape nor the one the DM approved. All of this appears in the proposal's Declined section rather than surfacing as a failure mid-run.

Write the proposal with `renderProposal` to `.professor-orb/proposals/migrate-<short-slug>.md`, following the same proposal-file convention `chronicler` uses: the DM may edit the file on disk, and execution reads that file rather than the conversation. Give the DM a summary and a pointer to the file in chat; do not paste the whole plan into the conversation.

**Then wait.** The DM may approve, or edit the file and then approve. Say plainly that editing it is expected and that what runs is what the file says.
