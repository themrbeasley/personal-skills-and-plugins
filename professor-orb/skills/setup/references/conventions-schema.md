# conventions.json schema reference

## What this file is

`.professor-orb/conventions.json` is professor-orb's rule schema instantiated for one
consumer project: the base rule set the plugin ships, plus the extras layer setup
discovers from that project and confirms with the DM. It exists so that structural
rules are stated once, in one place, and every downstream component checks against a
flat, deterministic file instead of re-reading prose.

Three components consume this schema:

- **The PostToolUse hook** (`validate-write.mjs`) reads it on every KB article write
  and checks the file against each rule whose `enforcement` is not `off`.
- **The setup skill** produces it, by instantiating the base rule set and layering
  on extras drawn from an existing human-readable conventions document (e.g.
  `KB-CONVENTIONS.md`), from conventions scattered across other files, or from an
  interview with the DM. See "How setup produces this file" below.
- **The validation sweep** (a KB-wide audit workflow) reads it to know what every
  sharded subagent should check, and regenerates the companion tag registry
  afterward.

All three must agree on the shape of the file. This document is that agreement.

The conventions file is **instantiated from professor-orb's base rule set, and
authoritative for structural checks**. It carries the base rules the plugin ships,
at the enforcement levels the DM confirmed during setup, plus the extras setup
derived from this project. If a human-readable conventions document existed at the
KB root, it was raw material for the extras layer only; the structural layer does
not come from it. The setup skill regenerates the file; nothing else hand-edits it
as primary.

A companion file, `.professor-orb/tag-registry.json`, holds the actual inventory
of tags in use across the KB. `conventions.json` only references that the tag
registry exists and where to find it; it does not embed the tag list.

## Design principles

1. **One base set, extended rather than replaced.** Professor-orb owns the
   structural layer and ships it at `references/base-rules.json`: thirteen rules,
   four structural (index parity, single ownership, and the split and absorb
   thresholds), five frontmatter (a required-field subset, field order, publish
   presence, the `type` enum, and the `tags` format), three filename (two
   type-to-suffix mappings and a filename charset), and one content rule banning
   em dashes. The base set ships **no wikilink rule and no tag-vocabulary rule**;
   a project that wants either emits its own `provenance: "project"` rule using
   the matching check kind from the catalog below. Read the artifact before
   assuming a base rule exists. Every consumer project gets the same base rules,
   at whatever enforcement levels its DM confirmed. What differs between two
   consumers is the extras layer: the article types that project actually uses,
   its tag vocabulary, and any rule the base set does not cover. A project
   extends a base rule through `extendedBy`; it does not restate, weaken, or
   replace one.
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

  // Which version of professor-orb's base rule set this file was generated
  // against, copied from the "schemaVersion" of references/base-rules.json.
  // It lets a later setup run detect that the base layer has moved on.
  // Independent of "version": that one describes the file format, this one
  // describes the rule set the file was instantiated from.
  "schemaVersion": 1,

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
    // Required. Who authored this rule: "professor-orb" for one that came from
    // the base rule set, "project" for one setup derived from this consumer.
    // A rule carrying no provenance at all is a v1 rule. Setup does NOT
    // default it to "project": it reconciles it against the base rule set,
    // which may fold it into a base rule, leave it as a project rule, or
    // route it to the DM. See "Reconciling a v1 file" below.
    "provenance": "professor-orb",

    // One of: "frontmatter" | "filename" | "structural" | "content".
    // Groups rules for documentation and for sweep reporting; the hook does
    // not branch on this field, only on "check".
    "category": "frontmatter",

    // Which check kind to run. See the rule catalog below for the fixed set
    // of check kinds and what each expects in "params".
    "check": "enum",

    // One of: "block" | "warn" | "off". See "Enforcement levels" below.
    "enforcement": "block",

    // Optional. Additional permitted values this project contributes to a base
    // rule. They are unioned into "params.values" and into nothing else. See
    // the note below; on a rule whose params carry no "values" array, this
    // field has no effect.
    "extendedBy": ["Settlement", "Landmark"],

    // Optional. "kb" restricts the rule to the setting knowledge base, so it
    // is not applied to material outside it. Absent means the rule applies
    // wherever the checking component looks.
    "scope": "kb",

    // Human-readable one-liner. This is what a DM reads directly in
    // conventions.json, and it doubles as the hook's fallback message for a
    // check that produces no more specific message of its own (no current
    // built-in check needs that fallback, since each one generates its own
    // message, but a future check might). Not used for logic. A terse
    // sentence stating what the rule checks, nothing more: never migration
    // status, approval claims, changelog notes, dates, or statistics.
    "description": "The `type` field must be one of the KB's recognized types.",

    // Optional. Plain-English instructions for fixing a violation of THIS rule,
    // written for a model to follow. Present means the fix class is pre-approved,
    // by the DM's authorship for a project rule and by the enforcement level they
    // confirmed at setup for a professor-orb rule. See the Autofix section below.
    // When the rule fails, the hook asks the main session to
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
semantically meaningful to the hook; it only reads `check`, `enforcement`,
`extendedBy`, `scope`, `params`, `description` (as the fallback violation
message when a check returns no message of its own), and `autofix` (to build
the autofix request). A base rule keeps the ID it carries in
`references/base-rules.json`, which is how setup, the sweep, and a later resync
recognize it as the same rule.

**Note on `provenance`:** every rule carries it, and it decides who is
accountable for the rule's content. A `professor-orb` rule came from the base
set: the plugin authored it, and the DM's say over it is the `enforcement` level
they confirmed at setup, including `off`. A `project` rule came from this
consumer: the DM authored it, directly or through a document setup read. The
distinction is load-bearing in the **reasoning** behind autofix pre-approval,
which answers differently for the two provenances: a `project` rule's fix class
is pre-approved by the DM having authored the rule, a `professor-orb` rule's by
the enforcement level they confirmed at setup. It is not load-bearing at
dispatch time, because **no executable component reads the field.** The hook
branches on `enforcement` and `autofix` alone, and the request it builds carries
neither `provenance` nor anything derived from it, so the `rule-fixer` agent
never receives it and must never be told to check it. See the Autofix section
below. A `project` rule may add a rule the base set does not cover. It
may not restate, weaken, or remove a base rule; `enforcement` is the deliberate
exception.

**Note on `extendedBy`:** a project does not get a second rule of the same check
kind on the same field. Each rule fails independently, so two `enum` rules on
`type` would make every article fail one of them. A base rule instead carries
`extendedBy`, an array of extra permitted values the project contributes, and
the checking component evaluates the union of `params.values` and `extendedBy`.
Both stay visible, so provenance is legible without a second rule entry.

`extendedBy` unions into `params.values` and into nothing else. In particular it
is never spliced into `params.mapping`: a `suffixByType` mapping holds
`{ type, suffix }` objects matched by their `type` key, so a bare string added
to that array could never match, which would silently stop enforcing the rule
for the extended type rather than enforcing it. A project that needs a new
type-to-suffix pair states it as its own `provenance: "project"` rule.

**Note on `scope`:** the only value is `"kb"`, and it restricts the rule to the
setting knowledge base. It is how a rule that only makes sense against KB
articles avoids being applied to material held elsewhere in the project. A rule
with no `scope` applies wherever the component checking it looks. Several base
rules ship with `scope: "kb"`.

**Note on `description`:** this field is a terse sentence, never narrative.
It states what the rule checks, in one clean sentence, and nothing else.
`description` is what a DM reads directly in conventions.json, and it is the
hook's fallback message for a check that produces no more specific message of
its own (no current built-in check needs that fallback, since each one
generates its own violation message, but a future check might), so treat it
as production text: terse and factual. It is never a place for migration
status, DM-approval claims, audit or changelog notes, dates, percentages, or
other statistics. A `description` that reads like a commit message or a
status update is a sign it was written by summarizing a conversation instead
of stating a check; rewrite it as the one-line fact that belongs in
conventions.json.

## Reconciling a v1 file, whose rules carry no `provenance` at all

Every rule in a v1 `conventions.json` was derived from the consumer's own
project, so reading them all as `provenance: "project"` would leave a second rule
of the same check kind on the same field standing beside every base rule, which
is exactly the breakage `extendedBy` exists to prevent. Reconciliation exists to
stop that. It runs on setup and on resync, over every rule in the v1 file.

**Reconciliation never writes into the draft.** It produces a *reconciliation
report*: a list of proposed folds, proposed drops, proposed new project rules,
proposed enforcement changes, and unresolved rules. The DM reads that report as
an explicit before-and-after diff and approves it item by item; only approved
items enter the starting draft. This matters because setup's resync path treats
the DM's prior confirmed choices as the starting draft. If reconciliation edited
that draft first, the confirmation walkthrough would present altered enforcement
levels as though they were the DM's own prior state, and the DM would be
approving a change they were never shown. **No enforcement level, on any rule,
changes without appearing in the report first.**

### Step 1: match each v1 rule to a base rule

Matching never uses `category`, which the hook does not branch on either. Try in
this order and stop at the first hit:

1. **Exact rule ID match.** A base rule keeps the ID it carries in
   `references/base-rules.json`, so an exact ID match is unambiguous and is
   tried before anything else. `filenameCharset` in a v1 file is the base
   `filenameCharset`.
2. **Check kind plus the target param.** Otherwise compare the v1 rule's `check`
   against the base rules, and where more than one base rule carries that check
   kind, disambiguate with the target param named in the table below.
3. **Ambiguous.** If two or more base rules still match, or the v1 rule carries
   no value for the target param, **setup does not guess.** The rule goes into
   the report as unresolved, naming every candidate base rule, and setup asks the
   DM via `AskUserQuestion` which base rule it corresponds to (or whether it
   should survive as its own project rule). Nothing folds and no enforcement
   level moves until that answer comes back.
4. **Unmatched.** If no base rule carries the check kind, or none whose target
   param matches, the rule has no base counterpart. See Step 4.

| check kind | base rules carrying it | target param |
|---|---|---|
| `requiredFields` | `frontmatterRequiredSubset`, `frontmatterFieldOrder`, `frontmatterPublishPresence` | **none exists.** `requiredFields` takes no `field` param, so check kind alone can never single one of the three out. Always ambiguous; always routed to the DM |
| `enum` | `frontmatterTypeEnum` | `params.field`, which matches only the value `"type"` |
| `default` | *(none)* | n/a; always unmatched |
| `format` | `frontmatterTagsFormat` | `params.field`, which matches only the value `"tags"` |
| `frontmatterImpliesFrontmatter` | *(none)* | n/a; always unmatched |
| `suffixByType` | `filenameSuffixByType`, `filenameSuffixChronology` | the `type` keys inside `params.mapping`. A v1 mapping naming only `Chronology` matches the second; one naming only `Index`, `Session Report`, or `Session Prep` matches the first; one spanning both is ambiguous |
| `charset` | `filenameCharset` | check kind alone singles it out; `params.pattern` is then compared, not matched on |
| `indexParity` | `structuralIndexParity` | check kind alone; `params.indexSuffix` is compared, not matched on |
| `singleOwnership` | `structuralSingleOwnership` | check kind alone; the check takes no params |
| `splitThreshold` | `structuralSplitThreshold` | check kind alone; `params.minEntries` is compared, not matched on |
| `absorbThreshold` | `structuralAbsorbThreshold` | check kind alone; `params.maxEntries` is compared, not matched on |
| `wikilinkPolicy` | *(none)* | n/a; always unmatched |
| `tagVocabulary` | *(none)* | n/a; always unmatched |
| `prohibitedPattern` | `contentNoEmDashes` | check kind alone; `params.pattern` and `params.appliesTo` are compared, not matched on |
| `bodyImpliesFrontmatter` | *(none)* | n/a; always unmatched |

This table is derived from the base rule set as shipped. If
`references/base-rules.json` changes, re-derive it from the artifact rather than
trusting this copy.

### Step 2: dispose of a matched rule's params

A matched v1 rule is not kept as a rule of its own; the base rule takes its
place, keeping the base rule's own `description`. Each of the matched rule's
params then reaches exactly one of three outcomes, and **every outcome appears in
the report**, including the drops:

- **Folds into `extendedBy`.** Only `params.values` folds, and only the values
  the base rule's `params.values` does not already carry. Of the thirteen base
  rules only `frontmatterTypeEnum` carries a `values` array, so this is the only
  fold that exists today; on any other base rule `extendedBy` has no effect (see
  the note above), and setup never writes one there.
- **Already covered.** A param whose value the base rule already carries
  (the same `pattern`, the same `indexSuffix`, the same `{ type, suffix }` pair,
  the same threshold) contributes nothing. It is dropped, and the report records
  it as covered by the named base rule so the DM can see it was accounted for
  rather than lost.
- **Cannot fold.** Everything else, which is the common case: a `mapping` entry
  the base rule does not carry, a different `pattern`, a different threshold,
  `fields` or `orderMatters` on a `requiredFields` rule. `extendedBy` cannot
  carry any of it and mapping extension is prohibited, so **setup never silently
  discards it.** It goes in the report with the v1 value beside the base value
  and a proposed disposition, and the DM picks:
  - **Emit it as a new `provenance: "project"` rule** carrying only the leftover
    params. Available when the leftover states something no base rule covers and
    contradicts none: a `{ type, suffix }` pair for a type no base mapping names,
    an additional prohibited pattern. Two rules of the same check kind coexist
    safely when their params are disjoint, which is why the base set itself ships
    `filenameSuffixByType` and `filenameSuffixChronology` side by side:
    `suffixByType` passes any article whose `type` no mapping entry names.
  - **Drop it.** The only option when the leftover contradicts a base rule (a
    different suffix for a type the base mapping already names, a `charset`
    pattern wider or narrower than the base one, a different threshold), because
    a project rule may not restate or weaken a base rule. Where the disagreement
    is really about strictness, `enforcement` is the lever that is offered
    instead, and it goes through Step 3 like any other level change.

### Step 3: propose, never carry, the enforcement level

A matched v1 rule's `enforcement` is a **proposal** to change the base rule's
level, never an assignment. Where the two differ, the report shows
`<base rule ID>: <base level> to <v1 level>` and the DM confirms it in setup's
Step 3 walkthrough. Where the two agree, nothing is proposed and nothing changes.

Where a rule was left unresolved by Step 1, **no level is carried at all** until
the DM resolves it. A level the DM once chose for one v1 rule is not evidence
about which of several base rules they meant, and folding it onto the wrong one
silently rewrites a choice they made. A v1 `requiredFields` rule set to `block`,
for example, must never land on `frontmatterFieldOrder`, whose base level is
`warn` and which the DM never asked to block.

### Step 4: a rule with no base counterpart

A v1 rule that matched nothing survives unchanged, and setup writes
`provenance: "project"` onto it. It still appears in the report, as a kept rule,
so the report is a full accounting of every rule in the v1 file rather than only
the ones that moved. Its `enforcement` is its own and is not a change, so Step 3
proposes nothing for it.

## Rule catalog

> Check semantics are duplicated four ways: this catalog (normative), the `CHECKS`
> table in `hooks/validate-write.mjs`, the `checkerPrompt` in
> `workflows/validation-sweep.mjs`, and `agents/kb-validator.md` Step 4. The base
> rule data is single-sourced at `references/base-rules.json`; the semantics are
> not. Changing one requires changing the other three.

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
enforcement scopes, classified by where it can actually be checked. The first
two are recorded in `conventions.json`; the third never is.

| scope | what it can see | where it is recorded |
|---|---|---|
| Per-write (the hook) | Only the file just written, the folder it lives in, and cheap existence lookups (e.g. whether a wikilink target exists somewhere in the KB) | An active rule in `conventions.json`, using one of the check kinds in the catalog above |
| Whole-KB (the validation sweep) | The entire KB: every article, every folder, the full index graph | A legitimate convention, but not a write-time gate; the hook returns "not applicable" for it (`singleOwnership` is the example already in this schema). Recorded in `conventions.json` as a sweep-scope entry carrying a non-off `enforcement`, typically `warn`. The hook stays silent on it because its check function returns "not applicable", not because of the enforcement level; `off` is reserved for a rule the DM has deliberately turned off, and giving it to a sweep-scope rule by default would make the sweep skip it too. A base rule may be sweep scope: `structuralSingleOwnership` ships this way, carrying `provenance: "professor-orb"` and `enforcement: "warn"` |
| Human judgment | No deterministic answer exists, for example which of two colliding filenames is "primary," or whether a prose cross-reference reads well | Never `conventions.json`. Setup routes it to the consumer project's CLAUDE.md, as guidance for a human, or a model exercising judgment, to read |

Setup classifies each candidate convention by enforcement scope before proposing
it to the DM.

**This classification is not the `scope` field.** `scope` is the prong
restriction described under "Note on `scope`" above: its only value is `"kb"`,
the hook gates on `rule.scope === "kb"`, and it says nothing about whether a rule
is checkable per write. The two are independent. All four structural base rules
carry `scope: "kb"`, yet only one of them is whole-KB scope.

A rule's enforcement scope is determined by **its check kind**, specifically by
whether that check can reach a verdict from the file just written and the folder
it lives in. Of the base set, `singleOwnership` is the only check that always
returns not applicable at write time; `indexParity`, `splitThreshold`, and
`absorbThreshold` each answer from the written file's own folder and are
per-write rules despite being KB-scoped. So setup reads the check kind, and the
catalog entry for it, to classify a base rule, and never infers sweep-only status
from `scope: "kb"`. Judgment-only conventions go to CLAUDE.md, never
into `conventions.json`. A migration, for example "the KB used to allow X, DMs
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
| `off` | Not evaluated at write time. | Not checked by the sweep either. An `off` rule produces no finding of any kind, so it can never end up in `mechanicallyFixable`. It stays in the file so the DM can see what they turned off and turn it back on. |

A PostToolUse hook's plain stdout reaches the debug log only, never Claude and
never the transcript; `additionalContext` in a JSON body is the supported channel
for this event. Any future check that wants to tell Claude something must go
through the same field rather than printing.

`block` should be reserved for rules where a wrong answer is unambiguous and
cheap to detect locally, for example an invalid `type` enum value or a missing
required field. `warn` fits rules with judgment calls or that need KB-wide
context the hook cannot fully verify, for example new tags or structural
thresholds, and that the DM still wants reported, whether at write time or by
the sweep. `off` fits a rule the DM wants recorded in the file, so they can see
what they turned off and turn it back on, but does not want evaluated
anywhere: not gating individual writes, and not picked up by the sweep either.

The setup skill always confirms each rule's enforcement level with the DM via
`AskUserQuestion` rather than assuming one; the levels above are the defaults the
base rules ship with, which the DM may change.

## Autofix

A rule may carry an optional `autofix` string. It holds plain-English guidance a
model can follow to correct a violation of that rule, and its presence marks the
fix class as pre-approved: by the DM's authorship for a `project` rule, and by
the enforcement level they confirmed at setup for a `professor-orb` rule.

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

A realistic (abbreviated) file in the v1 shape: `"version": 1`, and no rule
carrying a `provenance` field. Setup reconciles a file like this against the
base rule set on its next run, by "Reconciling a v1 file" above. The values are
Rolara-shaped illustrations of what one project's rules look like on disk; what
differs in another consumer is the extras layer, not the structural rules.
Rolara is a tier 1 project with an existing conventions document; a tier 2 or 3
project would have `"sourceConventionsDoc": null`.

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
          "Index", "Session Report"
        ]
      }
    },
    "frontmatterPublishDefault": {
      "category": "frontmatter",
      "check": "default",
      "enforcement": "warn",
      "description": "publish defaults to true, except NSFW-tagged articles and homebrew catalog entries, which default to false.",
      "params": {
        "field": "publish",
        "value": true,
        "overrides": [
          { "when": { "tags": ["NSFW"] }, "value": false },
          { "when": { "category": ["Homebrew"] }, "value": false }
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
      "enforcement": "warn",
      "description": "Each article's wikilink appears in exactly one owning index. The write-time check always returns not applicable; only the sweep can evaluate this KB-wide, so enforcement must stay non-off for the sweep to report it.",
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
the KB has drifted). Every project starts from the same base rule set, loaded
from the plugin's `references/base-rules.json`. The three intake tiers below
differ only in where the project-specific extras come from, tried in this order
of preference.

**Tier 1: an existing conventions document.** If the consumer already has a
human-readable conventions document (e.g. Rolara's `KB-CONVENTIONS.md`), setup
reads it section by section for extras. A section restating something a base
rule already covers contributes its distinct values to that base rule's
`extendedBy` rather than a rule of its own; a section the base set does not
cover becomes a `provenance: "project"` rule, using the matching check kind and
params from the catalog above. `sourceConventionsDoc` is set to that file's
path.

**Tier 2: scattered prose.** If project-specific conventions exist but are
spread across `CLAUDE.md`, other project files, or patterns visible across
multiple articles, setup gathers them into the same extras layer by the same
fold-or-emit rule. Because no single document was the source,
`sourceConventionsDoc` is set to null.

**Tier 3: interview and infer.** If nothing is written down, the base rule set
still applies unchanged. Setup interviews the DM (via `AskUserQuestion`) for the
extras and derives candidates from articles already in the KB: the distinct
`type` values actually in use become `extendedBy` entries on the base type enum,
and the tags already in use seed the tag registry. `sourceConventionsDoc` is set
to null.

**All tiers converge on the same step:** before writing `conventions.json`,
setup walks the DM through the full rule set, base and extras, confirms the
interpretation is correct, and confirms the enforcement level
(`block` / `warn` / `off`) per rule. Nothing is written to
`.professor-orb/conventions.json` without that confirmation. A resync re-runs
this same walkthrough against whatever has changed, rather than silently
overwriting the DM's prior choices.
