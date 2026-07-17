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

The conventions file is **derived, not authoritative**. It captures the rules the
DM confirmed during setup. If a human-readable conventions document existed at
the KB root, it was raw material for that derivation; `conventions.json` is the
machine-checkable result. The setup skill regenerates it; nothing else hand-edits
it as primary.

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
   values. Most params are flat; the deepest nesting is three levels in the
   `default` check's conditional overrides.
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
  // from, or null if no single source document existed (tiers 2 and 3 set
  // this to null; see below).
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
    // the validation sweep's report, verbatim. Not used for logic. A terse
    // sentence stating what the rule checks, nothing more: never migration
    // status, approval claims, changelog notes, dates, or statistics.
    "description": "The `type` field must be one of the KB's recognized types.",

    // Optional. Plain-English instructions for fixing a violation of THIS rule,
    // written for a model to follow. Present means the DM has pre-approved this
    // class of fix: when the rule fails, the hook asks the main session to
    // dispatch the rule-fixer agent, which applies the guidance to the whole
    // file and reports one line. Absent (the default) means violations are
    // only reported. A non-string or empty value is treated as absent.
    "autofix": "Replace each X with Y. Change nothing else.",

    // Check-specific parameters. Shape depends on "check"; see the catalog.
    "params": { "...": "..." }
  }
}
```

Rule IDs are free-form (camelCase is the convention setup uses when generating
new files) but must be unique within the file. Nothing about a rule ID is
semantically meaningful to the hook; it only reads `category`, `check`,
`enforcement`, and `params`.

**The `description` field is a terse sentence, never narrative.** It states
what the rule checks, in one clean sentence, and nothing else. The hook
surfaces this string verbatim on a block or a warn, and the sweep surfaces it
verbatim in its report, so `description` is never a place for migration
status, DM-approval claims, audit or changelog notes, dates, percentages, or
other statistics. A `description` that reads like a commit message or a
status update is a sign it was written by summarizing a conversation instead
of stating a check; rewrite it as the one-line fact a DM would want to see in
a hook error.

## Rule catalog

Four categories, matching the four kinds of conventions a knowledge base
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
| `frontmatterImpliesFrontmatter` | `when` (object mapping frontmatter field names to a required value or array of values, matched the same way as the `default` check's `overrides[].when`), `requireFrontmatter` (object, never an array, mapping frontmatter field names to a required boolean, string, or number) | If the article's own frontmatter matches `when`, every field named in `requireFrontmatter` must be present with exactly the given value; a missing field fails. Built for publish gating, for example a `dm-only` or `NSFW` tag must force `publish: false` explicitly rather than falling back to a default that could leak. Booleans and strings compare strictly, so a quoted `"false"` does not satisfy a required `false`; a required number is compared against the frontmatter parser's string reading of it, so `2` matches `field: 2`. This is the frontmatter-triggered sibling of `bodyImpliesFrontmatter` (Content rules, below): same `requireFrontmatter` semantics, but the trigger is a frontmatter condition instead of a body pattern |

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
| `wikilinkPolicy` | `format` (description string, e.g. `[[Filename\|Display Text]]`), `requireExistingTarget` (bool), `requireDisplayText` (bool, default false) | Wikilinks in the body are well-formed and, if `requireExistingTarget` is true, point at a file that exists in the KB. If `requireDisplayText` is true, a wikilink with no separator at all (e.g. `[[Target]]`) is flagged as missing display text; a wikilink that carries one, whether table-escaped (`[[Target\|Display]]`) or plain, still passes. Inside Markdown tables the pipe separator appears escaped as `\|` (a bare pipe would split the cell); checkers treat the escaped and bare forms as the same separator, never as a malformed link |
| `tagVocabulary` | *(none beyond the top-level `tagRegistryPath`)* | Tags used in frontmatter are cross-checked against the tag registry; new tags are reported with suggested near-matches, never blocked (see note below) |
| `prohibitedPattern` | `pattern` (regex string), `appliesTo` (`"body"` or `"frontmatter"`), `flags` (regex flags string, default `"u"`), `excludeTableDelimiters` (bool, body only, default false) | The text does not contain a disallowed pattern, e.g. em dashes. Set `flags` for case-insensitive or multiline matching (e.g. `"im"`); JavaScript regex does not support inline `(?im)` groups, so put those flags here instead. When the pattern also bans a double-hyphen used as a prose em-dash substitute, set `excludeTableDelimiters: true` so Markdown table delimiter rows and horizontal rules are not flagged |
| `bodyImpliesFrontmatter` | `bodyPattern` (regex string), `flags` (regex flags string, default `"u"`), `requireFrontmatter` (object, never an array, mapping frontmatter field names to a required boolean, string, or number) | If the article body matches `bodyPattern`, every field named in `requireFrontmatter` must be present in frontmatter with exactly the given value; a missing field fails. Built for publish gating: a body carrying a DM-only content marker must set `publish: false` explicitly, because a missing field would fall back to the site's default and leak. Booleans and strings compare strictly, so a quoted `"false"` does not satisfy a required `false` (it is a real bug worth surfacing); a required number is compared against the frontmatter parser's string reading of it, so `2` matches `field: 2`. See `frontmatterImpliesFrontmatter` (Frontmatter rules, above) for the same mechanism triggered by a frontmatter condition instead of a body pattern |

**Note on `prohibitedPattern` and Markdown tables:** an em-dash rule often bans both
the em dash character (codepoint U+2014) and a double-hyphen used as a prose
substitute for it.
Because a double-hyphen also occurs in Markdown table delimiter rows (the `|---|` line
under a table header) and horizontal rules, a rule whose pattern includes the
double-hyphen alternative MUST also set `excludeTableDelimiters: true`; without it, every
write of a normal table trips the block. With the flag set, table delimiters and horizontal
rules pass, while prose uses of a double-hyphen (whether joined to words or spaced) are
still caught, as is any real em dash even inside a table cell. A rule that bans only the
literal em dash character (`pattern: "\\u2014"`) does not need the flag.

**Note on `tagVocabulary`:** this check exists to encourage reuse, not to cap the
tag vocabulary. Setup should default this rule's `enforcement` to `warn` and
should push back if a DM asks for `block`, since blocking on an unrecognized tag
would prevent any KB from ever growing its vocabulary. `off` is reasonable for a
DM who does not want tag drift tracked at all.

## Enforcement scopes

Every convention that setup considers falls into exactly one of three
enforcement scopes, classified by where it can actually be checked. Only the
first scope becomes an active rule in `conventions.json`.

| scope | what it can see | where it is recorded |
|---|---|---|
| Per-write (the hook) | Only the file just written, the folder it lives in, and cheap existence lookups (e.g. whether a wikilink target exists somewhere in the KB) | An active rule in `conventions.json`, using one of the check kinds in the catalog above |
| Whole-KB (the validation sweep) | The entire KB: every article, every folder, the full index graph | A legitimate convention, but not a write-time gate; the hook returns "not applicable" for it (`singleOwnership` is the example already in this schema). Recorded in `conventions.json` as a sweep-scope entry, typically `enforcement: "off"`, so the sweep's report can still pick it up |
| Human judgment | No deterministic answer exists, for example which of two colliding filenames is "primary," or whether a prose cross-reference reads well | Never `conventions.json`. Setup routes it to the consumer project's CLAUDE.md, as guidance for a human, or a model exercising judgment, to read |

Setup classifies each candidate convention by scope before proposing it to
the DM, and only per-write-checkable conventions are emitted as active
rules. Judgment-only conventions go to CLAUDE.md, never into
`conventions.json`. A migration, for example "the KB used to allow X, DMs
should now write Y," is tracked only as a proposal during the setup
conversation; it is never asserted as settled fact inside `conventions.json`,
whether as a rule of its own or folded into a `description`.

## Enforcement levels

Every rule carries exactly one enforcement level, independent of every other
rule's level.

| level | hook behavior | who acts on it |
|---|---|---|
| `block` | Exits with code 2 and prints the violation to stderr. The hook runs after the write, so the file is already on disk; the exit code surfaces the violation as an error rather than preventing anything. | Claude sees the error and repairs or reverts the just-written file. |
| `warn` | Exits 0 and returns the violation as `hookSpecificOutput.additionalContext`. The write proceeds. | Claude sees the warning next to the tool result and may act on it, but nothing is gated. |
| `off` | Not evaluated at write time. | Documented for the DM's and the sweep's benefit only. The sweep may still choose to report `off` rules informationally, but never fails on them. |

A PostToolUse hook's plain stdout reaches the debug log only, never Claude and
never the transcript; `additionalContext` in a JSON body is the supported channel
for this event. Any future check that wants to tell Claude something must go
through the same field rather than printing.

`block` should be reserved for rules where a wrong answer is unambiguous and
cheap to detect locally, for example an invalid `type` enum value or a missing
required field. `warn` fits rules with judgment calls or that need KB-wide
context the hook cannot fully verify, for example new tags or structural
thresholds. `off` fits conventions the DM wants documented and picked up by the
sweep's report but does not want gating individual writes.

The setup skill always confirms each rule's enforcement level with the DM via
`AskUserQuestion` rather than assuming one; the levels above are guidance, not
defaults baked into the schema itself.

## Autofix

A rule may carry an optional `autofix` string. It holds plain-English guidance a
model can follow to correct a violation of that rule, and its presence is the
DM's standing approval for that class of fix.

When a rule with `autofix` fails, the hook appends a request naming the file, the
rule, and the guidance verbatim, and the main session dispatches the `rule-fixer`
agent to apply it. The hook cannot dispatch the agent itself; it can only make
the request. If the main session does not act on it, behavior degrades to a
reported violation, which is the same as having no `autofix` at all.

Write guidance that is specific about what may change and what may not. The
fixer applies it to every instance in the file, not only the one that triggered
the write, so a rule whose fix depends on per-instance judgment is a poor
candidate: leave those opted out and let the DM decide each one.

`autofix` composes with any `enforcement` level and any `check` kind. Nothing
about a particular project's rules lives in plugin code.

A fixer is contractually forbidden to touch code, fenced or inline, so a
violation that lives inside code cannot be cleared by autofix. If a rule still
matches such content (for example an em dash rule that does not exclude code),
the article stays flagged and re-requests a fix on each write; the recursion
guard bounds this to one no-op dispatch per write, never a loop, but the flag
does not go away on its own. Prefer a check that excludes code where the
convention allows it, or accept the standing flag on the rare article that
carries a violation-shaped character inside genuine code.

## Example conventions.json

A realistic (abbreviated) file, using Rolara-shaped values as examples. A
different consumer project would have different types, suffixes, and
thresholds, but the same shape. Rolara is a tier 1 project with an existing
conventions document; a tier 2 or 3 project would have
`"sourceConventionsDoc": null`.

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
      "description": "Article body text must not contain em dashes or a double-hyphen used as a prose substitute for one.",
      "params": {
        "pattern": "\\u2014|--",
        "appliesTo": "body",
        "excludeTableDelimiters": true
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
rule set. Because no single document was the source, `sourceConventionsDoc` is
set to null.

**Tier 3: interview and infer.** If conventions exist only in the DM's head,
setup interviews the DM (via `AskUserQuestion`) and infers likely conventions
from sample articles already in the KB (common frontmatter fields, filename
patterns, folder sizes). It produces `conventions.json` only; `sourceConventionsDoc`
is set to null.

**All tiers converge on the same step:** before writing `conventions.json`,
setup walks the DM through every proposed rule, confirms the interpretation is
correct, and confirms the enforcement level (`block` / `warn` / `off`) per rule.
Nothing is written to `.professor-orb/conventions.json` without that
confirmation. A resync re-runs this same walkthrough against whatever has
changed, rather than silently overwriting the DM's prior choices.
