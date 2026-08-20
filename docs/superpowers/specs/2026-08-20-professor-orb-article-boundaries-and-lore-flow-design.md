# professor-orb: Article Boundaries and the Lore Item Flow

**Date:** 2026-08-20
**Status:** Approved, not yet implemented
**Scope:** `professor-orb/skills/chronicler/SKILL.md`, `professor-orb/skills/prep/SKILL.md`, `professor-orb/skills/debrief/SKILL.md`, `professor-orb/skills/orb/SKILL.md`, `professor-orb/README.md`.

## The reported symptom

The DM reports that `chronicler` regularly leaks DM-only information or articles. In their words:

> Whole articles in the KB instead of in session-reports, usually put there during Chronicler passes post session debrief. DM-only information gets inserted into articles, report information and adventure/campaign statuses get inserted into articles, there are leaks from the session-reports and plan docs that Chronicler keeps taking and inserting into player facing KB stuff. These other skills are putting things in the right place, but then Chronicler moves them or inserts the info in bad places.

## Root cause: both of chronicler's declared inputs are phantoms

Chronicler names two source sections. Neither has ever existed.

| Chronicler says | Reality |
|---|---|
| `chronicler:38` "The lore candidates section is your backbone" | `debrief` builds reports with metadata, narrative recap, PCs present, NPCs and factions, locations, inventory, lore revelations, and open threads (`debrief:69`). There is no lore candidates section. |
| `chronicler:39` "If it has a lore resolution section, treat P0 items as priority" | `prep` builds four sections: Work Review, Last Session Recap, North Stars, Handouts. There is no lore resolution section, and no P0 anywhere. |

The strings "lore resolution" and "P0" appear in exactly two places in the entire plugin, both inside chronicler (lines 39 and 199). `git log -S` finds no commit that ever introduced either elsewhere, and both lines were present in chronicler's first commit (`4e7e5a0`). Chronicler was written against a pipeline design that was specified but never built.

**The consequence is mechanical, not a judgment failure.** With its backbone missing and its prep priorities missing, the only surviving instruction in Step 1a is "also read the narrative, new canon, discovered canon, and open threads sections." So chronicler reads whole files. Whole files contain:

- the session narrative, which is what happened to the party
- open threads, which `debrief:59` defines as "what has changed in the world that the party does not yet know about"
- the prep brief's North Stars, which are scenes the DM has not run yet

All three then land in articles.

### A third broken handshake

`debrief:91` tells the DM that the lore agent's proposal is preserved: "point them at the full proposal above in this conversation (the chronicler skill re-derives and persists it when it runs)."

`chronicler:40` says the opposite: if the lore agent did not run in this same conversation, mark the proposal "not available" and optionally suggest re-running it. Chronicler has no persistence behavior of any kind.

So the lore agent's analysis is conversation-scoped and dies with the conversation, while debrief promises the DM a durable record that nothing writes. Giving the report a Lore Candidates section is that missing persistence layer.

### Contributing defect: the publish warning is ignored by design

`references/base-rules.json` ships `frontmatterPublishPresence` at `enforcement: "warn"`, not `block`. `hooks/validate-write.mjs` exits 0 for warn-level violations. `chronicler:131` commits only to fixing block-level violations. A new article written with no `publish` field therefore succeeds, carries no disclosure flag, and falls back to the site default.

Chronicler is the only pipeline component that writes to the knowledge base, and it is the only one that never mentions `publish`.

## Three independent controls

The design separates three questions that chronicler currently collapses into one.

| Control | Governs | Answers |
|---|---|---|
| `publish` frontmatter | the whole article | Is this article fit to show anyone? |
| `%%` DM Eyes-Only block | one passage inside a visible article | Does the table know this yet? |
| staging vs `kbRoot` | where the file lives | Is this article finished enough? |

Readiness, disclosure, and location are orthogonal. Chronicler currently has none of them, so every question resolves to the same wrong answer: write it to the KB, unflagged.

## Design decisions and why

### 1. An article records the world, not the campaign

This is the positive definition, and it is the whole enforcement mechanism. "Do not leak DM-only information" fails as an instruction because "does the table know this?" is not observable from inside an article, so it gets guessed at, and the guess is optimistic. "Is this sentence about the party, a session, the players, or a plan?" is observable by reading the sentence.

The DM confirmed the line against a worked example. Given a Vela Thorne article containing eight candidate sentences, they ruled:

- **In:** what Vela is, what she does, how long she has traded, what she wears, and that she is the assassin who killed Duke Aldric. That last one is a fact about the world and belongs in her article whether or not anyone at the table has worked it out. Framing may evolve over the course of an adventure; the fact does not change.
- **Out:** "The party met her in Session 12 at the Rusty Anchor" (the party, the session), "The party does not yet know her true identity" (the players), "Vela is a planned reveal for the Act 2 finale" (campaign status), and "If confronted directly, she will flee the city" (the plan, sourced from prep).

The four excluded categories already live in the report and the brief, which is where they were correct. A second copy inside an article would drift out of sync with the first.

### 2. Placement is decided by what the run was given

The DM's model: chronicler legitimately writes to both `kbRoot` and the campaign's staging area under `sessionReportsRoot`, and staging exists because "it keeps those articles moving towards publishable over time... sort of a staging area for new articles-in-the-making."

The observable discriminator is the run's own inputs:

- A **session-driven run** has a session report or prep file in scope, which is every run following `debrief` or `prep`. Its material is in motion. New articles stage.
- A **standalone run** has neither. `kbRoot` is a normal destination for its new articles.

Edits go where the article already lives and never relocate it. Promotion out of staging is a distinct operation the DM asks for by name, never a side effect of a lore pass, and `/migrate` is what performs it.

**Determining the run mode is an explicit decision, not a side effect.** Chronicler's Step 1a currently makes a report mandatory and, absent a named one, goes and finds the most recent one. Left as-is there is no reachable standalone run: every run would be session-driven, every new article would stage, and chronicler would silently stop writing to `kbRoot` altogether. Step 1a must therefore decide the mode first. A run is session-driven when the DM named a report or prep file, or when `debrief` or `prep` just ran. A run is standalone when the DM invoked chronicler on its own subject ("write up the Vela article", "tidy the faction pages"), and a standalone run does not go hunting for a report.

**The staging area is a fixed subdirectory, not a configured path.** It is `<sessionReportsRoot>/<campaign>/articles/`, created on demand. This follows the precedent professor-orb already sets for campaign subdirectories: `content/` (`skills/content/SKILL.md:20`, "default to a `content/` subdirectory inside that campaign folder") and `prompts/` (`skills/forge-prompt/SKILL.md:158`, "Create the `prompts/` directory if it does not exist"). Neither is recorded in `conventions.json`, neither is asked about, and `/log` commits the campaign lane recursively so both are covered without further work.

This raises no Principle 11 problem. Principle 11 forbids *inferring* structure from a consumer's prose or inventing it on the spot. A fixed name professor-orb ships is neither: CLAUDE.md states that professor-orb imposes its own structural schema and that assigning an organization method is its purpose. No `stagingRoot` field is added to `conventions.json`, no `schemaVersion` bump is needed, and `setup`, `/genesis`, and the resync path are untouched.

### 3. DM Eyes-Only blocks are opt-in only

`%%`-wrapped blocks are hidden from rendered views, including published sites. The DM has independently confirmed this behavior three times for their setup. Nothing in the plugin currently references `%%`; there are zero occurrences across all files.

**The default disposition of an unrevealed in-world fact is plain prose, not a block.** Decision 1 puts the fact in the article; this decision does not take it back out. During an active campaign the article is usually staged anyway, since a session-driven run does not write new articles to `kbRoot`, so location is already carrying the secrecy. A block is what the DM reaches for when they want one specific passage hidden inside an article that is published. Where framing is genuinely uncertain rather than the fact itself, chronicler flags it in the proposal rather than guessing.

**Chronicler never creates or removes a `%%` block unless the DM asks for it specifically.** Removing a fence exposes content, which is the leaky direction, so the prohibition binds harder on removal than on creation. Where a session report shows the party has learned something an existing block covers, chronicler notes it under Deferred / Flagged and lets the DM decide, mirroring the skill's existing refusal to resolve temporal inconsistencies itself.

Chronicler must also **preserve** blocks it encounters: an edit made for any other reason must not reflow, relocate, or dissolve a block, and must not quote a block's contents into another article's visible prose.

**Campaign material never goes inside a block.** `%%` governs who sees a fact, not whether the fact belongs in an article. The four excluded categories stay out whether hidden or not.

When the DM does ask for a block, it sits **next to the prose it relates to**, not in a trailing section, so that an eventual unwrap is a clean edit rather than a rewrite.

### 4. The lore item flow gets a carrier at both ends

Four places already document a data flow that has no carrier:

| Where | What it says |
|---|---|
| `prep:3` | "feeds handout candidates and north stars to the content skill, and unresolved lore items to the chronicler skill" |
| `prep:136` | "If a north star depends on a lore decision, note it; do not resolve it." |
| `prep:147` | "If the Work Review reveals lore items the DM has not yet addressed, mention that `chronicler` can handle them." |
| `chronicler:39` | "If it has a lore resolution section, treat P0 items as priority." |

Prep is told twice to note and mention lore items, its own description promises it feeds them to chronicler, and chronicler is told to read them. The brief has nowhere to write them down, so they are said aloud in chat and evaporate.

The fix is not a new feature. It is the missing carrier for a flow specified at both ends.

### 5. Chronicler marks its own work done

The DM's requirement, in their words:

> It carries forward and Chronicler should not just summarize which were resolved, it should also automatically edit the prep doc or session report respectively, to mark that item resolved and note how. That's the record of what's outstanding, and if it isn't corrected, Claude/Chronicler will continue to be unsure if the work was done.

This reverses `chronicler:191`, "Never edit session reports or prep files. Those are historical records." The rule is narrowed rather than deleted, along a principled line: **chronicler may update work-tracking state in those files, never narrative content.** A checkbox in a work list is not history. The recap is.

Write-backs land in every carrier that holds the item, report and brief both, where available; a missing carrier is reported plainly rather than failing the run. They are listed in the proposal and approved with everything else.

Chronicler marks an item resolved even where it satisfied the item incidentally rather than by working from the list, since the alternative leaves the DM unsure whether work was done.

## Changes by file

### `skills/debrief/SKILL.md`

**Add a Lore Candidates section to the report structure** (`debrief:69`). Phase 3 seeds it from what debrief already tracked: entities touched with no article, new canon needing capture, and anything the DM flagged during interrogation.

**Phase 4 merges the lore agent's findings into that section** after the agent returns, presents the merged list for approval, and updates the file. This is a second write to a file debrief already owns and is what makes the lore agent's analysis durable.

**Correct `debrief:91`.** The parenthetical promising that chronicler persists the proposal becomes a statement that debrief itself has just written it into the report's Lore Candidates section.

### `skills/prep/SKILL.md`

**Add Section 5: Lore Resolution**, after North Stars, because priority derives from them. Three tiers in plain words:

- **Needed for next session**: a planned North Star depends on it.
- **Wanted this cycle**
- **Backlog**

Prep proposes the tiers; the DM adjusts in the draft exactly as they already do with North Stars; the DM may promote any item to the top and that stands (Principle 1).

Fed by three sources prep already has or is already told to notice: the report's Lore Candidates section, north-star-dependent lore decisions (`prep:136`), and outstanding items surfaced by Work Review (`prep:147`). Both of those existing instructions finally get a destination.

**Carry-forward.** Prep reads the previous brief and re-lists anything still open. Items already marked resolved are not re-raised (Principle 3). When prep carries an item across it notes its origin, for example `(from 2026-08-13-REPORT)`, which is what lets chronicler locate every carrier later without item IDs.

**Update the frontmatter description** to name five sections.

### `skills/chronicler/SKILL.md`

1. **New section, "What an article is."** The world-not-campaign rule stated constructively, with the four excluded categories and the sentence-subject test. Applies at every write location.

2. **New section, "Where an article goes."** Session-driven versus standalone runs, edits never relocating, promotion as a separate operation, and the Principle 11 handling for locating the staging area.

3. **New section, "DM Eyes-Only blocks."** Opt-in only, never created or removed unasked, preserved when encountered, never carrying campaign material, placed adjacent to related prose, with reveal candidates routed to Deferred / Flagged.

4. **Fix Step 1a item 2** (`chronicler:38`) to name what each report section is for: Lore Candidates and the two canon buckets are article material; narrative recap and open threads are context to understand and not text to transcribe.

5. **Fix Step 1a item 3** (`chronicler:39`) to name prep's five real sections, restrict the prep read to lore priorities only, and state that North Stars are unrun scenes and therefore never article content.

6. **Proposal template gains `Destination` and `Publish` columns** on the new-articles table, plus a new section listing lore items to mark resolved. Staged articles carry `publish: false`; KB articles carry a proposed value; the field is never omitted.

7. **Step 2c gains a publish rule**, and `chronicler:131` is amended so that the warn-level missing-`publish` violation is treated as blocking for chronicler's own writes, without changing enforcement for any other component.

8. **Write-back execution step** in Phase 2, and `chronicler:191` narrowed to work-tracking state only.

9. **Update `chronicler:199` and `chronicler:201`** so the Inputs and Downstream lines describe sections that exist. Drop "P0".

### Doc sync

`orb:30` and `README:23` both enumerate prep's four sections. They become five.

## Deliberately unchanged

- **`references/base-rules.json` rule set is not touched.** Raising `frontmatterPublishPresence` to `block` would start failing writes in existing consumer knowledge bases full of articles with no `publish` field. Chronicler binds itself instead. No `schemaVersion` bump either, since no schema field is added.
- **No new validator check.** A regex for campaign-status prose would misfire on legitimate lore, and the blast radius reaches every consumer via `setup`.
- **`skills/setup/SKILL.md`, `commands/genesis.md`, and the conventions schema are untouched**, because staging is a fixed subdirectory rather than a configured root.

## Findings from the conflict sweep

A five-lens sweep with adversarial verification of every claim (135 agents) found five confirmed conflicts and a set of gaps in the areas no lens covered. All were verified by hand against the files before being accepted. The material corrections to the design as first written:

1. **`chronicler:37` and `chronicler:199` make the report mandatory**, so the standalone run was unreachable and the placement rule would have staged everything. Corrected in Decision 2 above. This was a blocker: the feature would have silently stopped chronicler writing to `kbRoot` at all.
2. **`chronicler:200` states the no-edit rule a second time** ("No changes to session reports or prep files") in the connections section. The design named only `chronicler:191`. Both must change together, along with the frontmatter description at `chronicler:3`, which frames chronicler as writing only the KB.
3. **`hooks/pipeline-next.mjs:59` is deterministic code**, not prose: `LANE_CLAUSES.chronicler` is `" /scribe can commit the KB changes."` and it fires after every chronicler run. Staged articles commit through `/log`. `hooks/pipeline-next.test.mjs:123` pins the string with an exact-equality assertion, so the hook and its test change together.
4. **`debrief:69`'s section list is the third fallback**, reached only when the project has neither a report template nor existing reports. In any real consumer the structure comes from the template or from existing reports, so adding Lore Candidates to that list alone would never take effect. The section must be unconditional.
5. **`agents/lore.md` does need a change.** `lore.md:60` governs what the agent *reads*; its Output format at `lore.md:146` has no Lore Candidates bucket, returning Contradiction Check, Temporal Inconsistencies, Update Proposal, Non-obvious Connections, and Entities Without Articles. Debrief's Phase 4 needs an explicit mapping, and `lore.md:5`, `:30`, and `:183` still claim chronicler is the sole carrier of the proposal.
6. **`commands/log.md:59`'s surprise guard** stops on "a file inside the lane that does not match the schema". A `type: Person` article inside the session-reports lane is exactly that, so the guard needs `articles/` exempted the way `.obsidian/` already is.
7. **`frontmatterFieldOrder` requires `publish` first** (`references/base-rules.json`, `fields: [publish, type, tags]`, `orderMatters: true`), and it is unscoped so it applies in the staging prong too. Chronicler must write `publish` as the first frontmatter field.
8. **The publish self-binding applies to creates only.** `validate-write.mjs` fires on Edit as well as Write, so an edit to a legacy article missing `publish` would otherwise force chronicler to invent a disclosure value, which is exactly the bulk-default failure `migrate.mjs:1167` refuses. On an edit, chronicler leaves the field alone and flags the article for `/sweep`.
9. **Staged articles are outside several safety nets.** `validate-write.mjs:960` skips every `scope: "kb"` rule for a non-KB prong, so index parity, single ownership, and the split and absorb thresholds do not apply to a staged article. `validation-sweep.mjs` enumerates only each setting's `kbRoot`, so staged articles are never scanned. `kb-validator` would flag every staged article as orphaned from any index. These are stated as consequences, and `kb-validator` gets an exemption.
10. **The session-reports lane is enumerated in five places** that all omit staged articles: `commands/log.md:2`, `:43`, `:133`, `skills/orb/SKILL.md:42`, `README.md:24`, and `CONTEXT.md:232`.
11. **`prep:63` says "four sections"** in the body, in addition to the frontmatter description. Four enumeration sites total: `prep:3`, `prep:63`, `orb:30`, `README:23`.
12. **`orb:32` and `README:29` call chronicler "the only pipeline skill that writes the KB"**, which needs softening to "writes KB articles" now that it also writes outside the KB.
13. **Both version files must be bumped to 1.16.0.** CLAUDE.md requires `version` to match in `.claude-plugin/marketplace.json` and `professor-orb/.claude-plugin/plugin.json`. This is new behavior, not a fix.
14. **`chronicler:40` points at "your proposal template at line 70"**, a hardcoded line number that is already wrong (the field is at line 64) and that the new columns shift again. Replace with the field name.
15. **`chronicler:48`** (Step 1b's prose field list) must gain destination and publish alongside the template, and make owning index conditional on a `kbRoot` destination.
16. **`timeline`'s temporal declarations** are canon about a world phenomenon, not campaign status, and must be carved out of the campaign-material exclusion explicitly. A declaration article goes to `kbRoot` regardless of run mode, since `timeline` reads only `kbRoot`.
17. **`prep:10`** defines the brief as not a checklist, which Section 5 contradicts head-on and must be narrowed.
18. **`prep:41` and `prep:144`** scope the previous-brief read to format only; carry-forward needs its content.
19. **`forge-prompt:81`** resolves "the subject's KB article" and will miss a staged article, which is precisely the case right after a session-driven chronicler run.
20. **`CONTEXT.md`** is the project glossary and CLAUDE.md requires reading it before writing user-facing prose. It needs a staging entry and amendments to the lane model.

## Risks

- **Debrief writes the report twice.** Phase 3 saves it, Phase 4 updates the Lore Candidates section after the agent returns. The alternative leaves the section thin and reintroduces the persistence gap.
- **Body rules scan inside `%%` blocks.** `hooks/validate-write.mjs:556` treats the body as one flat string with no comment stripping, so `contentNoEmDashes` and any other body rule apply inside blocks. This is arguably correct and is left as is, but it should be stated rather than discovered.
- **`%%` protects rendered output, not the file.** It holds against a player reading a published site. It is not a wall against someone holding the vault or the repository.
- **Three skills change together.** Chronicler's content and placement rules are independent of the lore item flow and can land first if the change needs staging.
