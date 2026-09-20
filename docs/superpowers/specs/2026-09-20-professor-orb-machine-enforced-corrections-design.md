# professor-orb: machine-enforced corrections and option laundering

Design, 2026-09-20. Source: `rolara-project/docs/professor-orb-report-2026-09-20.md`,
compiled from the Adjustice sessions of 2026-09-18 and 2026-09-19.

## The problem

Two failures, one disease.

**The DM corrects something and the correction does not travel.** A false
sentence entered the 2026-09-18 report, then spread to the report's NPC line,
its faction line, the Reports-INDEX summary, and three commits, across two days
and three skills. When the DM caught it, the fix reached only the sites they
happened to name; the rest were found by hand. The same pattern repeated the
same evening with a second correction.

**The pipeline launders its own proposals into sources.** The false sentence did
not come from the DM. `prep` proposed a scene. `debrief` turned it into a
multi-select option whose description stated the outcome ("The team answered on
camera as the Neighborhood Watch Association"). One click, or as the DM reports,
no click at all, wrote that sentence into the report. From there it was a source:

| Hop | What it was | What the next hop saw |
| --- | --- | --- |
| `prep` | a suggestion | |
| `debrief` option | a description stating an outcome | |
| selection | a click | "the DM said so" |
| report body | a sentence | a source |
| NPC line, faction line, INDEX | derived | a source |
| recap | derived | a source |

Every artifact can cite the one above it. Citation-checking is therefore
circular: a pass that asks "can you trace this to the report?" returns yes for
the exact claim in question, and certifies the laundering.

## Why this design is mechanisms, not principles

`SHARED-PRINCIPLES` already carries six statements that the DM's word is law
(Principles 1, 3, 7, 14, 15, and Principle 2's approval gate). Every one of them
held during the 09-18 failure and none of them fired. The report's own diagnosis
names why: "the checks that matter are written as reminders rather than as steps
that produce something checkable."

A seventh reminder changes nothing. This design therefore puts each fix in one
of professor-orb's existing enforcement surfaces, which run as subprocesses
outside the model's cooperation:

- `UserPromptSubmit`: stdout is injected into the turn as context.
- `PostToolUse`: exit 2 with stderr blocks the write; exit 0 with
  `hookSpecificOutput.additionalContext` warns.

Two prose changes survive, both marked as prose below, both cheap, both
optional.

### Rejected: a corrections log

An earlier draft proposed
`session-reports/<setting>/<campaign>/CORRECTIONS.md` holding each wrong claim
and its correction. Rejected: the file's entire content is falsehoods, it grows
without bound, and every future `content` and `chronicler` run reads it into
context. It ships the poison to exactly the place that does the damage.

The corrected file is the record. Git already stores what it used to say, and
nothing reads git history into context. `/log` and `/scribe` already commit.

### Rejected: provenance markers carried between skills

An earlier draft proposed a durable mark on a `prep`-proposed scene that
`debrief` would read. Rejected on two counts. First, `debrief` never reads the
prep brief: there are zero mentions of it in its inputs or any of its four
phases, so there is no channel for a marker to travel. Second, building that
channel means loading a list of scenes that may not have happened into the
context of the skill writing the report, which is the corrections-log mistake
again.

Provenance cannot survive the hop. Mechanism 2 below uses it at the one moment
it still exists, inside the session, where the options offered are known
exactly.

## What ships

### Mechanism 1: the correction catcher

**New file** `professor-orb/hooks/dm-correction.mjs`, wired as a fourth entry in
`hooks/hooks.json` under `UserPromptSubmit`.

Runs on every DM message. Matches correction-shaped language against a tight,
high-signal pattern list ("never happened", "didn't happen", "that's wrong",
"not what I said", "I already told you", "no, it was"). On a match it does not
ask for a search. It runs the search itself: extracts content words from the
message, greps the resolved campaign lane (session reports, indexes, prep
briefs, staged articles, KB articles, proposals), and prints the hits to stdout,
where `UserPromptSubmit` injects them into the turn.

The model therefore receives a list of sites already found, rather than an
instruction to go looking. Producing the list requires no cooperation.

The injected preamble states the boundary explicitly:

> The DM's last message reads as a correction. The lines below are every place
> in the campaign lane that mentions what they corrected. Their statement stands
> on its own; this search establishes scope, not truth. Report the list and ask
> once whether to fix them all.

That last clause is the anti-litigation lever. The search must never read as a
fact-check of the DM.

**Contracts.** Fail-silent throughout, matching `pipeline-next.mjs`: a missing
`conventions.json`, an unresolvable campaign, an unreadable file, or a grep that
finds nothing exits 0 with no output. The hook never blocks and never writes.
A non-match is indistinguishable from the hook not existing.

**Approval.** The grep is a read, so Principle 2 needs no exception. The hits
list plus one confirmation before fixing *is* the Principle 2 gate.

**False positives are cheap, false negatives fall back to today.** A wrong match
costs one list the DM ignores. A miss leaves current behavior.

**Test** `hooks/dm-correction.test.mjs`: a detection matrix of phrasings that
must fire and phrasings that must not, plus the fail-silent paths.

### Mechanism 2: the laundering catcher

Two parts, both mechanical.

**Part A, recording.** A second `PostToolUse` entry in `hooks.json` with matcher
`AskUserQuestion`, running a recorder that appends each offered option's label
and description to a hook-owned state file under `.professor-orb/`.

The recorder stores **every option offered, not only those selected.** This is
deliberate and it is what makes the mechanism cover the 09-18 case as the DM
describes it: they state the option was never selected on their screen. Matching
against the full offered set catches a phantom selection and a real one alike,
and it removes any dependence on the shape of `tool_response`.

**Part B, blocking.** A new `optionEcho` check in `hooks/validate-write.mjs`,
registered in the existing `CHECKS` map and driven by a new rule in
`references/base-rules.json`. On a session report write it compares the report's
sentences against the recorded option descriptions and blocks any that is a near
copy, naming each one:

> This sentence is a near copy of an option this session offered, not of
> anything the DM said in prose: "<sentence>". Confirm it with the DM in their
> own words, or cut it.

This is the signature of the bug: a sentence in the report that the pipeline
wrote. It also replaces the prose rule an earlier draft proposed ("the draft
names the lines that came from a selection"), because the machine now produces
that list at write time.

**Rule** `contentOptionEcho`, `provenance: "professor-orb"`,
`category: "content"`, `check: "optionEcho"`, `enforcement: "block"`, no
`autofix` (the remedy is the DM's own words, never a mechanical substitution),
and **no `scope` field**. Omitting `scope` is deliberate: the only prong filter
`validate-write.mjs` applies is `rule.scope === "kb"`, so an absent `scope`
means the rule fires on every write it can reach. That is what is wanted here.
The laundered sentence reached the Reports-INDEX summary as well as the report
body on 09-18, and a KB article that echoes an option is the same bug with a
different filename.

**State file.** Hook-owned, under `.professor-orb/`, session-scoped, read only
by hooks and never by the model. Added to this development repo's own
`.gitignore` here; a consumer project's own `.gitignore` gets the matching
entry from `setup`, which this branch's amendments record as a gap closed by
this fix wave rather than by the original implementation. Principle 8's scope
discipline binds skills, not hooks; `pipeline-state.json` is the precedent. The
file holds proposed-scene text, so keeping it out of the model's context is part
of its contract, not incidental.

**Fail-silent.** No state file, an unreadable one, or a write outside a session
report exits without a violation. A session in which the recorder never ran
behaves exactly as today.

**Tests:** the recorder's append and malformed-input paths; `optionEcho`'s
matching, including a near copy that must block, an unrelated sentence that must
not, and the absent-state-file path.

### Mechanism 3: the pronoun checker

`party/Psyche.md` opened with "*Pronouns: she, they, and he.*" while the body,
the reports, and the DM's usage are they throughout. Four consecutive drafts
used she.

**Two parts.**

A new rule requiring a character article's pronoun line to name the pronoun used
in writing, with any others noted as also accepted. `enforcement: "warn"`,
because the remedy is the DM's call about their own character and blocking a
write on it would be wrong. `kb-validator` gains a matching check and buckets a
multi-set line with no writing pronoun named as **needs-judgment**, not
mechanically fixable, for the same reason.

A new `pronounConsistency` check in `validate-write.mjs`, registered in `CHECKS`.
On a content-file write it resolves the character articles the draft references,
reads each pronoun line, and flags a draft using a pronoun other than the one
named for writing.

**Rule** `contentPronounConsistency`, `category: "content"`,
`check: "pronounConsistency"`, `enforcement: "warn"`, no `autofix`, and no
`scope` field, for the same reason as `contentOptionEcho`: a KB article that
contradicts a character's own writing pronoun is the same defect as a recap that
does.

**Fail-silent.** An article with no pronoun line, an unresolvable reference, or a
pronoun line naming exactly one set and using it, produces nothing.

**Tests:** a multi-set line with no writing pronoun named; a draft contradicting
a named writing pronoun; a single-set line used correctly; the missing-article
path.

## What stays prose

Both are marked as prose in the files themselves, so a later reader does not
mistake them for guarantees.

**`SHARED-PRINCIPLES.md`, Principle 3 gains one paragraph.** Not another
statement that the DM is right, which Principle 3 already makes, but the part it
has never said:

> A correction travels. The same claim is usually in the report, its indexes, any
> brief that carried it forward, and any staged article drawn from it. On a
> correction, the turn's first tool call searches the campaign's lane for every
> copy, and the correction is not closed while one survives. The search
> establishes scope. It never re-litigates the correction.

Justification for keeping it: Mechanism 1 fires on a pattern match, so it will
miss some phrasings. This paragraph is what covers a miss, and it carries
genuinely new information rather than repeating Principles 1 and 3.

**`skills/debrief/SKILL.md`, Phase 2 Round discipline gains one rule.**

> **No option states an outcome.** The test is mechanical: if an option's text
> could be lifted into the report as a sentence about the session, it is not an
> option, it is a draft sentence, and it goes back as the question it should
> have asked. A selection points at a topic. What happened comes back in the
> DM's own words.

Justification for keeping it: Mechanism 2 blocks the write, which is late. This
rule is what stops the option being written in the first place, and unlike the
rules that failed on 09-18 it now has a machine backstop rather than standing
alone.

## Out of scope, deliberately

Two items from the source report are not addressed. Neither is an oversight.

**The length and compression defect (report section 3).** The recap was bound
for Discord's 2000-character limit, and each trimming pass moved it further from
the report: hedges became assertions, two facts merged into one sentence,
attribution dropped. The available fixes are a precedence statement ("accuracy
first, then length") and a destination-scoping step in `content` Phase 1. Both
are prose. A write-time length check does not help, because it fires after the
trimming that caused the damage. Deferred rather than shipped as unenforceable
rules.

**Hedge escalation and reveal ordering (report section 2, remainder).** "Hints of
research into superpowered plants" became "the reason for the research program";
a clan name the party learned late appeared in an earlier beat. No program can
judge whether a claim sits at its source's strength. The pronoun half of this
defect ships as Mechanism 3; the rest is deferred.

Both remain in the source report for a later pass if the DM decides
unenforceable guidance is worth having after all.

## Release

`version` bumps to 1.19.0 in both `.claude-plugin/marketplace.json` at the repo
root and `professor-orb/.claude-plugin/plugin.json`. The two must match.

`setup` copies `references/base-rules.json` into the consumer's
`conventions.json`, so the two new rules reach existing projects on their next
setup or resync. The spec does not migrate existing `conventions.json` files;
absent the new rules, the two `validate-write` checks simply never fire, which
is the correct degradation.

## Implementation notes to confirm during planning

- The exact pattern list for Mechanism 1's detector is settled during planning.
  The phrasings named above are the seed, and the test's must-not-fire column is
  what bounds it: a list wide enough to catch ordinary conversation is worse
  than a narrow one, because Mechanism 1 costs a grep on every match.
- The near-copy threshold for `optionEcho` needs a concrete definition. The
  file already carries a `levenshtein` helper used by `nearestMatch`, which is
  the natural basis; the threshold itself should be set against the 09-18
  sentence as the known-positive case.
- `hooks/hooks.json` gains two entries: the `UserPromptSubmit` hook and a second
  `PostToolUse` matcher for `AskUserQuestion`. The existing `Write|Edit`
  `PostToolUse` entry is unchanged.

## Amendments from implementation

**`validate-write.mjs` requires frontmatter `type`.** The hook exits 0 at
`hooks/validate-write.mjs:904` when the parsed frontmatter carries no `type`, so
every check in `CHECKS` reaches only files that have one. Session reports
(`Session Report`) and indexes (`Index`) qualify, which covers both sites the
09-18 falsehood reached on disk, so Mechanism 2 has full reach. Content files
qualify only in projects whose `conventions.json` defines a content type, and
`skills/content/SKILL.md` states many projects never formalize content-file
conventions. Mechanism 3 therefore does not reach recaps in every project. The
pronoun failure in a recap draft is caught by `pronounDeclaration` making the
source article unambiguous, not by checking the draft.

**Jaccard content-word overlap replaces edit distance for `optionEcho`, at 0.40.**
The spec named `levenshtein`, already present in the file, as the natural basis
for the near-copy threshold. The 09-18 case disproves it: the option read
"Reporter asked the name. The team answered on camera as the Neighborhood Watch
Association" and the report read "The reporter asked what the team was called,
and they answered on camera." That is a paraphrase merging the option's label
into its description, so edit distance is large while the claim is identical.
Overlap over the union scores it 0.50, against 0.27 for the worst innocent
sentence tested. Overlap over the smaller of the two sets was tried first and
rejected: it scores an innocent sentence at exactly 0.60 against the real
sentence's 0.83, leaving no threshold that separates them.

**`optionEcho` blocks only a sentence the DM never wrote in prose.** The spec
described the rule as blocking a sentence that restates an option, which
deadlocks. A good option paraphrases what it asks about, so a sentence the DM
explicitly confirms still overlaps its option heavily ("yes the reporter asked
what the team was called and they answered on camera" scores 0.60 against its
own option). Under the spec's wording the true sentence could never be written
at all. The implemented check reads the session transcript and passes any
sentence the DM substantially wrote themselves, which is the discrimination the
defect actually calls for: restates an option AND appears nowhere in the DM's
own words. Containment is measured against the single best DM message rather
than all of them pooled, because a realistic debrief transcript scores 1.00
pooled against a sentence it never states, which would suppress every block.
This adds `transcriptPath` to the validator's `ctx`.

**`pronounConsistency` split into two checks.** The spec described one check
plus a `kb-validator` update. The implementation ships `pronounDeclaration` (an
article listing several sets names the one prose uses) and
`pronounConsistency` (prose uses the named set), because the root fix is making
the article unambiguous rather than policing every consumer of it.

**Known follow-up: three new check kinds are not propagated to the other three
places check semantics live.** `hooks/validate-write.mjs` carries a load-bearing
comment (above its `CHECKS` map) stating check semantics are duplicated four
ways: `skills/setup/references/conventions-schema.md`'s check catalog, the
`CHECKS` table itself, the `checkerPrompt` in `workflows/validation-sweep.mjs`,
and `agents/kb-validator.md` Step 4, with the base rule data single-sourced at
`references/base-rules.json` but the semantics not. `optionEcho`,
`pronounDeclaration`, and `pronounConsistency` update only the `CHECKS` table
and `references/base-rules.json`; none of the other three locations mention any
of the three. This means `/sweep`'s validation pass and a `kb-validator` run
have no instruction to retroactively catch these three violation shapes in
articles and reports that predate this plan, including the specific
`party/Psyche.md` case that motivated the pronoun checks in the first place;
only the write-time hooks catch them, and only on the next write to the
affected file. This plan's task decomposition never scoped a task to touch the
other three locations, which is the gap, not an error in what was built: the
write-time mechanisms themselves are complete and independently verified. A
follow-up task should update `conventions-schema.md`'s check catalog,
`validation-sweep.mjs`'s `checkerPrompt`, and `kb-validator.md` Step 4's Content
validation section for all three check kinds together, in one reviewed unit.
