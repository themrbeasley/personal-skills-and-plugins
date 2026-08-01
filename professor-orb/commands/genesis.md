---
description: "Create a new setting: a world with its own knowledge base, homebrew catalog, session reports, Obsidian vault, and tag registry. Scaffolds professor-orb's canonical folder layout, one folder per article type and one per homebrew artifact type, each with its own index, then registers the world in conventions.json. Adopts a folder tree that already exists rather than refusing it, filling in only what is missing and never writing an existing file. Requires version control and a clean tree, takes its own snapshot commit, and lands its work as one commit. Use to start a second world, or to finish scaffolding one that was started by hand."
argument-hint: "[optional: the new world's name]"
---

# /genesis: create a setting

> **Before you begin:** read `../skills/SHARED-PRINCIPLES.md` (relative to this plugin) and apply its rules throughout this workflow.

You are creating a world. professor-orb brings the structure: the folder layout below is professor-orb's own, derived from its base type enum, and it is applied rather than discovered. What you ask the DM about is the world's name, where its rules come from, and its first campaign. Nothing else.

## What this command is not

- **Not a lifecycle tool.** Renaming, retiring, merging, and splitting a world are all `/migrate`'s. `/genesis` only creates.
- **Not a second executor.** It drives `workflows/migrate.mjs`, the same module `setup` and `/migrate` run. The snapshot discipline, the prechecks, and the per-operation accounting are that module's.
- **Not a content tool.** It creates folders and indexes. It writes no articles.

## Step 1: Establish the name

If the DM gave an argument, that is the proposed name. Otherwise ask for one. It is a short identifier used in every per-setting path, so keep it lowercase and free of spaces; propose a slug if the DM offers a display name.

**Then check it for a collision, before anything else.** Read `.professor-orb/conventions.json` and look for a `settings[]` entry of that name. Look on disk for the three prong paths the name implies. Report exactly what you found and ask how to proceed:

- **Nothing exists.** Say so in one line and continue to Step 2.
- **Folders exist but no `settings[]` entry names them.** Say which folders, and how much is in them. Offer to adopt them: register the world and fill in only what is missing. This is the ordinary shape for a DM who made folders by hand.
- **A `settings[]` entry already names this world.** Say so, and say that two entries on one folder would hand that world's articles to whichever resolves first. Offer to fill gaps in the existing world instead, or to pick a different name.

**Never decide this yourself.** Warn, show what you found, and wait for the DM to choose.

## Step 2: Establish the rules

professor-orb's base rule layer always comes along, identical in every setting by design. What varies is the rest.

If `conventions.json` holds another setting carrying `extendedBy` custom article types or project-provenance rule tweaks, name them and ask whether the new world should copy them or start with the base layer only. A second world in the same genre usually wants them; one in a different genre usually does not. If no other setting exists, or none carries extras, take the base layer and say so in one line.

## Step 3: Establish the first campaign

Ask what the first campaign is called, and say the question is skippable. Naming it creates the campaign folder under `sessionReportsRoot` and seeds `campaigns`, so the session-reports prong is usable immediately rather than after the first `/log`. If the DM skips it, create the prong root and its index only.

## Step 4: Require a clean tree

Run `git status --porcelain`. If anything is uncommitted, **stop**. Report what is outstanding and offer to commit it first through whichever lane command owns it. The snapshot is the DM's only undo, and a snapshot containing their unrelated work in progress cannot be reverted without taking that work with it.

`/genesis` requires version control. If the project has none, **stop** and point the DM at `setup`, which is what establishes it. Do not initialize a repository here.

## Step 5: Survey, then build the plan

**Survey first.** For every path the plan would write, check whether something is already there. Emit an operation only for what is genuinely missing. This is what makes adoption work and what keeps the prechecks green: `create-index` is deliberately not exempt from the destination-collision check, so an operation naming an occupied path would abort the whole run.

The layout, with `<name>` the world's name:

| Path | Operations |
| --- | --- |
| `settings/<name>/` | `create-index` for the root, then one per folder: `people/`, `locations/`, `organizations/`, `items/`, `creatures/`, `concepts/` |
| `homebrew/<name>/` | `create-index` for the root, then one per folder: `spells/`, `magic-items/`, `feats/`, `features/`, `monsters/`, `npcs/`, `species/`, `subclasses/`, `classes/`, `other/` |
| `session-reports/<name>/` | `create-index` for the root, plus one for the first campaign's folder if one was named |
| `settings/<name>/.obsidian` | `vault`, create shape: a `to` and no `from` |
| `.professor-orb/tag-registry.<name>.json` | `tag-registry` |

Each index's `to` is the folder path plus the folder name Title Cased with the setting's index suffix appended, so `settings/<name>/people/` gets `People-INDEX.md` under the default `-INDEX`. The root indexes take the world's name: `settings/<name>/<Name>-INDEX.md`.

**No operation creates a folder.** None needs to: `create-index` writes a file, and the executor creates the destination's parent on the way, so the folder tree falls out of the index list.

Run the prechecks. If they do not pass, something is at a path the survey said was free. Report the collision, do not execute, and return to the survey.

## Step 6: Show the plan and wait

Show the DM what will be created: the folder count, the index count, whether a vault and registry are included, and anything the survey found already present that is therefore being left alone. If adoption is in play, be explicit that existing files are not touched.

**Then wait for approval.** If the plan is empty because the world is fully scaffolded already, say exactly that and stop. Do not commit an empty run.

## Step 7: Take the snapshot

```
git commit --allow-empty -qm "chore: pre-genesis snapshot before /genesis"
```

Verify the tree is clean afterward and **print the hash**. This is the DM's undo and it appears again in Step 10's report.

## Step 8: Execute

Call `applyPlan` with the plan and its options: `cwd`, `settings`, `baseRules`, and `"commit": false`, because Step 10 makes the single commit.

If `result.refused` is set, the run touched nothing. Report `refused.detail` verbatim and stop. Every operation that runs lands in exactly one of `applied`, `failed`, or `dropped`. Read every entry in `result.messages` and surface anything found there.

## Step 9: Write the conventions entry

**Append** a `settings[]` entry to `.professor-orb/conventions.json`. Never rewrite the array, never touch another world's entry.

The entry carries `name`, `kbRoot`, `homebrewRoot`, `sessionReportsRoot`, `campaigns` (the first campaign if one was named, otherwise an empty array), `tagRegistryPath`, and `rules` (the base layer, plus the extras Step 2 settled).

It carries **none** of `retired`, `mergedInto`, or `retiredCampaigns`. Those three are written only by `/migrate` and are absent on a world that has never been retired or merged.

**Write it from what applied, not from what was planned.** Read `result.applied`. A prong whose operations all failed is not a root that exists, and recording it would point `conventions.json` at a folder nothing created. If anything failed, say so and record only what is actually on disk.

## Step 10: Commit and report

```
git add -A
git commit -qm "genesis: create the <name> setting"
```

Then report:

```
## /genesis Report

### World
**Name:** [name]
**Knowledge base:** [kbRoot]
**Homebrew:** [homebrewRoot]
**Session reports:** [sessionReportsRoot]
**First campaign:** [name, or "none yet"]

### Created
Folders: N. Indexes: N. Vault: [yes/no]. Tag registry: [yes/no].

### Already present
[Anything the survey found and left alone, or "Nothing: this world is new."]

### Rules
[Base layer only, or the extras copied and which world they came from.]

### Failed
[operation and error, or "None"]

### Git
**Snapshot:** [Step 7's hash]
**Genesis:** [Step 10's commit hash]
**Undo:** git -C [project] revert [Step 10's commit hash]

### Next
Write your first article, or run /migrate if you have material elsewhere to move in.
```

## Things to never do

- **Never create a world without asking about a name collision.** Warn, show, wait.
- **Never write or overwrite an existing file.** The survey is what guarantees it.
- **Never delete or rewrite another world's `settings[]` entry.** Append only.
- **Never write `retired`, `mergedInto`, or `retiredCampaigns`.** Those are `/migrate`'s.
- **Never rename, retire, merge, or split a world.** Those are `/migrate`'s too.
- **Never write articles.** Folders and indexes only.
- **Never run without a clean tree** (Step 4).
- **Never push.** `/genesis` commits; pushing is the DM's call.

## Edge cases

- **The world already exists in full.** The plan is empty. Say so and stop without committing.
- **Folders exist but no entry names them.** Offer adoption: register the world, fill only the gaps.
- **A `settings[]` entry already names this world.** Offer to fill its gaps, or to pick another name. Never a second entry.
- **No git.** Stop and point at `setup`. Do not initialize a repository here.
- **A path holds a file where a folder belongs.** The prechecks catch it. Report the path and stop.

## How this command connects to the others

- **Fills the gap `/migrate` declines.** `/migrate` performs lifecycle operations on a world that already exists; this is what creates one.
- **Shares `workflows/migrate.mjs` with `setup` and `/migrate`.** Same executor, same snapshot discipline.
- **Hands off to the lane commands.** Once the world is registered, `/scribe`, `/log`, and `/catalog` resolve into it like any other.
