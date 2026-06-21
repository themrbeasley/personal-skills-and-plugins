# Historian Agent, Timeline Skill, and Content Skill Evolution

**Date:** 2026-05-19
**Status:** Approved for piecemeal implementation
**Scope:** Three interconnected additions to the dnd-campaign-toolkit plugin

## Overview

Three changes that add temporal intelligence to the toolkit and establish an agent-supported content architecture:

1. **Historian agent** (new) -- read-only temporal analyst for campaign chronology
2. **Timeline skill** (new) -- interactive workflow for building/maintaining chronology documents
3. **Content skill evolution** -- agent-supported content pattern, starting with timeline visualization

These are designed to be implemented independently in any order, though the historian agent is the foundation the other two build on.

---

## 1. Historian Agent

### Identity

A read-only agent that serves as the campaign's institutional memory for *when* things happened. It discovers calendar systems from KB articles, builds chronological indexes from session reports and lore, converts between calendars, answers temporal queries, and flags inconsistencies. It prioritizes accuracy over producing polished output -- it is an organizational and reference tool, not a content creator.

### Capabilities

**Chronological indexing.** Reads across session reports and KB articles to build a temporal index of events. Each event entry captures: what happened, who was involved, where, when (in the source calendar), and the source document. The index is constructed on the fly from available documents -- the agent does not maintain persistent state.

**Calendar literacy.** Discovers calendar systems by reading KB articles (e.g., articles with a `calendar` type or equivalent per the project's conventions). Learns each calendar's structure: epoch, eras, months/cycles, days, intercalary periods, and any conversion rules relative to other calendars. Converts dates between any two known calendars. If a calendar article is incomplete or ambiguous, flags what is missing rather than guessing.

**Temporal queries.** Answers questions scoped by:
- Date range ("what happened between Mirtul 1 and Flamerule 15?")
- Entity ("show me all events involving Faction X")
- Location ("what has happened in the Underdark?")
- Theme or tag ("all diplomatic events", "all combat encounters")
- Combination of the above

**Consistency checking.** Flags temporal contradictions:
- Event A is dated before event B in one source, but after B in another
- An entity's article describes an event as happening "recently" relative to a date that contradicts session report dating
- Causal ordering violations (effect dated before cause)
- Duration contradictions (travel time, spell durations, seasonal references that don't match dates)

**Time travel and branched timelines.** Handles campaigns with non-linear time:
- Tracks events on branched timelines when the campaign establishes them
- Distinguishes between "timeline as experienced by PCs" and "timeline as it exists in the world"
- Notes paradoxes and causal loops without trying to resolve them (that is the DM's job)
- Clearly labels which timeline branch an event belongs to
- If the campaign has retroactive changes (retcons, time-travel rewrites), tracks both the original and revised versions with clear labeling

### What It Reads

- **Session reports** -- for event dates, sequences, new temporal data
- **KB articles** -- for entity histories, established dates, relationships, backstory events
- **Calendar articles** -- for calendar system definitions, epoch markers, conversion rules
- **Chronology documents** -- for existing timelines to verify against or extend
- **CLAUDE.md** -- for structural conventions only (where to find articles, type values, folder structure), never for calendar data

### What It Produces

A structured chronological report. The exact format adapts to the query, but the structure is consistent:

```
## Chronological Analysis -- [Query Description]

### Parameters
**Scope:** [what was queried]
**Calendar:** [which calendar system results are expressed in, with conversion notes]
**Sources consulted:** N session reports, M KB articles, K calendar articles
**Timeline branch:** [if applicable]

### Chronology
[Ordered list of events with dates, descriptions, involved entities, and source citations]

### Temporal Inconsistencies
[Contradictions found, with source references for both sides]
[Or "None found"]

### Gaps
[Periods with no documented events that the DM might want to fill]
[Missing calendar data that prevented conversion]
[Events with ambiguous or missing dates]

### Notes
[Observations about temporal patterns, convergences, or structural issues]
```

### When Spawned

- By **timeline skill** (primary consumer) -- to gather temporal data before building chronology documents
- By **content skill** -- when producing timeline visualizations
- By **debrief** -- to check whether newly reported events are temporally consistent with existing canon
- By **prep** -- for temporal context on upcoming sessions (what date is it in-world? what is happening simultaneously elsewhere?)
- **On demand** by the DM -- for ad-hoc temporal queries

### Technical Details

- **Model:** sonnet (needs broad reading and careful reasoning, same tier as `lore`)
- **Tools:** Read, Glob, Grep (read-only, consistent with existing agent pattern)
- **Color:** (to be chosen at implementation -- avoid yellow/cyan already used by lore/kb-validator)

### Design Principles

- **Accuracy over output.** If a date is uncertain, say so. If a conversion is ambiguous, flag it. Never fabricate temporal data to fill gaps. A timeline with honest gaps is more useful than a complete one with silent guesses.
- **System-agnostic.** No hardcoded calendar systems, date formats, or temporal assumptions. Everything is discovered from the project's KB articles.
- **Read-only.** Never edit files. Return analysis and structured data only.
- **Source everything.** Every event in a chronology cites the document it came from. The DM should be able to trace any claim back to its source.

### Process

1. **Learn the project's system.** Read CLAUDE.md for structural conventions. Discover calendar articles by type or folder convention.
2. **Read calendar articles.** Build an internal model of each calendar system and conversion rules between them.
3. **Determine scope.** What has been asked for? Parse the query into: entities, locations, date range, calendar, timeline branch.
4. **Read relevant sources.** Session reports and KB articles within scope. Extract temporal data: explicit dates, relative dating ("three days after the siege"), seasonal references, causal ordering.
5. **Build the chronology.** Order events. Convert dates to the requested calendar. Flag inconsistencies.
6. **Produce the report.** Structured output per the format above.

---

## 2. Timeline Skill

### Identity

An interactive workflow for building and maintaining chronology documents in the KB. It is the historian agent's interactive counterpart -- the same relationship that `chronicler` has with `lore`. The historian does the analysis; the timeline skill does the propose-then-execute workflow to produce and maintain actual documents.

### Pipeline Position

**Standalone**, like `homebrew`. Not part of the debrief > prep > content > chronicler pipeline. It can be invoked at any point:
- After debrief, to update a campaign chronology with new events
- After chronicler, to verify the timeline still holds
- On its own, to build a new chronology from scratch or answer temporal questions

### Trigger Phrases

"Build a timeline," "update the chronology," "when did X happen," "show me the timeline," "what's the chronological order of," "campaign timeline," "create a chronology," "history of [entity/era/region]."

### Workflow

> **Before you begin:** Read `skills/SHARED-PRINCIPLES.md` and apply its rules throughout this workflow.

#### Phase 1 -- Learn the system

Read the project's `CLAUDE.md`. Extract:
- KB folder structure and paths
- Where chronology/timeline documents live (if a convention exists)
- Filename conventions for timeline documents
- YAML frontmatter schema
- Cross-reference format
- Writing style rules

Discover calendar articles in the KB. Read them to understand the available calendar systems and conversion rules.

If no chronology conventions exist, establish minimal ones with the user.

#### Phase 2 -- Scope the work

Determine what the DM wants through a single AskUserQuestion batch:

1. **What kind of timeline?** Campaign-wide master chronology, entity-specific history, era-specific deep dive, event-filtered timeline (e.g., "all battles"), or a temporal query (no document output, just an answer).
2. **Which calendar?** Primary calendar to use, with conversion notes for others.
3. **Date range?** Full history, specific era, or "since session N."
4. **Update or create?** Is this a new chronology or an update to an existing one?

If the DM is just asking a temporal question ("when did X happen?"), skip to spawning the historian and return the answer. No document needed.

#### Phase 3 -- Gather temporal data

Spawn the historian agent with the scoped query. The agent reads across session reports, KB articles, and calendar articles, then returns a structured chronological report.

Review the agent's output for completeness relative to the scope. If gaps are significant, note them for the DM.

#### Phase 4 -- Draft the chronology document

Using the historian's output, draft a chronology document that follows the project's conventions. The document should be:

- **Ordered** by date within the primary calendar
- **Cross-referenced** to source articles using the project's link format
- **Calendar-aware** -- dates in the primary calendar with parenthetical conversions where relevant
- **Honest about gaps** -- periods without documented events are noted, not papered over
- **Readable** -- this is a reference document, not raw data. Organized by era, year, or thematic section as appropriate for the scope.

Present the draft for DM approval. Wait for approval, requested changes, or rejection. Revise if needed.

#### Phase 5 -- Save and index

Write the approved document. Update indexes per project conventions. If this is a new type of document the project hasn't had before, confirm the filing location with the DM.

Report back with a link and a one-sentence summary.

### Things to Never Do

- **Never invent events.** Every entry must be traceable to a session report, KB article, or DM statement.
- **Never resolve temporal contradictions silently.** Flag them for the DM.
- **Never assume a calendar system.** Discover from KB articles.
- **Never write files without approval.** Propose-then-execute.
- **Never produce player-facing content.** That is the content skill's job. The timeline skill produces DM reference documents. If the DM wants a player-facing timeline visualization, point them to the content skill.

### How This Skill Connects to the Others

- **Spawns:** The `historian` agent for temporal analysis.
- **Inputs:** Session reports (for events), KB articles (for historical data), calendar articles (for date systems).
- **Outputs:** Chronology documents in the KB.
- **Relationship to `chronicler`:** Orthogonal. Chronicler updates entity/location/faction articles. Timeline builds chronological reference documents. They may run in sequence (chronicler canonizes events, then timeline records their temporal position).
- **Relationship to `content`:** Timeline produces DM-facing reference documents. Content produces player-facing timeline visualizations. The historian agent serves both.

---

## 3. Content Skill Evolution

### The Problem

The content skill currently handles three content types (recaps, handouts, setpieces) and does all research and production internally. As content types grow more complex -- starting with timeline visualizations -- the skill becomes bloated if it also has to do deep analytical work (temporal analysis, calendar conversion, cross-KB research).

### The Pattern: Agent-Supported Content

Introduce a clean separation:
- **Specialized agents** handle analytical pre-work (research, data gathering, cross-referencing)
- **Content skill** handles production (craft, voice, formatting, presentation)

The content skill becomes an **orchestrator and producer**. For content types that need significant analytical input, it spawns a specialized agent in its Phase 2 (gather context), receives structured data, then applies craft in Phase 3 (draft).

This is not a rewrite. The existing content types (recaps, handouts, setpieces) continue to work exactly as they do today. The pattern is additive: new complex content types can opt into agent support.

### First Instance: Timeline Visualization

A fourth content type added to the content skill.

**What it is:** A player-facing or table-facing visual representation of a campaign timeline. Unlike the timeline skill's DM-reference chronology documents, this is *presentation content* -- designed to be shown, printed, or displayed.

**Voice:** Factual but evocative. Not the dry reference tone of a chronology document, and not the dramatic narrator tone of a recap. Think historical atlas -- clear, authoritative, with enough flavor to feel like it belongs in the world.

**How it works within the content skill:**

1. **Phase 1 (identify the work):** DM requests a timeline visualization. Content skill confirms scope: what timeline, what calendar, what audience (players at the table, VTT handout, campaign journal).
2. **Phase 2 (gather context):** Content skill spawns the historian agent with the scoped query. Historian returns structured chronological data.
3. **Phase 3 (draft):** Content skill produces the visualization using whatever tools are available. This is deliberately tool-agnostic -- the skill checks what Claude has access to in the current session and uses the best available option (text-based ASCII, HTML, markdown tables, Mermaid, or a specific visualization tool the user has set up). It does not require or assume any particular rendering tool; it works with whatever is present.
4. **Phase 4 (review and save):** Standard content skill review flow. Present for DM approval, save on approval.

**Writing rules for timeline visualizations:**
- Use in-world calendar names and date formats
- Include conversion notes for secondary calendars where relevant
- Cross-reference entities using the project's link format
- Scale detail to the timeline's scope: a 1000-year overview gets one line per era; a single-session timeline gets one line per scene
- Mark uncertain or approximate dates explicitly
- For player-facing timelines, include only information the players know (check session reports for what has been revealed)

### Future Agent-Supported Content Types

The pattern is extensible. Potential future instances (not designed here, just noted for directional alignment):

- **Voice/culture analyst agent** -- supports handout writing by researching NPC speech patterns, cultural conventions, and tone from KB articles. Handout production stays in the content skill; the agent does the deep cultural research.
- **Scene/environment analyst agent** -- supports setpiece writing by researching location details, atmospheric conditions, and sensory details from KB articles.
- **Faction briefing agent** -- supports political/diplomatic handouts by mapping faction relationships, power dynamics, and current agendas.

These are speculative. The point is that the architecture supports them without requiring changes to the content skill's core workflow -- just add a new agent and a new content type section.

### Changes to the Content Skill

**Description frontmatter:** Update to include timeline visualizations in the trigger list.

**New section in the skill file:** Add "4. Timeline visualization" alongside the existing three content types, with its own voice rules, length guidance, and structure.

**Phase 2 modification:** Add a conditional spawn point. When the content type is timeline visualization (or any future agent-supported type), spawn the appropriate agent and incorporate its output before proceeding to drafting.

**No changes to existing content types.** Recaps, handouts, and setpieces continue to work exactly as they do today. The agent-support pattern is opt-in per content type.

### How This Connects

- **Content skill spawns historian agent** when producing timeline visualizations.
- **Content skill reads historian output** as structured data input for its drafting phase.
- **Timeline skill is orthogonal.** Timeline skill produces DM-reference chronology documents. Content skill produces player-facing/table-facing timeline visualizations. Both use the historian agent, but for different purposes.

---

## Implementation Sequence

These can be built in any order, but the natural sequence is:

1. **Historian agent** -- the foundation. No dependencies. Can be tested standalone with ad-hoc temporal queries.
2. **Timeline skill** -- depends on historian agent for temporal analysis. Can be tested by building a chronology document.
3. **Content skill evolution** -- depends on historian agent. Requires modifying an existing skill file. Test by producing a timeline visualization.

Each is independently useful:
- Historian alone answers temporal questions and checks consistency.
- Timeline alone (with historian) produces chronology reference documents.
- Content evolution alone (with historian) produces timeline visualizations.

---

## Open Questions for Implementation

These do not need to be resolved in this spec. They are decision points the implementer should address per-component:

1. **Historian agent color.** Yellow and cyan are taken. Pick something that reads well in the terminal.
2. **Chronology document conventions.** What type value, filename suffix, and folder location? This will vary per consumer project -- the timeline skill should establish conventions through the project's CLAUDE.md, not hardcode them.
3. **Calendar article schema.** What frontmatter fields and body structure make a calendar article machine-readable enough for the historian to parse? This is a consumer-project concern, but the historian's documentation should suggest a minimum viable schema as guidance.
4. **Timeline visualization format.** The content skill is deliberately tool-agnostic here. The spec does not prescribe a rendering format. The implementer may want to provide guidance on common options (markdown table, ASCII art, HTML, Mermaid, etc.) without mandating one.
5. **Stop hook update.** The Stop hook currently suggests next steps for pipeline skills. It should be updated to mention the timeline skill when appropriate (e.g., after chronicler finishes a lore update).
6. **Content skill description update.** The description frontmatter needs to include timeline-related trigger phrases.
7. **`dnd` meta-skill update.** The `dnd` skill that shows available tools needs new rows for the historian agent and timeline skill in its table.
