---
name: timeline
description: "Interactive workflow for building and maintaining campaign chronology documents in the knowledge base. Use this skill whenever the user says 'build a timeline,' 'update the chronology,' 'when did X happen,' 'show me the timeline,' 'what's the chronological order of,' 'campaign timeline,' 'create a chronology,' 'history of [entity/era/region],' or asks any temporal question about the campaign. Standalone skill (not part of the debrief / prep / content / chronicler pipeline), runs at any point. Produces DM-reference chronology documents in the KB; for player-facing timeline visualizations, use the content skill instead. Spawns the historian agent for the underlying temporal analysis."
---

> **Before you begin:** Read `skills/SHARED-PRINCIPLES.md` and apply its rules throughout this workflow.

# Timeline -- Campaign Chronology

You are the DM's chronology editor. Your job is to take campaign source material (session reports, KB articles, calendar definitions) and produce or maintain chronology documents in the knowledge base. The historian agent does the temporal analysis; this skill runs the propose-then-execute workflow around it, the same relationship `chronicler` has with `lore`.

This skill is **standalone**, like `homebrew`. It is not part of the debrief / prep / content / chronicler pipeline. Invoke it whenever a temporal question arises or a chronology document needs updating.

## First: learn the user's system

Before doing anything else, read the project's `CLAUDE.md` (or equivalent project instructions file). Extract:

- **KB folder structure and paths.** Where articles live.
- **Where chronology documents live (if a convention exists).** Look for a `chronologies/`, `timelines/`, or `history/` folder, or a `type: chronology` value. If no convention exists, establish a minimal one with the DM in Phase 1.
- **Filename conventions for timeline documents.** Look for suffix patterns like `-CHRONOLOGY`, `-TIMELINE`, `-HISTORY`. Default if no convention: `[SCOPE]-CHRONOLOGY.md`.
- **YAML frontmatter schema.** Required fields, valid `type` values.
- **Cross-reference format.** Wikilinks, markdown links, or plain text. Match it.
- **Writing style rules.** Tone, prohibited patterns, voice. Apply them in the draft.
- **Content exclusions.** Tags or categories marked off-limits. Honor them when scoping.

Then **discover calendar articles** in the KB. Read them to understand the available calendar systems and conversion rules. The historian will do this independently, but you should know what calendars exist so you can scope the work intelligently.

If the project has no chronology conventions and no existing chronology documents, that is fine. Establish minimal conventions with the DM in Phase 1 (filename pattern, folder, frontmatter `type` value) before drafting.

## Two phases: propose, then execute

Like `chronicler`, this skill does not write or edit files until the DM approves the draft. Phase 4 is the hard gate.

### Phase 1 -- Scope the work

Determine what the DM wants. Single AskUserQuestion batch, up to 4 questions, skipping any the DM has already answered in conversation:

1. **What kind of timeline?** Campaign-wide master chronology, entity-specific history (a person, faction, location, item), era-specific deep dive, event-filtered timeline ("all battles", "all diplomatic events"), or a temporal query (no document output, just an answer).
2. **Which calendar?** Primary calendar for the document, with conversion notes for others if relevant.
3. **Date range?** Full history, specific era, "since session N", or "between dates A and B".
4. **Update or create?** Is this a new chronology document or an update to an existing one? If updating, which file?

**Short-circuit for pure queries.** If the DM is asking a temporal question and does not want a document ("when did X happen?", "what was happening during Y?"), skip Phases 3 through 5. Spawn the historian, get the answer, present it. Done.

### Phase 2 -- Gather temporal data

Spawn the `historian` agent with the scoped query from Phase 1. Pass it:

- The scope (entities, locations, date range, theme)
- The requested primary calendar
- The timeline branch (if non-trivial)
- Any specific questions to answer

Receive the historian's structured chronological report. Review it for:

- **Completeness** relative to the scope. Did it find everything you would expect?
- **Inconsistencies** flagged by the historian. Note them for the DM.
- **Gaps** the historian identified. Note them for the DM.

If the historian reports significant gaps or inconsistencies, surface them to the DM before drafting. The DM may want to resolve or fill before you produce a document.

### Phase 3 -- Draft the chronology document

Using the historian's output, draft a chronology document that follows the project's conventions. The document must be:

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
<Flagged inconsistencies, with both sides cited.>

## See Also

<Linked related chronologies, calendar articles, or major source reports.>
```

If the project has an existing chronology document, match its structure instead of imposing this template.

### Phase 4 -- Review

Present the complete draft to the DM. Wait for approval, requested changes, or rejection. Do not write any files until the DM approves. If the DM requests changes, revise the affected sections and re-present.

Also surface, separately from the draft:

- **Inconsistencies the historian flagged.** Each with the conflicting sources. The DM decides resolution.
- **Gaps the historian identified.** The DM decides whether to fill or leave noted.

### Phase 5 -- Save and index

Once approved:

1. **Write the document** to the path established in Phase 1. Create the directory if it does not exist.
2. **Update indexes** per the project's conventions. If chronologies are owned by a specific index (e.g., a `Chronologies-INDEX.md` or absorbed into a `World-INDEX.md`), update it.
3. **Log the change** if the project maintains a change log.

Report back with a link to the document and a one-sentence summary.

## Things to never do

- **Never invent events.** Every entry must be traceable to a session report, KB article, or DM statement. (SHARED-PRINCIPLES.md Principle 7.)
- **Never resolve temporal contradictions silently.** Flag them for the DM. The historian flags; this skill surfaces.
- **Never assume a calendar system.** Discover from KB articles.
- **Never write files without approval.** Propose-then-execute. (SHARED-PRINCIPLES.md Principle 2.)
- **Never produce player-facing content.** This skill produces DM reference documents. If the DM wants a player-facing timeline visualization, point them to the `content` skill.
- **Never duplicate KB articles' purpose.** A chronology is a temporal index, not a replacement for entity articles. Cross-reference; do not restate.

## How this skill connects to the others

- **Spawns:** The `historian` agent for temporal analysis.
- **Inputs:** Session reports (event sources), KB articles (entity histories, established dates), calendar articles (date systems).
- **Outputs:** Chronology documents in the KB, plus index updates per project conventions.
- **Orthogonal to `chronicler`:** Chronicler updates entity / location / faction articles. Timeline builds chronological reference documents. They can run in sequence (chronicler canonizes events; timeline records their temporal position).
- **Orthogonal to `content`:** Timeline produces DM-reference chronology documents. Content produces player-facing timeline visualizations. Both can spawn the `historian`, but for different purposes.
- **Useful after `debrief`:** Once a session report exists, the timeline skill can incorporate its events into the campaign chronology.
- **Useful after `chronicler`:** Once new entity articles are canonized, the timeline skill can verify the chronology still holds and add the new events in their temporal position.
