# Phase 1: the schema is professor-orb's

Date: 2026-07-28 (revised 2026-07-28 after adversarial verification)
**Phase 1 of 3 in a single 1.6.0 release.** Phases 2 and 3 are
`2026-07-28-apply-the-schema-design.md` and `2026-07-28-lane-commands-design.md`.
Status: design, approved 2026-07-28

> **These three specs ship as one release, in order.** They are not independently
> shippable and must not be treated as three increments. Phase 1 alone declares a schema
> nothing can instantiate, and leaves the rule-provenance fix dead in every existing
> consumer. Phase 2 runs `git init` at the project root, which would make `/catalog`'s
> repo-presence check return true for every consumer, so **phase 2 itself** deletes that
> check and flips Step 3's precedence; phase 3 collapses the remainder. The
> `conventions.json` version integer (1, then 2, then 3) identifies the file shape at each
> phase boundary and exists so an in-progress implementation stays coherent, not so the
> phases can ship separately. One version bump, 1.5.1 to 1.6.0, at the end.

## Problem

Professor-orb was built to impose an organizational method on campaign material that needs
one. `CONTEXT.md:108` states this directly about folder-index parity: it is "the structural
convention professor-orb **introduces** (amending Rolara's current, sloppier practice via
the resync flow)." `CONTEXT.md:128` agrees: "The setup skill applies the same index system
to new consumers, whether they arrive with an established KB or none at all."

The instruction files say the opposite. `skills/setup/SKILL.md:12`: "This skill discovers
and derives; it **never imposes a schema the project does not already use**."
`README.md:11`, one of the two facts the README says govern everything else: "The plugin is
configuration; the consumer project is the source of truth. No skill hardcodes a folder
layout, a frontmatter schema, or a filename convention." The plugin's owner has confirmed
the setup sentence is wrong and was invented by a previous agent.

The consequence is not theoretical. The plugin handles new material well and existing
material badly, because every component that meets an established KB is instructed to
reverse-engineer that KB's conventions and conform to them. A consumer with a disorganized
KB gets their disorganization ratified as the rule set, and the validator then enforces it.

An audit (6 agents, all 27 plugin files) found the defect is not localized:

- **Roughly 50 sentences across 8 files** state or reinforce the derive-never-impose
  posture, 17 of them load-bearing.
- **The same deference paragraph is duplicated in ten components** (debrief, prep, content,
  chronicler, timeline, catalog, lore, historian, kb-validator, homebrew). Four of them
  (`debrief:29`, `prep:30`, `chronicler:31`, `timeline:30`) go further and authorize
  inventing conventions on the spot.
- **The plugin already contradicts itself in both directions.** `setup/SKILL.md` Step 6
  imposes parity without deriving it, eleven paragraphs below the line forbidding
  imposition. `CONTEXT.md:28` ("The plugin ships no templates or schemas") contradicts
  `CONTEXT.md:108` in the same document.
- **A rule-provenance defect sits in the autofix path.** `agents/rule-fixer.md:35` tells the
  fixer that a rule's guidance "came from the project's conventions file, which the DM
  wrote. Follow it literally," and `hooks/validate-write.mjs:667` says "The DM pre-approved
  this fix class by setting autofix on the rule, so apply it without asking." Both become
  false once professor-orb ships its own rules, and they are what authorize unattended
  edits.
- **`enforcement: "off"` does not silence anything outside the hook.** The hook honors it
  (`validate-write.mjs:763`). The sweep does not: its checker prompt hands workers
  `rulesJson` verbatim (`validation-sweep.mjs:185`) and says "Check every frontmatter
  category rule against this file" (`:191`) and "Check every filename category rule"
  (`:192`) with no enforcement filter. Only `tagVocabulary` consults it (`:193`). Findings
  from an `off` rule land in `mechanicallyFixable`, which one batch approval applies.
  `conventions-schema.md:240` claims the opposite: "The sweep may still choose to report
  `off` rules informationally, but never fails on them."

This phase resolves an existing inconsistency in the plugin's favor. It does not introduce
a new one.

**One correction to an earlier draft of this spec.** It claimed `setup/SKILL.md:43` forbids
shipping sweep-scope rules. It does not. The line reads in full: "Only per-write-checkable
conventions become active rules in `conventions.json`. A whole-KB convention **may still be
included as a sweep-scope entry** (`enforcement: "off"` is typical)." The plugin already
permits what is needed. The only change is that a sweep-scope rule may carry
`provenance: "professor-orb"` and be emitted unconditionally, rather than only when the
consumer's own project happens to state it.

## Decisions

- Professor-orb owns the structural layer. Derivation is demoted to an extras layer for
  what the base schema does not cover.
- The base/derived split is as enumerated in Part 2, approved as proposed.
- Every rule records its provenance. `rule-fixer` keeps applying both kinds; the
  instruction stops claiming the DM authored what they did not.
- The base rule set ships as a machine-readable artifact, not as prose.
- Rules become per-setting in phase 2. This phase defines the rule model; phase 2 defines
  where it lives.

## Design

### Part 1: `conventions.json` becomes two layers

The file stops being "the machine-checkable derivation of a consumer project's conventions"
and becomes "professor-orb's schema, instantiated for this project, plus what this project
adds."

```json
{
  "version": 2,
  "schemaVersion": 1,
  "kbRoot": "rolara-kb",
  "generatedBy": "setup",
  "generatedAt": "2026-07-28T00:00:00Z",
  "sourceConventionsDoc": null,
  "tagRegistryPath": ".professor-orb/tag-registry.json",
  "rules": {
    "structuralIndexParity": {
      "provenance": "professor-orb",
      "category": "structural",
      "check": "indexParity",
      "enforcement": "warn",
      "description": "Every folder with content has exactly one owning -INDEX file.",
      "params": { "indexSuffix": "-INDEX" }
    },
    "frontmatterTypeEnum": {
      "provenance": "professor-orb",
      "extendedBy": ["Settlement", "Landmark", "Species"],
      "category": "frontmatter",
      "check": "enum",
      "enforcement": "block",
      "params": { "field": "type", "values": ["Person", "Location", "Settlement"] }
    }
  }
}
```

`kbRoot` stays `rolara-kb` at this phase: `settings/rolara` does not exist until phase 2's
migration creates it, and a `kbRoot` pointing at a nonexistent folder would make
`validate-write.mjs:724-729` exit 0 on every write, silently disabling the validator.

- **`provenance`** on every rule: `"professor-orb"` or `"project"`. Required. A rule without
  it reads as `"project"`, and setup rewrites it on next run.
- **`schemaVersion`**: which version of professor-orb's base rule set this file was
  generated against, so a later run can detect the base layer has moved on. Independent of
  `version`, which describes the file format.
- **`version` goes to 2** at this phase, and to 3 in phase 2. The integer identifies the
  shape unambiguously at every point.

**Extension, not duplication.** A project does not get a second rule of the same check kind
on the same field. `checkEnum` (`validate-write.mjs:236-244`) fails per rule independently,
so two `enum` rules on `type` would make every article fail one of them. Instead a base rule
carries `extendedBy`, an array of additional permitted values contributed by the project.
The hook and the sweep evaluate the union. `extendedBy` entries are the project's;
`params.values` are professor-orb's; both are visible, and provenance stays legible without
a second rule entry.

Rules that cannot be extended this way (a project wanting a genuinely different structural
rule) are not supported. That is the point of imposing a schema.

**Precedence.** A `"project"` rule may add rules the base does not cover. It may not weaken
or remove a base rule. `enforcement` is the deliberate exception: the DM sets levels on base
rules freely, including `off`.

**Reconciling an existing v1 file, which has no provenance at all.** Every rule in a v1
`conventions.json` was derived from the consumer's project, so reading them all as
`provenance: "project"` would produce a second rule of the same check kind on the same field
alongside every base rule, which is exactly the duplicate-enum breakage `extendedBy` exists
to prevent. The reconciliation rule, applied by setup and resync:

- A provenance-less rule whose **check kind and target field or param match a base rule** is
  discarded as a rule. Its distinct values fold into that base rule's `extendedBy`, and its
  `enforcement` level carries onto the base rule, so the DM's earlier choices survive.
- A provenance-less rule with **no base counterpart** survives as `provenance: "project"`.

For the reference consumer this means its `frontmatterTypeEnum` disappears as a rule, its
`Settlement`, `Landmark`, `Species`, `Ethnicity`, `Material`, `Vehicle`, `Technology`,
`Spell`, `Article`, `Myth`, `Natural-Law`, and `Law` values land in `extendedBy`, and its
`block` level carries onto the base enum.

**No base rule ships at `block` against a condition the migration deliberately declines to
correct.** A `block` rule the plugin itself refuses to fix leaves the DM unable to edit their
own article with no path forward. This governs `suffixByType` (phase 2 declines `-TIMELINE`
and `-HISTORY` renames), `publish` (never auto-inserted, above), and any rule a later phase
demotes to a report item. Those ship at `warn`.

**Field order is extensible in place.** Rolara's confirmed order is
`publish, type, category, tags` (`conventions-schema.md:325-329`), which includes a field
the base does not define. A project may insert its own fields into the base sequence as long
as the base fields keep their relative order. A conflict that cannot be resolved that way is
reported, never mass-rewritten.

**What stops being true.** `conventions-schema.md:25` ("The conventions file is derived, not
authoritative") is wrong on the first half. The file is professor-orb's schema instantiated
for this project, and it is authoritative for structural checks. `sourceConventionsDoc`
survives as provenance for the extras layer.

### Part 2: the base rule set, as a shippable artifact

The base rules ship as `references/base-rules.json` at the plugin root, readable by setup,
by the hook via `CLAUDE_PLUGIN_ROOT`, and by every fallback path that needs to name the base
schema without re-deriving it. Prose tables are documentation of that file, never the source.

Each entry carries: rule id, category, check kind, params, default enforcement, description,
and an `autofix` string where a deterministic correction exists.

**Structural**

| Rule | Check | Value | Default |
| --- | --- | --- | --- |
| Folder-index parity | `indexParity` | One index per folder; every subfolder carries its own; a folder with content must have one | `warn` |
| Single ownership | `singleOwnership` | An article's wikilink appears in exactly one index. Sweep scope | `off` at write time |
| Split threshold | `splitThreshold` | 6 or more entries earns a subfolder | `warn` |
| Absorb threshold | `absorbThreshold` | Under 4 entries dissolves the folder | `warn` |
| Index suffix | (param) | `-INDEX` | n/a |

**Structural rules apply to setting KB roots only.** They are not applied to
`homebrew/<setting>/` or `session-reports/<setting>/<campaign>/`, whose folder shape is
determined by the layout rather than by content volume. Every structural rule entry carries
a `scope` param reading `kb` so the hook and sweep both honor this. Frontmatter, filename,
and content rules apply to all prongs.

**Frontmatter**

| Rule | Value | Default |
| --- | --- | --- |
| Format | YAML fenced by `---` on line 1. Scalars, booleans, string arrays | n/a |
| Article definition | A file whose frontmatter carries a `type` field | n/a |
| Base field order | `publish`, `type`, `tags`, then type-specific fields | `warn` |
| Required subset | `type` | `block` |
| `publish` presence | `publish` should be present and explicit | `warn`, never auto-inserted |

**`publish` is never written by any unattended process, and that is a safety rule, not a
preference.** An earlier draft put `publish` in the required subset at `block` and gave it a
`true` default, which phase 2's migration would then have inserted into every article lacking
it. The guard that would have stopped that is not in the base set: forcing `publish: false`
when a body carries a DM-only marker is the `bodyImpliesFrontmatter` and
`frontmatterImpliesFrontmatter` check kinds, which are **project**-scope
(`conventions-schema.md:209`: "a body carrying a DM-only content marker must set
`publish: false` explicitly, because a missing field would fall back to the site's default
and leak"). On any KB not already carrying `publish`, an unattended run would have written
`publish: true` across unmarked-but-secret lore in bulk. `CONTEXT.md:117` notes the KB feeds
the DM's separate wiki-website project, so that is a live disclosure path.

Three consequences, all deliberate:

- `publish` is `warn` and outside the required subset, so a consumer who does not publish
  anything is not blocked by a field they have no use for.
- No migration, sweep autofix, or `rule-fixer` pass ever inserts or changes a `publish`
  value. Articles missing it are **reported**. Setting a disclosure flag is the DM's call,
  and it is the one field where guessing wrong is not recoverable by noticing later.
- `publish` came from the Rolara-shaped example at `conventions-schema.md:328`. Promoting a
  consumer's field to a `block` rule for everyone, in the same phase that deletes the
  sentences saying example values are illustrations, is the exact error this spec set exists
  to stop. It was caught for the `type` enum and missed for the field beside it.

**Base article types**, in two groups:

- **KB articles**, capitalized: `Person`, `Location`, `Organization`, `Item`, `Creature`,
  `Concept`, `Index`, `Session Report`, `Session Prep`, `Chronology`.
- **Homebrew catalog artifacts**, lowercase, the ten keys `/catalog` already offers at
  `commands/catalog.md:64`: `spell`, `magic-item`, `feat`, `feature`, `monster`, `npc`,
  `species`, `subclass`, `class`, `other`.

**`Homebrew` is not a `type` value.** An earlier draft listed it as one, on the strength of
`CONTEXT.md:91` and `validation-sweep.mjs:190`. The real catalog disagrees. Surveyed across
all 71 entries in the reference consumer's catalog: 36 carry `type: magic-item`, 12
`type: monster`, 7 `type: spell`, 5 `type: npc`, 4 `type: other`, 2 each `feature` and
`species`, 1 `feat`, plus one `type: Index` for the folder's index and one file with no
frontmatter. Every entry additionally carries `category: Homebrew`. So
`catalog-type-templates.md:21` is right that `type` holds "the artifact type key," and the
detectors are wrong.

**A catalog entry is an article whose `type` is one of the ten artifact keys.** No new field,
no reliance on `category` (which is a per-project field), and no migration of existing
entries, which are already correct. Three detectors are corrected to match:
`validation-sweep.mjs:190`, `agents/kb-validator.md:65`, and `CONTEXT.md:91`.

**This is a live defect, not only a spec concern.** The sweep currently identifies catalog
entries by `type` being exactly `Homebrew`, which matches none of the 71 real entries, so the
exemption that spares them wikilink and orphan checks has never fired. Every sweep run to
date has reported the entire homebrew catalog as orphaned articles.

**Case distinguishes two legitimately different things.** A KB article about a species
(`type: Species`, a project extension) and a homebrew species entry (`type: species`, base)
coexist. Comparison is case-sensitive, so they do not collide, but the enum must not be
case-folded.

**This list is canonical here and nowhere else.** Phase 2 cites it rather than restating it.
An earlier draft restated a shorter list in phase 2, which would have regenerated the
reference consumer's `conventions.json` without five types it actually uses, on a rule
enforced at `block`, breaking every subsequent write to those articles.

**A project's extras are derived from its KB, not hand-listed.** At setup or resync, the
distinct `type` values actually present in the consumer's articles become `extendedBy`
entries, confirmed with the DM. Rolara's would include `Settlement`, `Landmark`, `Species`,
`Ethnicity`, `Material`, `Vehicle`, `Technology`, `Spell`, `Article`, `Myth`, `Natural-Law`,
`Supernatural-Law`, and `Law`. Deriving rather than hand-listing is what prevents a
transcription error from blocking writes, and it is the one place derivation remains
load-bearing.

**`Chronology` requires a normalization step.** `skills/timeline/SKILL.md:128` emits
lowercase `type: chronology`, inconsistent with every other capitalized type. The base type
is `Chronology`, phase 2's migration normalizes existing `chronology` values, and timeline
is updated to emit the capitalized form. This is the `chronology` to `Chronology` item
deferred from the 1.3.0 plan, now unavoidable because the base enum makes the mismatch a
`block` violation.

**Filename**

| Rule | Value | Default |
| --- | --- | --- |
| Suffix by type | `Index` to `-INDEX`, `Session Report` to `-REPORT`, `Session Prep` to `-PREP` | `block` |
| Suffix by type, `Chronology` to `-CHRONOLOGY` | Separate entry, `warn`, because phase 2 declines to rename existing `-TIMELINE` and `-HISTORY` files | `warn` |
| Charset | `^[A-Za-z0-9-]+$` | `warn` |

`-CHRONOLOGY` matches what `timeline/SKILL.md:22` already documents as its default. Files
carrying `-TIMELINE` or `-HISTORY`, also valid under timeline's current text, are reported
rather than renamed, because renaming them is a link-breaking operation for a cosmetic gain.

**Filename rules cannot be autofixed by the sweep as it stands.** Its fix workers are told
to "apply the approved fix precisely using the Write or Edit tool"
(`validation-sweep.mjs:214`), which cannot rename a file: it would create a duplicate under
the corrected name and leave the original. Base filename rules therefore ship with no
`autofix` string, and filename violations are reported. Phase 2's migration executor is what
actually renames, once, with the link rewrite paired to it.

**Wikilinks**

| Rule | Value |
| --- | --- |
| Style | Obsidian filename-based, not path-based. Moves within one search root are link-safe; renames are not |
| Table escaping | Inside tables the separator is `\|`; escaped and bare forms are the same separator, never a malformed link |
| Catalog entries | An article whose `type` is one of the ten artifact keys carries no outgoing wikilinks and is never flagged for having none, nor for not being linked to from other article **bodies**. It remains subject to index ownership |

The catalog-entry wording is `validation-sweep.mjs:190` verbatim in substance. An earlier
draft compressed it to "never flagged as orphans," which contradicted the same table's
single-ownership row, because index ownership *is* a link in. The exemption is from
**article-body** links, not from index ownership.

### Part 3: rule provenance and the autofix path

Three statements assert every rule's autofix guidance was written by the DM, and they are
what authorize edits without asking:

- `agents/rule-fixer.md:4-5`: "Applies one pre-approved convention fix to one KB article,
  using guidance **the DM wrote** into that rule"
- `agents/rule-fixer.md:16`: "The DM pre-approved this fix class by configuring autofix on
  the rule, so the fix is applied without asking."
- `agents/rule-fixer.md:35`: "It came from the project's conventions file, which the DM
  wrote. Follow it literally."
- `hooks/validate-write.mjs:667`: "The DM pre-approved this fix class by setting autofix on
  the rule, so apply it without asking."
- `skills/setup/references/conventions-schema.md:277-279`: "its presence is the DM's
  standing approval for that class of fix."

All five key on `provenance`:

- **`provenance: "project"`**: unchanged. The guidance is the DM's and their standing
  approval.
- **`provenance: "professor-orb"`**: the guidance is the plugin's. The DM's standing
  approval comes from the enforcement level they confirmed at setup, not from authorship.
  `rule-fixer` still applies it without asking, and says so honestly.

An earlier draft named only `rule-fixer.md:35`, which would have left the agent's own
description, the first thing a dispatching model reads, still making the false claim.

### Part 4: check semantics have four copies

The base rule set and its check semantics are duplicated across:

1. `skills/setup/references/conventions-schema.md`, the check catalog. **Normative.** The
   other three implement what it documents.
2. `hooks/validate-write.mjs`, the `CHECKS` table (per-write enforcement)
3. `workflows/validation-sweep.mjs`, the inline `checkerPrompt` at `:174-203` (whole-KB)
4. `agents/kb-validator.md`, Step 4 (single-article audit)

`references/base-rules.json` (Part 2) is the machine-readable base *data*; these four are
the *semantics* that interpret it. The data is now single-sourced; the semantics remain
four-way duplicated, and that obligation is stated in each file rather than mechanized. A
Node hook cannot read markdown at speed, which is why this is documented rather than solved.

`agents/kb-validator.md:46` claims the third drives the fourth: "By the validation sweep
workflow, which orchestrates you at scale across the whole KB, sharding the work and
consolidating your reports." This is false. The sweep builds its own prompt and dispatches
anonymous haiku agents; `validation-sweep.mjs:45` names kb-validator only as the lighter
alternative. The description repeats it at `:11-12`, and `:61` and `:116` rely on it.

The sweep's `rulesJson` pass-through stays as it is. It receives whatever
`conventions.json` holds, which after this phase includes the base layer.

### Part 5: `enforcement: "off"` must actually silence

`off` is the DM's only lever over an imposed schema, and Part 3 grounds all unattended
base-rule autofix in "the enforcement level they confirmed at setup." It has to work.

- The hook already honors it (`validate-write.mjs:763`).
- **The sweep does not.** Its checker prompt gains an enforcement filter: a rule with
  `enforcement: "off"` is not checked, or is reported informationally only and never enters
  `mechanicallyFixable`. `conventions-schema.md:240` already documents the intended
  behavior; the prompt is what diverges.
- `agents/kb-validator.md:57` deliberately checks every rule regardless of level ("a rule
  set to `off` at write time is still worth surfacing in a broad audit"). That stays, and
  is correct for a single-article audit a human reads, because nothing auto-applies from it.
  The distinction is that the sweep's findings feed a batch the DM approves with one yes.

### Part 6: one fallback statement replacing ten

Ten components carry near-identical text: if `conventions.json` is missing, derive the
schema from the consumer's `CLAUDE.md` and existing articles. Four also authorize inventing
conventions on the spot.

All ten are replaced by one statement in `skills/SHARED-PRINCIPLES.md`, referenced rather
than restated:

> When `.professor-orb/conventions.json` is absent, apply professor-orb's base schema, which
> ships at `references/base-rules.json`, and say that setup has not run. Do not infer
> structural conventions from the project's prose or from its existing articles, and never
> invent conventions on the spot: two components inventing independently will disagree. The
> project's `CLAUDE.md` remains authoritative for campaign facts and content, never for
> structure.

Structure means folder layout, index rules, frontmatter schema, filename conventions, and
wikilink format. `commands/catalog.md:41` is included in this replacement.

### Part 7: the posture edits

Roughly 50 sentences change. The load-bearing list is in the appendix. The governing
distinction, applied sentence by sentence rather than by search and replace:

- **Deference on structure is wrong and changes.** Folder layout, index naming and
  ownership, split and absorb thresholds, frontmatter schema and field order, filename
  conventions, wikilink format.
- **Deference on campaign facts and content is correct and survives untouched.**
  `SHARED-PRINCIPLES.md` Principles 1, 3, 5, and 7; `historian.md:57` ("Calendar facts live
  in KB articles"); timeline's rule that the DM picks the theory of time travel; lore and
  historian's quote-anchored flag format; chronicler's tone and paragraph-length matching.
- **Derivation that stays correct as the extras layer.** Tag vocabulary, project-specific
  article types, Obsidian practices, VTT platform, content exclusion tags, and the per-rule
  enforcement levels the DM chooses.

The plugin's most public surfaces:

- **`.claude-plugin/plugin.json:3`**, the marketplace card: "Reads your project's
  conventions for campaign-specific rules." Rewritten to describe an applied method. The
  matching text in `.claude-plugin/marketplace.json` changes with it.
- **`README.md:11` and `README.md:12`** are the two facts the README says govern everything
  else. `:11` names folder layout, frontmatter schema, and filename convention as
  consumer-owned; `:12` says setup produces the file "by deriving rules from the consumer
  project." Both are rewritten. `README.md:3`'s pitch ("all against whichever knowledge base
  structure the DM already uses") goes with them.
- **`README.md:57`** is a separate Design-philosophy restatement, not one of the two
  governing facts. Its full clause is "No skill hardcodes a path, a folder name, or a
  frontmatter field." **Only the first third survives.** "No skill hardcodes a path" stays,
  because paths remain resolved from `conventions.json`, which is what makes phase 3's lane
  commands possible. "A folder name, or a frontmatter field" is deleted, because those are
  now professor-orb's. An earlier draft said this clause "survives intact" while quoting
  only the surviving third, which is exactly the kind of truncation this spec set exists to
  stop.

### Part 8: false claims to correct

1. **`CONTEXT.md:34-35`**: "Only the chronicler skill mutates it, and only after DM
   approval." Five components write inside `kbRoot`: `debrief` (reports plus campaign and
   master indexes), `prep`, `content`, `timeline` (Phase 6), and `/catalog`. Repeated at
   `README.md:59`, `skills/orb/SKILL.md:18`, `agents/lore.md:30` and `:181`, and
   `agents/kb-validator.md:37` and `:151`.
2. **`skills/timeline/SKILL.md`** contradicts itself 140 lines apart. Line 34: "it never
   writes a KB article itself even after approval: chronicler is always the writer." Line
   191: "Never write KB articles itself." Phase 6, lines 177-178: "Write the document to the
   path established in Phase 1" and "Update indexes." Resolved by making Phase 6's behavior
   the stated rule.
3. **`agents/kb-validator.md:46`**, the sweep-orchestration claim, per Part 4.
4. **`CONTEXT.md:125-127`** describes a "rebuild step" that "proposes regenerated index
   files (propose-then-execute, like chronicler)." No such component exists. Corrected to
   describe what exists, with a forward pointer to phase 2's migration executor.

## Out of scope

- **Setup's workflow, the layout, and the migration.** Phase 2.
- **`/scribe`, `/log`, `/catalog` Step 3, the Stop hook.** Phase 3.
- **`/migrate` and `/genesis`.** Later specs.
- **Mechanizing the four semantic copies into one source.** Documented as an obligation;
  revisit once the base rule set stabilizes.
- **New check kinds beyond those the base rules need.** Every base rule maps to an existing
  check kind or ships with none and is reported by the migration instead.

## Files touched

| File | Change |
| --- | --- |
| `references/base-rules.json` | **New.** The machine-readable base rule set |
| `skills/setup/references/conventions-schema.md` | `provenance`, `extendedBy`, `schemaVersion`, `scope` param, v2 shape, framing at `:5`/`:25`/`:37`/`:40`, enforcement scopes at `:228-246`, tier text at `:466`/`:479`, autofix at `:277-279` |
| `skills/setup/SKILL.md` | Posture sentences (`:12`, `:33`, `:37`, `:38`, `:39`, `:47`, `:81`). `:43` needs only the sweep-scope-provenance clarification. Step structure is phase 2 |
| `skills/SHARED-PRINCIPLES.md` | Shared fallback statement; Principle 9's "derivation" framing at `:51` |
| `hooks/validate-write.mjs` | `provenance` and `extendedBy` handling, `scope` param, autofix message at `:667` |
| `workflows/validation-sweep.mjs` | Enforcement filter in `checkerPrompt`; `extendedBy` union; sync-site note |
| `agents/kb-validator.md` | False orchestration claim (`:11-12`, `:46`, `:61`, `:116`), fallback (`:55`), parity conditionality (`:89`), writer claims |
| `agents/rule-fixer.md` | Provenance-aware guidance at `:4-5`, `:16`, `:35` |
| `agents/lore.md`, `agents/historian.md` | Fallback replacement, "derivation" framing, writer claims |
| `skills/debrief`, `prep`, `content`, `chronicler`, `timeline`, `homebrew` | Fallback replacement; structural deference; timeline's self-contradiction; timeline emits `Chronology` |
| `commands/catalog.md` | Fallback at `:41`; index format and ownership deference at `:110`; the split-threshold clause of `:112` only, since its AskUserQuestion gate survives |
| `CONTEXT.md` | `:28`, `:34-35`, `:44`, `:49`, `:52`, `:95-96`, `:125-127` |
| `README.md` | `:3`, `:11`, `:12`, `:14`, `:57` (partial), `:59`, `:70` |

Version bump happens once, at the end of phase 3.

## Verification

- `node workflows/validation-sweep.ownership.test.mjs` still passes.
- `references/base-rules.json` parses, and every entry names an existing check kind.
- Grep for the deference formulas ("never imposes", "the project already uses", "establish
  conventions as you go", "infer the schema") and confirm every remaining hit is
  content-side or extras-layer deference.
- Confirm the fallback statement appears once and all ten components reference it.
- **Assert `enforcement: "off"` silences.** Run the sweep against a fixture with a violated
  `off` rule and confirm nothing enters `mechanicallyFixable`.
- Assert a base `enum` rule with `extendedBy` accepts both base and project values, in the
  hook and in the sweep.
- Exercise the hook against a fixture carrying both provenance values; confirm the autofix
  message differs and neither path crashes a write.
- Confirm no em dashes in changed files. `CONTEXT.md` currently has eleven (lines 46, 76,
  104, 115, 138, 152, 164, 182, 183, 194, 204); `README.md`, `SHARED-PRINCIPLES.md`,
  `commands/catalog.md`, and `skills/setup/SKILL.md` have none.
- Read `CONTEXT.md` end to end and confirm no entry contradicts another on who owns
  structure.

## Appendix: load-bearing edits

The 17 sentences the audit classified as blocking. Roughly 35 supporting and incidental
findings are in the audit transcript, `wf_d5ca9c3d-14e/journal.jsonl` entry 6.

| File:line | Quote |
| --- | --- |
| `skills/setup/SKILL.md:12` | "This skill discovers and derives; it never imposes a schema the project does not already use." |
| `skills/setup/SKILL.md:12` | "Any example values you see in the reference file (article types, filename suffixes) belong to one consumer project and are illustrations only." |
| `skills/setup/SKILL.md:33` | "Determine which of the three tiers applies by looking at what the consumer project already has." |
| `skills/setup/SKILL.md:37` | "read it as raw material only. Derive `conventions.json` rule entries from it" |
| `skills/setup/SKILL.md:38` | "consolidate them into `conventions.json` only" |
| `skills/setup/SKILL.md:39` | "infer likely conventions from sample articles already in the KB" |
| `skills/setup/SKILL.md:47` | "you never argue that the DM's structure is wrong" |
| `skills/setup/SKILL.md:81` | "following the conventions agreed in Step 2 (index filename suffix, where the root index lives, and so on)" |
| `conventions-schema.md:25` | "The conventions file is derived, not authoritative." |
| `conventions-schema.md:37` | "Extensible, not hardcoded. This schema defines structure. The specific article types, filename suffixes, and field names ... are illustrations, not requirements." |
| `conventions-schema.md:40` | "A fresh consumer project with no existing conventions still produces a valid `conventions.json` using the same schema with different values." |
| `conventions-schema.md:466` | "Tier 1: translate an existing conventions document." |
| `conventions-schema.md:479` | "Tier 3: interview and infer." |
| `README.md:11` | "The plugin is configuration; the consumer project is the source of truth. No skill hardcodes a folder layout, a frontmatter schema, or a filename convention." |
| `README.md:57` | "The consumer project owns its conventions. The plugin discovers them rather than imposing a schema." |
| `CONTEXT.md:28` | "The plugin ships no templates or schemas." |
| `CONTEXT.md:52` | "Three intake tiers: (1) ... translate; (2) ... discover and consolidate; (3) ... interview + infer" |

## Notes

`commands/references/catalog-type-templates.md` is precedent worth studying: it is already
an opinionated, plugin-owned schema grounded in SRD 5.2.1 rather than in any consumer
project, and its tone is what a rewritten `conventions-schema.md` should adopt. It also
carries an unrelated defect: lines 10-11 point at
`docs/superpowers/specs/2026-07-11-catalog-redesign-design.md`, a path that exists only in
the development repo, not in an installed plugin.
