# /catalog redesign: artifact-type-aware, versioned homebrew capture

Date: 2026-07-11
Component: `professor-orb/commands/catalog.md`
Status: design, approved 2026-07-11

## Problem

The current `/catalog` command assumes every piece of homebrew is a single blob of
HTML that the DM pastes, which the command wraps verbatim in one fenced code block
inside one markdown entry. That model came from magic items, where an item usually
is one HTML description. It does not fit most homebrew:

- **Monsters and NPCs are not one HTML blob.** A creature stat block is a biography
  plus many separately named parts (traits, actions, bonus actions, reactions,
  legendary actions), each with its own description. In Foundry it lives as an actor
  JSON with per-item descriptions, so "paste the HTML stat block" has no correct answer.
- **Items are usually one description but not always** (tables, addenda).
- **Species, subclasses, classes, spells, feats, features** each have their own
  structure. One HTML paste does not serve them.
- **The sourcing rule is wrong for the DM's intent.** The command forbids anything
  but a fresh manual paste, to avoid cataloging a pre-tweak draft. But the finalized
  content already exists: the homebrew skill authored it, iteratively, and the DM
  confirmed it. The real guardrail is "never catalog an unfinished draft," not "never
  use anything but a manual paste."
- **The stated format does not match reality.** The one existing entry (Bionoid Bond)
  is plain markdown with no frontmatter and no fenced code block, which contradicts the
  command's "frontmatter plus fenced HTML" format.

## Corrected model

`/catalog` becomes: **capture a finalized piece of homebrew as a per-type entry, and
maintain it over its playtest life.** Type-aware, multi-part where the type needs it,
versioned, with an optional git-backed history. All catalogued homebrew is playtest
material by nature and is subject to revision, reversion, or discontinuation, in whole
or in part.

### Sourcing (maturity-aware)

1. **Primary: the homebrew skill's finalized design.** At the end of a homebrew-skill
   session the finalized content exists as Claude's output, iterated and confirmed by
   the DM. This works with **no Foundry involvement**, so the DM can catalog a design
   years before implementing it (or never implementing it).
2. **Optional enrichment: a Foundry JSON export.** When and if the DM has implemented
   the homebrew in Foundry (with automations and settings), they can point `/catalog`
   at the exported actor or item JSON. The command reads the as-built descriptions from
   it. Never required; the Foundry round-trip (build, apply automations, export, copy to
   project, supply path) is optional.
3. **Fallback: a manual paste**, as today.

**Anti-draft rule, corrected.** The guard is "only catalog *finalized, confirmed*
content," not "only a fresh manual paste." The DM invoking `/catalog` on content they
just confirmed is the gate; for a Foundry file, the DM pointing at the path is the
confirmation that it is the as-built version. No re-paste of what the assistant already
authored. This is consistent with the plugin's DM-supremacy posture: the DM is the
source of truth, and their act of invoking capture is the approval.

### Format principle

**Preserve the as-built content verbatim; do not re-transform it. The medium follows
the source.**

- A **Foundry-sourced** capture keeps the raw HTML in fenced blocks (per named part for
  a stat block).
- A **design-time** capture preserves the homebrew skill's finalized formatted text as
  it was confirmed.
- Either way the command never silently rewrites the DM's content.

This reconciles with the per-type templates below as follows: the template defines the
**structured frontmatter** (type-specific metadata) and the **body skeleton** (which
named blocks exist for this type). The **source fills each body block verbatim**. The
template is the skeleton; the source is the content. A monster from Foundry gets
frontmatter from the JSON's structured stat fields and one verbatim HTML block per
`items[]` entry plus the biography; the same monster designed but not yet built in
Foundry gets frontmatter from its finalized stat header and one verbatim block per
section of the finalized text.

## Per-type templates

The DM prefers dedicated per-type templates over a smaller set of shared shapes, because
type-specific detail matters more than keeping the template count low. Each type has its
own template: its own structured metadata header and its own body organization. Shared
machinery (frontmatter emission, index update, sourcing, versioning, lifecycle) is common
underneath so "more templates" does not mean disconnected implementations.

Field sets below are grounded in the SRD 5.2.1 (2024 rules). Each field is tagged
**[F]** frontmatter/metadata, **[B]** rendered body, or **[H]** homebrew-only (no SRD
basis; must never be presented as canon). Where the SRD embeds a value in prose that a
catalog might want structured, it is noted rather than invented.

### Cross-cutting facts from the SRD

- **NPC is not a separate stat block.** The SRD glossary defines an NPC as *a monster
  with a personal name and personality* — identical stat block, differing only in
  populated narrative fields. **Decision:** keep `monster` and `npc` as two distinct
  entry types the DM can choose, backed by **one shared stat-block schema**; NPC entries
  additionally expose the homebrew flavor fields (bio, faction, hooks, portrait), which
  monster entries usually leave empty.
- **"Feature" has no SRD type.** The closest analogue is a class/subclass feature
  (name + level + single prose block). A standalone, campaign-granted feature — which is
  exactly what Bionoid Bond is — is an inherently homebrew shape. This template is
  honestly homebrew-flavored, and Bionoid Bond is its exemplar.
- **Ritual and Concentration are not separate spell fields** in canon; they live inside
  Casting Time (`or Ritual`) and Duration (`Concentration, up to ...`). A filterable
  boolean is a homebrew normalization.
- **Species carry no ability-score increases** in 2024 (moved to Background).

### Spell
- **[F]** name; level (0-9, 0 = cantrip); school (enum: Abjuration, Conjuration,
  Divination, Enchantment, Evocation, Illusion, Necromancy, Transmutation); class tags;
  casting time (with `or Ritual` tag when applicable); range (distance / Touch / Self);
  components (V/S/M plus material text); duration (with `Concentration, up to ...` tag).
- **[B]** effect prose, then a trailing `Using a Higher-Level Spell Slot.` (leveled) or
  `Cantrip Upgrade.` (cantrip) paragraph when present.
- **[H]** optional boolean `ritual` / `concentration` for filtering. Save DC and attack
  bonus are never per-spell (universal formulas).

### Magic item
- **[F]** name; category (enum: Armor, Potion, Ring, Rod, Scroll, Staff, Wand, Weapon,
  Wondrous Item; plus subtype text where relevant); rarity (enum: Common, Uncommon, Rare,
  Very Rare, Legendary, Artifact); attunement (bool plus optional qualifier string);
  charges (count plus recharge phrasing, default "daily at dawn"); cursed (bool, default
  false).
- **[B]** effect prose plus optional `Regaining Charges.` paragraph; optional sentience
  sub-block (Intelligence/Wisdom/Charisma, alignment, communication, senses, purpose)
  only for items the DM makes sentient.
- **[H]** fixed GP price (SRD gives value by rarity band only); activation-method enum
  (Magic action / Bonus Action / Reaction / passive), stated in prose per item in canon.

### Monster / NPC (shared stat-block schema)
- **[F]** name; size; creature type (plus descriptive tag); alignment; AC; initiative
  (modifier plus score); HP (number plus hit-dice expression); speed (walking plus
  special movement); six ability scores (STR/DEX/CON/INT/WIS/CHA); saving-throw
  modifiers; skills; resistances; vulnerabilities; damage + condition immunities; gear;
  senses (special senses plus passive Perception); languages (plus telepathy); CR (plus
  XP, plus Proficiency Bonus).
- **[B]** Traits, Actions, Bonus Actions, Reactions, Legendary Actions — each a
  `{name, description}` pair; empty sections omitted entirely. 2024 phrasing:
  `Melee/Ranged Attack Roll: +X, reach/range N ft. Hit: N (dice) Type damage.`; saves as
  `<Ability> Saving Throw: DC N, <targets>. Failure: ... Success: ...`; Multiattack first
  in Actions; Legendary Actions preceded by the usage boilerplate line; Legendary
  Resistance is a Trait, not its own section.
- **[H]** (NPC flavor) roleplay bio, personality, faction/affiliation, location(s), plot
  hooks/secrets, relationships, portrait reference. Also "Habitat" and "Treasure" lines
  (absent from SRD 5.2.1; Monster-Manual-style, not SRD-native).

### Species
- **[F]** name; creature type; size; speed.
- **[B]** a flat set of named traits (`{name, description}`); named sub-choice tables
  (draconic ancestry, elven/gnomish lineage, giant ancestry, fiendish legacy) where the
  species presents a choice.
- **[H]** structured resource tracking (uses / recharge) parsed out of trait prose;
  "size chosen at creation" boolean.

### Feat
- **[F]** name; category (enum: Origin, General, Fighting Style, Epic Boon); prerequisite
  (optional free text); repeatable (bool plus optional condition string).
- **[B]** a single prose block, or `You gain the following benefits.` followed by a
  named-benefit list; an `Ability Score Increase.` benefit is a conventionally-named
  list item, not a separate field.
- **[H]** machine-checkable prerequisite parts (min level, required ability + score,
  required feature); "has ASI" boolean.

### Feature (inherently homebrew shape; SRD analogue = class/subclass feature)
- **[F]** name; source (class / subclass / species / campaign); level or grant condition.
- **[B]** a single prose block; internal sub-sections allowed (Bionoid Bond's Armor Mode
  and Combat Mode headings).
- **[H]** the entire standalone / campaign-granted notion, plus prerequisite / trigger /
  scope. None are SRD.

### Subclass
- **[F]** name; parent class; subclass-feature levels (array of ints).
- **[B]** a one-line tagline; a flavor paragraph; level-keyed features (`Level N: Name`
  plus prose).
- **[H]** balance/tier tags; author; version metadata.

### Class
- **[F]** name; primary ability; hit point die; saving-throw proficiencies; skill
  proficiencies (choose-N plus list); weapon proficiencies; armor training; tool
  proficiencies (optional — some classes grant none); starting-equipment options;
  subclass-choice level.
- **[B]** the progression table (`Level | Proficiency Bonus | Features | class-resource
  columns`); level-keyed features; the multiclass-entry subset.
- **[H]** a flexible `extraColumns` structure for class-specific resource trackers
  (names vary per class); playstyle / tier tags.

### Other / custom
- **[F]** name; DM-defined type label.
- **[B]** free-form.
- **[H]** everything. Catch-all so no novel kind of homebrew is ever blocked.

## Lifecycle status

Because all catalogued homebrew is playtest material, every entry carries a status:
**playtest** (default) -> **active** (in use at the table) -> **reverted** /
**discontinued**. Settable per entry, and notable per-part for stat blocks (one trait
discontinued while the rest stays) via an inline note on that part.

## Versioning (two tracks, established once)

The plugin must not force git on anyone (it is system-agnostic and the KB may be plain
markdown), but a private homebrew repo is a good idea and should be offered. The mode is
established once, the first time a catalog is used, and then followed silently.

- **First-time establishment.** Before the first capture writes anything, the command
  checks whether versioning has been established: is the catalog already inside a git
  repo, or does a marker `.professor-orb/catalog-versioning.json` exist? If neither, this
  is first use, so the command offers git once (DM-approval-gated, never forced).
  Pre-existing catalog entries do NOT count as established, so a catalog holding legacy
  entries still gets the offer. The chosen mode is recorded in the marker so the command
  never re-asks.
- **Git track (the real history).** If the DM accepts (or the catalog is already a git
  repo), the command runs `git init` locally and every capture and revision becomes a
  commit, so history, diff, and revert are real git operations. In git mode the entry
  carries no changelog block; the commit history is the record. Creating a private remote
  and pushing stays the DM's action (account and auth territory the command must not
  enter).
- **No-git baseline.** If the DM declines, the marker records changelog mode and the entry
  tracks a version number plus a short per-capture changelog line. Honest limitation:
  without git there is no full old-content recovery, which is why the git offer exists
  rather than a hand-rolled markdown history.

A new version is triggered by the DM re-running `/catalog` on a homebrew that already has
an entry; the command detects the existing entry and records the capture as a revision
(git commit in git mode, changelog line in changelog mode).

Recording the chosen mode in the marker is what makes the offer fire exactly once and
never nag; an earlier iteration recorded no choice, which let a first run silently default
to the no-git baseline without ever offering.

## Preserved machinery (unchanged from the current command)

- **Conventions-first resolution.** Read `.professor-orb/conventions.json` for catalog
  location, frontmatter schema, filename rules, and index conventions; fall back to
  `CLAUDE.md`; ask the DM if neither locates the catalog.
- **One entry file plus the owning index.** Write one entry, update exactly one owning
  index, single-ownership. Do not invent a sub-index split without asking.
- **PostToolUse hook compliance.** The entry write should pass the write-time validator;
  fix and retry on a block rather than working around it.
- **Standalone.** Outside the session pipeline; never writes `pipeline-state.json`.
- **Homebrew skill handoff.** The homebrew skill continues to point the DM here once a
  design is locked; it never catalogs itself.
- **Report back** with the entry path and index confirmation; keep it short.

## Existing entry migration

The current Bionoid Bond entry predates this design (markdown transcription, no
frontmatter, no fenced block). Its Foundry JSON exists, so re-capturing it under the new
format is easy and is a clean first real-world test of the `feature` template and the
Foundry-JSON source path. **Decision: re-capture Bionoid Bond under the new format as the
first validation case.** Because Bionoid Bond's as-built content lives in a Foundry JSON,
this validation case exercises the Foundry-JSON source path (Phase 2), so it lands with
Phase 2, not Phase 1.

## Scope and phasing

The spec covers the whole design as one coherent command. Implementation may be
sequenced:

- **Phase 1:** per-type capture from the homebrew skill's finalized output and from a
  manual paste; the per-type templates; lifecycle status; index and format handling;
  versioning baseline; and the git offer.
- **Phase 2:** Foundry-JSON enrichment (reading actor/item JSON), which carries the most
  format risk (Foundry's schema can change over time).

**Decision: build Phase 1 first, then Phase 2.**

## Resolved decisions (2026-07-11)

1. Bionoid Bond is re-captured under the new format as the first validation case; it
   lands with Phase 2 because its source is a Foundry JSON.
2. Phasing: Phase 1 first, then Phase 2.
3. Lifecycle status set (playtest / active / reverted / discontinued) is correct as-is.
