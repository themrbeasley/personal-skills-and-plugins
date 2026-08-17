# Catalog entry templates by artifact type

This file defines one entry template per homebrew artifact type. `/catalog` reads it and
uses the template matching the artifact's type. Each template lists its fields tagged:

- **[F]** frontmatter / metadata (structured, goes in the entry's YAML frontmatter)
- **[B]** rendered body (the DM's finalized content, preserved verbatim per Preservation below)
- **[H]** homebrew-only field with no SRD 5.2.1 basis; never present it as canon

Field sets are grounded in SRD 5.2.1 (2024 rules). See the design spec
`docs/superpowers/specs/2026-07-11-catalog-redesign-design.md` for provenance.

## Shared rules for every template

- **Preservation:** the body holds the DM's finalized content verbatim. The medium follows
  the source: content designed in the homebrew skill is preserved as the finalized formatted
  text; content exported from Foundry (Phase 2) is preserved as raw HTML in fenced blocks.
  Never silently rewrite the DM's content.
- **Skeleton vs content:** the template defines the frontmatter fields and which named body
  blocks exist for the type. The source fills each block verbatim.
- **Required frontmatter floor (all types):** `name`, `type` (the artifact type key),
  `status` (lifecycle; see the command), `version`, `date` (capture date, today), plus
  whatever `.professor-orb/conventions.json` marks required. Type-specific fields below are
  additive.

### Design Notes (optional, every type)

A record of the design decisions behind the artifact. Present when the design produced
decisions worth recording, absent otherwise. Available to every type key.

**Structure.** A list of labeled records, each answering one design question about this
artifact.

**Every paragraph carries a label, and the label is a design question.** The shapes in use:

- `Why <the design> exists.` — the general gap it fills, in the mechanical or thematic space
  at large (for example, "True Resurrection is effectively unreachable in Rolara"). Never a
  specific, dated campaign condition or a particular PC's situation — those belong only
  under `What the design responded to.`
- `Rejected: <the alternative>.` — what was cut, and why
- `<The mechanic>.` — what it was assembled out of, and why that shape
- `<The question>, raised but not settled.` — deliberately left open
- `Why <a fiction-driven choice>.` — how the fiction produced the mechanic
- `Naming.` — naming intent
- `What the design responded to.` — the campaign, the month and year, and the conditions
  the design answered

**The body answers the label's question,** about the artifact as a designed object: why it
is the way it is.

**Where a choice was made among alternatives, the record says it was made and says what was
cut.** The verbs carrying this are past tense: was cut, was weighed and declined, was
assembled out of, was chosen for, was kept instead, was set aside, was left in place rather
than designed around.

**Campaign conditions belong in `What the design responded to.` and nowhere else.** A
campaign condition is any fact specific to one campaign or table: a PC's situation, an
ongoing plot thread, a particular table's history. It is bound to the campaign and the month
and year, as a condition the design answered, and it is never restated or summarized under
another label — including `Why <the design> exists.`, whose gap is general, not
campaign-specific. Stated that way, a condition stays true after play moves past it.

**Each record is a decision the DM made.**

**The block is shown to the DM and confirmed before the entry is written.** This holds
however the text came to exist, so it needs no account of who drafted which part.

**Tagging: `[H]` alone.** It has no SRD 5.2.1 basis and never reads as published-rules
apparatus. It carries no `[B]` tag: `[B]` means content supplied to the command and
preserved verbatim, and this block's own rules cover how it comes to exist.

## spell

- **[F]** name; level (0-9, 0 = cantrip); school (enum: Abjuration, Conjuration, Divination,
  Enchantment, Evocation, Illusion, Necromancy, Transmutation); class tags; casting time
  (append `or Ritual` when applicable); range (a distance, Touch, or Self); components (V/S/M
  plus material text); duration (append `Concentration, up to ...` when applicable).
- **[B]** effect prose, then a trailing `Using a Higher-Level Spell Slot.` (leveled) or
  `Cantrip Upgrade.` (cantrip) paragraph when present.
- **[H]** optional boolean `ritual` / `concentration` for filtering. Save DC and attack bonus
  are never per-spell.

## magic-item

- **[F]** name; category (enum: Armor, Potion, Ring, Rod, Scroll, Staff, Wand, Weapon,
  Wondrous Item; plus subtype text where relevant); rarity (enum: Common, Uncommon, Rare,
  Very Rare, Legendary, Artifact); attunement (bool plus optional qualifier string); charges
  (count plus recharge phrasing, default "daily at dawn"); cursed (bool, default false).
- **[B]** effect prose plus optional `Regaining Charges.` paragraph; optional sentience
  sub-block only for items the DM makes sentient.
- **[H]** fixed GP price (SRD gives value by rarity band only); activation-method enum.

## feat

- **[F]** name; category (enum: Origin, General, Fighting Style, Epic Boon); prerequisite
  (optional free text); repeatable (bool plus optional condition string).
- **[B]** a single prose block, or `You gain the following benefits.` followed by a
  named-benefit list. An `Ability Score Increase.` benefit is a conventionally-named list
  item, not a field.
- **[H]** machine-checkable prerequisite parts; "has ASI" boolean.

## feature

Inherently a homebrew shape (the SRD has no standalone feature type; the closest analogue is
a class/subclass feature). Bionoid Bond is the exemplar.

- **[F]** name; source (class / subclass / species / campaign); level or grant condition.
- **[B]** a single prose block; internal sub-sections allowed (for example Armor Mode and
  Combat Mode headings).
- **[H]** the entire standalone / campaign-granted notion, plus prerequisite / trigger /
  scope. None are SRD.

## monster and npc (shared stat-block schema)

`monster` and `npc` are two type keys over one stat-block schema. An NPC is, per the SRD
glossary, a monster with a personal name and personality: same stat block, differing only in
which flavor fields are populated. Use type key `monster` for a bestiary creature and `npc`
for a named, characterized one; `npc` entries additionally populate the flavor fields below.

- **[F]** name; size; creature type (plus descriptive tag); alignment; AC; initiative
  (modifier plus score); HP (number plus hit-dice expression); speed (walking plus special
  movement); six ability scores (STR, DEX, CON, INT, WIS, CHA); saving-throw modifiers;
  skills; resistances; vulnerabilities; damage and condition immunities; gear; senses
  (special senses plus passive Perception); languages (plus telepathy); CR (plus XP, plus
  Proficiency Bonus).
- **[B]** Traits, Actions, Bonus Actions, Reactions, Legendary Actions. Each named entry is a
  `{name, description}` pair. Omit an empty section entirely. Use 2024 phrasing verbatim from
  the source: `Melee/Ranged Attack Roll: +X, reach/range N ft. Hit: N (dice) Type damage.`;
  saves as `<Ability> Saving Throw: DC N, <targets>. Failure: ... Success: ...`; Multiattack
  first in Actions; Legendary Actions preceded by the usage boilerplate line; Legendary
  Resistance is a Trait, not its own section.
- **[H]** (npc flavor only) roleplay bio, personality, faction / affiliation, location(s),
  plot hooks / secrets, relationships, portrait reference. Also "Habitat" and "Treasure"
  lines (absent from SRD 5.2.1; Monster-Manual-style, not SRD-native).

## species

- **[F]** name; creature type; size; speed.
- **[B]** a flat set of named traits (`{name, description}`); named sub-choice tables
  (draconic ancestry, elven / gnomish lineage, giant ancestry, fiendish legacy) where the
  species presents a choice.
- **[H]** structured resource tracking (uses / recharge) parsed out of trait prose; "size
  chosen at creation" boolean.

## subclass

- **[F]** name; parent class; subclass-feature levels (array of ints).
- **[B]** a one-line tagline; a flavor paragraph; level-keyed features (`Level N: Name` plus
  prose).
- **[H]** balance / tier tags; author; version metadata.

## class

- **[F]** name; primary ability; hit point die; saving-throw proficiencies; skill
  proficiencies (choose-N plus list); weapon proficiencies; armor training; tool
  proficiencies (optional, some classes grant none); starting-equipment options;
  subclass-choice level.
- **[B]** the progression table (`Level | Proficiency Bonus | Features | class-resource
  columns`); level-keyed features; the multiclass-entry subset.
- **[H]** a flexible `extraColumns` structure for class-specific resource trackers (names
  vary per class); playstyle / tier tags.

## other

Catch-all so no novel kind of homebrew is ever blocked.

- **[F]** name; a DM-defined type label.
- **[B]** free-form, preserved verbatim.
- **[H]** everything.
