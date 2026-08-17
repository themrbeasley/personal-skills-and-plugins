# VTT import-file authoring: a corpus in the consumer project

Date: 2026-08-17
Component: `professor-orb/skills/homebrew/SKILL.md`, `professor-orb/commands/catalog.md`
Status: design, approved 2026-08-17

## Problem

The homebrew skill's "VTT Automation Awareness" section is written entirely for design
*review*. It lists automation concerns to raise while judging a mechanic: reaction-based
effects that interrupt the damage pipeline, contested rolls outside standard handling, aura
interactions, dice modifications the VTT cannot detect.

It carries nothing for *authoring* a VTT import file for a design that is already finalized.
That task follows directly from the skill's own handoff — design finalized, capture via
`/catalog`, then get it into the VTT — and it is where a DM most wants help, because it is
mechanical, schema-bound, and unforgiving of small errors.

Producing two Foundry item JSONs required reverse-engineering four things from files already
in the consumer project: the target versions (dnd5e `5.2.5` on core `13.351`, readable only
from an existing export's `_stats`), which existing files were hand-authored envelopes rather
than D&D Beyond imports carrying importer flag blocks, the current `activities` map and
`damage.parts` shapes, and the weapon-specific `system` fields that differ from equipment.

Each is stable across a system version and none is inferable without opening a file.

### The constraint that decides the strategy

Spell-cast activities reference world-scoped compendium UUIDs of the form
`Compendium.world.<pack>.Item.<id>`. They are not derivable, and they are not portable even
between one DM's own worlds — the primary consumer's exports span three, each with its own
pack namespace.

A guessed UUID produces an activity that fails silently when clicked, which is materially
worse than an absent one. An absent activity is visibly missing; a broken one looks correct
until it is needed at the table.

## Why a procedure in the skill rather than a reference file in the plugin

The issue report proposed a shipped per-VTT reference file as the higher-cost option,
following the pattern of `references/cr-balance-table.md` and
`references/magic-item-rarity-by-tier.md`.

Those two transcribe DMG tables. Rules content of that kind is frozen: the 2014 monster
statistics table will not acquire a new column. A Foundry dnd5e item schema is third-party
software on its own release cadence, unrelated to D&D rules versioning. Shipping a copy would
commit professor-orb to tracking dnd5e releases, and a stale copy is worse than none, because
it contradicts the DM's installed version while carrying the plugin's authority.

This design relocates the schema to the consumer project instead. The DM's own Foundry
exports are ground truth for the version they actually run, so staleness becomes visible and
DM-correctable rather than requiring a plugin release to fix.

## The corpus

```
homebrew/<setting>/foundryvtt/
  actors/  facilities/  features/  items/  spells/
  reference/
    actors/  items/  spells/ ...
```

Authored output goes in its type's bucket. `reference/` holds the DM's Foundry exports, kept
as accurate examples of the setup the DM actually runs, and gains sub-buckets mirroring its
siblings once it holds enough to be worth organizing.

**Bucket comes from the JSON's own top-level `"type"` field**, which has been stable across
Foundry's history. It is read by parsing the JSON, not by position in the file.

The mapping is not identity, so it is stated:

| `"type"` | bucket |
|---|---|
| `spell` | `spells` |
| `facility` | `facilities` |
| `feat` | `features` |
| `weapon`, `equipment`, `consumable`, `tool`, `loot`, `container` | `items` |
| `npc`, `character`, `vehicle`, `group` | `actors` |

**A `type` with no mapped bucket is put to the DM.** The bucket list is the DM's convention
and is open-ended; asking is what lets it stay open-ended without the skill inventing a folder
name into existence.

### Acquisition

When no exemplar exists for the type being authored, the skill says so, asks the DM to export
the closest published analogue from Foundry, and files the result into `reference/<bucket>/`
itself from a pasted path.

The skill offers the mechanics as **Windows specifics, named as such**: Foundry's exports land
in `Downloads/` by default, and Explorer's Ctrl+Shift+C copies a selected file's path. A DM on
another platform pastes a path from wherever their exports land. Professor-orb bakes in no
consumer's specifics, and a keyboard shortcut stated flatly would be one.

### Freshness

The corpus carries no automatic freshness guarantee. A major dnd5e, Foundry core, or module
update can leave an exemplar describing a schema the DM no longer runs, and keeping the corpus
current is the DM's job.

The skill makes that job possible rather than leaving it to memory: **every authoring run
states the `systemVersion` and `coreVersion` it read and names the exemplar it read them
from.** The skill has to read those fields anyway, so surfacing them is free, and it puts the
staleness check at the one moment it matters. A stale corpus is corrected by re-exporting.

This is a property of what the skill says on each run, not a claim about a file's history, so
it is checkable.

### Creation

Buckets are created lazily, one at a time, when a file is first written into one.

`/genesis` is untouched. Its starter layout pairs a `create-index` operation with every folder
it creates, which is how the layout satisfies folder-index parity by construction, and the
count is pinned as a hand-written literal at
`workflows/migrate.plan.test.mjs:5548` — twenty-one operations, or twenty-two with a first
campaign — precisely so a layout change forces a spec change rather than a silent number
drift.

Adding the buckets there would force a choice between creating indexes for folders that hold
no articles and writing a parity exemption into the rules. Lazy creation never raises the
question: the validation sweep enumerates with `find ... -name '*.md'`
(`workflows/validation-sweep.mjs:175`), and folder-index parity is evaluated off that
enumeration, so a folder holding only JSON never appears and is never measured.

The cost is discoverability, accepted. The acquisition flow names the destination and files
the file itself, so the DM is told where things go at the moment it matters.

## The authoring procedure

1. Resolve the target type and its bucket.
2. Find an exemplar of that type, searching `reference/<bucket>/` first, then `<bucket>/`.
   Exports already sitting in a type bucket are real exports and are valid schema sources. If
   neither holds one, run acquisition.
3. Read from the exemplar: `_stats.systemVersion`, `_stats.coreVersion`, the envelope, the
   `system` field set for that type, the `activities` map shape, and `damage.parts`.
4. State those versions and the exemplar's path to the DM before producing output.
5. **Author fresh.** The authored file's `flags` object holds only what this skill
   deliberately put there.
6. **Identity fields are generated.** `_id`, and the keys of the `activities` map, are new.
   Inherited ones collide on import. The authored envelope carries the version fields read in
   step 3, so the file declares what it was built against; the exemplar's per-install and
   per-user identifiers are not reproduced.
7. **World-scoped references are read, never constructed.** Where a reference export *from
   the same world* carries a compendium UUID, use it. Where none does, omit the activity and
   name it in the handoff. Same-world is load-bearing: the pack name embeds the world, so a
   UUID read from one world's export is wrong in another. When the corpus shows more than one
   world, the skill asks which world the file is for.

   Module-scoped asset paths break the same way and silently, so the same rule governs them:
   use one only where a same-world reference carries it, otherwise a core Foundry icon.
8. Produce the handoff list: the cast activities omitted under rule 7, and anything else left
   for the DM to wire after import.

### Capability follows the corpus

The skill authors any document class it has an exemplar for, rather than a fixed list of
supported types. Item-class documents are what the corpus covers today; an actor exemplar
filed into `reference/actors/` extends the skill to actors without a plugin change.

This is the same principle as rule 3 applied one level up: what the skill can do is read from
the consumer project rather than declared from memory.

### Why the clean-exemplar problem disappears

The issue report had to find the one hand-authored file among many D&D Beyond imports, because
importer flag blocks would have been carried into a file built by copying and editing one.

Rule 5 removes the need. When the exemplar is read for its shape and the output is authored
fresh, an import is exactly as good a schema source as a hand-authored file. There is no
longer a distinction to draw, so the skill needs no rule for drawing it.

## Placement

**`skills/homebrew/SKILL.md`.** A new `## VTT Import-File Authoring` section, immediately
after `## VTT Automation Awareness` and inside the same dividers, so review and authoring read
as the counterparts they are.

The frontmatter `description` gains a clause covering the authoring task. It currently routes
on "a mechanic checked against VTT automation constraints" and never mentions producing a
file; a section the skill is never invoked for helps nobody.

The primary trigger is a DM request. The existing finalization handoff gains **one clause**,
firing only where the project names a VTT — that moment already carries the `/catalog` pointer
and the Design Notes offer, and a third full block would turn a handoff into a wall.

**`commands/catalog.md`.** The commit pathspec, below.

## Commit ownership

The JSONs land inside `homebrew/<setting>/`, which is `/catalog`'s prong under the lane model.
But `/catalog` stages exactly two files by path — the entry and its owning index — and
`commands/catalog.md:103` is explicit that it uses "never a directory-wide add and never `-A`
or `-a`". Nothing would commit them.

That is not merely untidy. `/migrate` requires a clean tree, so permanently uncommitted files
in the tree would block it.

`/catalog` therefore extends its `:(literal)` pathspec to cover the JSONs attributable to the
entry it is capturing, together with any `reference/` exports filed during that session. The
mechanism, the message format, and the one-commit-per-artifact shape are unchanged.

## What the repo already handles

Recorded so the implementation does not re-investigate them:

- **The write-time hook does not block these writes.** `hooks/validate-write.mjs:904` parses
  frontmatter and exits 0 silently unless it finds a `type` field. A Foundry JSON opens with
  `{` and carries no `---` fence, so it reaches no check. Its internal `"type"` is invisible
  to a YAML frontmatter read.
- **The validation sweep does not see them**, per the `*.md` enumeration cited above.
- **Folder-index parity demands no index in these folders**, for the same reason.
- **The excluded-tag hook's Grep gate is real friction, not a block on these files.**
  `hooks/block-excluded.mjs:256-269` blocks a content- or `-o`-mode Grep across any project
  that configures excluded tags, regardless of file extension, which includes a same-world
  UUID search under `reference/`. It degrades gracefully: the block's own message names the
  workaround, `files_with_matches` then a per-file Read, and each JSON Read passes cleanly
  (the hook's Read/Write path exits at line 279 for anything that isn't `.md`). No exemption
  needed; worth knowing so the friction isn't mistaken for a real block.

No exemption needs writing for any of the four.

## Out of scope

**Non-Foundry VTTs.** No corpus and no evidence. The corpus model generalizes if a second VTT
ever arrives; nothing here is written to prevent that.

**Migrating the consumer's existing exports into `reference/`.** Those files are consumer
content, and `/migrate` performs structural operations rather than content reorganization of
this kind. Step 2's fallback search means they work where they already sit.

**Hook, sweep, and `/genesis` changes.** Each shown unnecessary above.

**Relationship to the Design Notes spec** (`2026-08-17-design-notes-design.md`): that spec
named this gap as tracked separately and shares `SKILL.md` with it and nothing else. This
design also edits `catalog.md`, which that one explicitly left unchanged, so the two remain
disjoint.

## Resolved decisions (2026-08-17)

1. **A procedure in the skill, not a reference file in the plugin.** The existing reference
   files transcribe frozen rules content; a VTT schema is third-party software that moves on
   its own cadence, and a stale shipped copy would carry the plugin's authority against the
   DM's installed version.
2. **The corpus lives at `homebrew/<setting>/foundryvtt/<bucket>/`**, with `reference/`
   holding DM exports and sub-bucketing once it earns it.
3. **Bucket derives from the JSON's `type` through a stated mapping**, and an unmapped type is
   asked about rather than guessed, which is what keeps the bucket list open-ended.
4. **Capability follows the corpus** rather than a fixed supported-type list, with acquisition
   filling gaps and freshness owned by the DM.
5. **Freshness is surfaced, not asserted.** The skill states the versions and the exemplar it
   read them from on every run, because a rule about what the skill says is checkable where a
   rule about a file's history is not.
6. **Author fresh rather than copy-and-edit**, which dissolves the clean-versus-imported
   exemplar problem instead of solving it.
7. **World-scoped references are read from a same-world export or omitted.** Derivation was
   preferred over the report's flat prohibition because the corpus makes real UUIDs readable;
   the prohibition survives intact for the case where none is.
8. **`/catalog` extends its pathspec.** Chosen over a hand-commit, which would leave the tree
   dirty and block `/migrate`, and over a dedicated committer, which would add command surface
   against the intent of picking the lower-cost option.
9. **Buckets are created lazily on first write.** `/genesis` and its pinned operation count
   stay untouched, and no parity exemption is needed.
