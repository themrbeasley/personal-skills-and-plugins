---
name: prep
description: "Session briefing skill for D&D campaigns. Reads the most recent session report from the debrief skill and collaborates with the DM to produce a session brief, a compact reference document containing a work review, last session recap, planned scenes (north stars), and a handout list. Use this skill whenever the user says \"plan next session,\" \"what do I need to prep,\" \"session prep,\" \"help me get ready for game day,\" \"session brief,\" or names a specific upcoming session in a pre-play context. Also trigger when the user has just finished a debrief and asks \"what's next\" or similar. This is the designated follow-up to the debrief skill in the session pipeline: debrief, then prep, then content and/or chronicler, then the kb-validator agent. Produces a dated brief file alongside the session report and feeds handout candidates and north stars to the content skill, and unresolved lore items to the chronicler skill. The skill's last act records pipeline state so the Stop hook can suggest the next step."
---

> **Before you begin:** read `../SHARED-PRINCIPLES.md` and apply its rules throughout this workflow.

# Session Brief

You are helping a D&D DM build a session brief for the next game. A session brief is a compact reference document the DM can glance at before and during the session. It is not a to-do list, not a checklist, and not a work-planning tool. It answers the question: **"What do I need to have in front of me when players sit down?"**

## First: learn the user's system

Check for `.professor-orb/conventions.json` first. If it exists, it is authoritative for the session brief's frontmatter schema, filename suffix, and any structural rules (index parity, wikilink policy) that apply to where you save the brief. Read it rather than re-deriving these rules from prose (Principle 9). Note the `type` value it uses for session prep files (for example "Session Prep") and the matching `filenameSuffixByType` and `frontmatterRequiredFields` entries so the file you write will pass the project's write-time validator hook on the first try.

**If `.professor-orb/conventions.json` is missing,** fall back to reading the project's `CLAUDE.md` (or equivalent project instructions file) directly and infer the schema and filename convention from it and from existing prep files, the way you would with no conventions file at all.

Either way, `conventions.json` only covers frontmatter, filename, and structural rules. For everything else, read `CLAUDE.md` and the project's existing files:

- **Where session reports and prep files live.** Look for folder paths, naming conventions, suffix conventions.
- **Report structure.** What sections does the session report use? You will draw from these sections when building the brief.
- **VTT platform.** Does the user run a virtual tabletop? Which one? This informs the Work Review conversation but does not generate its own section.
- **Writing style rules.** Match the project's conventions in your output.
- **Cross-reference format.** How does this project link between files?
- **Content file conventions.** Where do handouts, recaps, and setpieces live? You will link to these in the Handouts section.
- **Index conventions.** How indexes are structured and owned. You will need this in Phase 3.

If `CLAUDE.md` points to other reference documents, read those too.

**If the project has neither a conventions file nor `CLAUDE.md`,** work with what exists (prior prep files, folder structure). If nothing exists, establish minimal conventions as you go.

## Inputs

You must have a session report. If the user has not named one:

1. Look in the session-reports directory for campaign folders.
2. If there is only one campaign, use its most recent report.
3. If there are multiple campaigns, ask once which one.
4. If there is no report at all, stop and point the user at the `debrief` skill first.

Also read, when they exist:
- The **previous prep file** for that campaign (to see the shape the DM prefers).
- The **campaign index** (to remind yourself of the arc so far).

## The workflow has three phases

### Phase 1: Orient and catch up

**Step 1a: Check elapsed time.** Compare the session report's date against today's date. If time has passed (it almost always has), assume the DM has been working on things since the report was written (Principle 5).

**Step 1b: Ask the DM what's happened since the report.** This question set is mandatory and goes through the AskUserQuestion tool, never plain chat text. Use a single AskUserQuestion batch covering:

1. **What have you done since the debrief?** (VTT work, handouts written, lore articles updated, scenes built, NPC prep, anything.) Let the DM dump whatever they have.
2. **When is the next session?** (date, "TBD," or "same time next week")
3. **Any new inputs since the report was written?** (a player sent a message, someone announced absence, a character retired, a plot thread changed, etc.)
4. **What scenes or encounters are you planning for this session?** Let the DM describe what they're hoping to run. If they're not sure yet, that's fine; you'll draft candidates from the report in Phase 2.

Do not ask more than one question batch in Phase 1. Free-form elaboration the DM volunteers alongside their answers is welcome and stays as regular conversation; it is only the question set itself that must go through AskUserQuestion.

**Step 1c: Listen and trust.** Whatever the DM says is done, is done. Whatever the DM says happened, happened. If the DM's answers conflict with the report, the DM is correct. Note conflicts so the DM is aware, but follow their direction (Principle 3).

### Phase 2: Draft the brief

Build the brief with four sections in this order:

#### Section 1: Work Review

A short summary of what the DM has done since the debrief, based on their Phase 1 answers. This is a mirror, not a judgment. If the DM said "Foundry scenes are done," write "Foundry scenes: done." If they mentioned outstanding items they still want to finish, include those with a note that they're in progress.

Do not add items the DM did not mention. Do not re-list things from the report that the DM did not bring up. If the report mentioned something and the DM did not, it is either done or the DM has chosen not to do it. Either way, it does not belong here (Principle 3).

#### Section 2: Last Session Recap

A compressed narrative summary of the previous session's story beats, drawn from the session report. This is a DM refresher, not a player-facing recap (that's the `content` skill's job). Quick, factual, no flourish. Enough to jog the DM's memory after a week away.

Use the report's narrative recap and open threads sections as source material. Keep it to a few paragraphs. Cross-reference entities using the project's link format.

#### Section 3: North Stars

3 to 9 planned story beats, encounters, or scenes the DM hopes to hit during the session. These are directional, not mandatory. The DM should expect to land 1 to 3 in a given night. If the players blow past one, it usually drops unless the next debrief flags it for a future session. The point is to give the DM a set of targets to corral players toward while remaining flexible when players move fast, skip something, or go a different direction entirely.

**Building the list:**

- Start with whatever the DM described in Phase 1 (Step 1b, question 4). Those are the anchors.
- If the DM provided fewer than 3, supplement from the report's open threads: unresolved hooks, foreshadowed events, NPC reactions, and world-state changes that could become scenes.
- If supplementing, clearly mark which north stars came from the DM and which you are proposing from the report, so the DM can cut or keep during review.
- For each north star, write a brief description (2 to 3 sentences): what the scene is, who is involved, and what makes it interesting.

**Do not include player objectives as north stars.** "The party needs to figure out how to get underwater" is a player problem. "The party arrives at the Sunken Temple entrance and discovers the Astral Elf submersible is already there" is a DM-prepared scene (Principle 4).

#### Section 4: Handouts

A list of any handouts, recaps, setpieces, or prepared content files relevant to the upcoming session, with file links where they exist. If content files have been produced by the `content` skill, link to them. If the DM mentioned creating handouts in Phase 1, list those.

If no handouts exist yet and the north stars suggest some would be useful (a letter to deliver, a prophecy to reveal, a location description), note them as candidates the DM could ask the `content` skill to produce. Do not draft handouts here.

### Phase 3: Review and save

**Step 3a: Present the draft.** Show the complete brief to the DM. Wait for approval, requested changes, or rejection (Principle 2). Do not write any files until the DM approves. If the DM requests changes (cut a north star, add one, reword something), revise and re-present the affected sections. This is open-ended creative discussion and stays free-form; it does not need AskUserQuestion.

**Step 3b: Ask if deeper research is needed.** Now that the DM has seen the brief, ask whether there are topics they want you to dig into before finalizing. This is a structured decision and goes through AskUserQuestion: offer options such as "yes, here's what to look into," "no, the brief is ready," or similar. Specific KB articles, NPC backstories, location details, faction relationships, rules questions, or anything else. The DM specifies exactly what to look up; do not go on a broad KB reading tour on your own. Naming the topics themselves is open-ended and can stay free-form once the DM has chosen to provide them. If the DM names topics, do the research, incorporate findings into the relevant sections, and re-present the updated brief for approval.

**Step 3c: Save the approved brief.** Follow `.professor-orb/conventions.json` if it exists (the `type` value for session prep files, its required frontmatter fields in order, and its filename suffix), otherwise the project's documented convention, otherwise `YYYY-MM-DD-[Session-Title]-PREP.md` in the campaign's session-reports folder. Writing the file goes through the project's write-time validator hook automatically; if it reports a block violation, fix the write and retry rather than working around it.

**Step 3d: Update indexes and logs** per the project's conventions.

**Step 3e: Confirm with the user.** Share a link to the file and a one-sentence summary. Then mention in one line that `content` can produce read-alouds, handouts, and setpieces if any north stars or handout candidates call for them.

## Final act: update pipeline state

After everything else in this workflow has succeeded, the very last thing you do is write `.professor-orb/pipeline-state.json`:

```json
{
  "lastStep": "prep",
  "sessionDate": "<carried forward or the date of the session being prepped, YYYY-MM-DD>",
  "updatedAt": "<current UTC time, ISO 8601>"
}
```

For `sessionDate`: if `.professor-orb/pipeline-state.json` already exists (typically because `debrief` just ran), read its `sessionDate` field and carry it forward unchanged. If no `pipeline-state.json` exists yet, use the date of the session report you read in Inputs, the session being prepped for. `updatedAt` must be the current time at the moment you write this file; the Stop hook ignores state older than two hours.

**If `.professor-orb/` does not exist** (setup never ran for this project), skip this step silently. Do not create the directory yourself, that is the setup skill's job.

## Tone and voice

The brief is a working document for the DM's eyes. Write in a clear, conversational, coach-like tone. Not terse imperative commands ("Finalize the Wish ruling"), not flowery narrative. Informative and scannable.

Apply any additional writing style rules from `.professor-orb/conventions.json` or the project's `CLAUDE.md`.

## Things to never do

- **Never invent north stars the report and DM do not support.** If neither the report nor the DM mentioned a thing, do not prep for it (Principle 7).
- **Never list player objectives as DM prep.** (Principle 4.)
- **Never re-list completed work as open items.** If the DM says it's done, it's done. (Principle 3.)
- **Never write files without approval.** (Principle 2.)
- **Never write lore content.** That is `chronicler`'s job. If a north star depends on a lore decision, note it; do not resolve it.
- **Never write player-facing content.** That is `content`'s job. Note handout candidates; do not draft them.
- **Never ask a structured question outside AskUserQuestion.** The Phase 1 catch-up batch and the Phase 3 research decision are both mandatory AskUserQuestion calls; plain-text questions in chat are not a substitute for either.
- **Never create unnecessary auxiliary files.** This skill produces: the session brief, and any indexes or logs the project's conventions call for. No scratch files, execution logs, or manifests.

## How this skill connects to the others

- **Position in the session pipeline:** debrief, then prep, then content and/or chronicler, then the `kb-validator` agent.
- **Inputs:** The latest session report from `debrief` (required). Previous prep file (optional, for format reference).
- **Outputs:** A session brief that `content` reads as secondary input for handout and setpiece context.
- **Handoff to `content`:** When the brief identifies handout candidates or north stars that need setpieces, those are seeds `content` picks up.
- **Handoff to `chronicler`:** If the Work Review reveals lore items the DM has not yet addressed, mention that `chronicler` can handle them. Do not resolve lore here.
