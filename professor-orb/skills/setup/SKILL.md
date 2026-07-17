---
name: setup
description: "One-time (plus on-demand resync) onboarding workflow that produces the .professor-orb/ artifacts every other professor-orb skill and hook depends on (conventions.json, pipeline-state.json, tag-registry.json, proposals/), plus a copy of the validation sweep workflow in .claude/workflows/. Use it when installing professor-orb into a new campaign project, when the DM asks to set up or configure the plugin, or when .professor-orb/ is missing, stale, or has drifted from the KB's actual conventions."
---

> **Before you begin:** read `../SHARED-PRINCIPLES.md` and apply its rules throughout this workflow. Then read `references/conventions-schema.md` in full: it defines the exact shape of `conventions.json`, the enforcement levels, the check kinds, and the three intake tiers this skill implements. Do not attempt to write `conventions.json` from memory or by guessing the schema.

# Setup

You are onboarding a D&D DM's campaign project onto professor-orb. This skill runs once per project, plus an on-demand resync later if the KB drifts. Nothing else in the plugin works reliably until `.professor-orb/` exists: the write-time validator hook degrades gracefully (stays silent) until this skill has produced `conventions.json`, and the session pipeline reads `pipeline-state.json` from the moment it exists. Treat this run as foundational, not a formality.

The DM is the source of truth throughout. Project documents are records of past decisions and raw material for deriving conventions; they are not authoritative in themselves. When a document and the DM disagree, the DM wins. This skill discovers and derives; it never imposes a schema the project does not already use. Any example values you see in the reference file (article types, filename suffixes) belong to one consumer project and are illustrations only.

Every mutation in this workflow (conventions.json contents, enforcement levels, migrations, the Tier 1 CLAUDE.md pointer paragraph, predecessor removal) requires the DM's explicit approval before it happens. Propose, then execute. Never restructure or write silently.

## Step 0: check for an existing install

Before anything else, check whether `.professor-orb/` already exists at the consumer project root.

- **If it does not exist,** this is a first-time setup. Continue to Step 1.
- **If it does exist,** do not clobber it. Tell the DM what you found (existing conventions, when it was last generated, whether the KB looks like it has drifted since) and offer a menu: review the current conventions, resync (re-run the intake and confirmation walkthrough against whatever has changed), or leave it alone. Only proceed past this point with the DM's direction. A resync reuses the rest of this workflow but treats the DM's prior confirmed choices as the starting draft rather than re-deriving everything from scratch, and sets `generatedBy` to `"resync"` instead of `"setup"`. Note: on resync, Step 1 (predecessor detection) is skipped; Step 4 regenerates only `conventions.json` and `tag-registry.json`, leaving `pipeline-state.json` and `proposals/` untouched.

## Step 1: detect predecessor installs

This step runs only on first-time setup. On a resync, skip to Step 2.

Look at the consumer project root for signs of the old Cowork edition (`dnd-campaign-toolkit`), such as a `dnd-campaign-toolkit.plugin` file or directory. Also check for any installed-plugin manifest that references it.

If found, explain the overlap to the DM in plain terms: professor-orb supersedes it, running both risks duplicate or conflicting behavior (for example, two Stop hooks suggesting different next steps). Offer to remove the predecessor's install artifacts. Wait for explicit approval before removing anything. If the DM declines or wants to keep it installed alongside, proceed with the rest of setup and note the coexistence so the DM remembers it later.

## Step 2: derive conventions through the appropriate intake tier

Determine which of the three tiers applies by looking at what the consumer project already has. The full mechanics of each tier are in `references/conventions-schema.md` under "How setup produces this file"; this section summarizes how to choose and act.

**First, locate the KB.** Find the consumer's knowledge base folder (look for a folder full of markdown articles, references in CLAUDE.md, or ask the DM directly if it is not obvious). This becomes `kbRoot` in `conventions.json`.

- **Tier 1, an existing conventions document.** If the KB root (or the project generally) already has a human-readable conventions file (for example `KB-CONVENTIONS.md`), read it as raw material only. Derive `conventions.json` rule entries from it, mapping each stated rule to the matching check kind from the reference file's rule catalog. Set `sourceConventionsDoc` to that file's path for provenance. Then offer the DM (approval required before acting) to retire the source doc and add a short pointer paragraph in the consumer's CLAUDE.md noting that `.professor-orb/conventions.json` is the single source of conventions. Do not draft a new `KB-CONVENTIONS.md`.
- **Tier 2, conventions scattered.** If structural rules exist but live spread across CLAUDE.md, README files, or index articles rather than in one document, consolidate them into `conventions.json` only. Set `sourceConventionsDoc` to null. Do not draft a `KB-CONVENTIONS.md`.
- **Tier 3, conventions in the DM's head.** If nothing is written down, interview the DM using AskUserQuestion and infer likely conventions from sample articles already in the KB (common frontmatter fields, filename patterns, folder sizes, existing tags). Produce `conventions.json` only. Set `sourceConventionsDoc` to null. Do not draft a `KB-CONVENTIONS.md`.

AskUserQuestion is mandatory for the tier 3 interview; do not substitute plain-text questions in chat for structured intake. Batch related questions together rather than asking one at a time.

**Classify by enforcement scope.** Before a candidate convention reaches the draft, decide where it can actually be enforced: per-write (the hook can check it against just the file being written), whole-KB (only the validation sweep can check it), or human judgment (no deterministic check exists, for example which of two colliding filenames is primary, or whether a prose cross-reference reads well). Only per-write-checkable conventions become active rules in `conventions.json`. A whole-KB convention may still be included as a sweep-scope entry (`enforcement: "off"` is typical); a judgment-only convention skips `conventions.json` entirely and goes to the consumer's CLAUDE.md instead. Never present a sweep-scope or judgment-only convention to the DM as something the hook enforces on every write. See the schema reference's "Enforcement scopes" section for the full breakdown.

**Description discipline.** Every rule `description` you draft is one terse sentence stating what the rule checks, nothing more. Never write migration status, DM-approval claims, dated audit or changelog notes, percentages, or other statistics into a description; see the schema reference's note on `description`.

In every tier, present the full derived rule set as one draft to the DM before moving to Step 3. Take a single markup pass: the DM flags anything wrong, you fix it, and that is the end of it. Any answer the DM gives is canon; you may ask one clarifying question if a correction is unclear, but you never argue that the DM's structure is wrong.

## Step 3: confirm enforcement levels with the DM

Every rule in `conventions.json` carries `block`, `warn`, or `off` (see the reference file's "Enforcement levels" section for the guidance behind each). Propose a sensible default per rule using that guidance (for example, an invalid `type` enum defaults to `block`; a structural threshold or new-tag detection defaults to `warn`), then confirm the actual levels with the DM via AskUserQuestion.

Batch these questions sensibly: group rules that share stakes or a category (all frontmatter rules together, all structural thresholds together) rather than asking one question per rule. Push back gently if the DM asks to `block` on `tagVocabulary`: blocking on an unrecognized tag would prevent the KB's vocabulary from ever growing, and `warn` (or `off`, for a DM who does not want tag drift tracked at all) fits the intent better.

AskUserQuestion is mandatory for this confirmation. Do not write `conventions.json` from assumed defaults; every rule's enforcement level must be something the DM actually chose or explicitly approved.

## Step 4: create or update the .professor-orb/ directory

Once the DM has approved the rule set and every enforcement level, act based on whether this is a first-time setup or a resync.

**First-time setup.** Create `.professor-orb/` at the consumer project root with:

- **`conventions.json`**: the approved rules, in the exact shape documented in `references/conventions-schema.md` (`version`, `kbRoot`, `generatedBy`, `generatedAt`, `sourceConventionsDoc`, `tagRegistryPath`, `rules`).
- **`pipeline-state.json`**: an empty initial state, `{}`. Setup does not write a `lastStep` here; setup is not a pipeline step, it is the prerequisite the pipeline runs on top of.
- **`tag-registry.json`**: an initial tag inventory. Scan existing KB article frontmatter for `tags` fields and build a flat object mapping each tag name to a rough count of how many articles use it, for example `{"npc": 12, "faction": 6}`. This is a quick scan for a starting inventory, not an exhaustive audit; the validation sweep regenerates this file properly later.
- **`proposals/`**: an empty directory where the chronicler skill will later write lore-update proposals for DM review.

**Resync.** Update only `conventions.json` and `tag-registry.json` with their new values. Leave `pipeline-state.json` and `proposals/` untouched; this preserves any in-flight pipeline breadcrumbs and pending chronicler proposals.

## Step 5: copy the validation sweep workflow

Copy the plugin's `workflows/validation-sweep.mjs` (resolved from the plugin root) to `.claude/workflows/validation-sweep.mjs` in the consumer project, creating the destination directory if needed. Copy the file as-is; do not read its contents into the conversation and retype them, and do not reproduce or summarize its contents anywhere in this skill's own instructions. Plugins cannot ship workflow files directly into a consumer project's `.claude/workflows/`, which is why this copy step exists.

If the source file is missing (for example if the plugin build has not shipped it yet), tell the DM this step could not complete and move on; do not fabricate a placeholder script.

## Step 6: apply folder-index parity

Check whether the KB already has articles.

- **Established KB.** Scan for folder-index parity violations: folders containing more than one index file, and folders with content but no index file at all. If you find violations, write a migration proposal describing exactly which files move or merge and which index files get created, and present it to the DM. Only execute the migration after explicit approval. Never restructure the KB silently, even if the fix looks obvious.
- **Greenfield KB (no articles yet).** There is nothing to migrate. Set up the folder and index structure from scratch, following the conventions agreed in Step 2 (index filename suffix, where the root index lives, and so on), and confirm the structure with the DM before creating it.

**Migrations stay proposals.** A migration proposal from this step is a conversation artifact, never file state. Never assert it inside `conventions.json`, whether "approved," "planned," or "deferred," whether as a rule of its own or folded into a description; `conventions.json` records confirmed rules, not intentions.

## Closing this run

Once all applicable steps are complete, summarize for the DM what was created or changed: the conventions source and tier used, the number of rules and their enforcement levels, whether a migration ran, and whether the validation sweep workflow copied successfully. If you noticed any factual discrepancy in the DM's documents while reading them, include one line flagging it: "noticed X, you may want to look at it". No offers, no corrections, no edits. On first-time setup, note that `pipeline-state.json` was initialized with an empty state; on resync, note what was updated (conventions and tag registry only). Point them at the session pipeline (debrief is the natural first step) as a next action. Setup's job ends here; the pipeline skills take it from there.
