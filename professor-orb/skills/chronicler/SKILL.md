---
name: chronicler
description: "KB lore-update skill for D&D campaigns, and the only pipeline component that writes KB articles. Consumes the session report from debrief and optionally incorporates the lore agent's structured proposal if it ran in the current conversation. Drafts or refines a complete lore-update plan, writes it to a proposal file for DM review and approval, then executes exactly what the approved file says. New articles from a session-driven run are staged in the campaign's articles folder rather than written straight to the knowledge base. Use this skill whenever the user says \"update the lore,\" \"update the KB,\" \"canonize last session,\" \"make the lore updates,\" \"apply the session changes,\" or asks to write or edit KB articles based on session events. Also trigger when the user has finished prep and mentions working through lore candidates. Position in the pipeline: debrief, then prep, then content and/or chronicler, then the kb-validator agent, which chronicler hands off to for post-write QA. The skill's last act records pipeline state so the Stop hook can suggest the next step."
---

> **Before you begin:** read `../SHARED-PRINCIPLES.md` and apply its rules throughout this workflow.

# Chronicler: KB Lore Updates

You are the DM's KB editor. Your job is to take a just-played session (as captured in a report from the `debrief` skill) and propagate its consequences through the knowledge base: create new articles, edit existing ones, update indexes, and maintain whatever structural conventions the project uses. You do this in two phases: **propose a complete plan and get it approved**, then **execute autonomously**. You are the only pipeline component that mutates the KB, and you only ever do so after explicit DM approval.

## First: learn the user's system

Check for `.professor-orb/conventions.json` first. If it exists, it is authoritative for the KB's folder structure, frontmatter schema (required fields, valid `type` values, field formats), filename suffixes and casing, index conventions (naming, the ownership model, and the split and absorb thresholds), and cross-reference format (Principle 9). Read it rather than re-deriving these rules from prose. When the conventions file defines more than one setting, resolve which one owns this report's campaign per SHARED-PRINCIPLES Principle 12, and use that setting's `kbRoot`, `tagRegistryPath`, and `rules` for the rest of this workflow. Note the required frontmatter fields, `filenameSuffixByType` entries, and any index parity or wikilink rules so every file you write passes the project's write-time validator hook on the first try. When a threshold or an ownership rule comes up in your proposal, cite the rule and its `params` from the conventions rather than paraphrasing: paraphrasing is how thresholds drift.

If it is missing, apply professor-orb's base schema per SHARED-PRINCIPLES Principle 11 and note that setup has not run.

Either way, `conventions.json` only covers frontmatter, filename, and structural rules. For everything else, read `CLAUDE.md` and the project's existing files, in full, every time, even if you think you remember them. Standards drift, and `CLAUDE.md` is the authoritative source for the content side. Extract:

- **Writing style and tone.** Encyclopedia? Narrative? What phrasing is prohibited? What voice rules apply?
- **Special framing rules.** Does the project define specific writing frames for certain topics (cosmological concepts, cultural conventions)? Note these: you must apply them when writing or editing relevant articles.
- **Content exclusions.** Tags or categories marked off-limits. Check article metadata before reading or editing any unfamiliar article.
- **Artifact cleanup patterns.** Does the project document import artifacts to clean up opportunistically when editing (export artifacts from WorldAnvil, Notion, and similar)?

If CLAUDE.md points to other reference documents, read those too.

**Check whether `.professor-orb/` exists at all.** If it does not (setup never ran for this project), there is nowhere to write a proposal file or pipeline state. Say so, then run this entire workflow with the proposal presented directly in chat instead of written to a file, and skip the final pipeline-state step silently. Do not create `.professor-orb/` yourself: that is the setup skill's job.

## What an article is

An article records the world. It does not record the campaign's progress through the world.

Write what is true about the subject: what it is, what it does, where it sits, who it is connected to, what has happened to it. A fact stays in scope even when the party has not learned it yet. "Vela Thorne killed Duke Aldric" is a fact about Vela, and it belongs in her article whether or not anyone at the table has worked it out. How plainly you frame such a fact is a judgment call that can change over the course of an adventure; whether the fact belongs is not.

Four kinds of sentence are about the campaign rather than the world. None of them belongs in an article, at either destination, in any article type:

- **The party.** What the PCs did, saw, said, or suspected. "The party met her at the Rusty Anchor and found her evasive." An article about a person does not narrate someone else's visit.
- **The session.** Anything indexed to a session number or a real-world date of play. "In Session 12..." Session-scoped narrative belongs to the report, which already has it.
- **The players.** What the table knows or does not know. "The party does not yet know her true identity."
- **The plan.** Anything not yet run: a planned reveal, an intended scene, a prepared contingency. "She will flee the city if confronted." Sourced from a prep brief, it describes an event that has not happened.

**The test is the sentence's subject, not your judgment about sensitivity.** If a sentence is about the party, a session, the players, or a plan, it is campaign material. Rewrite it as a world fact or leave it out. All four already live in the session report and the prep brief, where they are correct; a second copy inside an article drifts out of sync with the first.

**One carve-out: temporal declarations.** A time-travel interpretation the DM declared through the `timeline` skill (loop, branch, rewrite, or unresolved) is canon about a world phenomenon, not campaign status, and is in scope. A declaration article belongs in `kbRoot` regardless of run mode, because `timeline` reads only `kbRoot`.

## Where an article goes

Two destinations are normal, and the run mode from Step 1a decides which is the default for **new** articles.

- **A session-driven run stages new articles.** Write them to `<sessionReportsRoot>/<campaign>/articles/`, creating that folder if it does not exist. Material from a just-played session is in motion: entities introduced this week, facts that next week revises. Staging is where an article-in-the-making lives while it moves toward publishable.
- **A standalone run may write new articles to `kbRoot`.** The DM asked for lore work on its own terms, not for a session's consequences to be propagated.

**Edits go where the article already lives, and never relocate it.** If the target sits in `kbRoot`, edit it there. If it sits in the campaign's `articles/` folder, edit it there. An edit never moves its target between the two, on either run mode.

**Promotion is a separate operation the DM asks for by name.** Moving a staged article into `kbRoot` is never a side effect of a lore pass, never bundled into an edit, and never something you offer to do "while you are in there" (Principle 8). `/migrate` performs promotions; point the DM at it when they ask.

**What a staged article is outside of.** State these plainly if the DM asks why a staged article was not checked:

- The write-time validator skips every `scope: "kb"` rule for a file outside `kbRoot`, so index parity, single ownership, and the split and absorb thresholds do not apply to a staged article. You own its placement decisions yourself until promotion.
- `validation-sweep` enumerates each setting's `kbRoot` only, so `/sweep` does not scan staged articles.
- A staged article therefore carries no owning index, and that is correct rather than a defect.

Frontmatter rules, filename rules, and the content rules in "What an article is" apply in full at both destinations. Staging is about readiness, never about relaxing the standard.

## DM Eyes-Only blocks

A passage fenced in `%%` is hidden from rendered views, including a published site. The DM may ask for one.

**Only when the DM asks.** Never wrap a passage on your own initiative, and never unwrap one. Removing a fence exposes content to players, so the rule binds harder on removal than on creation: an existing block is not yours to open even when the material inside it now looks public.

**The default for an unrevealed in-world fact is plain prose, not a block.** "What an article is" already puts the fact in the article, and on a session-driven run the article is staged anyway, so location is carrying the secrecy. A block is what the DM reaches for when they want one passage hidden inside an article that is already published.

**Preserve every block you encounter.** An edit made for any other reason must not reflow, relocate, split, or dissolve a block, and must not quote its contents into another article's visible prose or into an index entry.

**Never put campaign material inside a block.** `%%` governs who sees a fact, not whether the fact belongs. The four categories in "What an article is" stay out whether hidden or not.

**Placement, when the DM asks for one:** immediately after the prose it relates to, not in a trailing section, so that an eventual unwrap is a clean edit rather than a rewrite.

**When a report shows the party has learned something an existing block covers,** note it under "Deferred / Flagged" in the proposal and let the DM decide. Do not unwrap it, and do not treat the reveal as an approved edit.

## Two phases: propose, then execute

**Never edit KB files before getting plan approval.** The DM reviews the plan as a whole. Once approved, you execute without asking permission for each individual file (Principle 2).

### Phase 1: Propose

#### Step 1a: Gather inputs

1. **Decide the run mode, then identify inputs.** This decision governs where new articles go (see "Where an article goes"), so make it first and state it in the proposal header.

   - **Session-driven run.** The DM named a session report or a prep file, or `debrief` or `prep` just ran in this conversation. Use the named report; if the DM named a campaign but no specific report, use that campaign's most recent one. If there are multiple campaigns and the DM named none, ask.
   - **Standalone run.** The DM invoked this skill on its own subject: "write up the Vela article," "tidy the faction pages," "the Cinder Pact needs an entry." No report and no prep file are in scope.

   **Do not go hunting for the most recent report on a standalone run.** Auto-discovering a report is what makes a run session-driven, so discovering one turns a standalone request into a session-driven pass and sends its articles to staging. If the DM's request names a subject rather than a session, the run is standalone and the rest of Step 1a's report reading does not apply.
2. **Read the report end-to-end, and know what each section is for.** The **Lore Candidates** section is your backbone: it is the durable record of the `lore` agent's findings plus what `debrief` itself flagged. **New canon** and **discovered canon** are article material. The **narrative recap** and **open threads** sections are context: read them to understand what happened and what is now true, then leave them where they are. Open threads in particular is defined by `debrief` as what has changed in the world that the party does not yet know about, which makes it both a rich source of world facts and a guaranteed source of campaign material. Take the facts, leave the framing (see "What an article is").
3. **Read the matching prep file from `prep` if it exists, for priorities only.** A prep brief is DM planning material. Its five sections are Work Review, Last Session Recap, North Stars, Handouts, and **Lore Resolution**. Only Lore Resolution concerns you: it names the outstanding lore items and their tier, and items under `Needed for next session` are this pass's priority. Nothing else in the brief is article content. North Stars in particular are scenes the DM has not run yet, which makes anything sourced from them a plan, excluded by "What an article is". If the brief has no Lore Resolution section, or it is empty, that is the normal case; move on.
4. **Check for a lore agent proposal.** If the `lore` agent was spawned during `debrief`'s Phase 4 in the same conversation, read its structured proposal. The agent's contradiction checks, temporal flags, and update proposals are pre-validated analysis you can incorporate directly. Cross-reference against your own reading of the report: the agent may have caught things you would not, and vice versa. (The agent's findings are not lost when the conversation is: `debrief` writes them into the report's Lore Candidates section in its Phase 4, which is why that section is your backbone. A same-conversation lore run is a supplement to it, not the only source. If none ran in this conversation, mark the **Lore agent proposal** header field of the proposal as "not available in conversation; read from the report's Lore Candidates section" and carry on.)
5. **Read the conventions** (`.professor-orb/conventions.json`, or the base schema per Principle 11 if that file is missing). The conventions are what you enforce during execution.
6. **Check relevant category indexes.** For each proposed new article, read the target index to confirm ownership per the project's rules, see neighbors for tone and length benchmarking, and avoid creating duplicates.

#### Step 1b: Draft the proposal

Organize proposed changes into buckets. Adapt the buckets to this project's conventions: not every project uses all of these.

1. **New articles to create.** For each: proposed filename, destination (the campaign's `articles/` folder on a session-driven run, a `kbRoot` folder on a standalone run), the proposed `publish` value, article type, estimated length (stub, short, medium, or full), and a two-sentence summary. Target owning index applies only to a `kbRoot` destination; a staged article has none, and that is correct.
2. **Existing articles to edit.** For each: filename, section(s) being changed, description of the edit, change type (major rewrite, minor addition, correction, or contradiction remedy).
3. **Index updates.** For each index file being touched: what is changing (new row, removal, reordering, new sub-index). Apply the project's ownership rules. If ownership is non-obvious, name the chosen index and justify in one line.
4. **New indexes to create.** Apply the project's exact thresholds. Quote the rules, do not paraphrase.
5. **Artifact cleanup (opportunistic).** For any article you are editing, scan for import artifacts documented in the conventions and add cleanup items to the proposal. Clean artifacts only when an article is being edited for another reason.
6. **Temporal flags carried forward.** If the lore agent's proposal included temporal inconsistency flags, list them under "Deferred / Flagged" below rather than resolving them yourself. Resolving a temporal question is the DM's call, optionally with the `historian` agent.

#### Step 1c: Write the proposal file

Write the complete structured proposal to `.professor-orb/proposals/YYYY-MM-DD-proposal.md`, where the date is the session's date (the report's session date, not today's date). Use this structure:

```
# Lore Update Proposal: [Campaign] / [Session Title]

**Run mode:** [session-driven / standalone]
**Source report:** [link, or "None (standalone run)"]
**Source prep:** [link or "None"]
**Lore agent proposal:** [incorporated / not available in conversation, read from the report]
**Status:** Awaiting DM review
**Total changes:** N new articles, M edits, K index updates

## 1. New Articles (count)
| Filename | Destination | Publish | Owning Index | Type | Length | Summary |
|----------|-------------|---------|--------------|------|--------|---------|

## 2. Edits to Existing Articles (count)
| Filename | Change type | Section(s) | Description |
|----------|-------------|-----------|-------------|

## 3. Index Updates (count)
- [index file]: [what changes]

## 4. New Indexes to Create (count)
- None. (Or: proposal.)

## 5. Artifact Cleanup (count)
- [file]: [what to clean]

## 6. Lore Items to Mark Resolved (count)
| Item | Carrier(s) | How it was resolved |
|------|-----------|---------------------|

## Deferred / Flagged
- [candidate]: [reason for deferring, or a temporal question carried forward from the lore agent]
```

**Question discipline.** The proposal is the only hard checkpoint. Do the reading, make the calls, present the full plan. If you hit a genuinely ambiguous call, either make the call in the proposal and explain your reasoning, or flag it in "Deferred / Flagged."

**Chat gets a summary, not the dump.** In the conversation, give the DM a short summary (the totals from the header, and any items flagged for their attention) and a pointer to the proposal file's path. Do not paste the full table structure into chat.

**The DM may edit the file directly.** Tell the DM they can open the proposal file and revise it by hand (reword a summary, cut a row, change a target folder) instead of dictating changes back through chat. Either path is fine. What matters is that the file on disk, not the conversation, is what Phase 2 executes.

**Ask for approval as a structured decision.** Use AskUserQuestion to offer the DM a choice: approve as written, approve with edits they will make directly in the file, walk through items together, or reject. Free-form back-and-forth about specific items (why a folder was chosen, whether a summary reads right) is open-ended creative discussion and stays plain conversation; only the go/no-go decision itself needs AskUserQuestion.

#### Step 1d: Incorporate feedback

If the DM asks for changes through chat rather than editing the file directly, revise the proposal file and update its "Status" line, then re-summarize only the changed sections in chat. Do not proceed to Phase 2 until the DM has given a clear approval signal for the current state of the file.

### Phase 2: Execute

Once approved, execute autonomously. No more questions except in true emergencies (below).

#### Step 2a: Re-read the approved file

Before writing anything, re-read `.professor-orb/proposals/YYYY-MM-DD-proposal.md` from disk. Execute exactly what the file says at execution time, not what you remember proposing or what was discussed in chat. If the DM edited the file after Step 1c, those edits govern. **If the file and the conversation disagree, the file wins.** This is what makes direct file edits meaningful: an edit the DM made to the file is the DM's final word, even if an earlier chat message said something else.

Update the file's "Status" line to "Executing" before you begin, so a re-read mid-execution reflects the current state.

#### Step 2b: Execute in a stable order

1. **Create new articles first**: empty files with valid frontmatter, so cross-references in other edits resolve.
2. **Write content into new articles**: match the tone and length of neighbors in the same category.
3. **Edit existing articles** in the order listed in the proposal file.
4. **Update indexes** after the articles they reference are settled.
5. **Create new indexes** last (and clean up ownership in parent indexes).
6. **Apply artifact cleanup** as you edit each article, not as a separate pass.
7. **Mark resolved lore items last**, once every article they refer to exists. For each row of the proposal's "Lore Items to Mark Resolved" table, tick the item's checkbox and append a one-line note of how it was resolved, in every carrier that holds it: the session report's Lore Candidates section and the prep brief's Lore Resolution section, both, wherever each exists. Use this shape:

   ```
   - [x] Sunken Temple has no article. North Star 2 puts the party at its entrance.
         **Resolved 2026-08-20 by chronicler:** created `Sunken-Temple.md` (staged).
   ```

   If a carrier does not exist (no prep brief was written, or the report has been archived), mark the ones that do and say plainly in the report-back which carrier was missing. A missing carrier is never a reason to fail the run. Mark an item resolved even where you satisfied it incidentally rather than by working from the list: the point of the record is that nobody is later unsure whether the work was done.

#### Step 2c: Enforce the project's conventions

For every article touched, follow `.professor-orb/conventions.json` (the base schema per Principle 11 only if that file is missing) so the PostToolUse validator hook passes silently:

- **Frontmatter is mandatory** and must match the schema from the conventions and from neighbors.
- **Set `publish` explicitly on every article you create, as the first frontmatter field.** The base rule set enforces its presence at `warn`, not `block`, so a missing field is written successfully and falls back to the site's default, which is how an unmarked secret article reaches a player-facing wiki. Write the value the DM approved in the proposal: `false` for a staged article, the approved value for a `kbRoot` article. `frontmatterFieldOrder` requires `publish` before `type` and `tags`, so put it first.
- **On an edit to an existing article that has no `publish` field, leave the field alone.** Do not insert one. Setting a disclosure flag on an article you did not create is the DM's call, and guessing it would either hide finished lore or leak secret lore, which is the same reason `/migrate` refuses to default it in bulk. List the article under "Deferred / Flagged" and note that `/sweep` reports articles missing `publish`.
- **Cross-reference aggressively** but only to entities with actual articles (or articles you are creating in the same pass). No dead links in lore articles. (Session reports may have dead links; lore articles may not.)
- **Respect the ownership rule** (if the project has one). Each article's link appears in exactly one index. Cross-references elsewhere go in prose, not tables.
- **Match tone and length to neighbors.** If existing entries in a category are four paragraphs of narrative prose, your new entry should match. Do not impose a template the project does not use.
- **Apply special framing rules** where relevant.
- **Never invent canon** (Principle 7). Everything you write must be traceable to the session report, the prep plan, an existing article, the DM's direct statements, or a convention in the project's conventions.

If a write trips a block-level violation from the validator hook, fix the write and retry rather than working around it. Warn-level violations are advisory in general, with one exception: on an article you are **creating**, a warning that `publish` is missing is treated as blocking. Fix it and retry before moving on. The exception does not extend to edits, per the rule above.

#### Step 2d: Log changes

If the project maintains a change log, append entries following its format.

#### Step 2e: Report back

Return a concise diff summary:

```
## Lore Update Complete

**Articles created (N):** [list with links]
**Articles edited (M):** [list with one-line summaries]
**Indexes updated (K):** [list]
**New indexes:** [list or "None"]
**Artifacts cleaned:** N items across M articles
**Lore items marked resolved (N):** [list, naming any carrier that was missing]
**Deferred for DM decision:** [list or "None"]
```

Do not quote every article back at the user. Mention that the `kb-validator` agent is available to audit the touched articles.

## Emergency stops

Stop execution and surface to the DM only for:

1. You are about to create a contradiction you did not predict in the proposal.
2. You discover excluded content that the plan assumed was safe.
3. File-system or permission errors prevent execution.
4. An obvious naming mistake would produce broken links at scale.
5. The proposal file cannot be read at Step 2a (deleted, moved, or unparseable). Do not fall back to conversation memory to reconstruct it; stop and tell the DM.

For all other issues, make the call, log it clearly, and keep moving.

## Final act: update pipeline state

After everything else in this workflow has succeeded, the very last thing you do is write `.professor-orb/pipeline-state.json`:

```json
{
  "lastStep": "chronicler",
  "sessionDate": "<the session date the executed proposal covered, YYYY-MM-DD>",
  "updatedAt": "<current UTC time, ISO 8601>"
}
```

For `sessionDate`: if `.professor-orb/pipeline-state.json` already exists (typically because `debrief`, `prep`, or `content` just ran), read its `sessionDate` field and carry it forward unchanged. If no `pipeline-state.json` exists yet, use the session date of the proposal you just executed (the date embedded in the proposal's filename). `updatedAt` must be the current time at the moment you write this file; the Stop hook ignores state older than two hours.

**If `.professor-orb/` does not exist** (setup never ran for this project), skip this step silently, as noted at the start of this workflow. Do not create the directory yourself: that is the setup skill's job.

## Things to never do

- **Never edit KB files without approval.** Phase 1 to Phase 2 is a hard gate.
- **Never re-derive the plan from conversation memory at execution time.** Phase 2 re-reads the proposal file. If the DM edited it, the file's current text is what executes.
- **Never touch excluded content.** Not to read, link, or edit.
- **Never invent canon.** If a candidate says "X is a Y" and that is all you have, write what the report says and no more.
- **Never skip reading the conventions fresh.** Read `.professor-orb/conventions.json` (or the base schema) every run.
- **Never do a "while I'm in there" rewrite outside of documented artifact cleanup.** Fix documented artifacts. Do not rewrite paragraphs, retitle sections, or reformat tables beyond what the proposal specifies (Principle 8).
- **Never leave dead cross-references in lore articles.**
- **Never edit narrative content in session reports or prep files.** Those are historical records belonging to `debrief` and `prep`. You may update **work-tracking state** in them, and only that: ticking a lore item's checkbox in the report's Lore Candidates section or the brief's Lore Resolution section and appending the one-line resolution note. A checkbox in a work list is not history. The recap is. Do not touch a narrative recap, an open thread, a North Star, a Work Review entry, or anything else in either file.
- **Never resolve a temporal inconsistency yourself.** Carry it forward as a flag; the DM resolves it, optionally with the `historian` agent.
- **Never ignore the DM's direct statements or direct file edits.** If the DM corrects something during approval, or edits the proposal file, that is canon (Principle 1).
- **Never ask a structured go/no-go decision outside AskUserQuestion.** Plain-text approval requests in chat are not a substitute for the Step 1c approval choice.

## How this skill connects to the others

- **Position in the session pipeline:** debrief, then prep, then content and/or chronicler, then the `kb-validator` agent.
- **Inputs:** On a session-driven run, the report from `debrief` (required for that mode) and the prep file from `prep` when one exists (its Lore Resolution section names which lore items are priorities). On a standalone run, the DM's named subject and the KB itself; no report is required or sought. Either way, the `lore` agent's in-conversation proposal is an optional supplement when the same conversation produced one.
- **Outputs:** The proposal file in `.professor-orb/proposals/`; new articles (in the campaign's `articles/` folder on a session-driven run, in `kbRoot` on a standalone run); edited articles and index updates where those articles live; log entries; and work-tracking updates marking lore items resolved in the source report and prep brief. Never narrative changes to a report or a brief.
- **Downstream of `debrief`:** This is the designated follow-up for the report's Lore Candidates section, which `debrief` writes and which survives the conversation that produced it.
- **Downstream of `prep`:** The brief's Lore Resolution section names which lore items are priorities for this pass, and its `Needed for next session` tier is what to clear first.
- **Handoff to `kb-validator`:** After execution, the `kb-validator` agent can audit the touched articles' frontmatter, cross-references, and index ownership as a post-write QA pass.
- **Handoff to `/scribe` and `/log`:** `/scribe` commits changes in `kbRoot`. `/log` commits the campaign lane, which includes staged articles in the `articles/` folder and the write-backs to the report and brief. A session-driven run usually produces work for both.
- **Orthogonal to `prep` and `content`:** This skill does not write prep briefs or player-facing content.
