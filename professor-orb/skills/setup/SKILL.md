---
name: setup
description: "One-time (plus on-demand resync) onboarding workflow that puts version control under a campaign project, migrates it onto professor-orb's canonical layout behind a snapshot commit, and produces the .professor-orb/ artifacts every other professor-orb skill and hook depends on (conventions.json, versioning.json, pipeline-state.json, per-setting tag registries, proposals/), plus copies of the plugin's workflows in .claude/workflows/. Use it when installing professor-orb into a new campaign project, when the DM asks to set up or configure the plugin, or when .professor-orb/ is missing, stale, or has drifted from the KB's actual conventions."
---

> **Before you begin:** read `../SHARED-PRINCIPLES.md` and apply its rules throughout this workflow. Then read `references/conventions-schema.md` in full: it defines the exact shape of `conventions.json`, the enforcement levels, the check kinds, and the three intake tiers this skill implements. Do not attempt to write `conventions.json` from memory or by guessing the schema.

# Setup

You are onboarding a D&D DM's campaign project onto professor-orb. This skill runs once per project, plus an on-demand resync later if the KB drifts. Nothing else in the plugin works reliably until `.professor-orb/` exists: the write-time validator hook degrades gracefully (stays silent) until this skill has produced `conventions.json`, and the session pipeline reads `pipeline-state.json` from the moment it exists. Treat this run as foundational, not a formality.

The DM is the source of truth throughout. Project documents are records of past decisions and raw material for deriving conventions; they are not authoritative in themselves. When a document and the DM disagree, the DM wins. This skill applies professor-orb's schema and derives only what that schema does not cover. The base rule set ships at `references/base-rules.json`; the extras layer is discovered from this project.

**Every mutation in this workflow requires the DM's explicit approval before it happens, with exactly one exception.** The exception is the schema migration at Step 10, and only that. What replaces the gate there is Step 5's verified snapshot commit, Step 7's confirmation of the prong mapping, and Step 16's after-action report. Everything else keeps its gate: `conventions.json`'s contents, every enforcement level, the Tier 1 CLAUDE.md pointer paragraph, predecessor removal, and retirement of a source conventions document. For those, propose, then execute. Never write them silently.

**The carve-out is conditional on the snapshot.** If `versioning.json` records mode `changelog`, or if Step 5's assertion fails for any reason, there is no verified hash and therefore no gate to replace. On that path the manifest from Step 9 is presented as a proposal and execution waits for the DM's approval, exactly as it did before. Note also that the executor refuses to start without a snapshot commit and without a determinable ignore list, so on the no-version-control path an approved migration still cannot be run unattended: say that plainly, offer version control again, and otherwise report what would have moved rather than moving it.

## The run order

The order of the steps below is the safety design, not a suggested sequence. Run them in the order they are numbered. Three orderings carry the whole design: the clean-tree gate precedes anything that writes a file, the snapshot commit precedes every mutation of the DM's material, and the migration's own commit comes last so that everything Steps 12 through 14 change is captured by it. A resync runs Steps 1 through 14 in full, including the snapshot, the aside, the mapping confirmation, the manifest, and the prechecks. It is not a lighter path.

## Step 1: detect what is already here

This step writes nothing. Gather all four findings below; the run does not continue past this step until each of them is resolved.

**An existing install.** Check whether `.professor-orb/` already exists at the consumer project root. If it does not, this is a first-time setup. If it does, do not clobber it: tell the DM what you found (existing conventions, when they were generated, whether the KB looks like it has drifted since) and offer a menu: review the current conventions, resync, or leave it alone. Say plainly what a resync does before they choose it: it re-imposes professor-orb's schema, it relocates the project to the canonical layout at Step 10, it takes a snapshot commit first, and it can be undone with `git reset --hard <snapshot hash>`, which Step 5 prints. Only proceed past this point with the DM's direction. A resync sets `generatedBy` to `"resync"` instead of `"setup"`.

**A predecessor install.** Look at the project root for signs of the old Cowork edition (`dnd-campaign-toolkit`), such as a `dnd-campaign-toolkit.plugin` file or directory, and for any installed-plugin manifest that references it. This check runs on a resync too, not only on first-time setup, because the migration runs on both. Explain the overlap in plain terms: professor-orb supersedes it, running both risks duplicate or conflicting behavior, and its own `Write|Edit` hook fires throughout the migration no matter what professor-orb does with its own conventions file. That makes removal a mutation-safety matter rather than tidiness, and the removal has to actually happen before the migration for that rationale to hold anything up. Offer to remove the predecessor's install artifacts and wait for explicit approval. If approved, the removal executes at Step 5, right after the snapshot commit and well before the migration at Step 10; it is not deferred to Step 13, because deferring it would let the predecessor's hook fire through the entire migration regardless, which is precisely the outcome removal exists to prevent. If the DM declines, proceed and state in the report that its hook will have produced noise during the migration.

**Repository state.** Enumerate every remote (`git remote -v`) rather than testing whether one exists. Four cases:

- **A repository with a remote the DM confirms in this run.** Record it. Never push to a remote the DM has not confirmed in this run: a project can carry archived read-only remotes from retired repositories, and pushing to one would be both a failure and a surprise.
- **A repository with no usable remote.** No `git init`. Offer the GitHub connection at Step 3, or record local-git mode.
- **Not a repository, but nested inside one.** Name the ancestor repository's root and ask. Never adopt an ancestor silently.
- **No repository anywhere.** The full three-way offer at Step 3.

**A nested repository below the project root.** Scan the project root and every candidate prong root for a `.git` directory below the root. A nested repository's contents are invisible to the outer snapshot, so if one exists, stop here and resolve it (absorb its history, or have the DM archive and remove it) before anything else happens.

## Step 2: require a clean tree

If the project is already a repository, run `git status --porcelain`. If it is non-empty, report what is uncommitted and stop, or offer to commit the DM's existing work first under its own message. Nothing has been written yet, so this gate is reachable and a refusal here costs nothing.

The gate exists because a migration that begins on a dirty tree cannot be cleanly reverted: the snapshot would sweep in unrelated work, and `git reset --hard` back to it would discard the DM's own uncommitted changes along with the migration. On a project that is not a repository yet there is no tree to be dirty; the gate applies from the moment one exists.

## Step 3: establish version control

**The offer names the migration.** The DM is not choosing version control in the abstract, they are choosing whether the restructure about to happen is undoable. Say so in the AskUserQuestion body: setup is about to reorganize N files into professor-orb's layout, and version control is what makes that reversible.

1. **A private GitHub repository (recommended).** Full undo plus an offsite copy.
2. **Local git only.** No account, works offline, full undo. No offsite copy.
3. **No version control.** The changelog baseline, and the migration then has no restore point. On this path the migration requires an explicit second confirmation, and Step 16's undo instruction is replaced by a plain statement that the restructure cannot be reversed automatically.

**Voice.** This is the plugin's only encounter with a DM who may never have used git. Avoid every term or define it on first use in one clause. Never emit a bare command without saying what it does and what they will see.

**Privacy.** Campaign material routinely contains what players must not read. Private is the default, a public repository would expose unrevealed plot, and private is confirmed before anything is created. Choosing GitHub uploads campaign content to a third party; state that before creating anything.

**Handed back to the DM:** creating a GitHub account, running `gh auth login` (interactive, and it cannot be driven from a non-interactive shell), and entering any password or token.

**What you do once they are authenticated:** verify with `gh --version` and `gh auth status`, run `git init` if needed, write the `.gitignore` additions below, and nothing else here. The repository itself is created at Step 15 with `gh repo create <name> --private --source=. --remote=origin --push`, once the snapshot and migration commits exist for `--push` to send. If `gh` is absent, offer installation (`winget install --id GitHub.cli`, `brew install gh`); if that is declined, the DM creates the repository in the web UI and pastes the HTTPS URL, you run `git remote add origin`, and the DM runs the first push themselves. A bare `git push` without `gh` can raise a credential-manager window that would hang a non-interactive shell call. If the DM stalls on account creation, complete local git now, record mode `git` with `githubPending: true`, and say that finishing later is a matter of asking.

**The `.gitignore` policy, additions only.** Never rewrite or reorder an existing `.gitignore`; append what is missing.

Ignored, as derived or transient: `.professor-orb/pipeline-state.json`, `.professor-orb/proposals/`, `.professor-orb/tag-registry*.json`, `**/.obsidian/workspace*.json`, `**/.obsidian/plugins/`.

The `**/` prefix is required, not decorative. A gitignore pattern with a slash anywhere but at its end is anchored to the directory holding the `.gitignore`, so `.obsidian/workspace*.json` matches a vault at the project root and nothing under `settings/<setting>/`. Measured against real git: without the prefix, vault state and plugin bundles get staged and pushed, and `workspace.json` is rewritten every time Obsidian opens or closes, so `git status --porcelain` is never clean again and Step 2's gate fails on every later resync.

Tracked, deliberately: `.professor-orb/conventions.json`, `.professor-orb/versioning.json`, and the migration manifest.

**Do not ask the large-and-sensitive-material question here.** It runs at Step 14, after the snapshot. Asking before anything is captured invites the DM to exclude exactly the material the migration is about to move, which would then sit outside the only restore point they have.

## Step 4: convert the versioning marker

If `.professor-orb/catalog-versioning.json` exists and `.professor-orb/versioning.json` does not, copy its `mode` and `decided` values unchanged into the new file and mention the conversion in passing. Never rewrite `decided`. Writing a fresh date destroys the only record of when the DM actually chose, and a later reader cannot tell a converted decision from a new one. That date is the single field this conversion exists to carry across. Do not delete the old file here; Step 12 deletes it, after the snapshot commit has captured it.

## Step 5: commit the snapshot

Commit everything as it stands, with the message `chore: pre-migration snapshot before professor-orb setup`. Then **assert** that `git status --porcelain` is empty and capture the commit hash. If either the commit or the assertion fails, abort before any mutation and say why.

Print the hash and the undo command now, in conversation, not only in the closing report. `git init` alone provides zero revertibility, because an untracked working tree has no restore point; this commit is the restore point, and it is the thing that stands between an unattended restructure and unrecoverable loss.

If the DM approved predecessor removal at Step 1, remove the predecessor's install artifacts now, immediately after this commit and before Step 6 writes anything. Removing it here, rather than at the end of the migration, is what actually keeps its `Write|Edit` hook from firing while Steps 6 through 10 write and move files; deferring the removal would let the hook fire through the whole migration regardless of when the artifacts eventually go. This is not its own commit: it rides in Step 9's preparation commit alongside the aside, the copied workflows, and the manifest. Step 13 handles only retiring a source conventions document; predecessor removal does not wait that long.

## Step 6: move any existing conventions.json aside

Read its rules, its extras layer, and its per-rule enforcement levels into memory **first**. Then move the file to `.professor-orb/conventions.json.pre-migration`, which the snapshot has already captured.

`conventions.json` exists on disk at no point between this step and Step 12. That is what keeps the write-time hook silent through the migration on **resync** as well as on a first run, and resync is the path an established project takes. Without it the hook is armed for every write the migration makes, blocking on rule violations and dispatching autofixes that race the migration's own edits.

## Step 7: discover the prongs and confirm the mapping

This is the one confirmation the migration asks for. Enumerate the candidate locations of all three prongs (the setting knowledge base, the homebrew catalog, and the session reports), report exactly what you found and where each one would move to, and confirm the source-to-destination mapping with the DM via AskUserQuestion before anything moves.

It is the one input the plugin cannot derive reliably, and getting it wrong is the one error the after-action report cannot help with, because the DM would not know to look. Any move whose destination lies inside its own source is staged through a temporary sibling path.

## Step 8: copy the workflows

Copy every workflow the plugin ships (resolved from the plugin root) into `.claude/workflows/` in the consumer project, creating the destination directory if needed. This includes `migrate.mjs`, which Step 10 needs, and `validation-sweep.mjs`. Copy each file as-is; do not read its contents into the conversation and retype them, and do not reproduce or summarize them anywhere in this skill's own instructions. Plugins cannot ship workflow files directly into a consumer project's `.claude/workflows/`, which is why this copy step exists.

If a source file is missing (for example if the plugin build has not shipped it yet), tell the DM that step could not complete; do not fabricate a placeholder script. If the missing file is `migrate.mjs`, stop: the migration cannot run without it.

## Step 9: write the migration manifest and run the prechecks

Survey the project against the base rule set and build the manifest. The survey includes the folder-index parity scan: scan for folder-index parity violations, folders containing more than one index file, and folders with content but no index file at all.

Run `migrate.mjs`'s plan phase, which mutates nothing, and write the resulting operation list and its prechecks to a tracked path so a half-applied run is diagnosable from the repository alone. **A precheck failure stops the run before any mutation.** A destination collision aborts: list the colliding pairs, state that the project is unchanged, and offer to continue once the DM has resolved them.

Split and absorb are **reported, never executed** on this run. Crossing a threshold says a folder should divide or dissolve; it does not say how to partition it or where its contents belong, and that is a judgment about the DM's own material.

**Greenfield KB (no articles yet).** There is nothing to migrate. Set up the folder and index structure from scratch, following professor-orb's canonical layout as the base rules define it (the `-INDEX` suffix, one owning index per folder that holds content, the split and absorb thresholds), and confirm the structure with the DM before creating it.

**A migration is never asserted inside `conventions.json`.** The manifest is a run artifact; the migration itself is never recorded in `conventions.json` as "approved," "planned," or "deferred," whether as a rule of its own or folded into a description. That file records confirmed rules, not intentions.

Finish this step by committing what it, Step 6, and Step 8 have written, together with Step 5's predecessor removal if the DM approved one (the aside, the copied workflows, the manifest, and the removal), under a plain message such as `chore: professor-orb setup preparation`, so that the working tree is clean. The executor refuses to start on a dirty tree, and correctly: a tree with uncommitted work has no coherent state to restore to. The snapshot from Step 5 remains the restore point, since resetting to it discards this preparation commit too.

## Step 10: execute the migration

Run `migrate.mjs`'s apply phase against the plan from Step 9, with its own commit step disabled (`"commit": false` in its arguments), because the single migration commit happens at Step 15 and has to carry what Steps 12 through 14 produce as well.

What the executor guarantees, and what you must carry into the report rather than restate as your own: every relocation goes through `git mv`; any operation whose source is git-ignored is skipped and reported, never moved, because the snapshot does not contain it; per-file applied true or false accounting means a dropped worker is never counted as done; and link integrity is asserted across every prong root before anything is committed. It also reports `ignoredEdits` and `ignoredMoved`, the edits and moves the snapshot cannot undo.

**If the link-integrity assertion fails, do not commit at Step 15.** It fails in two different ways that need two different reports, and `linkIntegrity.coverage` is what tells them apart. Read it before writing anything.

- **`coverage: "ok"` with a non-empty `dead` array.** Report the dead links with their containing files, exactly as the executor returned them.
- **`coverage: "no-links-checked"`, with `dead` empty.** There are no dead links to report, and saying "no dead links were found" here would invert what happened. This outcome says the run rewrote at least one wikilink, so this knowledge base demonstrably has them, and the assertion then walked the roots in `linkIntegrity.roots` and found none at all. The walked roots are not where the run put the content. Report `linkIntegrity.roots` and `filesChecked` verbatim, set them against each setting's `kbRoot`, `homebrewRoot`, and `sessionReportsRoot`, and name the mismatch. Do not re-run the executor unchanged: nothing about a second run moves those roots, so it reproduces identically.

In both cases point at Step 5's snapshot hash, not the executor's.

**Two different commits are both called "the snapshot"; do not confuse them.** The executor's own `result.snapshot` field, and the restore instruction it prints, both name `git rev-parse HEAD` taken at the moment the executor runs, which by now is Step 9's preparation commit, because Steps 6, 8, and 9 all wrote to the tree after Step 5. That hash is not the restore point the DM wants: resetting to the preparation commit lands after Step 6 already moved `conventions.json` aside, so the DM's own conventions file is not sitting at its expected path there. Whatever the executor prints or returns as `snapshot`, do not copy it into the report; the report at Step 16 always uses the hash Step 5 captured.

The migration applies the base rules at their **default** enforcement levels, because the DM confirms levels at Step 11, after this. The levels they choose take effect from the next write onward. This run's authority comes from the snapshot commit and the after-action report, not from a level confirmed at setup.

## Step 11: derive the extras, draft the rule set, and confirm enforcement levels

Both of these belong here, after the migration, because the extras are derived from the KB's post-migration state.

**Locate the KB** as it now stands: the setting knowledge base at its canonical destination becomes that setting's `kbRoot`, and its two sibling prongs become `homebrewRoot` and `sessionReportsRoot`.

Every project starts from the same base rule set. The tiers differ only in where the project-specific extras come from. The full mechanics of each tier are in `references/conventions-schema.md` under "How setup produces this file"; this section summarizes how to choose and act.

- **Tier 1, an existing conventions document.** If the KB root (or the project generally) already has a human-readable conventions file (for example `KB-CONVENTIONS.md`), read it as raw material for the extras layer. Where it states something a base rule already covers, fold its distinct values into that base rule's `extendedBy` rather than emitting a second rule of the same check kind on the same field; where it states something no base rule covers, emit a `provenance: "project"` rule using the matching check kind from the reference file's rule catalog. Set `sourceConventionsDoc` to that file's path. Retiring that document and adding a pointer paragraph to the consumer's CLAUDE.md are offered at Step 13 and both keep their approval gate. Do not draft a new `KB-CONVENTIONS.md`.
- **Tier 2, conventions scattered.** If project-specific conventions exist but live spread across CLAUDE.md, README files, or index articles rather than in one document, gather them into the same extras layer by the same fold-or-emit rule as tier 1. Set `sourceConventionsDoc` to null. Do not draft a `KB-CONVENTIONS.md`.
- **Tier 3, conventions in the DM's head.** If nothing is written down, the base rule set still applies unchanged. Interview the DM using AskUserQuestion for the extras, and derive candidates from articles already in the KB: the distinct `type` values actually in use become `extendedBy` entries on the base type enum, and existing tags seed the tag registry. Set `sourceConventionsDoc` to null. Do not draft a `KB-CONVENTIONS.md`.

AskUserQuestion is mandatory for the tier 3 interview; do not substitute plain-text questions in chat for structured intake. Batch related questions together rather than asking one at a time.

**On a resync**, the base layer is re-imposed from `references/base-rules.json` again, never carried over from the previous file. What survives is the extras layer and the DM's enforcement choices, both read into memory at Step 6. If any rule in that file carries no `provenance`, reconcile it against the base rule set by the schema reference's "Reconciling a v1 file" section, which produces a report the DM approves item by item. The test is per rule, not per file: a file where some rules carry `provenance` and some do not is the expected shape after a DM hand-edit, which `generatedBy: "manual"` records, and its provenance-less rules need reconciling just as much as a wholly v1 file's do. Never apply a reconciliation result into the draft first, or the confirmation walkthrough will present changed enforcement levels as if they were the DM's own prior choices.

**Classify by enforcement scope.** Before a candidate convention reaches the draft, decide where it can actually be enforced: per-write (the hook can check it against the file being written, its folder, and cheap existence lookups), whole-KB (only the validation sweep can check it), or human judgment (no deterministic check exists, for example which of two colliding filenames is primary, or whether a prose cross-reference reads well). A per-write-checkable convention becomes an active rule in `conventions.json`. A whole-KB convention may also be recorded there, as a sweep-scope entry; a judgment-only convention skips `conventions.json` entirely and goes to the consumer's CLAUDE.md instead. A base rule may be whole-KB scope; `structuralSingleOwnership` ships that way, carrying `enforcement: "warn"` and a check function that returns not applicable at write time. The hook is therefore silent on it by function rather than by level, and the validation sweep is what actually checks it. Never present a sweep-scope or judgment-only convention to the DM as something the hook enforces on every write. See the schema reference's "Enforcement scopes" section for the full breakdown.

**Description discipline.** Every rule `description` you draft is one terse sentence stating what the rule checks, nothing more. Never write migration status, DM-approval claims, audit or changelog notes, dates, percentages, or statistics into a description; see the schema reference's note on `description`.

In every tier, present the full rule set, base and extras, as one draft to the DM. Take a single markup pass: the DM flags anything wrong, you fix it, and that is the end of it. Any answer the DM gives about their campaign's content is canon; you may ask one clarifying question if a correction is unclear.

**Then confirm enforcement levels.** Every rule carries `block`, `warn`, or `off` (see the reference file's "Enforcement levels" section for the guidance behind each). Propose a sensible default per rule using that guidance (for example, an invalid `type` enum defaults to `block`; a structural threshold or new-tag detection defaults to `warn`), then confirm the actual levels with the DM via AskUserQuestion. Batch these questions sensibly: group rules that share stakes or a category (all frontmatter rules together, all structural thresholds together) rather than asking one question per rule. Push back gently if the DM asks to `block` on `tagVocabulary`: blocking on an unrecognized tag would prevent the KB's vocabulary from ever growing, and `warn` (or `off`, for a DM who does not want tag drift tracked at all) fits the intent better.

AskUserQuestion is mandatory for this confirmation. Do not write `conventions.json` from assumed defaults; every rule's enforcement level must be something the DM actually chose or explicitly approved.

## Step 12: write the .professor-orb/ artifacts

- **`conventions.json`**: the approved rules, in the exact shape documented in `references/conventions-schema.md`. It is a v3 file: a `settings` array, with `kbRoot`, `homebrewRoot`, `sessionReportsRoot`, `campaigns`, `tagRegistryPath`, and `rules` inside each setting. Copy `schemaVersion` from the `schemaVersion` of `references/base-rules.json`; it is what lets a later run detect that the base rule set has moved on, so a file written without it defeats its own purpose.
- **`pipeline-state.json`**: an empty initial state, `{}`. Setup does not write a `lastStep` here; setup is not a pipeline step, it is the prerequisite the pipeline runs on top of. On a resync, leave this file untouched.
- **A tag registry per setting**, at each setting's `tagRegistryPath`. Scan that setting's KB article frontmatter for `tags` fields and build a flat object mapping each tag name to a rough count of how many articles use it, for example `{"npc": 12, "faction": 6}`. This is a quick scan for a starting inventory, not an exhaustive audit; the validation sweep regenerates these files properly later.
- **`proposals/`**: an empty directory where the chronicler skill will later write lore-update proposals for DM review. On a resync, leave it and its contents untouched.

Then delete `.professor-orb/conventions.json.pre-migration` and, if Step 4 converted it, the old `.professor-orb/catalog-versioning.json`. The snapshot captured both. `versioning.json` itself is never regenerated here: Step 4 owns it, and `decided` is never rewritten.

## Step 13: handle the remaining deletions

Predecessor install artifacts are not handled here. If Step 1 found a predecessor and the DM approved removing it, that removal already happened at Step 5, right after the snapshot and well before the migration; if the DM declined, or wanted it kept installed alongside, Step 1 already covers noting the coexistence in the report. What is left here keeps its own approval gate and waits for explicit approval before anything is removed.

- **Retiring a source conventions document** (tier 1 only), together with a short pointer paragraph in the consumer's CLAUDE.md noting that `.professor-orb/conventions.json` is the single source of conventions. Offer it; do not do it unasked.

## Step 14: ask the large-and-sensitive-material question

Ask the DM whether anything under the project should stay out of version control: large binaries, scanned handouts, audio, video, and any material they do not want in a repository at all. Apply the additions to `.gitignore`, then untrack any newly ignored path the project's history already tracks, one path per invocation:

```
git rm --cached -- ":(literal)<path>"
```

Then check for pre-existing ignore rules that would swallow a file that is currently tracked.

`git rm` takes a **pathspec**, not a path. `--` stops option parsing, but git still reads `*`, `?`, `[`, and `]` inside the pathspec that follows as wildcards, so a DM-chosen folder or filename carrying one of them can untrack a neighbouring file the DM never named. Measured against real git: with `items/Weapons [OS]-INDEX.md` sitting next to an unrelated `items/Weapons O-INDEX.md`, `git rm -q -- "items/Weapons [OS]-INDEX.md"` removed both, while the same command with `:(literal)` prefixed removed only the named one. Keep the prefix even for a path that looks safe, and keep `--` as well: they fix different halves of the same line and neither substitutes for the other. This is the same rule `/scribe`, `/log`, and `/catalog` follow for their lane pathspecs.

The position of this step is deliberate at both ends. It runs **after** the snapshot at Step 5, because asking what to exclude before anything is captured invites the DM to exclude exactly the material the migration is about to move, which would then be missing from the only restore point they have. It runs **before** the migration commit at Step 15, so that the `git rm --cached` removals it produces are captured by that commit rather than left sitting uncommitted in the tree.

## Step 15: commit the migration

Commit only if Step 10's link-integrity assertion passed. One commit carries the migration, the `.professor-orb/` artifacts, the deletions, and Step 14's untracking. Then push, if and only if the DM confirmed a remote in this run: `gh repo create <name> --private --source=. --remote=origin --push` for a new GitHub repository, or a push to the confirmed remote for an existing one. Never push to a remote the DM has not confirmed in this run.

## Step 16: report

The DM approved the prong mapping and nothing else, so this report is the whole accountability surface. It reuses the KB Validation Report shape from `../../agents/kb-validator.md`:

```
## professor-orb Setup Report

### Scope
**Project:** [path]
**Run:** first-time setup, or resync
**Layout before:** [where each prong was found]
**Layout after:** [where each prong now lives]

### Moved
Files moved: N. Renamed: N. Created: N. Merged: N. Deleted: N.
**Manifest:** [tracked path]

### Edited
Files whose contents were edited: N, broken down by the operation that edited each
one (type normalization, link rewriting, index merging, frontmatter repair).
Wikilinks rewritten: N.
[Any edit the executor reported as outside the snapshot, which restoring will not undo.]

### Obsidian
**Vault to reopen:** [path, per setting]

### Declined
Everything not done, with the reason: git-ignored files, absorb candidates, split
proposals, -TIMELINE and -HISTORY files, articles missing `publish`, prose path
references in CLAUDE.md or elsewhere.

### Failed
[file and error, or "None"]

### Git
**Snapshot:** [the hash Step 5 captured, never the executor's `result.snapshot` field]
**Migration:** [Step 15's commit hash]
**Undo:** git -C [project] reset --hard [Step 5's snapshot hash, never the executor's printed restore line]

### Summary
[One paragraph: what changed, what still needs the DM, and the recommended next step.]
```

The **Edited** section is not optional. Two of the migration's operations change what is inside articles rather than where they sit, and a report that enumerates only location changes leaves them out entirely: the DM would have approved a mapping and received an accounting of everything except what was rewritten inside their own articles.

**The Git section's Snapshot and Undo lines are never filled from what the executor printed or returned.** They always take the hash Step 5 captured and printed, the one asserted clean before any mutation of the DM's material. The executor's own `result.snapshot` field and its own printed restore instruction name Step 9's preparation commit instead, because that is what `HEAD` is at the moment the executor runs; copying either of those in here points the DM's undo command at the preparation commit, where `.professor-orb/conventions.json` is not at its expected path (Step 6 moved it aside). Migration takes Step 15's commit hash.

On the no-version-control path, replace the **Undo** line with a plain statement that the restructure cannot be reversed automatically.

## Closing this run

Add what the report shape does not cover: the conventions source and tier used, the number of rules and their enforcement levels, whether the workflows copied successfully, and, on a first-time setup, that `pipeline-state.json` was initialized empty. If you noticed any factual discrepancy in the DM's documents while reading them, include one line flagging it: "noticed X, you may want to look at it". No offers, no corrections, no edits. Point them at the session pipeline (debrief is the natural first step) as a next action. Setup's job ends here; the pipeline skills take it from there.
