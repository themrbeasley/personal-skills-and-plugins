# Historian Agent, Timeline Skill, and Content Skill Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add temporal intelligence to the dnd-campaign-toolkit plugin via a new read-only historian agent, an interactive timeline skill, and a fourth content type (timeline visualization) in the existing content skill.

**Architecture:** All three components are markdown only. The historian is a read-only QA agent following the same pattern as `lore` and `kb-validator`. The timeline skill mirrors the chronicler skill's propose-then-execute pattern but is standalone (not part of the pipeline). The content skill gets an additive fourth type with a conditional Phase 2 agent-spawn pattern. Two ancillary files (Stop hook, `dnd` meta-skill) get small updates so the new components are discoverable.

**Tech Stack:** Markdown with YAML frontmatter. Claude Code plugin format (`.claude-plugin/plugin.json`, `agents/*.md`, `skills/*/SKILL.md`, `hooks/hooks.json`). No build, test, or lint tooling. Validation is by reading the artifacts and comparing against existing skill/agent patterns. The working directory is not yet a git repo — there are no commit steps in this plan.

**Design decisions locked in here:**

- **Historian color:** `purple`. Yellow (`lore`) and cyan (`kb-validator`) are taken; purple reads cleanly in dark and light terminals and is thematically appropriate for an archival/temporal agent.
- **Historian model:** `sonnet` (per spec — broad reading and careful reasoning, same tier as `lore`).
- **Historian tools:** `["Read", "Glob", "Grep"]` (read-only, matching `lore`).
- **Calendar article schema guidance (consumer-project hint, not enforcement):** the historian's documentation will suggest a minimum schema (`type: calendar`, fields for epoch, era list, month/cycle names, days per cycle, intercalary periods, and conversion offsets to other calendars). This is described as a suggestion, not a requirement — the historian discovers whatever schema the project actually uses.
- **Timeline visualization rendering:** tool-agnostic per spec. The content skill lists common options (markdown table, ASCII timeline, fenced Mermaid `timeline` or `gantt` block, HTML) and picks based on what the session's tools and the DM's audience support.
- **Chronology document conventions:** the timeline skill establishes these with the DM via the consumer's `CLAUDE.md` — no hardcoded folder, suffix, or type value.
- **No em dashes anywhere.** SHARED-PRINCIPLES.md Principle 6.

---

## File Structure

Files to create:

- `dnd-campaign-toolkit/agents/historian.md` — new read-only agent (Task 1)
- `dnd-campaign-toolkit/skills/timeline/SKILL.md` — new standalone skill (Task 2)

Files to modify:

- `dnd-campaign-toolkit/skills/content/SKILL.md` — add 4th content type and conditional Phase 2 spawn (Task 3)
- `dnd-campaign-toolkit/hooks/hooks.json` — update Stop hook to mention timeline (Task 4)
- `dnd-campaign-toolkit/skills/dnd/SKILL.md` — add historian and timeline rows to the table (Task 4)
- `dnd-campaign-toolkit/README.md` — refresh the inventory list to include historian/timeline (Task 4)

Files NOT touched: `debrief/SKILL.md`, `prep/SKILL.md`, `chronicler/SKILL.md`, `homebrew/SKILL.md`, `lore.md`, `kb-validator.md`, `SHARED-PRINCIPLES.md`, `plugin.json`. The spec lists debrief and prep as potential historian consumers, but those handoffs are documented in the historian's "When Spawned" section in its own file — no edits to debrief/prep are required for this implementation. (If we discover during implementation that debrief or prep needs a one-line nudge, that becomes a follow-up.)

---

## Task 1: Historian Agent

**Files:**
- Create: `dnd-campaign-toolkit/agents/historian.md`

- [ ] **Step 1: Write the historian agent file**

Use this exact content:

```markdown
---
name: historian
description: |
  Use this agent to analyze the temporal structure of a campaign: build chronological
  indexes from session reports and KB articles, convert dates between calendar systems,
  answer temporal queries scoped by date range, entity, location, or theme, and flag
  temporal inconsistencies. This agent is read-only: it never edits files. It returns
  a structured chronological report.

  Primarily spawned by the timeline skill and by the content skill when producing
  timeline visualizations. Also useful on demand for ad-hoc temporal queries, and from
  debrief or prep for consistency checks and in-world dating of upcoming sessions.

  <example>
  Context: The timeline skill needs temporal data before drafting a chronology document
  user: (timeline skill spawns this agent with the scoped query)
  assistant: "I'll build a chronological index from the session reports and KB articles in scope and return a structured report."
  <commentary>
  Primary consumer. The timeline skill scopes the query, the historian does the temporal analysis, the timeline skill drafts the document.
  </commentary>
  </example>

  <example>
  Context: The DM asks an ad-hoc temporal question
  user: "When did the Siege of Tellsbridge happen relative to the Faerunian calendar?"
  assistant: "I'll run the historian to find the siege in the session reports and convert its date to the Faerunian calendar."
  <commentary>
  Direct invocation for a temporal query. The agent reads calendar articles to learn the conversion rules, finds the event, and reports the date with sources.
  </commentary>
  </example>

  <example>
  Context: Debrief wants to check if newly reported events are temporally consistent
  user: (debrief spawns this agent with the report draft)
  assistant: "I'll cross-check the report's dates and event ordering against existing canon and flag any inconsistencies."
  <commentary>
  Consistency-check use. The agent flags contradictions (event A before/after B in conflicting sources, causal-ordering violations, duration mismatches) and reports them without trying to resolve them.
  </commentary>
  </example>

model: sonnet
color: purple
tools: ["Read", "Glob", "Grep"]
---

You are a temporal analyst for a D&D campaign knowledge base. You serve as the campaign's institutional memory for *when* things happened. You discover calendar systems from KB articles, build chronological indexes from session reports and lore, convert between calendars, answer temporal queries, and flag inconsistencies. You are **read-only**: you never edit, create, or delete files.

Accuracy matters more than polished output. A timeline with honest gaps is more useful than a complete one with silent guesses.

## Process

### Step 1: Learn the project's system

Read the project's `CLAUDE.md`. Extract structural conventions only (where articles live, what `type` values are valid, folder layout, frontmatter schema, cross-reference format). Do not pull calendar data from `CLAUDE.md`; calendar facts live in KB articles, not project instructions.

### Step 2: Discover calendar systems

Find calendar articles using whatever convention the project uses (commonly `type: calendar` or a folder like `calendars/`). Read each one and build an internal model of:

- Epoch markers (year zero, founding event, reckoning shift)
- Era names and boundaries
- Months or cycles, their order, and their day counts
- Intercalary days, leap-year rules, week structure
- Conversion rules or offsets relative to other calendars

If a calendar article is incomplete or ambiguous, note what is missing. Do not guess to fill the gap. If the project has no calendar articles, work in whatever date format the session reports use and flag the absence in the output.

**Suggested minimum calendar-article schema (guidance for consumers, not enforcement):**

```yaml
---
type: calendar
name: <calendar name>
epoch: <year-zero marker, e.g., "Founding of Waterdeep">
eras:
  - name: <era>
    starts: <date in this calendar>
    ends: <date or "present">
months_or_cycles:
  - name: <name>
    days: <count>
intercalary:
  - name: <name>
    position: <where it falls>
conversions:
  - to: <other calendar name>
    offset: <description of the offset or rule>
---
```

If the project's schema differs, follow the project's schema. This is a suggestion to surface when the DM asks what makes a calendar article machine-readable.

### Step 3: Parse the query into scope

Identify the dimensions of the query:

- **Date range** ("between Mirtul 1 and Flamerule 15", "the Third Era", "since session 12")
- **Entities** (PCs, NPCs, factions, items, creatures)
- **Locations** (regions, settlements, planes, dungeons)
- **Themes or tags** ("diplomatic events", "combat encounters", "deaths")
- **Calendar** (which calendar to express results in; default to the project's primary calendar if not specified)
- **Timeline branch** (main timeline, alternate timeline, pre-retcon, post-retcon)

If the query is ambiguous, make the most charitable interpretation and state it explicitly in the output's Parameters section.

### Step 4: Read relevant sources

Use Glob and Grep to find session reports and KB articles in scope. Read them and extract temporal data:

- **Explicit dates** ("On the 15th of Mirtul...")
- **Relative dating** ("three days after the siege", "the morning after")
- **Seasonal references** ("in late autumn", "during the Long Dark")
- **Causal ordering** ("after the artifact was destroyed", "before the alliance broke")
- **Durations** (travel times, ritual lengths, spell effects with calendar implications)

If the project defines content exclusion tags, check article metadata first. Skip excluded articles and note that they could not be checked.

### Step 5: Build the chronology

Order events by date in the requested calendar. For each event capture:

- What happened (one line)
- Who was involved (named entities)
- Where (location, if known)
- When (in the requested calendar, with the source calendar's date in parentheses if conversion was applied)
- Source citation (filename or filename:section)

### Step 6: Check for inconsistencies

Flag, do not resolve:

- **Ordering contradictions** — event A is dated before B in one source and after B in another
- **Recency contradictions** — an article describes an event as recent relative to a date that contradicts session report dating
- **Causal violations** — an effect appears in the chronology before its cause
- **Duration contradictions** — travel time, spell duration, or seasonal reference does not match the dates as stated

For each inconsistency, list the conflicting sources with line or section references. Do not pick a winner. That is the DM's job.

### Step 7: Handle non-linear time

If the campaign has established branched timelines, time travel, or retcons, label each event with its branch ("main timeline", "alternate timeline B", "pre-retcon", "post-retcon"). Distinguish:

- **Timeline as experienced by the PCs** (subjective order of play)
- **Timeline as it exists in the world** (objective in-world chronology)

When both are relevant, present both views and label them. Note paradoxes and causal loops without trying to resolve them.

## Output format

```
## Chronological Analysis -- [Query Description]

### Parameters
**Scope:** [what was queried]
**Calendar:** [which calendar system results are expressed in, with conversion notes]
**Sources consulted:** N session reports, M KB articles, K calendar articles
**Timeline branch:** [if applicable, otherwise "Main timeline"]

### Chronology
[Ordered list of events. One line per event: date, what happened, who, where, source citation.]

### Temporal Inconsistencies
[Contradictions found, with source references for both sides.]
[Or "None found".]

### Gaps
[Periods with no documented events that the DM might want to fill.]
[Missing calendar data that prevented conversion.]
[Events with ambiguous or missing dates.]

### Notes
[Observations about temporal patterns, convergences, or structural issues.]
```

## Rules

- **Never edit files.** You are read-only. Return analysis only.
- **Never invent dates.** If a date is uncertain, say so. If a conversion is ambiguous, flag it.
- **Never resolve contradictions silently.** Flag them; the DM resolves them.
- **Never assume a calendar system.** Discover from KB articles.
- **Source everything.** Every event cites the document it came from.
- **Be concise.** One line per event, one line per inconsistency.
- **No em dashes.** Per SHARED-PRINCIPLES.md Principle 6, use commas, colons, parentheses, or restructure.
```

- [ ] **Step 2: Verify the file against existing agent patterns**

Read the file back and compare to `dnd-campaign-toolkit/agents/lore.md` and `dnd-campaign-toolkit/agents/kb-validator.md`:

- [ ] Frontmatter has `name`, `description` (block scalar), `model`, `color`, `tools`
- [ ] `description` includes 2-3 `<example>` blocks with `<commentary>` sub-blocks
- [ ] `tools` is read-only: `["Read", "Glob", "Grep"]`
- [ ] Body has Process, Output format, Rules sections like `lore.md`
- [ ] Contains zero em dashes (search for the literal em-dash character)

Run:

```bash
grep -c "—" dnd-campaign-toolkit/agents/historian.md
```

Expected: `0`

If non-zero, find and replace em dashes with `--`, commas, colons, or parentheses per SHARED-PRINCIPLES.md.

- [ ] **Step 3: Verify color is not a conflict**

Run:

```bash
grep -h "^color:" dnd-campaign-toolkit/agents/*.md
```

Expected output:

```
color: yellow
color: cyan
color: purple
```

If any duplicate appears, change the historian to a different terminal-readable color (green or blue are safe fallbacks) and rerun.

---

## Task 2: Timeline Skill

**Files:**
- Create: `dnd-campaign-toolkit/skills/timeline/SKILL.md`

- [ ] **Step 1: Write the timeline skill file**

Use this exact content:

```markdown
---
name: timeline
description: "Interactive workflow for building and maintaining campaign chronology documents in the knowledge base. Use this skill whenever the user says 'build a timeline,' 'update the chronology,' 'when did X happen,' 'show me the timeline,' 'what's the chronological order of,' 'campaign timeline,' 'create a chronology,' 'history of [entity/era/region],' or asks any temporal question about the campaign. Standalone skill (not part of the debrief / prep / content / chronicler pipeline) -- runs at any point. Produces DM-reference chronology documents in the KB; for player-facing timeline visualizations, use the content skill instead. Spawns the historian agent for the underlying temporal analysis."
---

> **Before you begin:** Read `skills/SHARED-PRINCIPLES.md` and apply its rules throughout this workflow.

# Timeline -- Campaign Chronology

You are the DM's chronology editor. Your job is to take campaign source material (session reports, KB articles, calendar definitions) and produce or maintain chronology documents in the knowledge base. The historian agent does the temporal analysis; this skill runs the propose-then-execute workflow around it -- the same relationship `chronicler` has with `lore`.

This skill is **standalone**, like `homebrew`. It is not part of the debrief / prep / content / chronicler pipeline. Invoke it whenever a temporal question arises or a chronology document needs updating.

## First: learn the user's system

Before doing anything else, read the project's `CLAUDE.md` (or equivalent project instructions file). Extract:

- **KB folder structure and paths.** Where articles live.
- **Where chronology documents live (if a convention exists).** Look for a `chronologies/`, `timelines/`, or `history/` folder, or a `type: chronology` value. If no convention exists, establish a minimal one with the DM in Phase 2.
- **Filename conventions for timeline documents.** Look for suffix patterns like `-CHRONOLOGY`, `-TIMELINE`, `-HISTORY`. Default if no convention: `[SCOPE]-CHRONOLOGY.md`.
- **YAML frontmatter schema.** Required fields, valid `type` values.
- **Cross-reference format.** Wikilinks, markdown links, or plain text. Match it.
- **Writing style rules.** Tone, prohibited patterns, voice. Apply them in the draft.
- **Content exclusions.** Tags or categories marked off-limits. Honor them when scoping.

Then **discover calendar articles** in the KB. Read them to understand the available calendar systems and conversion rules. The historian will do this independently, but you should know what calendars exist so you can scope the work intelligently.

If the project has no chronology conventions and no existing chronology documents, that is fine. Establish minimal conventions with the DM in Phase 2 (filename pattern, folder, frontmatter `type` value) before drafting.

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
- **Calendar-aware** -- dates in the primary calendar with parenthetical conversions where useful
- **Honest about gaps** -- periods without documented events are noted, not papered over
- **Readable** -- this is a reference document, not raw data. Organize by era, year, decade, or thematic section as appropriate for the scope.

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

1. **Write the document** to the path established in Phase 1 / Phase 2. Create the directory if it does not exist.
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
```

- [ ] **Step 2: Verify against existing skill patterns**

Compare to `dnd-campaign-toolkit/skills/chronicler/SKILL.md` and `homebrew/SKILL.md`:

- [ ] Frontmatter has `name` and `description` (single-line quoted string with trigger phrases)
- [ ] Description names the upstream/downstream relationships (here: standalone, but mentions content/chronicler relationships)
- [ ] Body opens with the SHARED-PRINCIPLES.md reminder block
- [ ] Body has "First: learn the user's system" section that reads consumer CLAUDE.md
- [ ] Two-phase propose / execute structure with explicit hard gate
- [ ] "Things to never do" section
- [ ] "How this skill connects to the others" section
- [ ] Zero em dashes

Run:

```bash
grep -c "—" dnd-campaign-toolkit/skills/timeline/SKILL.md
```

Expected: `0`

- [ ] **Step 3: Cross-check skill description against trigger phrases in the spec**

Verify the description includes (or paraphrases) every spec-mandated trigger: "build a timeline", "update the chronology", "when did X happen", "show me the timeline", "what's the chronological order of", "campaign timeline", "create a chronology", "history of [entity/era/region]". If any are missing, edit them in.

---

## Task 3: Content Skill Evolution

**Files:**
- Modify: `dnd-campaign-toolkit/skills/content/SKILL.md`

Three coordinated edits:

1. Update the `description` frontmatter to include timeline visualization triggers.
2. Add "4. Timeline visualization" as a new content type alongside the existing three.
3. Modify Phase 2 with a conditional historian spawn.

- [ ] **Step 1: Update the description frontmatter**

Locate the current description (lines 2-3 of the file). It is one long quoted string starting with `"Player-facing content generator for D&D sessions. Produces three kinds...`.

Edit:

- Change `Produces three kinds of immersive content` to `Produces four kinds of immersive content`
- After the existing list `(1) dramatic third-person read-aloud recaps...`, `(2) handouts...`, `(3) boxed-text setpieces...`, add `, and (4) player-facing timeline visualizations that present campaign chronology as an in-world artifact`
- After the existing trigger phrase list (after `'scene intro,'`), add `'timeline visualization,' 'player-facing timeline,' 'campaign timeline handout,' 'history display,' 'era overview for the players,'`

Resulting description (verify by reading after the edit):

```
"Player-facing content generator for D&D sessions. Produces four kinds of immersive content from a session report and (optionally) its prep plan -- (1) dramatic third-person read-aloud recaps of the previous session to open the next game, (2) handouts such as in-world letters, item descriptions, clues, prophecies, maps-as-prose, (3) boxed-text setpieces for key upcoming scenes, and (4) player-facing timeline visualizations that present campaign chronology as an in-world artifact. Use this skill whenever the user asks for a 'recap,' 'read-aloud,' 'opening narration,' 'handout,' 'letter from X,' 'item description,' 'boxed text,' 'setpiece,' 'scene intro,' 'timeline visualization,' 'player-facing timeline,' 'campaign timeline handout,' 'history display,' 'era overview for the players,' or anything the DM will read or hand to players at the table. Also trigger when the user has just finished session-prep and asks for 'the recap' or 'the handouts' -- content is the designated follow-up for player-facing content. Produces files in the campaign's session folder with clear filename prefixes."
```

- [ ] **Step 2: Add the 4th content type section**

After the closing of the "3. Setpiece (boxed text)" section (which ends with the bullet "Resolve the reveal. Describe the figure; let the player make the connection." around line 99 of the current file) and before `## Workflow`, insert this new section:

```markdown
### 4. Timeline visualization

A player-facing or table-facing visual representation of a campaign timeline. Unlike the timeline skill's DM-reference chronology documents, this is *presentation content* -- designed to be shown, printed, or displayed at the table or in a VTT.

**Voice:** factual but evocative. Not the dry reference tone of a DM chronology document, and not the dramatic narrator tone of a recap. Think historical atlas: clear, authoritative, with enough flavor to feel like it belongs in the world.

**Length:** scale to scope. A 1000-year overview gets one line per era; a single-session timeline gets one line per scene. Aim for the timeline to fit on one displayed page or screen; if it cannot, the scope is too broad and should be split.

**Format:** tool-agnostic. Pick the best option for the session's tools and the DM's audience:

- **Markdown table** -- cleanest for printed handouts and most VTT rich-text editors. Columns: Date / Event / Involved (or similar).
- **ASCII timeline** -- works in any plain-text journal or chat-based VTT. Vertical line with date markers and short event labels.
- **Fenced Mermaid block** (`timeline` or `gantt`) -- if the consumer renders Mermaid (Obsidian, GitHub, some VTTs), produces a clean visual. Verify the consumer supports Mermaid before defaulting to this.
- **HTML** -- for VTT handouts that accept HTML. Use semantic markup; the DM can style it.

If you are unsure what the consumer supports, ask the DM. Do not default to a format that the destination cannot render.

**Writing rules:**

- Use in-world calendar names and date formats. Add a parenthetical conversion only when a secondary calendar is genuinely useful to the audience.
- Cross-reference entities using the project's link format -- but only when the destination renders links. A printed handout does not need wikilinks.
- For player-facing timelines, include only information the players know. Cross-check session reports for what has been revealed. Do not leak DM-only canon.
- Mark uncertain or approximate dates explicitly ("circa", "early in the reign of", "before the Sundering").
- The artifact should feel like an in-world object: a scholar's timeline, a temple's reckoning, a faction's official history. Give it an attributed source in-fiction when appropriate.
```

- [ ] **Step 3: Modify Phase 2 to add the conditional historian spawn**

Locate the existing `### Phase 2 -- Gather voice for handouts (if applicable)` section. It currently reads:

```
### Phase 2 -- Gather voice for handouts (if applicable)

For each handout, confirm the four questions above. Batch if there are multiple handouts. Do not write until every handout has answers.
```

Rename the section heading and expand to handle the agent-supported pattern. Replace with:

```
### Phase 2 -- Gather context

This phase has two tracks. Run whichever apply, in this order:

**Track A -- Voice for handouts (if any handouts are in the work).** For each handout, confirm the four questions from the Handout section above. Batch if there are multiple handouts. Do not draft any handout until every handout has answers.

**Track B -- Agent-supported research (if any agent-supported content types are in the work).** Some content types depend on analytical pre-work that a specialized agent does better than the content skill. When the work list includes one of these types, spawn the appropriate agent before drafting and incorporate its structured output in Phase 3.

Current agent-supported types:

- **Timeline visualization** -> spawn the `historian` agent. Pass it the scope (audience, calendar, date range, entities or themes in focus) and a note that the output is player-facing (so it should flag any DM-only content the visualization must omit). Receive the historian's structured chronological report. Use it as the source for the visualization's events; do not invent dates or fill in gaps the historian did not confirm.

If the work list contains no agent-supported types, skip Track B.

The pattern is additive. Future content types may opt in by adding a row above (and a matching agent), without changing the existing types' flow.
```

- [ ] **Step 4: Verify the edits**

Run:

```bash
grep -c "—" dnd-campaign-toolkit/skills/content/SKILL.md
```

Expected: `0` (still — the edits introduce no em dashes).

Read the file end-to-end and confirm:

- [ ] Description says "four kinds" not "three kinds"
- [ ] Description includes the new timeline trigger phrases
- [ ] Section "### 4. Timeline visualization" exists between setpiece and `## Workflow`
- [ ] Phase 2 has Track A and Track B
- [ ] No existing language about recaps, handouts, or setpieces was removed
- [ ] Self-check checklist in Phase 3 still references the original three types (do not modify it in this task; a timeline-visualization self-check line is fine to add but not required for the spec)

If any existing content was clobbered, restore from the original file and redo the edits surgically.

---

## Task 4: Ancillary updates (Stop hook, dnd meta-skill, README)

**Files:**
- Modify: `dnd-campaign-toolkit/hooks/hooks.json`
- Modify: `dnd-campaign-toolkit/skills/dnd/SKILL.md`
- Modify: `dnd-campaign-toolkit/README.md`

- [ ] **Step 1: Update the Stop hook**

Open `dnd-campaign-toolkit/hooks/hooks.json`. The `Stop` hook currently contains this prompt:

```
Check whether the conversation just completed one of these session pipeline steps: debrief, prep, content, or chronicler. If so, mention what is available next in one sentence: after debrief, prep can build a session brief; after prep, content can write recaps and handouts, and chronicler can update the KB; after chronicler, the kb-validator agent can audit the changes. Frame it as an option, not a directive. Do NOT mention next steps if the conversation was about homebrew design, general questions, or anything outside the session pipeline. Keep it to a single brief line.
```

Replace the entire prompt string with:

```
Check whether the conversation just completed one of these session pipeline steps: debrief, prep, content, or chronicler. If so, mention what is available next in one sentence: after debrief, prep can build a session brief; after prep, content can write recaps and handouts, and chronicler can update the KB; after chronicler, the kb-validator agent can audit the changes, and the timeline skill can record the session's events in the campaign chronology. If the conversation involved temporal questions, in-world dates, or chronology updates, the timeline skill is also a relevant follow-up. Frame it as an option, not a directive. Do NOT mention next steps if the conversation was about homebrew design, general questions, or anything outside the session pipeline. Keep it to a single brief line.
```

- [ ] **Step 2: Verify the JSON parses**

Run:

```bash
node -e "JSON.parse(require('fs').readFileSync('dnd-campaign-toolkit/hooks/hooks.json', 'utf8')); console.log('ok')"
```

Expected: `ok`

If parse fails, the prompt string was likely truncated or contains an unescaped quote. Reopen the file, fix, and retry.

- [ ] **Step 3: Update the dnd meta-skill table guidance**

Open `dnd-campaign-toolkit/skills/dnd/SKILL.md`. It currently instructs the model to render a table including the five skills (debrief, prep, content, chronicler, homebrew) and both agents (lore, kb-validator).

Replace the line:

```
3. A table with one row per skill/agent, columns: Name | When to use | What it produces
   Include all five skills (debrief, prep, content, chronicler, homebrew) and both agents (lore, kb-validator).
   For prep, use: "Build a session brief with your DM" | "Session brief (work review, recap, north stars, handouts)"
```

with:

```
3. A table with one row per skill/agent, columns: Name | When to use | What it produces
   Include all six skills (debrief, prep, content, chronicler, timeline, homebrew) and all three agents (lore, kb-validator, historian).
   For prep, use: "Build a session brief with your DM" | "Session brief (work review, recap, north stars, handouts)"
   For timeline, use: "Build or update a campaign chronology, or answer a temporal question" | "Chronology document in the KB (or a direct answer for pure queries)"
   For historian, use: "Read-only temporal analysis: chronological indexing, calendar conversion, consistency checks" | "Structured chronological report"
```

Also update line 2 of the same file:

```
2. The session pipeline as a simple flow: debrief > prep > content / chronicler > kb-validator
```

stays the same (timeline is standalone, not part of the pipeline). Add a separate line after it:

```
2b. A second line for standalone tools: "Standalone: homebrew, timeline, historian (read-only agent, spawned by timeline and content)."
```

So the renumbered instruction list reads:

```
1. A one-line description: "Collaborative post-session workflow for D&D DMs. Every skill drafts its output and waits for your approval before writing files."
2. The session pipeline as a simple flow: debrief > prep > content / chronicler > kb-validator
3. A second line for standalone tools: "Standalone: homebrew, timeline, historian (read-only agent, spawned by timeline and content)."
4. A table with one row per skill/agent, columns: Name | When to use | What it produces
   Include all six skills (debrief, prep, content, chronicler, timeline, homebrew) and all three agents (lore, kb-validator, historian).
   For prep, use: "Build a session brief with your DM" | "Session brief (work review, recap, north stars, handouts)"
   For timeline, use: "Build or update a campaign chronology, or answer a temporal question" | "Chronology document in the KB (or a direct answer for pure queries)"
   For historian, use: "Read-only temporal analysis: chronological indexing, calendar conversion, consistency checks" | "Structured chronological report"
5. A single closing line: "What would you like to do?"
```

- [ ] **Step 4: Update the plugin README**

Open `dnd-campaign-toolkit/README.md`. Find whatever inventory list of skills and agents it contains and add `timeline` to the skills list and `historian` to the agents list, matching the file's existing style. If the README does not enumerate components (just describes the suite at a high level), add a one-line mention of timeline and historian wherever the pipeline is described.

Read the file first to see what shape the update should take. Do not restructure the README; just add the new entries.

- [ ] **Step 5: End-to-end pattern check**

Run:

```bash
grep -rn "—" dnd-campaign-toolkit/agents/historian.md dnd-campaign-toolkit/skills/timeline/SKILL.md dnd-campaign-toolkit/skills/content/SKILL.md dnd-campaign-toolkit/skills/dnd/SKILL.md dnd-campaign-toolkit/hooks/hooks.json dnd-campaign-toolkit/README.md
```

Expected: no matches (no em dashes anywhere in the changed files).

Run:

```bash
ls dnd-campaign-toolkit/skills/timeline/ dnd-campaign-toolkit/agents/historian.md
```

Expected:

```
dnd-campaign-toolkit/agents/historian.md

dnd-campaign-toolkit/skills/timeline/:
SKILL.md
```

---

## Task 5: Final review

- [ ] **Step 1: Spec coverage walkthrough**

Re-read `docs/superpowers/specs/2026-05-19-historian-timeline-content-evolution-design.md` and verify every requirement maps to a task:

- [ ] Historian agent capabilities (chronological indexing, calendar literacy, temporal queries, consistency checking, time travel / branched timelines) -- all present in Task 1's Process section
- [ ] Historian output format -- present in Task 1
- [ ] Historian "When Spawned" list -- present in Task 1's description block
- [ ] Historian technical details (sonnet, Read/Glob/Grep, color) -- present in Task 1 frontmatter
- [ ] Historian design principles (accuracy, system-agnostic, read-only, source everything) -- present in Task 1 Rules section
- [ ] Timeline skill identity (standalone, propose-then-execute, historian counterpart) -- present in Task 2
- [ ] Timeline trigger phrases -- verified in Task 2 Step 3
- [ ] Timeline workflow (Phase 1-5) -- present in Task 2
- [ ] Timeline "Things to never do" -- present in Task 2
- [ ] Content skill description updated with timeline triggers -- Task 3 Step 1
- [ ] Content skill 4th type "Timeline visualization" -- Task 3 Step 2
- [ ] Content skill Phase 2 conditional spawn -- Task 3 Step 3
- [ ] No changes to existing content types (recaps, handouts, setpieces) -- verified in Task 3 Step 4
- [ ] Stop hook updated -- Task 4 Step 1
- [ ] `dnd` meta-skill updated with new entries -- Task 4 Step 3

- [ ] **Step 2: Cross-reference consistency check**

Confirm that:

- Timeline skill mentions historian by name -- yes (Phase 2, "How this skill connects")
- Content skill mentions historian by name -- yes (Phase 2 Track B)
- Historian description mentions timeline and content as primary consumers -- yes (description block)
- `dnd` meta-skill mentions historian as spawned by timeline and content -- yes (line 3)
- README mentions both -- verified in Task 4 Step 4

- [ ] **Step 3: Install and exercise (manual)**

Per `CLAUDE.md`: "To validate changes, install the plugin into a Claude Code session against a real campaign project and exercise the pipeline."

This step is the DM's: install the updated plugin into a campaign project and run, in order:

1. `/dnd` -- verify the table renders correctly with timeline and historian
2. Spawn `historian` directly with a temporal query -- verify it reads CLAUDE.md, finds calendar articles, and produces the structured report
3. Invoke the `timeline` skill -- verify Phase 1 scoping, historian spawn, draft, and approval gate work end-to-end
4. Invoke `content` with a timeline-visualization request -- verify Phase 2 Track B spawns the historian and Phase 3 produces a player-facing visualization
5. Complete a `chronicler` run and observe the Stop hook output -- verify the timeline skill is mentioned as a follow-up

If any step fails or behaves surprisingly, capture the gap and file a follow-up task.
