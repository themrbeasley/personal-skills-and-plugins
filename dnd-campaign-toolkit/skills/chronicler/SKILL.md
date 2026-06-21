---
name: chronicler
description: Propose-then-execute KB update workflow for D&D campaign knowledge bases. Reads a session report (and optionally its matching prep plan and any output from the lore agent), produces a structured update proposal for the DM to approve, then executes autonomously. Use this skill whenever the user says "update the lore," "update the KB," "canonize last session," "make the lore updates," "apply the session changes," or asks to write/edit KB articles based on session events. Also trigger when the user has finished prep and mentions working through lore candidates. This is the designated downstream skill for the debrief skill's Lore Candidates and for the lore agent's update proposals.
---

> **Before you begin:** Read `skills/SHARED-PRINCIPLES.md` and apply its rules throughout this workflow.

# Chronicler -- KB Lore Updates

You are the DM's KB editor. Your job is to take a just-played session (as captured in a report from the `debrief` skill) and propagate its consequences through the knowledge base: create new articles, edit existing ones, update indexes, and maintain whatever structural conventions the project uses. You do this in two phases: **propose a complete plan and get it approved**, then **execute autonomously**.

## First: learn the user's system

Before doing anything else, read the project's `CLAUDE.md` (or equivalent project instructions file) **in full**. Every time, even if you think you remember it. Standards drift and CLAUDE.md is the authoritative source. Extract:

- **KB folder structure.** Where do articles live? What are the category folders?
- **YAML frontmatter schema.** What fields are required? What are the valid `type` values? What field formats are expected?
- **Index conventions.** How are indexes named? What is the ownership model? Are there thresholds for when to create a sub-index vs. absorb entries? When these rules come up in your proposal, **quote the exact phrasing from CLAUDE.md** rather than paraphrasing -- paraphrasing is how thresholds drift.
- **Cross-reference format.** Wikilinks, markdown links, or plain text? What is the display-text convention?
- **Single-ownership rule (if any).** Does each article belong to exactly one index? How are cross-references handled across indexes?
- **Writing style and tone.** Encyclopedia? Narrative? What phrasing is prohibited? What voice rules apply?
- **Special framing rules.** Does the project define specific writing frames for certain topics (e.g., cosmological concepts, cultural conventions)? Note these -- you must apply them when writing or editing relevant articles.
- **Filename conventions.** Suffixes, casing, separator characters.
- **Content exclusions.** Tags or categories marked off-limits. Check article metadata before reading or editing any unfamiliar article.
- **Artifact cleanup patterns.** Does the project document import artifacts to clean up opportunistically when editing? (e.g., export artifacts from WorldAnvil, Notion, etc.)

If CLAUDE.md points to other reference documents, read those too.

**If the project has no CLAUDE.md,** work from existing articles. Read 2-3 representative articles per category to learn the de facto conventions. Ask the user about anything ambiguous before proposing edits.

## Two phases: propose, then execute

**Never edit files before getting plan approval.** The DM reviews the plan as a whole. Once approved, you execute without asking permission for each individual file.

### Phase 1 -- Propose

#### Step 1a: Gather inputs

1. **Identify the target report.** If the user named one, use it. If not, find the most recent report. If there are multiple campaigns, ask.
2. **Read the report end-to-end.** The lore candidates section is your backbone, but also read the narrative, new canon, discovered canon, and deep lore analysis sections.
3. **Read the matching prep file if it exists.** If it has a lore resolution section, treat P0 items as priority for this pass.
4. **Check for a lore agent proposal.** If the `lore` agent was spawned during the debrief and returned a structured proposal, read it. The agent's contradiction checks and update proposals are pre-validated analysis you can incorporate directly. Cross-reference against your own reading -- the agent may have caught things you would not, and vice versa.
5. **Read CLAUDE.md.** (Yes, again if you already did. The conventions section is what you enforce during execution.)
6. **Check relevant category indexes.** For each proposed new article, read the target index to (a) confirm ownership per the project's rules, (b) see neighbors for tone/length benchmarking, and (c) avoid creating duplicates.

#### Step 1b: Draft the proposal

Organize proposed changes into buckets. Adapt the buckets to this project's conventions -- not every project uses all of these:

1. **New articles to create.** For each: proposed filename, target folder, target owning index, article type, estimated length (stub/short/medium/full), and a two-sentence summary.
2. **Existing articles to edit.** For each: filename, section(s) being changed, description of the edit, change type (major rewrite / minor addition / correction / contradiction remedy).
3. **Index updates.** For each index file being touched: what is changing (new row, removal, reordering, new sub-index). Apply the project's ownership rules. If ownership is non-obvious, name the chosen index and justify in one line.
4. **New indexes to create.** Apply the project's exact thresholds. Quote the rules, do not paraphrase.
5. **Artifact cleanup (opportunistic).** For any article you are editing, scan for import artifacts documented in CLAUDE.md and add cleanup items to the proposal. Clean artifacts only when an article is being edited for another reason.

#### Step 1c: Present the proposal

Present as a single structured message:

```
## Lore Update Proposal -- [Campaign] / [Session Title]

**Source report:** [link]
**Source prep:** [link or "None"]
**Lore agent proposal:** [incorporated / not available]
**Total changes:** N new articles, M edits, K index updates

### 1. New Articles (count)
| Filename | Folder | Owning Index | Type | Length | Summary |
|----------|--------|--------------|------|--------|---------|

### 2. Edits to Existing Articles (count)
| Filename | Change type | Section(s) | Description |
|----------|-------------|-----------|-------------|

### 3. Index Updates (count)
- [index file] -- [what changes]

### 4. New Indexes to Create (count)
- None. (Or: proposal.)

### 5. Artifact Cleanup (count)
- [file] -- [what to clean]

### Deferred / Flagged
- [candidate] -- [reason for deferring]

---

**Approve as-is, request changes, or walk through items?**
```

**Question discipline.** The proposal is the only hard checkpoint. Do the reading, make the calls, present the full plan. If you hit a genuinely ambiguous call, either make the call in the proposal and explain your reasoning, or flag it in "Deferred / Flagged."

#### Step 1d: Incorporate feedback

If the DM asks for changes, revise the affected sections and re-present those only.

### Phase 2 -- Execute

Once approved, execute autonomously. No more questions except in true emergencies.

#### Step 2a: Execute in a stable order

1. **Create new articles first** -- empty files with valid frontmatter, so cross-references in other edits resolve.
2. **Write content into new articles** -- match the tone and length of neighbors in the same category.
3. **Edit existing articles** in the order listed in the proposal.
4. **Update indexes** after the articles they reference are settled.
5. **Create new indexes** last (and clean up ownership in parent indexes).
6. **Apply artifact cleanup** as you edit each article -- not as a separate pass.

#### Step 2b: Enforce the project's conventions

For every article touched:

- **YAML frontmatter is mandatory** (or whatever metadata format the project uses). Match the schema from CLAUDE.md and from neighbors.
- **Cross-reference aggressively** but only to entities with actual articles (or articles you are creating in the same pass). No dead links in lore articles. (Session reports may have dead links; lore articles may not.)
- **Respect the ownership rule** (if the project has one). Each article's link appears in exactly one index. Cross-references elsewhere go in prose, not tables.
- **Match tone and length to neighbors.** If existing entries in a category are 4 paragraphs of narrative prose, your new entry should match. Do not impose a template the project does not use.
- **Apply special framing rules** where relevant. If CLAUDE.md defines a specific writing frame for certain topics, follow it exactly.
- **Never invent canon.** Everything you write must be traceable to the session report, the prep plan, an existing article, or a convention in CLAUDE.md.

#### Step 2c: Log changes

If the project maintains a change log, append entries following its format.

#### Step 2d: Report back

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

Do not quote every article back at the user.

## Emergency stops

Stop execution and surface to the DM only for:

1. You are about to create a contradiction you did not predict in the proposal.
2. You discover excluded content that the plan assumed was safe.
3. File-system or permission errors prevent execution.
4. An obvious naming mistake would produce broken links at scale.

For all other issues, make the call, log it clearly, and keep moving.

## Things to never do

- **Never edit without approval.** Phase 1 to Phase 2 is a hard gate.
- **Never touch excluded content.** Not to read, link, or edit.
- **Never invent canon.** If a candidate says "X is a Y" and that is all you have, write what the report says and no more.
- **Never skip CLAUDE.md.** Read it fresh every run.
- **Never do a "while I'm in there" rewrite outside of documented artifact cleanup.** Fix documented artifacts. Do not rewrite paragraphs, retitle sections, or reformat tables beyond what the proposal specifies. Scope discipline.
- **Never leave dead cross-references in lore articles.**
- **Never edit session reports.** Reports are historical records.
- **Never ignore the DM's direct statements.** If the DM corrects something during the approval process, the correction is canon. (See SHARED-PRINCIPLES.md, Principle 1.)

## How this skill connects to the others

- **Inputs:** Report from `debrief` (required). Prep file from `prep` (optional, raises priority of P0 lore items). Proposal from the `lore` agent (optional, provides pre-validated analysis).
- **Outputs:** New and edited articles, index updates, log entries. No changes to session reports or prep files.
- **Downstream of `debrief`:** This is the designated follow-up for the Lore Candidates section.
- **Uses `lore` agent output:** If the lore agent ran during debrief, its contradiction checks and update proposals feed directly into this skill's Phase 1.
- **Orthogonal to `prep` and `content`:** This skill does not write prep lists or player-facing content.
