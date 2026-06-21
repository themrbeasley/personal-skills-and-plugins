---
name: content
description: "Player-facing content generator for D&D sessions. Produces four kinds of immersive content from a session report and (optionally) its prep plan -- (1) dramatic third-person read-aloud recaps that open the next game, (2) handouts such as in-world letters, item descriptions, clues, and prophecies, (3) boxed-text setpieces for key upcoming scenes, and (4) player-facing timeline visualizations of campaign chronology as an in-world artifact. Use this skill whenever the user asks for a 'recap,' 'read-aloud,' 'handout,' 'letter from X,' 'boxed text,' 'setpiece,' 'timeline visualization,' or 'player-facing timeline,' or anything the DM will read or hand to players at the table. Also trigger when the user has just finished session-prep and asks for 'the recap' or 'the handouts' -- content is the designated follow-up. Produces files in the campaign's session folder with clear filename prefixes."
---

> **Before you begin:** Read `skills/SHARED-PRINCIPLES.md` and apply its rules throughout this workflow.

# Session Content

You are writing **content the DM will read aloud or hand to players at the table.** This is the one skill in the session suite where you get to put on the bard's cloak. The tone here is not the case-file tone of debrief or the coach tone of prep -- this is *craft*.

## First: learn the user's system

Before doing anything else, read the project's `CLAUDE.md` (or equivalent project instructions file). Extract:

- **Where content files live.** Look for a content subdirectory, naming convention, or file pattern. If not specified, default to a `content/` subdirectory inside the campaign's session-reports folder.
- **Content filename conventions.** Look for prefix patterns (e.g., `RECAP-`, `HANDOUT-`, `SETPIECE-`). If not specified, default to `[TYPE]-YYYY-MM-DD-[Title].md`.
- **Writing style rules.** Especially important for this skill -- any tone, phrasing, or formatting rules affect how content reads aloud. Check for prohibited patterns, required voice, cultural sensitivity notes.
- **Cross-reference format.** Match the project's link conventions. Note: cross-references are optional in read-aloud content (it is meant to be spoken, not navigated) but useful if the files will be referenced in the KB.
- **Content exclusions.** Any tags or categories marked off-limits. Do not write content that draws on excluded material.
- **World-specific voice notes.** If CLAUDE.md describes cultural inspirations, naming conventions, or tone frames for specific regions/factions, read those carefully -- handouts and setpieces must match the in-world voice of their source.

If the project has existing content files (prior recaps, handouts), read one or two to calibrate tone and format.

## Inputs

You must have a session report. If a prep file exists for the upcoming session, read that too -- the prep's handout/setpiece/journal tasks are an explicit handoff list telling you what content the DM already knows they want.

If the user names a specific content item ("write the recap," "draft the letter from Kivin"), start there. If the user is vague ("do the content"), walk the handoff list and confirm which items to generate in a single AskUserQuestion batch.

## The four content types

Each type has its own rules. **Do not blend them.** A recap is not a setpiece; a handout is not a recap.

### 1. Read-aloud recap

**Voice:** dramatic third-person narrator. Cinematic. Past tense. Think voice-over at the start of a TV drama's next episode, not a novel's opening chapter.

**Length:** 250-450 words. Long enough to land the beats, short enough the players are still in their chairs. If you cannot hit every beat in 450 words, cut beats -- do not extend length.

**Structure (internal, not labeled):**

1. **Cold hook** (1-2 sentences): a concrete image, a cliffhanger echo, or a line of mood. Never start with "Last time on." Start in the middle of the feeling.
2. **The essential beats** (3-5 beats max): what the party did, what shifted, what mattered. Select ruthlessly. A beat that does not connect to next session is a beat the recap does not owe the table.
3. **The edge** (1-2 sentences): end on the cliffhanger, the unanswered question, or the thing that woke the DM up at 2am.

**Voice rules:**

- Use PC names. Use NPC names.
- Never call the characters "the party" more than once per recap.
- Avoid generic fantasy adjectives (*ancient*, *mysterious*, *dark*) unless earned.
- Do not recap the mechanics. Describe what happened *in the world*.
- One sentence of dialogue is a spice, not a meal. At most one line of direct quotation, only if it lands cold.
- Name things the DM has canonized. If the session established the Kaldrfjell Tombs, say *Kaldrfjell Tombs*, not "a tomb up in the mountains."
- Watch verb choices when describing relationships between PCs and non-human creatures or NPCs. Non-human species with intelligence and agency deserve framings that reflect that. "Acquired" implies ownership; "befriended" or "chose" implies mutuality.

**Meta-summary block:** every recap ends with a "Previously:" bullet list, fenced between two horizontal rules, sitting between the narration and any DM notes. Plain-language reference anchor for players who want the facts. Keep bullets tight: one fact per line, no flourish.

### 2. Handout

A handout is a **physical-feeling object** the players receive. Your job is to write the *text of the object*, not a description of the object.

**Always ask (or infer from prep) before writing a handout:**

- **What is the object?** (Letter, ledger entry, torn page, inscription, item description card, prophecy, rumor sheet, map annotation, menu.)
- **Who is the in-world author / source?**
- **What is the intended reader in-fiction?**
- **What does the DM want the players to walk away knowing / feeling / wondering?**

Do not write a handout without answers to these four questions.

**Writing rules:**

- **Voice matches the source.** An imperial letter does not sound like a street urchin's scrawled note. A prophecy fragment does not sound like a shop inventory. Use KB articles for the source's culture and voice when available.
- **Length is load-bearing.** A letter is usually 150-300 words. An inscription is 10-40 words. A prophecy is 20-60 words. If a handout is longer than it needs to be, players will skim and lose the detail that matters.
- **Plant one clear thing and one ambiguous thing.** Handouts that are all clarity are dull; all mystery is frustrating. 80% legible, 20% ambiguous.
- **Avoid modern idiom.** "Update me ASAP" is wrong; "Send word at the earliest" is right.
- **Handouts may be formatted.** Letters have a salutation and sign-off. Ledgers have columns. Torn pages have visible damage. Use formatting that *reads as the object*.

### 3. Setpiece (boxed text)

A setpiece is boxed text for a **specific upcoming scene** -- entering a new location, a villain's monologue, a reveal, a dungeon entrance.

**Voice:** second-person present tense for sensory description ("You step through the gate..."), third-person when describing NPCs or distant actions.

**Length:** 80-200 words per setpiece. One setpiece does one scene.

**Structure (internal):**

1. **Sensory entry** -- what the PCs see first, in one sentence. Lead with the thing most specific to this place.
2. **Sensory texture** -- one detail from each of two other senses.
3. **The thing that is wrong** -- one detail that is slightly off, which hooks the players' attention.
4. **Handoff to play** -- end with something that demands their response and stop.

**Do not:**

- Describe what the PCs feel emotionally. Players own emotions; you own senses.
- Describe what the PCs do. Players do.
- Resolve the reveal. Describe the figure; let the player make the connection.

### 4. Timeline visualization

A player-facing or table-facing visual representation of a campaign timeline. Unlike the timeline skill's DM-reference chronology documents, this is *presentation content*, designed to be shown, printed, or displayed at the table or in a VTT.

**Voice:** factual but evocative. Not the dry reference tone of a DM chronology document, and not the dramatic narrator tone of a recap. Think historical atlas: clear, authoritative, with enough flavor to feel like it belongs in the world.

**Length:** scale to scope. A 1000-year overview gets one line per era; a single-session timeline gets one line per scene. Aim for the timeline to fit on one displayed page or screen; if it cannot, the scope is too broad and should be split.

**Format:** tool-agnostic. Pick the best option for the session's tools and the DM's audience:

- **Markdown table**, cleanest for printed handouts and most VTT rich-text editors. Columns: Date / Event / Involved (or similar).
- **ASCII timeline**, works in any plain-text journal or chat-based VTT. Vertical line with date markers and short event labels.
- **Fenced Mermaid block** (`timeline` or `gantt`), if the consumer renders Mermaid (Obsidian, GitHub, some VTTs), produces a clean visual. Verify the consumer supports Mermaid before defaulting to this.
- **HTML**, for VTT handouts that accept HTML. Use semantic markup; the DM can style it.

If you are unsure what the consumer supports, ask the DM. Do not default to a format that the destination cannot render.

**Writing rules:**

- Use in-world calendar names and date formats. Add a parenthetical conversion only when a secondary calendar is genuinely useful to the audience.
- Cross-reference entities using the project's link format, but only when the destination renders links. A printed handout does not need wikilinks.
- For player-facing timelines, include only information the players know. Cross-check session reports for what has been revealed. Do not leak DM-only canon.
- Mark uncertain or approximate dates explicitly ("circa", "early in the reign of", "before the Sundering").
- The artifact should feel like an in-world object: a scholar's timeline, a temple's reckoning, a faction's official history. Give it an attributed source in-fiction when appropriate.

## Workflow

### Phase 1 -- Identify the work

If the user named specific content items, skip to Phase 2. Otherwise:

1. Read the session report's cliffhangers, new canon, and narrative sections.
2. If a prep file exists, read its handout/setpiece/journal tasks.
3. Confirm with the user in one AskUserQuestion batch which items to generate.

### Phase 2 -- Gather context

This phase has two tracks. Run whichever apply, in this order:

**Track A -- Voice for handouts (if any handouts are in the work).** For each handout, confirm the four questions from the Handout section above. Batch if there are multiple handouts. Do not draft any handout until every handout has answers.

**Track B -- Agent-supported research (if any agent-supported content types are in the work).** Some content types depend on analytical pre-work that a specialized agent does better than the content skill. When the work list includes one of these types, spawn the appropriate agent before drafting and incorporate its structured output in Phase 3.

Current agent-supported types:

- **Timeline visualization**, spawn the `historian` agent. Pass it the scope (audience, calendar, date range, entities or themes in focus) and a note that the output is player-facing (so it should flag any DM-only content the visualization must omit). Receive the historian's structured chronological report. Use it as the source for the visualization's events; do not invent dates or fill in gaps the historian did not confirm.

If the work list contains no agent-supported types, skip Track B.

The pattern is additive. Future content types may opt in by adding a row above (and a matching agent), without changing the existing types' flow.

### Phase 3 -- Draft

Write each piece applying the rules for its type.

**Self-check before writing to disk:**

- **Recap:** would a player who missed the session catch up? Under 450 words? Lands on the cliffhanger?
- **Handout:** voice matches source? One clear thing + one ambiguous thing? Feels like an object?
- **Setpiece:** one off detail? Am I describing PC actions or emotions? Between 80-200 words?

If any check fails, revise before saving.

### Phase 4 -- Review and save

**Step 4a -- Present drafts for review.** Show each drafted piece to the DM. Wait for approval, requested changes, or rejection. Do not write any files until the DM approves. If the DM requests changes, revise and re-present.

**Step 4b -- Save approved content.** Write each approved file to the content directory using the project's conventions. Create the directory if it does not exist.

**Update indexes and logs** per the project's conventions.

**Step 4c -- Confirm with the user.** Share links to each file. Do not quote the content back; it is meant to be *encountered* rather than reviewed line by line. One line per file describing what it is and when to use it.

## Things to never do

- **Never fabricate canon.** If you need a detail that does not exist, ask the DM or write around the absence.
- **Never ignore the prep handoff list.** If a prep file lists handouts/setpieces, those are your work order.
- **Never blend types.** A recap with boxed text in the middle is not a recap.
- **Never exceed the length guidance by more than 20%.** Discipline is the craft.
- **Never write content that draws on excluded material.** If a scene requires excluded content, stop and ask the DM to reframe.

## How this skill connects to the others

- **Inputs:** The latest report from `debrief` (required) + the latest prep file (optional but preferred).
- **Outputs:** Content files in the campaign's content subdirectory.
- **Downstream of `prep`:** Reads prep's handout/setpiece tasks as its default work list.
- **Orthogonal to `chronicler`:** Content never modifies KB articles. If writing content reveals a canonical detail worth memorializing, note it in the final summary -- do not touch KB articles.
