# `/genesis`: create a setting

Date: 2026-08-01
Status: design, approved 2026-08-01

> Ships in professor-orb 1.8.0 alongside `2026-08-01-migrate-split-merge-design.md`.
> The two are independent: that one changes one planner inside `workflows/migrate.mjs`,
> this one adds a command. They share a release and nothing else.
>
> This is the "spec 5" referenced by `2026-07-28-migrate-command-design.md`,
> `2026-07-28-apply-the-schema-design.md`, `2026-07-28-lane-commands-design.md`, and
> `2026-07-28-canonical-schema-design.md`.

## Problem

The multi-setting layout has existed since 1.6.0: `conventions.json` carries a `settings[]`
array, one entry per world, and every lane command resolves through it. Nothing creates an
entry. `setup` writes the first one as a side effect of onboarding an existing project, and
`/migrate` declines the job outright:

> Creating a setting is out of scope for this release. If the DM asks to start a second
> world, say that `/migrate` performs lifecycle operations on a setting that already exists
> (a rename, a retirement, a split, or a merge) and that creating one is not part of what it
> does. Do not improvise a creation path: a half-created setting with no `conventions.json`
> entry is worse than none.

So a DM who wants a second world has no supported path. `/migrate` can rename, retire, split,
and merge worlds it did not create. This spec closes that gap and nothing else.

## Professor-orb decides the layout

A new world is laid down to professor-orb's own schema. The starter folders below are derived
from the base type enum in `references/base-rules.json`, not invented and not discovered from
anything the DM already has. This is the same posture `setup` takes when it applies the
canonical layout to an existing project, and the reason a new world is valid against the
validator the moment it exists.

## What a run looks like

Three parts, the shape `/migrate` already uses: ask, plan and approve, execute.

### 1. Ask

Three questions, and only three:

- **The world's name.** Short identifier, used in every per-setting path.
- **Where the rules come from.** professor-orb's base layer always comes along; it is identical
  in every setting by design. What is asked about is the rest: the `extendedBy` custom article
  types and any project-provenance rule tweaks an existing world carries. Offer to copy them
  from a named existing world, or start with base rules only. A second world in the same genre
  usually wants them; one in a different genre usually does not.
- **The first campaign's name**, skippable. Naming it creates the campaign folder under
  `sessionReportsRoot` and seeds `campaigns`, so the session-reports prong is usable
  immediately rather than after the first `/log`.

**A name collision stops the run and asks.** Before anything else, check the name against both
`settings[]` and the filesystem. If either already has it, report exactly what was found: a
registered entry, folders on disk, or both, then ask how to proceed. `/genesis` never decides
this on its own: adopting an unregistered folder tree and refusing a duplicate registration are
both reasonable, and which one is right depends on how the collision arose. Warn, show, wait.

### 2. Plan and approve

Build the operations below, run the prechecks, and show the DM the plan before executing. The
same principle `/migrate`'s proposal step rests on applies: the plan is the only place a
misreading becomes visible before it costs anything.

### 3. Execute

Hand the plan to `applyPlan`, with `settings` set to the on-disk array plus the new world's own
entry, not the on-disk array alone. The executor resolves a `tag-registry` operation's owner and
a `create-index` operation's suffix by matching against `settings`; a world absent from that
array owns nothing under either lookup, so its registry operation finds no owner and its indexes
fall back to the base suffix. Then write the `conventions.json` entry.

## The plan needs no new operation kinds

`create-index` creates its own folder. `writeText` (`migrate.mjs:5892`) does a recursive
`mkdirSync` of the destination's parent before writing, so an index written into a folder that
does not exist brings the folder into being. The whole folder tree therefore falls out of the
index list rather than needing an operation of its own, and `/genesis` builds a world entirely
from kinds that already exist, are already ranked in `APPLY_ORDER`, and are already tested.

| Kind | Count | For |
| --- | --- | --- |
| `create-index` | 7 | `kbRoot` plus one per article-type folder |
| `create-index` | 11 | `homebrewRoot` plus one per artifact-type folder |
| `create-index` | 1–2 | `sessionReportsRoot`, plus the first campaign if one was named |
| `vault` | 1 | the world's Obsidian vault (create shape: `to`, no `from`) |
| `tag-registry` | 1 | the companion registry at `tagRegistryPath` |

`applyCreateIndex` derives each index's `type` from the suffix rule the filename satisfies via
`typeForSuffix`, falling back to `Index`, and writes "No articles in this folder yet." for an
empty folder. It writes no `publish` field, which is correct and deliberate: that flag is never
set by an unattended process.

Index stems follow the setting's own suffix rule through `indexStemFor`, the same helper
`planSplitFolders` uses for a bucket index, so a world created here and a folder split later
name their indexes by one rule.

## Starter folders

Derived from the base type enum. The knowledge-base types are `Person`, `Location`,
`Organization`, `Item`, `Creature`, and `Concept`; `Index`, `Session Report`, `Session Prep`,
and `Chronology` are not subject folders and get none.

```
<kbRoot>/                people/ locations/ organizations/ items/ creatures/ concepts/
<homebrewRoot>/          spells/ magic-items/ feats/ features/ monsters/ npcs/
                         species/ subclasses/ classes/ other/
<sessionReportsRoot>/    <first-campaign>/        (only if a campaign was named)
```

Lowercase plural, matching the existing consumer's `items/`. Each folder gets its own index,
which is what folder-index parity requires; a starter folder without one would be born
violating a rule professor-orb enforces.

`other/` is included because `other` is a real value in the homebrew artifact enum, and an
entry carrying it needs somewhere to live that satisfies parity. It is the one folder here that
is a catch-all rather than a category.

## Adopting an existing tree

This falls out of the precheck machinery rather than needing a second code path.

`create-index` is deliberately absent from `DESTINATION_MAY_EXIST`, so an index already on disk
registers as an on-disk destination collision at plan time. `/genesis` surveys the target paths
first and **emits operations only for what is genuinely missing**, then reports the rest as
already present and left alone. The prechecks stay green because the plan never names an
occupied path.

Consequences, all of them wanted:

- A world whose scaffolding drifted, someone having made `locations/` by hand and never written its
  index, gets exactly its gaps filled.
- A complete world produces an empty plan, and the run says so rather than doing nothing
  silently.
- **No existing file is ever written.** Not an index, not an article. The survey is what
  guarantees it, and `applyCreateIndex` refuses an existing destination independently as a
  second line.

The `vault` create shape is already exempt from the on-disk check (`destinationMayExist`
returns true for `vault` with no `from`), and `applyVault` is idempotent: `mkdirSync` is
recursive and the `app.json` marker is written only when absent. So re-running against a world
that already has a vault neither false-aborts nor overwrites the DM's Obsidian configuration.

## `conventions.json`

No operation kind writes `conventions.json`, and none should. `setup` writes the `.professor-orb/`
artifacts itself at its Step 12, outside the executor, and `/genesis` does the same: the executor
builds the tree, and the settings entry is written after it returns.

The entry carries `name`, the three prong roots, `campaigns`, `tagRegistryPath`, and `rules`.
It carries none of `retired`, `mergedInto`, or `retiredCampaigns`. Those three are `/migrate`'s
alone and are absent on a world that has never been retired or merged.

**Written from what applied, not from what was planned**, the same rule `/migrate` Step 8 follows
when it passes `result.applied` to `conventionsAfterScope`. A prong whose `create-index`
operations all failed must not be recorded as a root that exists. If the executor reports
failures, report them and write the entry describing only what is actually on disk.

## Files touched

| File | Change |
| --- | --- |
| `professor-orb/commands/genesis.md` | **New.** The command. |
| `professor-orb/.claude-plugin/plugin.json` | Version to 1.8.0. |
| `.claude-plugin/marketplace.json` | Version to 1.8.0. |
| `professor-orb/commands/migrate.md` | Remove "Creating a setting is out of scope for this release"; point at `/genesis`. |
| `professor-orb/skills/orb/SKILL.md` | Add `/genesis` to the component menu. |
| `professor-orb/README.md` | Add `/genesis` to the components table. |
| `professor-orb/CONTEXT.md` | Record the command and the starter-layout decision. |

No change to `workflows/migrate.mjs`. That is the point of the design.

## Tests

`/genesis` is a command, and commands in this plugin are markdown rather than code, so most of
its behavior is exercised by running it. What is testable is the plan it produces, and that
belongs with the executor's existing plan suite:

1. A brand-new world plans 21 operations without a campaign and 22 with one: 7 knowledge-base
   indexes, 11 homebrew, 1 session-reports root, the optional campaign, 1 `vault`, and 1
   `tag-registry`, and the prechecks come back ok.
2. Every planned index path sits inside the prong root it belongs to, and each folder's index
   stem matches `indexStemFor` for that setting's suffix.
3. A target folder that already holds an index contributes **no** `create-index`, and the
   prechecks stay ok. This is the adopt case.
4. A fully scaffolded world plans zero operations.
5. A world with an existing vault plans the `vault` operation without tripping the on-disk
   collision check.
6. Naming a campaign adds exactly one `create-index` under `sessionReportsRoot`; omitting one
   adds none.

## Out of scope

- **Renaming, retiring, merging, or splitting a world.** All `/migrate`'s, all already built.
  `/genesis` only creates.
- **Any change to `workflows/migrate.mjs`.** Every operation kind it needs exists.
- **Seeding content.** Starter folders and indexes only; no example articles.
- **Deciding a collision automatically.** Warn and ask is the whole behavior; adopt-vs-refuse
  is the DM's call at the moment it arises.
- **The split-folder merge fix.** Its own spec, same release.
