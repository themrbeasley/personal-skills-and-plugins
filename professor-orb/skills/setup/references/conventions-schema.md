# conventions.json schema reference

## What this file is

`.professor-orb/conventions.json` is the machine-checkable derivation of a consumer
project's knowledge base conventions. It exists so that structural rules only have
to be interpreted once (by the setup skill, with the DM's confirmation) and every
downstream component can then check against a flat, deterministic file instead of
re-reading prose.

Three components consume this schema:

- **The PostToolUse hook** (`validate-write.mjs`) reads it on every KB article write
  and checks the file against each rule whose `enforcement` is not `off`.
- **The setup skill** produces it, by translating an existing human-readable
  conventions document (e.g. `KB-CONVENTIONS.md`), by consolidating conventions
  scattered across other files, or by interviewing the DM. See "How setup produces
  this file" below.
- **The validation sweep** (a KB-wide audit workflow) reads it to know what every
  sharded subagent should check, and regenerates the companion tag registry
  afterward.

All three must agree on the shape of the file. This document is that agreement.

The conventions file is **derived, not authoritative**. If a human-readable
conventions document exists at the KB root, that document is the source of truth
for intent; `conventions.json` is its machine-checkable projection. The setup
skill regenerates it; nothing else hand-edits it as primary.

A companion file, `.professor-orb/tag-registry.json`, holds the actual inventory
of tags in use across the KB. `conventions.json` only references that the tag
registry exists and where to find it; it does not embed the tag list.

## Design principles

1. **Extensible, not hardcoded.** This schema defines structure. The specific
   article types, filename suffixes, and field names in any example below belong
   to one consumer project (Rolara) and are illustrations, not requirements.
   A fresh consumer project with no existing conventions still produces a valid
   `conventions.json` using the same schema with different values.
2. **Per-rule enforcement, never global strictness.** There is no top-level
   "strict mode" toggle. Each rule carries its own `enforcement`. A DM can block
   on invalid `type` values while only warning on new tags, in the same file.
3. **Flat and cheap to parse.** The hook is a small Node ESM script. Rules live in
   one top-level `rules` object keyed by rule ID. Each rule entry is shallow: a
   handful of scalar fields plus one `params` object holding check-specific
   values. Rule params are mostly flat or one level deep. The one exception is
   the `default` check, whose `overrides` array nests a `when` condition object
   (three levels total); hook authors should expect this structure.
4. **Forward-compatible.** A rule's `check` field names a check kind the hook
   knows how to run. If the hook encounters a `check` value it does not recognize
   (e.g. written against a newer schema version), it should skip that rule and
   continue rather than fail the write. Unknown rules are a sweep concern, not a
   write-blocker.

## Top-level shape

```jsonc
{
  // Schema version for this file format. Bump only if the shape of a rule
  // entry changes in a way older hook versions cannot parse.
  "version": 1,

  // Path to the KB folder, relative to the project root.
  "kbRoot": "rolara-kb",

  // How this file was produced. One of: "setup" (first-time generation),
  // "resync" (setup re-run against a KB that has drifted), "manual" (a DM
  // hand-edit; rare, and setup will offer to reconcile it on next resync).
  "generatedBy": "setup",

  // ISO 8601 timestamp of the last (re)generation.
  "generatedAt": "2026-07-09T00:00:00Z",

  // Path to the human-readable conventions document this file was derived
  // from, or null if none exists yet (tier 2/3 intake; see below).
  "sourceConventionsDoc": "rolara-kb/KB-CONVENTIONS.md",

  // Where the companion tag registry lives. The hook reads this path when
  // running any "tagVocabulary" check; conventions.json never embeds the
  // tag list itself.
  "tagRegistryPath": ".professor-orb/tag-registry.json",

  // Every rule the DM has confirmed, keyed by a short rule ID. See "Rule
  // entry shape" and the "Rule catalog" below.
  "rules": {
    "...": { "...": "..." }
  }
}
```

`conventions.json` on disk is strict JSON (no comments). The `jsonc` fencing above
is for this document only, to annotate each field inline.

## Rule entry shape

Every entry in `rules` follows the same shape, regardless of category:

```jsonc
{
  "<ruleId>": {
    // One of: "frontmatter" | "filename" | "structural" | "content".
    // Groups rules for documentation and for sweep reporting; the hook does
    // not branch on this field, only on "check".
    "category": "frontmatter",

    // Which check kind to run. See the rule catalog below for the fixed set
    // of check kinds and what each expects in "params".
    "check": "enum",

    // One of: "block" | "warn" | "off". See "Enforcement levels" below.
    "enforcement": "block",

    // Human-readable one-liner, shown in hook error/warning output and in
    // the validation sweep's report. Not used for logic.
    "description": "The `type` field must be one of the KB's recognized types.",

    // Check-specific parameters. Shape depends on "check"; see the catalog.
    "params": { "...": "..." }
  }
}
```

Rule IDs are free-form (camelCase is the convention setup uses when generating
new files) but must be unique within the file. Nothing about a rule ID is
semantically meaningful to the hook; it only reads `category`, `check`,
`enforcement`, and `params`.

## Rule catalog

Four categories, matching the four kinds of conventions a KB-CONVENTIONS.md
typically encodes. Each `check` kind below is a fixed vocabulary the hook
implements; setup only ever emits rules using one of these check kinds.

### Frontmatter rules

Checked by parsing the YAML frontmatter of the file being written.

| check | params | what it checks |
|---|---|---|
| `requiredFields` | `fields` (ordered array of field names), `requiredSubset` (which of those are mandatory vs. optional-but-ordered-if-present), `orderMatters` (bool) | Frontmatter includes the required fields, and if `orderMatters` is true, that present fields appear in the given order |
| `enum` | `field` (string), `values` (array of allowed strings) | The named field's value is one of `values` |
| `default` | `field`, `value`, `overrides` (array of `{ when, value }`, where `when` matches on other frontmatter fields, e.g. `type` or `tags`) | Whether a field missing its default should warn/block, and which default applies given the article's other field values |
| `format` | `field`, `format` (one of `string`, `boolean`, `string-array`, `date`), `optional` (bool) | The named field, when present, has the expected type shape |

### Filename rules

Checked against the file's path and basename, independent of file contents.

| check | params | what it checks |
|---|---|---|
| `suffixByType` | `mapping` (array of `{ type, suffix }`, where `type` matches the frontmatter `type` value and `suffix` is the required pre-extension suffix) | An article of a given type carries its mandatory filename suffix (e.g. `type: Session Report` files end in `-REPORT.md`) |
| `charset` | `pattern` (regex string) | The filename (minus extension) matches an allowed character set, e.g. kebab-case or title-case-with-hyphens, no spaces or symbols |

### Structural rules

Checked against the containing folder or the wider KB. Some of these need only
the folder the written file lives in (cheap: one `readdir`); others need the
full KB's index graph and are realistically only exhaustive under the
validation sweep. The hook still attempts local checks (e.g. counting siblings
in the current folder for a split threshold) and defers what it cannot
determine locally, treating that rule as unchecked for this write rather than
failing it.

| check | params | what it checks |
|---|---|---|
| `indexParity` | `indexSuffix` (string, e.g. `-INDEX`) | The folder containing the written file has exactly one file ending in `indexSuffix` |
| `singleOwnership` | *(none)* | The article's wikilink appears in exactly one owning index across the KB (KB-wide; sweep-scope in practice) |
| `splitThreshold` | `minEntries` (integer) | A folder has reached the entry count at which it should earn its own sub-index |
| `absorbThreshold` | `maxEntries` (integer) | A sub-index has dropped below the entry count at which it should be absorbed into its parent |

### Content rules

Checked against the article's body text.

| check | params | what it checks |
|---|---|---|
| `wikilinkPolicy` | `format` (description string, e.g. `[[Filename\|Display Text]]`), `requireExistingTarget` (bool) | Wikilinks in the body are well-formed and, if `requireExistingTarget` is true, point at a file that exists in the KB |
| `tagVocabulary` | *(none beyond the top-level `tagRegistryPath`)* | Tags used in frontmatter are cross-checked against the tag registry; new tags are reported with suggested near-matches, never blocked (see note below) |
| `prohibitedPattern` | `pattern` (regex string), `appliesTo` (`"body"` or `"frontmatter"`) | The text does not contain a disallowed pattern, e.g. em dashes |

**Note on `tagVocabulary`:** this check exists to encourage reuse, not to cap the
tag vocabulary. Setup should default this rule's `enforcement` to `warn` and
should push back if a DM asks for `block`, since blocking on an unrecognized tag
would prevent any KB from ever growing its vocabulary. `off` is reasonable for a
DM who does not want tag drift tracked at all.

## Enforcement levels

Every rule carries exactly one enforcement level, independent of every other
rule's level.

| level | hook behavior | who acts on it |
|---|---|---|
| `block` | Exits with code 2 and prints the violation to stderr. The write is stopped. | Claude sees the error and self-heals before retrying the write. |
| `warn` | Exits 0, prints the violation to stdout. The write proceeds. | Claude sees the warning and may act on it, but nothing is gated. |
| `off` | Not evaluated at write time. | Documented for the DM's and the sweep's benefit only. The sweep may still choose to report `off` rules informationally, but never fails on them. |

`block` should be reserved for rules where a wrong answer is unambiguous and
cheap to detect locally, for example an invalid `type` enum value or a missing
required field. `warn` fits rules with judgment calls or that need KB-wide
context the hook cannot fully verify, for example new tags or structural
thresholds. `off` fits conventions the DM wants documented and picked up by the
sweep's report but does not want gating individual writes.

The setup skill always confirms each rule's enforcement level with the DM via
`AskUserQuestion` rather than assuming one; the levels above are guidance, not
defaults baked into the schema itself.

## Example conventions.json

A realistic (abbreviated) file, using Rolara-shaped values as examples. A
different consumer project would have different types, suffixes, and
thresholds, but the same shape.

```json
{
  "version": 1,
  "kbRoot": "rolara-kb",
  "generatedBy": "setup",
  "generatedAt": "2026-07-09T00:00:00Z",
  "sourceConventionsDoc": "rolara-kb/KB-CONVENTIONS.md",
  "tagRegistryPath": ".professor-orb/tag-registry.json",
  "rules": {
    "frontmatterRequiredFields": {
      "category": "frontmatter",
      "check": "requiredFields",
      "enforcement": "block",
      "description": "Frontmatter must include publish, type, category, tags in that order when present.",
      "params": {
        "fields": ["publish", "type", "category", "tags"],
        "requiredSubset": ["publish", "type"],
        "orderMatters": true
      }
    },
    "frontmatterTypeEnum": {
      "category": "frontmatter",
      "check": "enum",
      "enforcement": "block",
      "description": "type must be one of the KB's recognized article types.",
      "params": {
        "field": "type",
        "values": [
          "Person", "Settlement", "Location", "Landmark", "Organization",
          "Species", "Ethnicity", "Item", "Material", "Vehicle", "Technology",
          "Spell", "Article", "Myth", "Natural-Law", "Supernatural-Law", "Law",
          "Index", "Homebrew", "Session Report"
        ]
      }
    },
    "frontmatterPublishDefault": {
      "category": "frontmatter",
      "check": "default",
      "enforcement": "warn",
      "description": "publish defaults to true, except NSFW-tagged or Homebrew articles, which default to false.",
      "params": {
        "field": "publish",
        "value": true,
        "overrides": [
          { "when": { "tags": ["NSFW"] }, "value": false },
          { "when": { "type": ["Homebrew"] }, "value": false }
        ]
      }
    },
    "frontmatterTagsFormat": {
      "category": "frontmatter",
      "check": "format",
      "enforcement": "block",
      "description": "tags, when present, must be an array of strings.",
      "params": {
        "field": "tags",
        "format": "string-array",
        "optional": true
      }
    },
    "filenameSuffixByType": {
      "category": "filename",
      "check": "suffixByType",
      "enforcement": "block",
      "description": "Index, session report, and session prep articles carry a mandatory filename suffix.",
      "params": {
        "mapping": [
          { "type": "Index", "suffix": "-INDEX" },
          { "type": "Session Report", "suffix": "-REPORT" },
          { "type": "Session Prep", "suffix": "-PREP" }
        ]
      }
    },
    "filenameCharset": {
      "category": "filename",
      "check": "charset",
      "enforcement": "warn",
      "description": "Filenames should use letters, digits, and hyphens only.",
      "params": {
        "pattern": "^[A-Za-z0-9-]+$"
      }
    },
    "structuralIndexParity": {
      "category": "structural",
      "check": "indexParity",
      "enforcement": "warn",
      "description": "Every folder with content has exactly one owning -INDEX file.",
      "params": {
        "indexSuffix": "-INDEX"
      }
    },
    "structuralSingleOwnership": {
      "category": "structural",
      "check": "singleOwnership",
      "enforcement": "off",
      "description": "Each article's wikilink appears in exactly one owning index. Tracked by the sweep, not gated at write time.",
      "params": {}
    },
    "structuralSplitThreshold": {
      "category": "structural",
      "check": "splitThreshold",
      "enforcement": "warn",
      "description": "A folder earns its own sub-index at 6 or more entries.",
      "params": {
        "minEntries": 6
      }
    },
    "structuralAbsorbThreshold": {
      "category": "structural",
      "check": "absorbThreshold",
      "enforcement": "warn",
      "description": "A sub-index is absorbed into its parent below 4 entries.",
      "params": {
        "maxEntries": 4
      }
    },
    "contentWikilinkPolicy": {
      "category": "content",
      "check": "wikilinkPolicy",
      "enforcement": "warn",
      "description": "Wikilinks should point at confirmed existing articles.",
      "params": {
        "format": "[[Filename-Without-Extension|Display Text]]",
        "requireExistingTarget": true
      }
    },
    "contentTagVocabulary": {
      "category": "content",
      "check": "tagVocabulary",
      "enforcement": "warn",
      "description": "Prefer reusing an existing tag over coining a near-duplicate. Never blocks.",
      "params": {}
    },
    "contentNoEmDashes": {
      "category": "content",
      "check": "prohibitedPattern",
      "enforcement": "block",
      "description": "Article body text must not contain em dashes.",
      "params": {
        "pattern": "\\u2014",
        "appliesTo": "body"
      }
    }
  }
}
```

## How setup produces this file

The setup skill runs once per consumer project (plus an on-demand resync when
the KB has drifted). It supports three intake tiers, tried in this order of
preference:

**Tier 1: translate an existing conventions document.** If the consumer already
has a human-readable conventions document (e.g. Rolara's `KB-CONVENTIONS.md`),
setup reads it section by section and proposes one or more rule entries per
section, mapping prose like "6+ entries earns a subfolder" directly to a
`splitThreshold` rule with `minEntries: 6`. `sourceConventionsDoc` is set to that
file's path.

**Tier 2: discover and consolidate.** If conventions exist but are scattered
across `CLAUDE.md`, other project files, or inferred from patterns already
present across multiple articles, setup gathers them into a single proposed
rule set. Because no single document was the source, setup also drafts a new
human-readable `KB-CONVENTIONS.md` from the consolidated rules, so the consumer
ends up with the same two-layer architecture (prose plus JSON) as a tier 1
consumer. `sourceConventionsDoc` points at the newly drafted file.

**Tier 3: interview and infer.** If conventions exist only in the DM's head,
setup interviews the DM (via `AskUserQuestion`) and infers likely conventions
from sample articles already in the KB (common frontmatter fields, filename
patterns, folder sizes). It drafts both `conventions.json` and a new
`KB-CONVENTIONS.md`, same as tier 2.

**All tiers converge on the same step:** before writing `conventions.json`,
setup walks the DM through every proposed rule, confirms the interpretation is
correct, and confirms the enforcement level (`block` / `warn` / `off`) per rule.
Nothing is written to `.professor-orb/conventions.json` without that
confirmation. A resync re-runs this same walkthrough against whatever has
changed, rather than silently overwriting the DM's prior choices.
