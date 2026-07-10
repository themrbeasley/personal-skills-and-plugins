---
name: debrief
description: "Interactive D&D session debrief workflow that turns a just-played session into a structured session report, then hands off to the lore agent for KB cross-referencing. Use this skill whenever the user signals a recent game session is being processed: explicit cues like \"debrief me\", \"write up last night's session\", \"session report\", \"let's do a debrief\", or narrative cues like \"so last session the party...\", \"we just finished a session\", \"the party did X last night\". Also trigger when the user names a specific ongoing campaign in a post-play context. This is the entry point to the session pipeline: it feeds prep (next session planning) and chronicler (KB updates), and its output is what the lore agent cross-references against the knowledge base. Every DM-facing follow-up question during interrogation goes through AskUserQuestion, never plain chat text, and interrogation runs in rounds until the DM explicitly ends it, even after a long pasted recap. The skill's last act records pipeline state so the Stop hook can suggest the next step."
---

> **Before you begin:** read `../SHARED-PRINCIPLES.md` and apply its rules throughout this workflow.

# Session Debrief

You are helping a D&D DM turn a just-played session into a structured session report. The report serves two audiences: the DM planning next session, and the `lore` agent that will read the report to cross-reference it against the KB. Both audiences benefit from rich structure, aggressive cross-referencing, and explicit callouts of new canon versus discovered canon.

## First: learn the user's system

Check for `.professor-orb/conventions.json` first. If it exists, it is authoritative for the session report's frontmatter schema, filename suffix, and any structural rules (index parity, wikilink policy) that apply to where you save the report. Read it rather than re-deriving these rules from prose (Principle 9). Note the `type` value it uses for session reports and the matching `filenameSuffixByType` and `frontmatterRequiredFields` entries so the file you write will pass the project's write-time validator hook on the first try.

**If `.professor-orb/conventions.json` is missing,** fall back to reading the project's `CLAUDE.md` (or equivalent instructions file) directly and infer the schema and filename convention from it and from existing reports, the way you would with no conventions file at all.

Either way, `conventions.json` only covers frontmatter, filename, and structural rules. For everything else, read `CLAUDE.md` and the project's existing files:

- **Where session reports live.** Look for a session-reports directory or a documented pattern. If nothing is specified, default to `session-reports/[Campaign-Name]/` at the KB root and confirm with the user.
- **Report body structure.** Check for a report template, or look at existing reports to learn the section headers already in use. If neither exists, build one with the user in Phase 1.
- **Cross-reference format.** Wikilinks, markdown links, plain text: match whatever the project already uses.
- **Writing style rules.** Tone, phrasing, or formatting rules beyond what `conventions.json` encodes (encyclopedia vs. narrative voice, tense, and so on).
- **Content exclusions.** Any tags or categories the project marks off-limits (for example NSFW). If such tags exist, check article frontmatter before reading or citing any unfamiliar article.
- **Index conventions.** How indexes are structured and owned. You will need this when updating the campaign index in Phase 3.

If `CLAUDE.md` points to other reference documents, read those too. The goal is to understand the project's conventions before writing anything.

**If the project has neither a conventions file nor `CLAUDE.md`,** that is fine. Work with what exists (prior reports, folder structure). If nothing exists, ask the user a few foundational questions in Phase 1 and establish conventions as you go.

## The workflow has four phases

Do them in order.

### Phase 1: Intake

Determine the campaign. Most of the time the user names it upfront. If they don't, infer from recent conversation context and confirm with a single AskUserQuestion listing your best guess, any other existing campaigns visible in the session-reports folder, and "New campaign."

Check the session-reports directory to see which campaigns already exist. If the folder doesn't exist yet, that is fine, you will create it in Phase 3.

If it is a new campaign, ask for the campaign's display name in the same question batch.

**If you found no existing reports or templates,** add one more question to this batch asking what structure the DM wants for reports (offer to model it on common patterns, or to keep it simple and iterate). Keep intake to a couple of questions total.

**Invite bulk memory.** Once the campaign is settled, prompt the DM openly: "Walk me through the session, tell it however feels natural, and I'll take notes and interrogate you after." This is bulk memory: a free-form recall dump. It is entirely optional and welcome at any level of completeness, from nothing to an exhaustive play-by-play. While the DM narrates, note who appeared, where they went, what changed in the world, what the PCs did and gained and lost, and any loose threads. Do not interrupt with structured questions during this narration.

**Bulk memory is raw material, not a substitute for interrogation.** No matter how complete the DM's recap is, Phase 2 still runs in full. A thorough recap can narrow what Phase 2 needs to cover, but it can never justify skipping or shortening it.

### Phase 2: Interrogation

This phase is mandatory and every question in it goes through the AskUserQuestion tool. Never substitute a plain-text question in chat for a structured question during interrogation, and never skip this phase because bulk memory in Phase 1 seemed thorough. Always run at least one full round of AskUserQuestion here, regardless of how much the DM already covered.

**What to probe.** Compare what you already know from intake against this checklist, and only ask about gaps:

1. **Session metadata.** IRL session date. In-game date and passage of time. Session title (offer 2-3 suggestions, let them pick or write their own).
2. **Players and PCs present.** Which PCs were at the table, which players were absent, how absent PCs were handled.
3. **NPCs and factions touched.** For each major NPC: did status, disposition, or circumstances change? For each faction: shifts in power, relationships, or perception?
4. **Locations visited.** New locations that need articles? Changes to existing locations?
5. **Notable inventory updates.** Items gained, lost, destroyed, transformed. Magic items identified. Consumables used that matter narratively.
6. **Lore revelations, split into two buckets.** New canon established (things the DM invented or decided at the table that are now true) versus canon discovered (things the PCs learned that were already true).
7. **Cliffhangers and open threads.** What is unresolved? What was foreshadowed? What has changed in the world that the party does not yet know about?

**Round discipline.** Batch questions 2-4 per AskUserQuestion call. Do not ask about anything already answered in intake or a prior round. Do not ask filler.

**The DM ends interrogation, not you.** Every round's batch must include an explicit option letting the DM stop: something like "Done, write the report" alongside "Keep going." Do not decide on your own that you have enough and move to Phase 3; keep running rounds until the DM picks the option to stop. If you genuinely have no more gaps to probe, say so and offer the same explicit choice rather than silently ending the phase.

**Track entities as you go.** Throughout intake and interrogation, keep a running list of every named NPC, faction, location, item, species, and cosmological concept touched in the session. You will pass this list to the `lore` agent in Phase 4.

### Phase 3: Report writing

**Draft the report.** If the project has a report template, use it. If it has existing reports, match their structure. If neither exists, build one covering: metadata, narrative recap, PCs present, NPCs and factions, locations, inventory, lore revelations (new canon and discovered canon), and open threads. The open threads section describes the state of the world, not a list of tasks for the DM. Fill every section; for sections with nothing to report, write a stub rather than omitting it, downstream skills need predictable structure.

Cross-reference aggressively using whatever link format the project uses. If unsure whether an article exists, still link it: dead links in reports are acceptable because downstream tools use them to identify article candidates.

**Present the draft for review.** Show the complete report draft to the DM. Wait for approval, requested changes, or rejection (Principle 2). Do not write any files until the DM approves. If the DM requests changes, revise and re-present the affected sections.

**Determine the filename and frontmatter.** Follow `conventions.json` if it exists (the `type` value for session reports, its required frontmatter fields in order, and its filename suffix), otherwise the project's documented convention, otherwise `YYYY-MM-DD-[Session-Title]-REPORT.md`. Save to the campaign's session-reports folder, creating it if it does not exist. Writing the file goes through the project's write-time validator hook automatically; if it reports a block violation, fix the write and retry rather than working around it.

**Update the campaign index.** If the project uses per-campaign indexes, update it. If this is a new campaign, create the index following the project's index conventions. If none exists, create a simple one and note it for the DM.

**Update the master index and log, if applicable.** If the project maintains a master session-reports index, update it following the project's ownership conventions. If it maintains a change log, append an entry following its format.

Do not proceed to Phase 4 until the report file exists on disk.

### Phase 4: Lore agent handoff

Once the report is written, spawn the `lore` agent with fan-out instructions:

- Pass the report's file path and the full entity list you tracked in Phases 1 and 2.
- Instruct the agent to fan out: one subagent per entity touched in the session, each subagent reading only the session report and that entity's KB article(s). The lore agent fans out per entity when the session touched three or more entities; smaller sessions are analyzed directly.
- The parent `lore` agent merges the subagents' findings into a single structured proposal: non-obvious connections, contradictions, lore candidates, and entities without articles.

Wait for the `lore` agent to return its findings. Present a summary to the DM (not a raw dump) and point them at the full proposal above in this conversation (the chronicler skill re-derives and persists it when it runs), and tell them the `chronicler` skill is what actually canonizes any of it into the KB.

If the `lore` agent is unavailable or the DM declines the handoff, note that the report was written without a lore cross-reference and move on. Do not attempt the deep KB cross-referencing yourself; that is the `lore` agent's job.

**Present the report to the DM.** Share a link to the report file and a one-sentence summary. Do not lecture the user about what is in the file.

## Final act: update pipeline state

After everything else in this workflow has succeeded, the very last thing you do is write `.professor-orb/pipeline-state.json`:

```json
{
  "lastStep": "debrief",
  "sessionDate": "<the in-game or real session date being debriefed, YYYY-MM-DD>",
  "updatedAt": "<current UTC time, ISO 8601>"
}
```

Use the session date gathered in Phase 2's metadata question. `updatedAt` must be the current time at the moment you write this file; the Stop hook ignores state older than two hours.

**If `.professor-orb/` does not exist** (setup never ran for this project), skip this step silently. Do not create the directory yourself, that is the setup skill's job.

## Tone and voice

The session report is a working document, not lore prose. It should be clear, specific, and scannable: closer to a well-kept case file than to an in-world chronicle. Third person past tense. Bullet points inside structured sections, prose paragraphs in the narrative recap.

Apply any additional writing style rules from `conventions.json` or the project's `CLAUDE.md`.

## Things to never do

- **Never skip or shorten interrogation because of bulk memory.** A thorough recap in Phase 1 changes what Phase 2 asks about, never whether Phase 2 runs.
- **Never ask a structured question outside AskUserQuestion during interrogation.** Plain-text questions in chat are not a substitute.
- **Never end interrogation on your own judgment.** Only the DM's explicit "done" choice ends the phase.
- **Never invent content.** If you do not know something and could not extract it from the DM, either ask or leave a placeholder. Fabricating session events into canon is the worst possible failure mode.
- **Never update lore articles yourself.** That is the `chronicler` skill's job, working from the `lore` agent's proposal. You write the report and hand off, you do not edit character, location, or faction articles.
- **Never ask the user more than about four questions per AskUserQuestion call.** Batch tight.
- **Never create unnecessary auxiliary files.** This skill produces: the session report, the campaign index (if new or updated), and the master index (if applicable). No scratch files, execution logs, or manifests.

## How this skill connects to the others

- **Position in the session pipeline:** debrief, then prep, then content and/or chronicler, then the `kb-validator` agent.
- **Outputs:** A session report that `prep`, `content`, and `chronicler` all read as input.
- **Spawns:** The `lore` agent at the start of Phase 4 for KB cross-referencing, fanned out per entity.
- **Handoff to `prep`:** After the report is written, suggest the DM run `prep` to plan the next session.
- **Handoff to `chronicler`:** The `lore` agent's proposal is the input the `chronicler` skill uses to propose and execute KB updates.
