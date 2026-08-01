# `/genesis`: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/genesis` command that creates a new setting: its three prong folders scaffolded to professor-orb's schema, an Obsidian vault, a tag registry, and a `conventions.json` entry.

**Architecture:** `/genesis` is a markdown command that builds a plan of existing operation kinds and hands it to `applyPlan`, the way `setup` already does. No change to `workflows/migrate.mjs`: `create-index` creates its own folder because `writeText` recursively creates the destination's parent, so the whole folder tree falls out of the index list. Adopting a partly built world needs no second code path either, because the command surveys first and emits operations only for what is missing.

**Tech Stack:** Markdown command definition. Node 20 ESM for the one test addition. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-01-genesis-command-design.md`

**Ordering:** This plan owns the single 1.8.0 version bump, in Task 5. `2026-08-01-migrate-split-merge.md` deliberately does not bump. Land that plan first if both are being done in one release, so the bump ships a complete 1.8.0.

## Global Constraints

- **No em dashes in any output.** Code, comments, commit messages, doc prose, and command prose. Use commas, colons, parentheses, or restructure. This is `professor-orb/skills/SHARED-PRINCIPLES.md` Principle 6, enforced by the `kb-validator` and `historian` agents. Every shipped professor-orb file has zero. Verify with `grep -c $'\xe2\x80\x94' <file>` before each commit. The byte escape is used because this Git Bash supports neither backslash-u escapes nor PCRE. En dashes are fine and already in use.
- **professor-orb imposes its schema.** The starter layout is professor-orb's decision, derived from the base type enum in `references/base-rules.json`. Do not write anything suggesting the command should discover a layout from the consumer project.
- **Node built-ins only** in `workflows/`. No dependencies, no test framework.
- **Never edit the marketplace cache** under `C:\Users\jorda\.claude\plugins\cache\`. It is a build artifact.
- **Never run `professor-orb:setup`.** It regenerates `conventions.json` wholesale and would discard hand-tuned rules.
- **Never delete or overwrite a `settings[]` entry.** `/genesis` appends. `retired`, `mergedInto`, and `retiredCampaigns` are `/migrate`'s alone and must never be written here.
- **Commit style:** `feat(professor-orb): ...` subject, blank line, body paragraph, blank line, then `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Version bump goes in BOTH** `professor-orb/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, in the same commit.
- **Line numbers are as of this plan's writing and drift as tasks land.** Earlier tasks in this plan add comment blocks to the same files, so a later task's cited line will have moved. The quoted code is the anchor: locate it by its text, not by its number.

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `professor-orb/commands/genesis.md` | The command: ask, plan, approve, execute, write conventions, report | Create |
| `professor-orb/workflows/migrate.plan.test.mjs` | Plan-phase regression suite | Add one case pinning the starter layout constants |
| `professor-orb/commands/migrate.md` | The `/migrate` command | Remove the "creating a setting is out of scope" refusal, point at `/genesis` |
| `professor-orb/skills/orb/SKILL.md` | Component menu | Add `/genesis` |
| `professor-orb/README.md` | Components table | Add `/genesis` |
| `professor-orb/CONTEXT.md` | Vocabulary and decisions | Record the command and the starter layout |
| `professor-orb/.claude-plugin/plugin.json` | Plugin manifest | Version to 1.8.0 |
| `.claude-plugin/marketplace.json` | Marketplace manifest | Version to 1.8.0 |

---

### Task 1: Pin the starter layout as a test before writing the command

The command is markdown, so its behavior is exercised by running it. What can be pinned mechanically is the layout it must produce: the folder names, the index stems, and the operation kinds. Writing that first gives the command a specification it can be checked against, and catches a drift between the base type enum and the folder list.

**Files:**
- Test: `professor-orb/workflows/migrate.plan.test.mjs` (append one block)

**Interfaces:**
- Consumes: `BASE_RULES` (already loaded at the top of the suite from `references/base-rules.json`), and `indexStemFor` semantics, which Title Case the folder name and append the setting's index suffix. `indexStemFor` is not exported, so the test asserts the resulting strings rather than calling it.
- Produces: two exported-by-convention constant lists that `commands/genesis.md` must match. They live in the test file, which is where the layout is pinned.

- [ ] **Step 1: Write the failing test**

Append to `migrate.plan.test.mjs`:

```javascript
console.log("\n=== genesis: the starter layout professor-orb lays down ===");

{
  // The layout /genesis creates. Written out rather than derived from
  // base-rules.json, for the reason EXPECTED_ORDER above is written out: deriving
  // it would compare the enum against itself and pass whichever way the enum
  // changed. This literal IS the decision, from the /genesis spec.
  const KB_FOLDERS = ["people", "locations", "organizations", "items", "creatures", "concepts"];
  const HOMEBREW_FOLDERS = [
    "spells", "magic-items", "feats", "features", "monsters",
    "npcs", "species", "subclasses", "classes", "other",
  ];

  // Every knowledge-base subject type in the base enum has a folder, and the four
  // that are not subject types have none. A type added to the enum without a
  // folder here would be a type with nowhere to live that satisfies parity.
  const enumRule = obj(obj(obj(BASE_RULES).rules).frontmatterTypeEnum);
  const values = list(obj(enumRule.params).values);
  const NON_SUBJECT = ["Index", "Session Report", "Session Prep", "Chronology"];
  const HOMEBREW_KEYS = [
    "spell", "magic-item", "feat", "feature", "monster",
    "npc", "species", "subclass", "class", "other",
  ];
  const kbTypes = values.filter((v) => !NON_SUBJECT.includes(v) && !HOMEBREW_KEYS.includes(v));

  check("every knowledge-base subject type has exactly one starter folder",
    [kbTypes.length, KB_FOLDERS.length], [6, 6]);
  check("and the base enum still holds the six the layout was derived from",
    kbTypes.slice().sort(),
    ["Concept", "Creature", "Item", "Location", "Organization", "Person"]);
  check("every homebrew artifact key has exactly one starter folder",
    [HOMEBREW_KEYS.every((k) => values.includes(k)), HOMEBREW_FOLDERS.length],
    [true, 10]);

  // The index each starter folder carries, under rolara's default suffix. A world
  // whose setting declares "-IDX" takes that instead; the stem rule is the same.
  const stem = (name, suffix) => `${name.charAt(0).toUpperCase()}${name.slice(1)}${suffix}`;
  check("a starter folder's index stem Title Cases the folder name",
    [stem("people", "-INDEX"), stem("magic-items", "-INDEX"), stem("npcs", "-IDX")],
    ["People-INDEX", "Magic-items-INDEX", "Npcs-IDX"]);

  // 7 knowledge-base indexes, 11 homebrew, 1 session-reports root, 1 vault, 1 tag
  // registry. Plus one more create-index when a first campaign is named.
  const opCount = (withCampaign) =>
    (1 + KB_FOLDERS.length) + (1 + HOMEBREW_FOLDERS.length) + 1 + (withCampaign ? 1 : 0) + 1 + 1;
  check("a new world is 21 operations, or 22 with a first campaign",
    [opCount(false), opCount(true)], [21, 22]);
}
```

- [ ] **Step 2: Run the suite to see whether it passes**

Run: `node professor-orb/workflows/migrate.plan.test.mjs`

Expected: PASS on all five checks, assuming `references/base-rules.json` holds the enum the spec was derived from. If "and the base enum still holds the six the layout was derived from" FAILS, the enum has changed since the spec was written: stop and reconcile the spec's starter folder list with the enum before continuing, because the command's layout would otherwise be built on a stale premise.

- [ ] **Step 3: Verify no em dashes**

Run: `grep -c $'\xe2\x80\x94' professor-orb/workflows/migrate.plan.test.mjs`

Expected: `0`.

- [ ] **Step 4: Commit**

```bash
git add professor-orb/workflows/migrate.plan.test.mjs
git commit -m "$(cat <<'EOF'
test(professor-orb): pin the starter layout /genesis lays down

The command itself is markdown, so what can be checked mechanically is
the layout it must produce. This pins the six knowledge-base folders
against the base type enum's subject types, the ten homebrew folders
against its artifact keys, the Title Case index stem rule, and the
operation count.

Written out rather than derived from base-rules.json, for the reason
EXPECTED_ORDER is written out: deriving it would compare the enum against
itself and pass whichever way the enum changed. A type added to the enum
without a starter folder now fails here rather than shipping as a type
with nowhere to live that satisfies folder-index parity.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Write the command

**Files:**
- Create: `professor-orb/commands/genesis.md`

**Interfaces:**
- Consumes: `buildPlan({projectRoot, settings, baseRules, discovered})` and `applyPlan` from `workflows/migrate.mjs`, the same entry points `setup` uses. Operation shapes: `{op: "create-index", to, reason}`, `{op: "vault", to, reason}` (create shape carries no `from`), `{op: "tag-registry", to, reason}`.
- Produces: a `settings[]` entry in `.professor-orb/conventions.json` carrying `name`, `kbRoot`, `homebrewRoot`, `sessionReportsRoot`, `campaigns`, `tagRegistryPath`, and `rules`.

- [ ] **Step 1: Read the two commands this one is modelled on**

Run: `head -60 professor-orb/commands/migrate.md` and `grep -n "^## Step" professor-orb/skills/setup/SKILL.md`

Read `commands/migrate.md`'s frontmatter block in full. `/genesis` copies its shape: a `description` naming what the command does and when to use it, and an `argument-hint`. Read setup's Step 12 for how `.professor-orb/` artifacts are written outside the executor.

- [ ] **Step 2: Create the command file**

Create `professor-orb/commands/genesis.md`:

````markdown
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
````

- [ ] **Step 3: Verify the frontmatter parses and the description is short enough**

Run: `head -4 professor-orb/commands/genesis.md` and check the `description` value is under 1500 characters.

Expected: valid YAML frontmatter delimited by `---`, with `description` and `argument-hint` keys. The 1500 character ceiling is the Cowork content validator's; professor-orb ships through the marketplace rather than Cowork, but staying under it costs nothing and keeps the option open.

- [ ] **Step 4: Verify no em dashes**

Run: `grep -c $'\xe2\x80\x94' professor-orb/commands/genesis.md`

Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git add professor-orb/commands/genesis.md
git commit -m "$(cat <<'EOF'
feat(professor-orb): add /genesis, the command that creates a setting

The multi-setting layout has existed since 1.6.0 and nothing created an
entry in it. setup writes the first as a side effect of onboarding, and
/migrate declines the job by name, so a DM wanting a second world had no
supported path.

/genesis asks three things: the world's name, whether to copy another
world's custom types and rule tweaks or take the base layer alone, and
the first campaign. Then it surveys, builds a plan of create-index,
vault, and tag-registry operations, shows it, and hands it to applyPlan.

It needs no new operation kind. create-index writes a file and the
executor creates the destination's parent on the way, so the folder tree
falls out of the index list. Adoption needs no second code path either:
the survey emits operations only for paths that are free, so a world
whose scaffolding drifted gets its gaps filled and no existing file is
ever written.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Remove `/migrate`'s refusal and point it at `/genesis`

`commands/migrate.md` tells the DM that creating a setting is out of scope and instructs the model not to improvise a creation path. That instruction was correct while no creation path existed. It is now wrong.

**Files:**
- Modify: `professor-orb/commands/migrate.md:41` (Step 2) and `:208` (Things to never do)

**Interfaces:**
- Consumes: nothing. Documentation only.
- Produces: nothing.

- [ ] **Step 1: Find both statements**

Run: `grep -n "Creating a setting is out of scope\|Never create a setting" professor-orb/commands/migrate.md`

Expected: two hits, one in Step 2 and one in "Things to never do".

- [ ] **Step 2: Replace the Step 2 paragraph**

Replace the paragraph beginning "**Creating a setting is out of scope for this release.**" with:

```
**Creating a setting is `/genesis`'s job, not this command's.** If the DM asks to start a second world, say that `/genesis` creates one, scaffolded to professor-orb's layout and registered in `conventions.json`, and that `/migrate` performs lifecycle operations on a world that already exists: a rename, a retirement, a split, or a merge. Do not improvise a creation path here. A half-created setting with no `conventions.json` entry is worse than none, which is exactly the failure `/genesis` exists to avoid.
```

- [ ] **Step 3: Replace the never-do line**

Replace the line beginning "- **Never create a setting.**" with:

```
- **Never create a setting.** Lifecycle operations act on worlds that exist. `/genesis` creates them.
```

- [ ] **Step 4: Verify no em dashes and no stale refusal**

Run: `grep -c $'\xe2\x80\x94' professor-orb/commands/migrate.md && grep -n "out of scope for this release" professor-orb/commands/migrate.md`

Expected: `0` em dashes, and no hit for "out of scope for this release".

- [ ] **Step 5: Commit**

```bash
git add professor-orb/commands/migrate.md
git commit -m "$(cat <<'EOF'
docs(professor-orb): point /migrate's setting-creation refusal at /genesis

/migrate told the DM that creating a setting was out of scope and
instructed the model not to improvise a creation path. That was correct
while no creation path existed. /genesis is now the answer, so the
refusal names it instead of dead-ending.

The reason the refusal gave, that a half-created setting with no
conventions.json entry is worse than none, is kept: it is exactly what
/genesis exists to avoid, and it still argues against improvising one
here.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Surface `/genesis` in the menu, the README, and CONTEXT

A command nothing points at is a command nobody finds. `orb` is the menu skill and is what a DM runs to see what exists.

**Files:**
- Modify: `professor-orb/skills/orb/SKILL.md`, `professor-orb/README.md`, `professor-orb/CONTEXT.md`

**Interfaces:**
- Consumes: nothing. Documentation only.
- Produces: nothing.

- [ ] **Step 1: Find the component tables**

Run: `grep -n "migrate" professor-orb/skills/orb/SKILL.md professor-orb/README.md | head`

Read each table's existing rows so the new one matches column count and voice.

- [ ] **Step 2: Add the row to `orb`**

Add a row beside `/migrate`'s in the component table, matching the file's existing column layout:

```
| /genesis | Command | Creates a new setting: three prong folders scaffolded to professor-orb's layout, a vault, a tag registry, and a conventions.json entry. Adopts a folder tree that already exists rather than refusing it | `/genesis`, "start a second world", "new setting", "new campaign world" |
```

- [ ] **Step 3: Add the row to the README**

Add the same command to the README's components table, matching that table's columns.

- [ ] **Step 4: Record the decision in CONTEXT.md**

Add a vocabulary entry beside the existing ones, matching their format:

```
**starter layout**:
The folder tree /genesis lays down for a new world: one folder per knowledge-base
article type (people, locations, organizations, items, creatures, concepts), one
per homebrew artifact type (spells, magic-items, feats, features, monsters, npcs,
species, subclasses, classes, other), each with its own index. Derived from the
base type enum, applied rather than discovered, and pinned by a case in
migrate.plan.test.mjs so a type added to the enum without a folder fails there.
_Avoid_: calling it a template, or describing it as a default the consumer overrides
```

- [ ] **Step 5: Verify no em dashes**

Run: `grep -c $'\xe2\x80\x94' professor-orb/skills/orb/SKILL.md professor-orb/README.md professor-orb/CONTEXT.md`

Expected: `0` for all three.

- [ ] **Step 6: Commit**

```bash
git add professor-orb/skills/orb/SKILL.md professor-orb/README.md professor-orb/CONTEXT.md
git commit -m "$(cat <<'EOF'
docs(professor-orb): surface /genesis in the menu, README, and CONTEXT

orb is what a DM runs to see what exists, so a command missing from its
table is a command nobody finds.

CONTEXT gains a starter layout entry recording that the folder tree is
derived from the base type enum and applied rather than discovered, and
that a test pins it so a type added to the enum without a folder fails
there rather than shipping with nowhere to live.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Bump to 1.8.0

This is the release commit for both 1.8.0 features. If `2026-08-01-migrate-split-merge.md` has not landed yet, stop and land it first: this bump ships a version whose notes name both.

**Files:**
- Modify: `professor-orb/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Confirm both features are in**

Run: `git log --oneline -12`

Expected: commits for the split-merge guard, the bucket index routing, the merge disclosure, and `/genesis`. If the split-merge commits are absent, stop.

- [ ] **Step 2: Run every suite**

Run: `for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done`

Expected: all seven pass. Do not bump a version over a red tree.

- [ ] **Step 3: Bump both manifests**

In `professor-orb/.claude-plugin/plugin.json`, change `"version": "1.7.0"` to `"version": "1.8.0"`.

In `.claude-plugin/marketplace.json`, change the `professor-orb` entry's `"version": "1.7.0"` to `"version": "1.8.0"`.

- [ ] **Step 4: Verify both moved together**

Run: `grep -n '"version"' professor-orb/.claude-plugin/plugin.json .claude-plugin/marketplace.json`

Expected: `1.8.0` in both. A mismatch means the marketplace advertises a version the plugin does not carry.

- [ ] **Step 5: Commit**

```bash
git add professor-orb/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "$(cat <<'EOF'
chore(professor-orb): 1.8.0

Two features, independent of each other.

/migrate split buckets may now land in a subfolder that already has
content, which is the feature's most common real use: merging
unorganized material into organized material. A merged bucket rebuilds
the destination's existing index rather than creating a second one, and
the proposal lists what the destination already holds so the merge is
approved with both halves visible. The overwrite hazard the old refusal
stood in for is caught per file and always was.

/genesis creates a setting: three prong folders scaffolded to
professor-orb's layout, a vault, a tag registry, and a conventions.json
entry. It fills the gap /migrate declined by name. No new operation kind
was needed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Verification

After Task 5:

```
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

All seven suites pass. Then exercise the command for real: install the plugin into a scratch project that already has one world, run `/genesis`, and confirm three things the tests cannot check. First, a brand-new world produces the full folder tree with an index in every folder and a `settings[]` entry naming three roots that exist. Second, re-running against that same world produces an empty plan and stops without committing. Third, making a folder by hand and re-running fills in only its missing index and leaves the hand-made files untouched.

## Spec coverage

| Spec section | Task |
| --- | --- |
| Ask: name, rules, first campaign | Task 2, Steps 1 through 3 of the command |
| Name collision warns and asks | Task 2, command Step 1 and the never-do list |
| Plan and approve | Task 2, command Steps 5 and 6 |
| Execute through `applyPlan` | Task 2, command Step 8 |
| The plan needs no new operation kinds | Task 2, command Step 5; asserted by the operation count in Task 1 |
| Starter folders, derived from the base type enum | Task 1 (pinned against the enum), Task 2 (applied) |
| Adopting an existing tree | Task 2, command Steps 1, 5, 6, and the edge cases |
| `conventions.json` written outside the executor, from what applied | Task 2, command Step 9 |
| Never writes `retired` / `mergedInto` / `retiredCampaigns` | Task 2, command Step 9 and the never-do list |
| Files touched: `commands/genesis.md` | Task 2 |
| Files touched: both version manifests | Task 5 |
| Files touched: `commands/migrate.md` | Task 3 |
| Files touched: `skills/orb/SKILL.md`, `README.md`, `CONTEXT.md` | Task 4 |
| Tests 1 through 6 | Task 1 pins the layout, count, and stem rule. The three behavioral cases (adopt, empty plan, existing vault) are markdown-command behavior and are covered by the manual verification above, not by the suite |
