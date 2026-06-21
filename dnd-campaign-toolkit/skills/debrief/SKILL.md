---
name: debrief
description: Interactive D&D session debrief workflow that captures what happened in a session and produces a structured report file. Use this skill whenever the user signals a recent game session is being processed -- explicit cues like "debrief me", "write up last night's session", "session report", "let's do a debrief", OR narrative cues like "so last session the party...", "we just finished a session", "the party did X last night". Also trigger when the user names a specific ongoing campaign in a post-play context. This skill owns the session-reports/ folder structure, maintains per-campaign index files, and pre-formats reports so downstream skills can process them cleanly. Use it even if the user doesn't use the word "report" -- if a session just happened and they're recounting it, they want this workflow.
---

> **Before you begin:** Read `skills/SHARED-PRINCIPLES.md` and apply its rules throughout this workflow.

# Session Debrief

You are helping a D&D DM turn a just-played session into a structured session report. The report serves two audiences: **the DM planning next session**, and **a downstream lore analysis agent** that will read the report to propose KB article changes. Both audiences benefit from rich structure, aggressive cross-referencing, and explicit callouts of new canon vs. discovered canon.

## First: learn the user's system

Before doing anything else, read the project's `CLAUDE.md` (or equivalent project instructions file). Extract:

- **Where session reports live.** Look for a session-reports directory, a naming convention, or a file pattern. If CLAUDE.md doesn't specify, default to `session-reports/[Campaign-Name]/` at the KB root and confirm with the user.
- **Report filename convention.** Look for a date format, title format, or suffix convention (e.g., `-REPORT.md`). If not specified, default to `YYYY-MM-DD-[Session-Title]-REPORT.md`.
- **YAML frontmatter schema.** What fields does this project use? What are the valid `type` values? Do not assume a schema -- discover it from CLAUDE.md and from existing reports in the project.
- **Report body structure.** Check if the project has a report template, or look at existing reports to learn the section headers and structure already in use. If neither exists, you will build one with the user in Phase 1.
- **Cross-reference format.** How does this project link between files? Wikilinks, markdown links, plain text? Match whatever is in use.
- **Writing style rules.** Any tone, phrasing, or formatting rules (e.g., prohibited characters, required tense, encyclopedia vs. narrative voice).
- **Content exclusions.** Any tags or categories the project marks as off-limits (e.g., NSFW). If such tags exist, check article frontmatter before reading or citing any unfamiliar article.
- **Index conventions.** How are indexes structured? What's the ownership model for cross-references? You will need this when updating campaign indexes in Phase 4.

If CLAUDE.md points to other reference documents, read those too. The goal is to understand this project's conventions thoroughly before writing anything.

**If the project has no CLAUDE.md or conventions file,** that is fine. Work with what exists (prior reports, folder structure, article patterns). If nothing exists, you are starting from scratch -- ask the user a few foundational questions in Phase 1 and establish conventions as you go.

## The workflow has four phases

Do them in order. Do not skip the lore analysis phase -- it is the highest-value thing this skill does that the user cannot easily do on their own.

### Phase 1 -- Setup (1 question max)

Determine the campaign. Most of the time the user will name it upfront. If they don't, infer from recent conversation context and confirm with a single AskUserQuestion listing (a) your best guess, (b) any other existing campaigns you can see in the session-reports folder, and (c) "New campaign."

Check the session-reports directory to see which campaigns already exist. If the folder doesn't exist yet, that is fine -- you will create it in Phase 4.

If it is a new campaign, ask for the campaign's display name in the same question batch.

**If you found no existing reports or templates in the project,** add one additional question to this batch: ask the user what structure they want in their reports (offer to model it on common patterns, or to keep it simple and iterate). Do not present a long intake form -- keep it to 1-2 questions total.

### Phase 2 -- Narrative capture (open, then structured follow-up)

**Step 2a -- Let the user narrate.** Prompt them openly: *"Walk me through the session. Tell it however feels natural, and I'll take notes and ask follow-ups after."* Then listen. Do not interrupt with structured questions yet.

While they narrate, mentally note:
- Who appeared (NPCs, factions, creatures)
- Where they went (settlements, landmarks, planes)
- What was revealed, established, or changed in the world
- What the PCs did, gained, and lost
- Loose threads, glossed-over moments, ambiguities

**Step 2b -- Structured follow-ups via AskUserQuestion.** Once the user finishes their recap, do a structured follow-up pass. Batch questions in groups of 2-4. **Skip any topic the user already fully covered in narration.** The follow-up pass covers:

1. **Session metadata.** IRL session date. In-game date and passage of time. Session title (offer 2-3 suggestions, let them pick or write their own).
2. **Players and PCs present.** Which PCs were at the table, which players were absent, how absent PCs were handled.
3. **NPCs and factions touched.** For each major NPC: did status, disposition, or circumstances change? For each faction: shifts in power, relationships, or perception?
4. **Locations visited.** New locations that need articles? Changes to existing locations?
5. **Notable inventory updates.** Items gained, lost, destroyed, transformed. Magic items identified. Consumables used that matter narratively.
6. **Lore revelations -- split into two buckets.**
   - **New canon established.** Things the DM invented or decided at the table that are now true.
   - **Canon discovered.** Things the PCs learned that were already true.
7. **Cliffhangers and open threads.** What is unresolved? What was foreshadowed? What has changed in the world that the party does not yet know about?

**Question discipline.** Do not ask questions the user already answered. Do not ask filler. If you are uncertain whether something happened, ask a *specific* question.

### Phase 3 -- Deep lore analysis (this is the phase that earns the skill its keep)

Before writing the report, do a dedicated lore pass. This is the highest-leverage part of the workflow.

**Step 3a -- Build a list of KB entities touched.** From the narrative and follow-ups, list every named NPC, location, faction, item, species, and cosmological concept that appeared in the session.

**Step 3b -- Read the relevant KB articles.** For each entity, check if it has an article in the project's KB. Use whatever index or search method the project supports. For non-trivial entities, read the article (or enough of it to understand its current canonical state). Also check relevant category indexes to catch adjacent entities.

If the project defines content exclusion tags, check article metadata before reading. Skip excluded articles and note that they could not be checked.

**Step 3c -- Look for four things:**

1. **Non-obvious connections.** Did something in this session thematically, historically, or causally touch something in deep lore that the DM may not have noticed? Only flag connections that feel earned -- not forced.
2. **Contradictions.** Did anything established at the table conflict with existing canon? For each contradiction, propose a remedy: table chat, retcon, soft retcon, or "not actually a contradiction."
3. **Lore candidates.** What KB articles would need updates if the session's events were to be canonized? Include non-obvious candidates, not just the entities that directly appeared.
4. **Special framing checks.** If the project's CLAUDE.md defines special writing frames for certain topics (e.g., specific cosmological concepts, cultural conventions, canonical phrasing), check whether session events touch those frames and flag any deviations.

**Step 3d -- Spawn the lore agent.** After completing your analysis, spawn the `lore` agent, passing it the session report draft (or your structured notes if the report is not yet written). The lore agent will cross-reference session events against the full KB independently and return a structured proposal with contradiction checks, update proposals, non-obvious connections, and entities without articles. Its findings supplement your Phase 3 analysis -- present both to the user as part of the final report.

If the lore agent is unavailable or the user declines, proceed with your own Phase 3 findings alone.

**Step 3e -- Package findings.** These go into dedicated report sections. Keep them tight and actionable.

### Phase 4 -- Write the report and update indexes

**Step 4a -- Draft the report.** If the project has a report template, use it. If it has existing reports, match their structure. If neither exists, build a clean structure that covers: metadata, narrative recap, PCs present, NPCs and factions, locations, inventory, lore revelations (new canon / discovered canon), deep lore analysis (connections, contradictions, lore candidates), and open threads (unresolved hooks, changed world state, foreshadowed events). The open threads section describes the state of the world, not a list of tasks for the DM. Include the lore agent's findings (if available) in the analysis sections.

Fill every section. For sections with nothing to report, write a stub rather than omitting -- downstream skills need predictable structure.

**Cross-reference aggressively** using whatever link format the project uses. If unsure whether an article exists, still link it -- dead links in reports are acceptable because downstream tools use them to identify article candidates.

**Step 4b -- Present the draft for review.** Show the complete report draft to the DM. Wait for approval, requested changes, or rejection. Do not write any files until the DM approves. If the DM requests changes, revise and re-present the affected sections.

**Step 4c -- Determine the filename.** Use the project's convention (from Phase 0). Save to the campaign's session-reports folder. Create the folder if it does not exist.

**Step 4d -- Update the campaign index.** If the project uses per-campaign indexes, update it. If this is a new campaign, create the index following the project's index conventions. If the project has no index convention, create a simple one and note it for the user.

**Step 4e -- Update the master index (if applicable).** If the project maintains a master session-reports index, update it. Follow the project's ownership conventions for how master indexes link to sub-indexes.

**Step 4f -- Log it (if applicable).** If the project maintains a change log, append an entry following its format.

**Step 4g -- Present to user.** Share a link to the report and give a one-sentence summary. Do not lecture the user about what is in the file.

## Tone and voice

The session report is a working document, not lore prose. It should be **clear, specific, and scannable** -- closer to a well-kept case file than to an in-world chronicle. Third person past tense. Bullet points inside structured sections, prose paragraphs in the narrative recap.

Apply any additional writing style rules from the project's CLAUDE.md.

## Things to never do

- **Never skip Phase 3.** The deep lore analysis is the point of this skill. If the user is in a hurry, offer a shortened analysis rather than skipping.
- **Never invent content.** If you do not know something and could not extract it from the user, either ask or leave a placeholder. Fabricating session events into canon is the worst possible failure mode.
- **Never update lore articles themselves.** That is the chronicler skill's job. You write the report, list lore candidates, flag contradictions -- you do not edit character/location/faction articles.
- **Never ask the user more than ~4 questions per AskUserQuestion call.** Batch tight.
- **Never create unnecessary auxiliary files.** The skill produces: the session report, the campaign index (if new or updated), and the master index (if applicable). No scratch files, execution logs, or manifests.

## How this skill connects to the others

- **Outputs:** A session report that `prep`, `content`, and `chronicler` all read as input.
- **Spawns:** The `lore` agent at the end of Phase 3 for independent KB cross-referencing.
- **Handoff to `prep`:** After the report is written, suggest the user run `prep` to plan the next session.
- **Handoff to `chronicler`:** The Lore Candidates section (and the lore agent's proposal, if available) are the inputs the `chronicler` skill uses to propose and execute KB updates.
