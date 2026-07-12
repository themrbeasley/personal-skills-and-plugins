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
