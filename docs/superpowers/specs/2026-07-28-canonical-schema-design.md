# The schema is professor-orb's: base rules, provenance, and the posture correction

Date: 2026-07-28
Spec 1 of 3 (followed by: apply it; lane commands)
Components: `conventions.json` shape, `skills/setup/references/conventions-schema.md`,
`hooks/validate-write.mjs`, `workflows/validation-sweep.mjs`, `agents/`, `skills/`,
`commands/`, `CONTEXT.md`, `README.md`, `.claude-plugin/plugin.json`
Status: design, approved 2026-07-28

## Problem

Professor-orb was built to impose an organizational method on a body of campaign material
that needs one. `CONTEXT.md:108` states this directly about folder-index parity: it is "the
structural convention professor-orb **introduces** (amending Rolara's current, sloppier
practice via the resync flow)." `CONTEXT.md:128` agrees: "The setup skill applies the same
index system to new consumers, whether they arrive with an established KB or none at all."

The instruction files say the opposite. `skills/setup/SKILL.md:12`: "This skill discovers and
derives; it **never imposes a schema the project does not already use**." `README.md:57`
elevates that to a governing principle: "The consumer project owns its conventions. The plugin
discovers them rather than imposing a schema." The plugin's owner has confirmed the setup
sentence is wrong and was invented by a previous agent rather than reflecting design intent.

The consequence is not theoretical. The plugin handles new material well and handles existing
material badly, because every component that meets an established KB is instructed to
reverse-engineer that KB's conventions and then conform to them. A consumer with a
disorganized KB gets their disorganization ratified as the rule set, and the validator then
enforces it.

An audit of the plugin on 2026-07-28 (6 agents, all 27 plugin files) found the defect is not
localized:

- **Roughly 50 sentences across 8 files** state or reinforce the derive-never-impose posture,
  17 of them load-bearing enough to block a rewrite outright.
- **The same deference paragraph is duplicated in ten components** (debrief, prep, content,
  chronicler, timeline, catalog, lore, historian, kb-validator, homebrew): if
  `conventions.json` is missing, derive the schema from the consumer's `CLAUDE.md` and
  existing articles. Four of them (`debrief:29`, `prep:30`, `chronicler:31`, `timeline:30`)
  go further and authorize inventing conventions on the spot.
- **The plugin already contradicts itself in both directions.** `setup/SKILL.md` Step 6
  imposes parity without deriving it, eleven paragraphs below the line that forbids imposing.
  `CONTEXT.md:28` ("The plugin ships no templates or schemas") contradicts `CONTEXT.md:108`
  in the same document.
- **A rule-provenance defect sits in the autofix path.** `agents/rule-fixer.md:35` tells the
  fixer that a rule's guidance "came from the project's conventions file, which the DM wrote.
  Follow it literally," and `hooks/validate-write.mjs:667` says "The DM pre-approved this fix
  class by setting autofix on the rule, so apply it without asking." Both statements become
  false the moment professor-orb ships its own rules, and they are what authorize unattended
  edits.
- **`setup/SKILL.md:43` forbids the plugin from shipping one of its own core rules.** "Only
  per-write-checkable conventions become active rules in `conventions.json`." Single ownership
  cannot be checked per-write (`validate-write.mjs:371` returns null permanently, commented
  "KB-wide check"), yet `validation-sweep.mjs:522` imposes it on every consumer unconditionally.

This spec resolves an existing inconsistency in the plugin's favor. It does not introduce a
new one.

## Decisions

Settled with the DM during brainstorming:

- Professor-orb owns the structural layer. Deriving from the consumer project is not
  eliminated, it is demoted to an extras layer for what the base schema does not cover.
- The base/derived split is as enumerated in Part 2 below, approved as proposed.
- Every rule records its provenance. `rule-fixer` keeps applying both kinds, but the
  instruction stops claiming the DM authored something they did not.

## Design

### Part 1: `conventions.json` becomes two layers

The file stops being "the machine-checkable derivation of a consumer project's conventions"
and becomes "professor-orb's schema, instantiated for this project, plus what this project
adds." The shape barely changes. Three additions:

```json
{
  "version": 2,
  "schemaVersion": 1,
  "kbRoot": "settings/rolara",
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
    }
  }
}
```

- **`provenance`** on every rule: `"professor-orb"` or `"project"`. Required. A rule without
  it is treated as `"project"` for backward compatibility, and setup rewrites it on next run.
- **`schemaVersion`** at the top level: which version of professor-orb's base rule set this
  file was generated against. Lets a later run detect that the base layer has moved on and
  the project's copy is stale. Independent of `version`, which describes the file format.
- **`version` goes to 2**, since `provenance` is required and consumers of the file must
  handle both shapes during the transition.

**Precedence.** A `"project"` rule may extend a base rule (adding type enum values, adding a
suffix mapping) but may not weaken or remove one. Where a project rule and a base rule
address the same check with incompatible params, the base rule wins and setup reports the
conflict. `enforcement` is the deliberate exception: the DM chooses enforcement levels on
base rules freely, including `off`.

**What stops being true.** `conventions-schema.md:25` ("The conventions file is derived, not
authoritative") is wrong on the first half and right on the second. It becomes: the file is
professor-orb's schema instantiated for this project, and it is authoritative for structural
checks. `sourceConventionsDoc` survives unchanged as provenance for the extras layer.

### Part 2: the base rule set

These ship with the plugin and appear in every consumer's `conventions.json` with
`provenance: "professor-orb"`.

**Structural**

| Rule | Value |
| --- | --- |
| Folder-index parity | Exactly one index per folder; every subfolder carries its own; a folder with content must have one |
| Single ownership | An article's wikilink appears in exactly one index |
| Index suffix | `-INDEX` |
| Split threshold | 6 or more entries earns a subfolder; articles physically move in |
| Absorb threshold | Under 4 entries dissolves the folder; articles move up |
| Master index | The KB root's one index. No special-case concept |

**Frontmatter**

| Rule | Value |
| --- | --- |
| Format | YAML fenced by `---` on line 1. Scalars, booleans, and string arrays only |
| Article definition | A file whose frontmatter carries a `type` field |
| Base field order | `publish`, `type`, `tags`, then type-specific fields |
| Required subset | `publish`, `type` |
| `publish` default | `true`, except `Homebrew` and NSFW-tagged articles, which default to `false` |

**Base article types.** `Person`, `Location`, `Organization`, `Item`, `Creature`, `Concept`,
`Index`, `Homebrew`, `Session Report`, `Session Prep`, `Chronology`. A project extends this
list; it does not replace it. Rolara's existing `Settlement`, `Landmark`, `Species`,
`Ethnicity`, `Material`, `Vehicle`, `Technology`, `Spell`, `Myth`, `Natural-Law`,
`Supernatural-Law`, and `Law` become `provenance: "project"` extensions, which is the
intended demonstration of the two-layer model.

**Filename**

| Rule | Value |
| --- | --- |
| Suffix by type | `Index` to `-INDEX`, `Session Report` to `-REPORT`, `Session Prep` to `-PREP`, `Chronology` to `-CHRONOLOGY` |
| Charset | `^[A-Za-z0-9-]+$` |

**Wikilinks**

| Rule | Value |
| --- | --- |
| Style | Obsidian filename-based, not path-based. This is what makes migration moves non-breaking |
| Table escaping | Inside markdown tables the separator is `\|`; escaped and bare forms are the same separator, never a malformed link |
| Catalog entries | `type: Homebrew` articles sit outside the wikilink graph: no links in or out, never flagged as orphans, still subject to index ownership |

**Enforcement levels ship as opinionated defaults, not fixed values.** The DM adjusts them.
`conventions-schema.md:272` ("the levels above are guidance, not defaults baked into the
schema itself") is corrected to say the base rules ship with defaults that the DM may change.

**Single ownership is admitted as a sweep-scope base rule.** `setup/SKILL.md:43`'s "only
per-write-checkable conventions become active rules" is rewritten: base rules may be
whole-KB scope. The rule is recorded with `enforcement: "off"` for the write-time hook and is
checked by the sweep, which already does so unconditionally. This makes existing sweep
behavior legible instead of surprising.

### Part 3: rule provenance and the autofix path

Three sentences currently assert that every rule's autofix guidance was written by the DM:

- `agents/rule-fixer.md:35`: "It came from the project's conventions file, which the DM wrote.
  Follow it literally."
- `hooks/validate-write.mjs:667`: "The DM pre-approved this fix class by setting autofix on
  the rule, so apply it without asking."
- `skills/setup/references/conventions-schema.md:277-279`: "its presence is the DM's standing
  approval for that class of fix."

All three become false when base rules ship with autofix guidance, and all three are what
authorize edits without asking. Each is rewritten to key on `provenance`:

- **`provenance: "project"`**: unchanged. The guidance is the DM's and their standing approval.
- **`provenance: "professor-orb"`**: the guidance is the plugin's, and the DM's standing
  approval comes from the enforcement level they confirmed at setup rather than from
  authorship. `rule-fixer` still applies it without asking. The instruction says so honestly
  rather than misattributing it.

`conventions-schema.md:292` ("Nothing about a particular project's rules lives in plugin
code") stays true as written, since base rules are not a particular project's rules, but
gains a clarifying clause so it is not read as denying a base layer.

### Part 4: the three sync sites

The base rule set has three independent copies that must agree:

1. `hooks/validate-write.mjs`, the `CHECKS` table (per-write enforcement)
2. `workflows/validation-sweep.mjs`, the inline `checkerPrompt` at lines 174-203 (whole-KB)
3. `agents/kb-validator.md`, Step 4 (single-article audit)

`agents/kb-validator.md:46` claims the third is driven by the second: "By the validation sweep
workflow, which orchestrates you at scale across the whole KB, sharding the work and
consolidating your reports." This is false. The sweep builds its own prompt and dispatches
anonymous haiku agents; `validation-sweep.mjs:45` names kb-validator only as the lighter
alternative. The description repeats the false claim at lines 11-12, and lines 61 and 116 rely
on it.

**Correction:** fix the false claim, and state the three-copy obligation explicitly in each
file so a future edit to one is known to require the others. A single shared reference file is
the better end state, but the hook is Node and cannot read a markdown reference at speed, so
the obligation is documented rather than mechanized. This mirrors the existing precedent at
`workflows/validation-sweep.ownership.test.mjs:7-9`, which already carries a byte-alignment
obligation against the sweep.

### Part 5: one fallback statement replacing ten

Ten components carry near-identical text: if `conventions.json` is missing, derive the schema
from the consumer's `CLAUDE.md` and existing articles. Four also authorize inventing
conventions on the spot.

All ten are replaced by one shared statement, added to `skills/SHARED-PRINCIPLES.md` and
referenced by each component rather than restated:

> When `.professor-orb/conventions.json` is absent, apply professor-orb's base schema and say
> that setup has not run. Do not infer structural conventions from the project's prose or from
> its existing articles, and never invent conventions on the spot: two components inventing
> independently will disagree. The project's `CLAUDE.md` remains authoritative for campaign
> facts and content, never for structure.

Structure means folder layout, index rules, frontmatter schema, filename conventions, and
wikilink format. `commands/catalog.md:41` is included in this replacement.

### Part 6: the posture edits

Roughly 50 sentences change. The full load-bearing list is in the appendix. The governing
distinction, which must be applied sentence by sentence rather than by search and replace:

- **Deference on structure is wrong and changes.** Folder layout, index naming and ownership,
  split and absorb thresholds, frontmatter schema and field order, filename conventions,
  wikilink format.
- **Deference on campaign facts and content is correct and must survive untouched.**
  `SHARED-PRINCIPLES.md` Principles 1, 3, 5, and 7; `historian.md:57` ("Calendar facts live in
  KB articles"); timeline's rule that the DM picks the theory of time travel; lore and
  historian's quote-anchored flag format; chronicler's tone and paragraph-length matching to
  neighbouring articles.
- **Derivation that stays correct as the extras layer.** Tag vocabulary, project-specific
  article types, Obsidian-specific practices, VTT platform, content exclusion tags, and the
  per-rule enforcement levels the DM chooses.

Two edits deserve naming here because they are the plugin's most public surfaces:

- **`.claude-plugin/plugin.json:3`**, the marketplace card: "Reads your project's conventions
  for campaign-specific rules." Rewritten to describe an applied method. The matching
  description in `.claude-plugin/marketplace.json` changes with it.
- **`README.md:11` and `README.md:57`**, the two "facts that govern everything else in this
  plugin." Both currently name folder layout, frontmatter schema, and filename convention as
  consumer-owned. Both are rewritten. `README.md:3`'s pitch ("all against whichever knowledge
  base structure the DM already uses") goes with them.

**One clause survives intact and should be preserved deliberately:** `README.md:57`'s "No
skill hardcodes a path." Paths remain resolved from `conventions.json`, which is what makes
spec 3's lane commands possible. Owning the schema is not the same as hardcoding paths, and
conflating them would break the next two specs.

### Part 7: false claims to correct

Four statements are simply untrue today and are corrected as part of this pass, since the
posture edits touch the same files:

1. **`CONTEXT.md:34-35`**: "Only the chronicler skill mutates it, and only after DM approval."
   Five components write inside `kbRoot`: `debrief` (reports plus campaign and master indexes),
   `prep`, `content`, `timeline` (Phase 6), and `/catalog`. The same false claim appears at
   `README.md:59`, `skills/orb/SKILL.md:18`, `agents/lore.md:30` and `:181`, and
   `agents/kb-validator.md:37` and `:151`.
2. **`skills/timeline/SKILL.md`** contradicts itself 140 lines apart. Line 34: "it never
   writes a KB article itself even after approval: chronicler is always the writer." Line 191:
   "Never write KB articles itself." Phase 6, lines 177-178: "Write the document to the path
   established in Phase 1" and "Update indexes." Line 203 confirms the writes. This is the same
   defect class as `setup/SKILL.md:12` and is resolved by making Phase 6's behavior the stated
   rule.
3. **`agents/kb-validator.md:46`**, the sweep-orchestration claim, per Part 4.
4. **`CONTEXT.md:125-127`** describes a "rebuild step" that "proposes regenerated index files
   (propose-then-execute, like chronicler)." No such component exists. The entry is corrected
   to describe what exists, with a forward pointer to spec 2's migration, which is where that
   machinery actually belongs.

## Out of scope

Deliberately excluded, to keep this spec implementable:

- **Setup's workflow.** The three intake tiers are restructured in spec 2, which is where
  setup's steps, the multi-setting layout, git-first onboarding, and the initial migration all
  land. This spec changes what the schema **is** and how it is represented, not the workflow
  that produces it. `setup/SKILL.md`'s posture sentences are edited here; its step structure
  is not.
- **The migration itself.** No file in any consumer project moves as a result of this spec.
- **`/scribe`, `/log`, `/catalog` Step 3, the Stop hook.** All spec 3.
- **`/migrate` and `/genesis`.** Later specs.
- **`versioning.json`, GitHub onboarding, `.gitignore`.** Carried from the superseded
  `2026-07-28-project-repo-onboarding-design.md` into spec 2.
- **Mechanizing the three sync sites into one source.** Documented as an obligation here;
  worth revisiting once the base rule set has stabilized.

## Files touched

| File | Change |
| --- | --- |
| `skills/setup/references/conventions-schema.md` | Base rule set, `provenance`, `schemaVersion`, version 2 shape, framing at `:5`/`:25`/`:37`/`:40`, tier text at `:466`/`:479`, autofix at `:277-279` |
| `skills/setup/SKILL.md` | Posture sentences (`:12`, `:33`, `:37`, `:38`, `:39`, `:43`, `:47`, `:81`). Step structure unchanged, that is spec 2 |
| `skills/SHARED-PRINCIPLES.md` | New shared fallback statement; Principle 9's "derivation" framing at `:51` |
| `hooks/validate-write.mjs` | `provenance` handling, autofix message at `:667`, sync-site note |
| `workflows/validation-sweep.mjs` | Sync-site note; `checkerPrompt` aligned to the base rule set |
| `agents/kb-validator.md` | False orchestration claim (`:11-12`, `:46`, `:61`, `:116`), fallback (`:55`), parity conditionality (`:89`), writer claims |
| `agents/rule-fixer.md` | Provenance-aware guidance at `:35` |
| `agents/lore.md`, `agents/historian.md` | Fallback replacement, "derivation" framing, writer claims |
| `skills/debrief/SKILL.md`, `prep`, `content`, `chronicler`, `timeline`, `homebrew` | Fallback replacement; structural deference; timeline's self-contradiction |
| `commands/catalog.md` | Fallback at `:41`; index format and ownership deference at `:110`, `:112` |
| `CONTEXT.md` | `:28`, `:34-35`, `:44`, `:49`, `:52`, `:95-96`, `:125-127` |
| `README.md` | `:3`, `:11`, `:12`, `:14`, `:57`, `:59`, `:70` |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | Description; version 1.5.1 to 1.6.0, same commit |

## Verification

No test framework covers the markdown components, so verification is behavioral plus one
mechanical check:

- `node workflows/validation-sweep.ownership.test.mjs` still passes (the one existing test).
- Grep the plugin for the deference formulas ("never imposes", "the project already uses",
  "establish conventions as you go", "derive", "infer the schema") and confirm every remaining
  hit is content-side or extras-layer deference, not structural.
- Confirm the fallback statement appears once in `SHARED-PRINCIPLES.md` and that all ten
  components reference rather than restate it.
- Confirm the base rule set is byte-consistent across the three sync sites.
- Confirm no em dashes in any changed file (`SHARED-PRINCIPLES.md` Principle 6).
- Read `CONTEXT.md` end to end and confirm no entry contradicts another on who owns structure.
- Exercise the hook against a fixture `conventions.json` carrying both provenance values and
  confirm the autofix message differs appropriately and neither path crashes a write.

## Appendix: load-bearing edits

The 17 sentences the audit classified as blocking. Supporting and incidental findings (roughly
35 more) are in the audit transcript at
`.claude/projects/.../subagents/workflows/wf_d5ca9c3d-14e/journal.jsonl`, entry 6.

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

Version bump is minor (1.5.1 to 1.6.0). The `conventions.json` format change is versioned and
backward-compatible on read (a rule without `provenance` is treated as `"project"`), so no
consumer breaks before setup next runs.

`commands/references/catalog-type-templates.md` is precedent worth studying during
implementation: it is already an opinionated, plugin-owned schema grounded in SRD 5.2.1 rather
than in any consumer project, and its tone is the tone a rewritten `conventions-schema.md`
should adopt. It also carries an unrelated defect worth fixing in passing: lines 10-11 point
at `docs/superpowers/specs/2026-07-11-catalog-redesign-design.md`, a path that exists only in
the development repo and not in an installed plugin.
