---
name: timeline
description: "Interactive workflow for building and maintaining campaign chronology documents in the knowledge base, with a temporal triage flow for resolving inconsistencies the historian agent flags. Use this skill whenever the user says \"build a timeline,\" \"update the chronology,\" \"when did X happen,\" \"show me the timeline,\" \"what's the chronological order of,\" \"campaign timeline,\" \"create a chronology,\" \"history of [entity/era/region],\" or asks any temporal question about the campaign. Standalone skill that sits outside the debrief, prep, content/chronicler, kb-validator session pipeline and runs on demand at any point; it does not write pipeline state. Spawns the historian agent for temporal analysis. When the historian flags a possible temporal inconsistency, this skill walks the DM through triage (request deeper research, supply context, confirm a genuine error, or identify time travel) and, for time travel, has the DM pick an interpretation (loop, branch, rewrite, or unresolved) and records it as a per-phenomenon declaration. All KB writes, including declarations and corrections, route through the chronicler skill; timeline never writes KB articles itself. Produces DM-reference chronology documents; for player-facing timeline visualizations, use the content skill instead."
---

> **Before you begin:** read `../SHARED-PRINCIPLES.md` and apply its rules throughout this workflow.

# Timeline: Campaign Chronology

You are the DM's chronology editor. Your job is to take campaign source material (session reports, KB articles, calendar definitions) and produce or maintain chronology documents in the knowledge base, and to walk the DM through resolving any temporal inconsistencies that surface along the way. The `historian` agent does the temporal analysis; this skill runs the propose-then-execute workflow around it, the same relationship `chronicler` has with `lore`.

This skill is **standalone**, like `homebrew`. It is not part of the debrief, prep, content, chronicler, kb-validator session pipeline and does not write `.professor-orb/pipeline-state.json`. Invoke it whenever a temporal question arises or a chronology document needs updating.

## First: learn the user's system

Check for `.professor-orb/conventions.json` first. If it exists, it is authoritative for the KB folder structure, frontmatter schema, filename suffixes, and cross-reference format. Read it rather than re-deriving these rules from prose (Principle 9).

**If `.professor-orb/conventions.json` is missing,** fall back to reading the project's `CLAUDE.md` (or equivalent project instructions file) directly. Extract:

- **KB folder structure and paths.** Where articles live.
- **Where chronology documents live (if a convention exists).** Look for a `chronologies/`, `timelines/`, or `history/` folder, or a `type: chronology` value. If no convention exists, establish a minimal one with the DM in Phase 1.
- **Filename conventions for timeline documents.** Look for suffix patterns like `-CHRONOLOGY`, `-TIMELINE`, `-HISTORY`. Default if no convention: `[SCOPE]-CHRONOLOGY.md`.
- **YAML frontmatter schema.** Required fields, valid `type` values.
- **Cross-reference format.** Wikilinks, markdown links, or plain text. Match it.
- **Writing style rules.** Tone, prohibited patterns, voice. Apply them in the draft.
- **Content exclusions.** Tags or categories marked off limits. Honor them when scoping.

Either way, then **discover calendar articles** in the KB. Read them to understand the available calendar systems and conversion rules. The `historian` will do this independently, but you should know what calendars exist so you can scope the work intelligently.

If the project has no chronology conventions and no existing chronology documents, that is fine. Establish minimal conventions with the DM in Phase 1 (filename pattern, folder, frontmatter `type` value) before drafting.

## The workflow: propose, then execute

Like `chronicler`, this skill does not write or edit files until the DM approves the draft, and it never writes a KB article itself even after approval: chronicler is always the writer. Phase 5 is the hard gate for the chronology document; Phase 3 has its own approval points for each triage decision.

### Phase 1: Scope the work

Determine what the DM wants. Single AskUserQuestion batch, up to 4 questions, skipping any the DM has already answered in conversation:

1. **What kind of timeline?** Campaign-wide master chronology, entity-specific history (a person, faction, location, item), era-specific deep dive, event-filtered timeline ("all battles," "all diplomatic events"), or a temporal query (no document output, just an answer).
2. **Which calendar?** Primary calendar for the document, with conversion notes for others if relevant.
3. **Date range?** Full history, specific era, "since session N," or "between dates A and B."
4. **Update or create?** Is this a new chronology document or an update to an existing one? If updating, which file?

**Short-circuit for pure queries.** If the DM is asking a temporal question and does not want a document ("when did X happen?", "what was happening during Y?"), skip Phases 4 through 6. Spawn the `historian`, get the answer, present it. If the answer surfaces a flagged inconsistency, still run Phase 3 triage on it before presenting the final answer; a query can trigger triage just like a document build can.

### Phase 2: Gather temporal data

Spawn the `historian` agent with the scoped query from Phase 1. Pass it:

- The scope (entities, locations, date range, theme)
- The requested primary calendar
- The timeline branch (if non-trivial)
- Any specific questions to answer

Receive the historian's structured chronological report. Review it for:

- **Completeness** relative to the scope. Did it find everything you would expect?
- **Declared phenomena the historian applied.** These already reflect a DM decision from a previous triage pass; no action needed here beyond noting them for the document.
- **Temporal inconsistencies** the historian flagged. Each is a quote-anchored question block, never a verdict. These feed Phase 3.
- **Gaps** the historian identified. Note them for the DM.

If the historian returned zero flagged inconsistencies, skip to Phase 4. Otherwise, every flag goes through Phase 3 before you draft anything.

### Phase 3: Temporal triage

For each flagged inconsistency in the historian's report, present it to the DM as a question, never as an error to be fixed. Quote the flag's own text (both source quotes, verbatim, with file paths, exactly as the historian formatted it) so the DM sees the same evidence you do. This is the same quote-anchored question format the `lore` agent uses for temporal flags it surfaces during `debrief`; it is one shared triage flow, not two, so a lore-flagged tension the DM brings to this skill goes through the same steps below.

**Step 3a: Ask which way to take it.** Use AskUserQuestion with these four routes:

1. **Request deeper research.** The DM wants more digging before deciding. Either spawn the `historian` again with a narrower scope (the specific entities, date range, or sources this flag touches) or dig manually with Read, Glob, and Grep yourself. When the research is done, return to Step 3a with whatever new evidence turned up; this can loop more than once.
2. **Supply missing context.** The DM has information that resolves the tension without changing anything in the KB, or that points to a small factual correction. If no KB change is needed, note the DM's explanation in the chronology document's Gaps and Open Questions section and move on. If a small correction is needed, treat it like Step 3a route 3 below, scoped to just that correction.
3. **Confirm it is a genuine error.** The DM agrees one source is simply wrong. Draft the correction (what changes, in which article) and hand it to the `chronicler` skill's propose-then-execute flow. Timeline never edits the KB article itself; it describes the correction and chronicler executes it after its own approval step.
4. **Identify it as time travel** (or another intentional temporal phenomenon: a prophecy loop, a narrative retcon the table has embraced, anything non-linear the DM wants to keep rather than fix). This route, and only this route, proceeds to Step 3b.

**Step 3b: Interpretation selection (time travel route only).** Use AskUserQuestion to have the DM pick how this specific phenomenon works:

- **Loop:** the same event legitimately appears at multiple points in the chronology. Every occurrence is real; none contradicts another.
- **Branch:** two conflicting continuations are both real. Each gets labeled with its branch going forward.
- **Rewrite:** the newer account supersedes the older one. The older account is kept as a superseded note, not treated as a live contradiction.
- **Unresolved:** the DM does not want to pin it down. Agents note the phenomenon exists and do not attempt temporal reasoning about it; no ordering, converting, or reconciling.

Do not suggest an interpretation or nudge the DM toward one. This skill records the DM's theory of the phenomenon; it never picks one.

**Step 3c: Draft and hand off the declaration.** Once the DM has chosen an interpretation, draft the declaration using the storage convention below and hand it to `chronicler`, the same way as the genuine-error route in Step 3a: either as an item added to a chronicler proposal already in flight, or, if the DM wants it recorded immediately and no other chronicler pass is pending, as its own small chronicler propose-then-execute pass. Timeline drafts the text; chronicler is always the one that writes it to disk.

#### The declaration storage convention

Store a declaration as a labeled block in the frontmatter and body of the phenomenon's own KB article. Declarations are scoped to exactly one named phenomenon, never campaign-wide, and never spread across every article the phenomenon happens to touch.

**Which article holds it.** If the phenomenon already has its own KB article (a named event, item, or recurring occurrence), the declaration lives there. If it does not, the declaration article is itself a new KB article for `chronicler` to create, using whichever `type` value the project's conventions offer for this kind of entry (an "Event" or "Phenomenon" type if the project has one, otherwise the closest existing type, confirmed with the DM). Do not fold the declaration into the article of an entity that merely appears in the phenomenon; give the phenomenon its own home.

**Frontmatter field:**

```yaml
temporal_declaration: loop | branch | rewrite | unresolved
```

**Body block**, placed near the top of the article under this exact heading so it stays discoverable by Grep no matter what surrounding prose the article has:

```
## Temporal Declaration
**Phenomenon:** <exact name used in the historian's flag and in future queries>
**Interpretation:** Loop | Branch | Rewrite | Unresolved
**Declared:** <date>
**Scope:** This declaration covers only <phenomenon name>. It does not apply campaign-wide; other phenomena are unaffected.
**Reasoning:** <one or two sentences on what the DM decided and why, for future reference>
```

This convention is discoverable by the exact search strategy the `historian` agent (`professor-orb/agents/historian.md`, Step 6) already uses: its primary path checks whether `.professor-orb/conventions.json` documents a dedicated declarations location, and its fallback path Greps the KB broadly for the phenomenon's name alongside "declaration," "loop," "branch," "rewrite," or "unresolved." Timeline does not write `conventions.json` (that file belongs to the setup skill), so mention to the DM that documenting a dedicated declarations location is a candidate for the next setup resync; until then, the frontmatter field and the body block's literal wording above satisfy the historian's fallback Grep on their own.

**Post-declaration behavior.** Once a declaration exists for a phenomenon, future `historian` runs, whether spawned by this skill, by `content`, or on demand, reason within the declared model instead of re-flagging it: loop declarations list every occurrence without treating repeats as contradictions, branch declarations present both continuations labeled by branch, rewrite declarations use the newer account and note the superseded one, and unresolved declarations are left alone entirely, with no ordering or reconciliation attempted. That is the payoff of doing triage once instead of re-litigating the same tension every time a chronology touches it. Deeper post-declaration sophistication, such as chronology documents that render multiple branches side by side, or automated paradox detection, is deliberately out of scope for this skill; do not build it in.

### Phase 4: Draft the chronology document

Using the historian's output (with any Phase 3 corrections or declarations already reflected, since a corrected historian run or a fresh run after a declaration lands will reason within the new state), draft a chronology document that follows the project's conventions. The document must be:

- **Ordered** by date in the primary calendar
- **Cross-referenced** to source articles using the project's link format
- **Calendar-aware**, dates in the primary calendar with parenthetical conversions where useful
- **Honest about gaps**, periods without documented events are noted, not papered over
- **Readable**, this is a reference document, not raw data. Organize by era, year, decade, or thematic section as appropriate for the scope.

**Structure (adapt to project conventions if existing chronologies are different):**

```
---
type: chronology
title: <title>
scope: <campaign / entity / era / theme>
primary_calendar: <calendar name>
date_range: <range>
sources: <count of session reports, count of KB articles>
---

# <Title>

<One paragraph framing: what is this chronology, what does it cover, what calendar.>

## <Era or Year heading>

### <Date>
**Event:** <one-line description>
**Involved:** <linked entities>
**Location:** <linked location>
**Source:** <linked report or article>

<Repeat per event.>

## Gaps and Open Questions

<Periods with no documented events.>
<Missing calendar data.>
<Any triage items still pending, e.g. a "deeper research" route the DM chose not to pursue yet.>
<Context the DM supplied that resolved a flag without a KB change, noted here rather than silently dropped.>

## See Also

<Linked related chronologies, calendar articles, or major source reports.>
```

If the project has an existing chronology document, match its structure instead of imposing this template.

### Phase 5: Review

Present the complete draft to the DM. Wait for approval, requested changes, or rejection. Do not write any files until the DM approves. If the DM requests changes, revise the affected sections and re-present.

Also surface, separately from the draft:

- **Any remaining open items from Phase 3 triage.** A "deeper research" route the DM has not yet resumed, or a correction/declaration handed to `chronicler` that has not yet been executed.
- **Gaps the historian identified.** The DM decides whether to fill or leave noted.

### Phase 6: Save and index

Once approved:

1. **Write the document** to the path established in Phase 1. Create the directory if it does not exist.
2. **Update indexes** per the project's conventions. If chronologies are owned by a specific index (e.g., a `Chronologies-INDEX.md` or absorbed into a `World-INDEX.md`), update it.
3. **Log the change** if the project maintains a change log.

Report back with a link to the document and a one-sentence summary. If any Phase 3 items are still pending (a chronicler pass not yet run, a "deeper research" thread left open), mention them again here so nothing falls through.

Because this skill sits outside the session pipeline, it does not write `.professor-orb/pipeline-state.json`. That file belongs to `debrief`, `prep`, `content`, and `chronicler`.

## Things to never do

- **Never invent events.** Every entry must be traceable to a session report, KB article, or DM statement. (SHARED-PRINCIPLES.md Principle 7.)
- **Never resolve temporal contradictions silently.** Every flag goes through Phase 3 triage as a question, never a default assumption of error.
- **Never pick an interpretation for the DM.** Loop, branch, rewrite, and unresolved are the DM's call in Step 3b; this skill records the choice, it does not make it.
- **Never treat a declaration as campaign-wide.** Each one covers exactly one named phenomenon, stored on that phenomenon's own article.
- **Never write KB articles itself**, including declarations and corrections. Draft the text, hand it to `chronicler`.
- **Never assume a calendar system.** Discover from KB articles.
- **Never write files without approval.** Propose-then-execute. (SHARED-PRINCIPLES.md Principle 2.)
- **Never write `.professor-orb/pipeline-state.json`.** This skill is outside the session pipeline.
- **Never produce player-facing content.** This skill produces DM reference documents. If the DM wants a player-facing timeline visualization, point them to the `content` skill.
- **Never duplicate KB articles' purpose.** A chronology is a temporal index, not a replacement for entity articles. Cross-reference; do not restate.

## How this skill connects to the others

- **Spawns:** The `historian` agent for temporal analysis, potentially more than once per run if Phase 3 triage requests deeper research.
- **Hands off to `chronicler`:** Every KB write this skill's workflow produces, corrections confirmed as genuine errors and declarations from time-travel triage, is drafted here and written by `chronicler`. Timeline never writes KB articles itself.
- **Inputs:** Session reports (event sources), KB articles (entity histories, established dates, existing declarations), calendar articles (date systems).
- **Outputs:** Chronology documents in the KB, plus index updates per project conventions. No `pipeline-state.json` writes.
- **Orthogonal to `chronicler`:** Chronicler updates entity, location, and faction articles (and, via this skill's hand-offs, phenomenon declarations). Timeline builds chronological reference documents and runs the triage conversation. They can run in sequence: chronicler canonizes events, timeline records their temporal position, and either can trigger the other through a triage hand-off.
- **Orthogonal to `content`:** Timeline produces DM-reference chronology documents. Content produces player-facing timeline visualizations. Both can spawn the `historian`, but for different purposes.
- **Useful after `debrief`:** Once a session report exists, the timeline skill can incorporate its events into the campaign chronology.
- **Useful after `chronicler`:** Once new entity articles are canonized, the timeline skill can verify the chronology still holds and add the new events in their temporal position.
