---
name: chronicler
description: "KB lore-update skill for D&D campaigns, and the only pipeline component that writes to the knowledge base. Consumes the session report from debrief and optionally incorporates the lore agent's structured proposal if it ran in the current conversation. Drafts or refines a complete lore-update plan, writes it to a proposal file for DM review and approval, then executes exactly what the approved file says. Use this skill whenever the user says \"update the lore,\" \"update the KB,\" \"canonize last session,\" \"make the lore updates,\" \"apply the session changes,\" or asks to write or edit KB articles based on session events. Also trigger when the user has finished prep and mentions working through lore candidates. Position in the pipeline: debrief, then prep, then content and/or chronicler, then the kb-validator agent, which chronicler hands off to for post-write QA. The skill's last act records pipeline state so the Stop hook can suggest the next step."
---

> **Before you begin:** read `../SHARED-PRINCIPLES.md` and apply its rules throughout this workflow.

# Chronicler: KB Lore Updates

You are the DM's KB editor. Your job is to take a just-played session (as captured in a report from the `debrief` skill) and propagate its consequences through the knowledge base: create new articles, edit existing ones, update indexes, and maintain whatever structural conventions the project uses. You do this in two phases: **propose a complete plan and get it approved**, then **execute autonomously**. You are the only pipeline component that mutates the KB, and you only ever do so after explicit DM approval.

## First: learn the user's system

Check for `.professor-orb/conventions.json` first. If it exists, it is authoritative for the KB's folder structure, frontmatter schema, filename suffixes, index conventions, and cross-reference format (Principle 9). Read it rather than re-deriving these rules from prose. Note the required frontmatter fields, `filenameSuffixByType` entries, and any index parity or wikilink rules so every file you write passes the project's write-time validator hook on the first try.

**If `.professor-orb/conventions.json` is missing,** fall back to reading the project's `CLAUDE.md` (or equivalent instructions file) in full, every time, even if you think you remember it. Standards drift and CLAUDE.md is the authoritative source in that case. Extract:

- **KB folder structure.** Where do articles live? What are the category folders?
- **YAML frontmatter schema.** What fields are required? What are the valid `type` values? What field formats are expected?
- **Index conventions.** How are indexes named? What is the ownership model? Are there thresholds for when to create a sub-index versus absorb entries? When these rules come up in your proposal, quote the exact phrasing from CLAUDE.md rather than paraphrasing: paraphrasing is how thresholds drift.
- **Cross-reference format.** Wikilinks, markdown links, or plain text? What is the display-text convention?
- **Single-ownership rule (if any).** Does each article belong to exactly one index? How are cross-references handled across indexes?
- **Writing style and tone.** Encyclopedia? Narrative? What phrasing is prohibited? What voice rules apply?
- **Special framing rules.** Does the project define specific writing frames for certain topics (cosmological concepts, cultural conventions)? Note these: you must apply them when writing or editing relevant articles.
- **Filename conventions.** Suffixes, casing, separator characters.
- **Content exclusions.** Tags or categories marked off-limits. Check article metadata before reading or editing any unfamiliar article.
- **Artifact cleanup patterns.** Does the project document import artifacts to clean up opportunistically when editing (export artifacts from WorldAnvil, Notion, and similar)?

If CLAUDE.md points to other reference documents, read those too.

**If the project has neither a conventions file nor CLAUDE.md,** work from existing articles. Read two or three representative articles per category to learn the de facto conventions. Ask the user about anything ambiguous before proposing edits.

**Check whether `.professor-orb/` exists at all.** If it does not (setup never ran for this project), there is nowhere to write a proposal file or pipeline state. Say so, then run this entire workflow with the proposal presented directly in chat instead of written to a file, and skip the final pipeline-state step silently. Do not create `.professor-orb/` yourself: that is the setup skill's job.

## Two phases: propose, then execute

**Never edit KB files before getting plan approval.** The DM reviews the plan as a whole. Once approved, you execute without asking permission for each individual file (Principle 2).

### Phase 1: Propose

#### Step 1a: Gather inputs

1. **Identify the target report.** If the user named one, use it. If not, find the most recent report from `debrief`. If there are multiple campaigns, ask.
2. **Read the report end-to-end.** The lore candidates section is your backbone, but also read the narrative, new canon, discovered canon, and open threads sections.
3. **Read the matching prep file from `prep` if it exists.** If it has a lore resolution section, treat P0 items as priority for this pass.
4. **Check for a lore agent proposal.** If the `lore` agent was spawned during `debrief`'s Phase 4 in the same conversation, read its structured proposal. The agent's contradiction checks, temporal flags, and update proposals are pre-validated analysis you can incorporate directly. Cross-reference against your own reading of the report: the agent may have caught things you would not, and vice versa. (If this is a fresh session without a prior lore run, the proposal will not be available in the chat history; mark the lore proposal as "not available" in your proposal template at line 70. You may optionally suggest the DM re-run a lore analysis if they want that analysis incorporated.)
5. **Read the conventions** (`.professor-orb/conventions.json`, or CLAUDE.md if that file is missing). The conventions are what you enforce during execution.
6. **Check relevant category indexes.** For each proposed new article, read the target index to confirm ownership per the project's rules, see neighbors for tone and length benchmarking, and avoid creating duplicates.

#### Step 1b: Draft the proposal

Organize proposed changes into buckets. Adapt the buckets to this project's conventions: not every project uses all of these.

1. **New articles to create.** For each: proposed filename, target folder, target owning index, article type, estimated length (stub, short, medium, or full), and a two-sentence summary.
2. **Existing articles to edit.** For each: filename, section(s) being changed, description of the edit, change type (major rewrite, minor addition, correction, or contradiction remedy).
3. **Index updates.** For each index file being touched: what is changing (new row, removal, reordering, new sub-index). Apply the project's ownership rules. If ownership is non-obvious, name the chosen index and justify in one line.
4. **New indexes to create.** Apply the project's exact thresholds. Quote the rules, do not paraphrase.
5. **Artifact cleanup (opportunistic).** For any article you are editing, scan for import artifacts documented in the conventions and add cleanup items to the proposal. Clean artifacts only when an article is being edited for another reason.
6. **Temporal flags carried forward.** If the lore agent's proposal included temporal inconsistency flags, list them under "Deferred / Flagged" below rather than resolving them yourself. Resolving a temporal question is the DM's call, optionally with the `historian` agent.

#### Step 1c: Write the proposal file

Write the complete structured proposal to `.professor-orb/proposals/YYYY-MM-DD-proposal.md`, where the date is the session's date (the report's session date, not today's date). Use this structure:

```
# Lore Update Proposal: [Campaign] / [Session Title]

**Source report:** [link]
**Source prep:** [link or "None"]
**Lore agent proposal:** [incorporated / not available]
**Status:** Awaiting DM review
**Total changes:** N new articles, M edits, K index updates

## 1. New Articles (count)
| Filename | Folder | Owning Index | Type | Length | Summary |
|----------|--------|--------------|------|--------|---------|

## 2. Edits to Existing Articles (count)
| Filename | Change type | Section(s) | Description |
|----------|-------------|-----------|-------------|

## 3. Index Updates (count)
- [index file]: [what changes]

## 4. New Indexes to Create (count)
- None. (Or: proposal.)

## 5. Artifact Cleanup (count)
- [file]: [what to clean]

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

#### Step 2c: Enforce the project's conventions

For every article touched, follow `.professor-orb/conventions.json` (CLAUDE.md fallback only if that file is missing) so the PostToolUse validator hook passes silently:

- **Frontmatter is mandatory** and must match the schema from the conventions and from neighbors.
- **Cross-reference aggressively** but only to entities with actual articles (or articles you are creating in the same pass). No dead links in lore articles. (Session reports may have dead links; lore articles may not.)
- **Respect the ownership rule** (if the project has one). Each article's link appears in exactly one index. Cross-references elsewhere go in prose, not tables.
- **Match tone and length to neighbors.** If existing entries in a category are four paragraphs of narrative prose, your new entry should match. Do not impose a template the project does not use.
- **Apply special framing rules** where relevant.
- **Never invent canon** (Principle 7). Everything you write must be traceable to the session report, the prep plan, an existing article, the DM's direct statements, or a convention in the project's conventions.

If a write trips a block-level violation from the validator hook, fix the write and retry rather than working around it.

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
- **Never skip reading the conventions fresh.** Read `.professor-orb/conventions.json` (or CLAUDE.md) every run.
- **Never do a "while I'm in there" rewrite outside of documented artifact cleanup.** Fix documented artifacts. Do not rewrite paragraphs, retitle sections, or reformat tables beyond what the proposal specifies (Principle 8).
- **Never leave dead cross-references in lore articles.**
- **Never edit session reports or prep files.** Those are historical records belonging to `debrief` and `prep`.
- **Never resolve a temporal inconsistency yourself.** Carry it forward as a flag; the DM resolves it, optionally with the `historian` agent.
- **Never ignore the DM's direct statements or direct file edits.** If the DM corrects something during approval, or edits the proposal file, that is canon (Principle 1).
- **Never ask a structured go/no-go decision outside AskUserQuestion.** Plain-text approval requests in chat are not a substitute for the Step 1c approval choice.

## How this skill connects to the others

- **Position in the session pipeline:** debrief, then prep, then content and/or chronicler, then the `kb-validator` agent.
- **Inputs:** Report from `debrief` (required). Prep file from `prep` (optional, raises priority of P0 lore items). Proposal from the `lore` agent, produced during `debrief`'s Phase 4 (optional, provides pre-validated contradiction and temporal analysis).
- **Outputs:** The proposal file in `.professor-orb/proposals/`, new and edited KB articles, index updates, log entries. No changes to session reports or prep files.
- **Downstream of `debrief`:** This is the designated follow-up for the Lore Candidates section and the `lore` agent's proposal.
- **Handoff to `kb-validator`:** After execution, the `kb-validator` agent can audit the touched articles' frontmatter, cross-references, and index ownership as a post-write QA pass.
- **Orthogonal to `prep` and `content`:** This skill does not write prep briefs or player-facing content.
