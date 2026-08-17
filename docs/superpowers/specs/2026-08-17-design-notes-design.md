# Design Notes: specifying the catalog entry's decision record

Date: 2026-08-17
Component: `professor-orb/commands/references/catalog-type-templates.md`,
`professor-orb/skills/homebrew/SKILL.md`
Status: design, approved 2026-08-17

## Problem

Catalog entries carry a `## Design Notes` section that nothing in professor-orb defines.
`catalog-type-templates.md` declares no such body block for any of the ten type keys, and
the `homebrew` skill never mentions one. The convention arose inside homebrew-skill
conversations as an emergent suggestion and has been reproduced from entry to entry since,
with no file stating what belongs in it, what register it is written in, or how it comes
to exist.

An unspecified convention drifts. This one drifted from recording the design decision
toward asserting setting facts and current campaign state. Both failures matter more here
than they would elsewhere: a catalog entry is knowledge-base content, so an assertion
placed in it becomes canon nobody agreed to, and a statement of present campaign state
expires as soon as play advances while the entry stays.

The drift is also invisible until someone writes a bad one. It surfaced when capturing a
paired artifact took three rejected drafts of the section before landing, each rejection
caught by the DM rather than by the command, because no component had a position on any
of it.

## Derivation rule

**The exemplars are `Loom-of-Marrow-and-Flesh` and `Bodkin`. Derive from those two and no
others.**

Entries carrying a Design Notes section that predate this spec are not exemplars. They
were written under the unspecified convention and reproduce it at varying distances from
what this spec describes.

The issue report that prompted this work reverse-engineered a four-item field list from
non-exemplar entries. That list is superseded by the grammar below. One of its four items
licensed the drift outright, which is what a list derived from drifted material will tend
to do.

This rule exists because the mistake already happened once. State the derivation source
explicitly rather than leaving a future editor to infer it from whatever entries are on
disk at the time.

## The specification

Design Notes is a **list of labeled records, each answering one design question about this
artifact**. That is the whole structure.

**Every paragraph carries a label, and the label is a design question.** The shapes the
exemplars use:

- `Why <the design> exists.` — the gap it fills
- `Rejected: <the alternative>.` — what was cut, and why
- `<The mechanic>.` — what it was assembled out of, and why that shape
- `<The question>, raised but not settled.` — deliberately left open
- `Why <a fiction-driven choice>.` — how the fiction produced the mechanic
- `Naming.` — naming intent
- `What the design responded to.` — the campaign, the month and year, and the conditions
  the design answered

**The body answers the label's question**, and answers it about the artifact as a designed
object: why it is the way it is.

**Where a choice was made among alternatives, the record says it was made and says what was
cut.** The verbs carrying this are past tense: was cut, was weighed and declined, was
assembled out of, was chosen for, was kept instead, was set aside, was left in place rather
than designed around.

**Campaign conditions are recorded in `What the design responded to.`**, bound to the
campaign and the month and year, as conditions the design answered. A condition stated that
way stays true after play moves past it, which is what a plan or a status stated in the
present cannot do.

**Each record is a decision the DM made.**

**Validated against the exemplars.** Every paragraph in both exemplar entries parses under
this grammar. An earlier draft required a past-tense decision verb in every record and was
cut: it rejected three exemplar paragraphs outright, among them `Why a rapier.` and
`Naming.`, which explain in present tense why a mechanic took the shape it did. The label
carries the constraint. Tense follows the kind of record and is not itself the rule, so do
not reinstate it as one.

`What the design responded to.` is required when the design answered a specific campaign
condition, and honestly omitted when it did not. Both exemplars carry it, and it is what
makes a note dateable rather than reading as timeless setting fact. The conditions are
stated as what the design responded to, in past tense, which is how a condition that later
changes stays true as a record.

**Provenance: `[H]`, and `[H]` alone.** Homebrew-only, no SRD basis. It is a design-record
apparatus and never reads as published-rules apparatus. It carries no `[B]` tag: `[B]`
means content supplied to the command and preserved verbatim, and this block's own
definition covers how it comes to exist, so tagging it `[B]` would overload a tag that is
doing real work across all ten type keys.

**The block is shown to the DM and confirmed before the entry is written.** This holds
however the text came to exist. It is an action the model takes, not a history it
reconstructs, which is what makes it a rule the system can actually follow.

## Why a grammar and not a list of prohibitions

The specification carries no negative clause, deliberately.

A prohibition ships an example of the thing it forbids, and that example is then in context
at the moment the block is drafted. Naming the failure keeps it available rather than
removing it.

The grammar makes the failures unrepresentable instead. A setting fact answers no design
question about the artifact, so there is no label it can sit under. Campaign state has
exactly one home, bound to a campaign and a date. A forward-looking plan is absorbed by that
same home, entering as the dated condition the design answered rather than as a status that
expires. A ruling the DM did not make is not a decision the DM made. None of these needs
forbidding, because none of them fits.

The grammar is also generative rather than restrictive. Material that would otherwise
arrive as a fact-assertion survives, reshaped into decision register: what was decided,
and why, in place of what is true. This includes interaction and ecosystem reasoning, which
enters as the reasoning that drove a decision and has no slot as a description of the
ecosystem's current contents. That distinction resolves inside the grammar without a rule
of its own.

**A note for a future editor:** the grammar is enforceable because it is a property of the
text. A paragraph either carries a decision label and a past-tense decision verb or it does
not, checkable by reading it. An earlier iteration of this design proposed a `[D]` tag
distinguishing drafted-then-approved content from verbatim DM content, and it was cut: that
distinction is provenance, unobservable at write time, since nothing marks which text in a
conversation the DM typed and which the assistant produced. A rule whose precondition the
system cannot observe gets guessed at. Prefer rules about the text and rules about actions
over rules about history.

## Where the rules live

**`commands/references/catalog-type-templates.md` — the authority, and the only place the
grammar is written.**

Design Notes joins *Shared rules for every template* as an optional block available to
every type key. It is not type-specific, so it belongs in the shared section rather than in
any one `## <type>` section. The block carries the grammar, the `[H]` tag, and the
show-before-write line.

Placing it here covers every capture path. `/catalog` Step 4 reads this file on every
capture regardless of where the content came from, so a manual paste and content confirmed
earlier in a conversation are both covered by construction.

**`commands/catalog.md` — no changes.**

Step 4 already directs the command to treat body blocks per the template's Preservation
rule, so specifying the block in the template is sufficient. The command's existing body
rules govern not altering supplied content — never rewrite, never reformat, never complete —
and none of them prohibits originating a block, so none of them conflicts with a block
composed during the session.

**`skills/homebrew/SKILL.md` — the offer only.**

At the existing handoff section, where the skill already points the DM at `/catalog` once a
design is finalized, add an offer to compose the Design Notes block while the reasoning is
fresh. The offer points at the template for the definition rather than restating the
grammar; two copies of a rule drift apart.

The offer fires when the conversation produced decisions worth recording — an alternative
rejected, a benchmark named, a departure made deliberately, a constraint that shaped the
design. A design that produced none of these gets no offer, so routine captures carry no
boilerplate.

This needs no new mechanism. The skill authors no files, so an approved block stays in the
conversation and travels to `/catalog` as part of the finalized content, which is already
how everything else the skill produces reaches capture.

**Two entry points, one definition.** The skill offers at finalization, where the reasoning
is freshest and largely lost by capture time otherwise. `/catalog` composes when a capture
did not come through the skill. Both resolve the same grammar from the same file.

## Out of scope

**Existing entries.** This spec governs new writes. Entries already carrying a Design Notes
section are consumer content, and `/migrate` performs structural operations only and never
rewrites body prose, so bringing one into this form is a DM-side edit rather than a plugin
operation. Where such an entry carries setting material, that material's destination is the
subject's own knowledge-base article.

**VTT import-file authoring.** A separate gap in the same skill file, tracked separately.
It shares a file with this change and nothing else — no rule, no failure mode, no test.

**The documented git commit pattern.** The three lane commands document a commit invocation
with no `-m`, which places the message after the `--` separator where git reads it as a
pathspec. Tracked separately.

## Resolved decisions (2026-08-17)

1. **Assistant-drafted, DM-confirmed**, rather than DM-authored only. The reasoning is
   freshest at finalization and is largely lost by capture time, so a DM-authored-only rule
   would lose the section on most captures.
2. **A closed grammar, no prohibitions.** Negation leaves the failure in context. The
   grammar makes it unrepresentable.
3. **No provenance tag.** The `[D]` proposal was cut as unobservable at write time. The
   show-before-write action replaces it and needs no provenance.
4. **`catalog.md` unchanged.** Step 4's delegation to the template's Preservation rule is
   sufficient, and the command's body rules govern transformation rather than origination.
5. **The offer is conditional**, firing only when the conversation produced decisions worth
   recording.
6. **Derive from Loom and Bodkin only.** Recorded above as a standing rule rather than a
   one-time note, because deriving from non-exemplar entries is the mistake that produced
   the superseded field list.
7. **The label carries the constraint, not the tense.** An earlier draft of the grammar
   required a past-tense decision verb in every record; validating it against the exemplars
   rejected three of their paragraphs, so it was cut. Any future revision to the grammar is
   checked the same way: it holds only if every paragraph of both exemplars parses under it.
