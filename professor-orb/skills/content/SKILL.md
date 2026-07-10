---
name: content
description: "Player-facing content generator for D&D sessions. Produces four kinds of immersive content from a session report and (optionally) its session brief: (1) dramatic third-person read-aloud recaps, (2) handouts such as in-world letters, item descriptions, clues, and prophecies, (3) boxed-text setpieces for upcoming scenes, and (4) player-facing timeline visualizations. Each piece can be output as plain markdown, a self-contained Foundry fragment (an inline-styled HTML snippet pasteable into any Foundry HTML field: journal entries, item descriptions, actor biographies, module fields, not just journals), or a printable page (a standalone HTML file with print CSS for physical handouts or PDF export). Any output with an image slot gets a matching prompt sidecar for image generation. Use this skill whenever the user asks for a 'recap,' 'read-aloud,' 'handout,' 'letter from X,' 'boxed text,' 'setpiece,' 'timeline visualization,' or 'player-facing timeline,' or anything the DM will read aloud or hand to players at the table, including in Foundry. Also trigger right after prep, when the DM asks for 'the recap' or 'the handouts.' Position in the pipeline: debrief, then prep, then content and/or chronicler, then the kb-validator agent. The skill's last act records pipeline state so the Stop hook can suggest the next step."
---

> **Before you begin:** read `../SHARED-PRINCIPLES.md` and apply its rules throughout this workflow.

# Session Content

You are writing **content the DM will read aloud or hand to players at the table.** This is the one skill in the session suite where you get to put on the bard's cloak. The tone here is not the case-file tone of debrief or the coach tone of prep, this is *craft*.

## First: learn the user's system

Check `.professor-orb/conventions.json` first. If it defines rules for content files (a `type` value such as "Content," matching filename suffix, required frontmatter), follow those so anything you write passes the project's write-time validator hook on the first try. Many projects never formalize content-file conventions in `conventions.json`, since content is player-facing craft rather than KB canon; if it does not cover content files, fall back to the project's `CLAUDE.md` (or equivalent instructions file) the same way debrief and prep do for everything `conventions.json` doesn't reach. Extract:

- **Where content files live.** Look for a content subdirectory, naming convention, or file pattern. If not specified, default to a `content/` subdirectory inside the campaign's session-reports folder.
- **Content filename conventions.** Look for prefix patterns (for example `RECAP-`, `HANDOUT-`). If not specified, default to `[TYPE]-YYYY-MM-DD-[Title].md` for markdown, with `-FRAGMENT.html`, `-PRINT.html`, and `-IMAGE-PROMPT.md` suffixes for the Foundry fragment, printable page, and prompt sidecar variants described below.
- **Writing style rules.** Especially important for this skill, since any tone, phrasing, or formatting rules affect how content reads aloud. Check for prohibited patterns, required voice, cultural sensitivity notes.
- **Cross-reference format.** Match the project's link conventions. Cross-references are optional in read-aloud content (it is meant to be spoken, not navigated) and pointless in HTML outputs bound for Foundry or print, but useful if a markdown file will be referenced from the KB.
- **Content exclusions.** Any tags or categories marked off-limits. Do not write content that draws on excluded material.
- **World-specific voice notes.** If the project's instructions describe cultural inspirations, naming conventions, or tone frames for specific regions or factions, read those carefully: handouts and setpieces must match the in-world voice of their source.

If the project has existing content files (prior recaps, handouts), read one or two to calibrate tone and format.

## Inputs

You must have a session report from `debrief`. If a session brief from `prep` exists for the upcoming session, read that too: its handout and setpiece candidates are an explicit handoff list telling you what content the DM already knows they want.

If the user names a specific content item ("write the recap," "draft the letter from Kivin"), start there. If the user is vague ("do the content"), walk the handoff list and confirm which items to generate in a single AskUserQuestion batch.

## The four content types

Each type has its own rules. **Do not blend them.** A recap is not a setpiece; a handout is not a recap.

### 1. Read-aloud recap

**Voice:** dramatic third-person narrator. Cinematic. Past tense. Think voice-over at the start of a TV drama's next episode, not a novel's opening chapter.

**Length:** 250 to 450 words. Long enough to land the beats, short enough the players are still in their chairs. If you cannot hit every beat in 450 words, cut beats; do not extend length.

**Structure (internal, not labeled):**

1. **Cold hook** (1 to 2 sentences): a concrete image, a cliffhanger echo, or a line of mood. Never start with "Last time on." Start in the middle of the feeling.
2. **The essential beats** (3 to 5 beats max): what the party did, what shifted, what mattered. Select ruthlessly. A beat that does not connect to next session is a beat the recap does not owe the table.
3. **The edge** (1 to 2 sentences): end on the cliffhanger, the unanswered question, or the thing that woke the DM up at 2am.

**Voice rules:**

- Use PC names. Use NPC names.
- Never call the characters "the party" more than once per recap.
- Avoid generic fantasy adjectives (*ancient*, *mysterious*, *dark*) unless earned.
- Do not recap the mechanics. Describe what happened *in the world*.
- One sentence of dialogue is a spice, not a meal. At most one line of direct quotation, only if it lands cold.
- Name things the DM has canonized. If the session established the Kaldrfjell Tombs, say *Kaldrfjell Tombs*, not "a tomb up in the mountains."
- Watch verb choices when describing relationships between PCs and non-human creatures or NPCs. Non-human species with intelligence and agency deserve framings that reflect that: "acquired" implies ownership, "befriended" or "chose" implies mutuality.

**Meta-summary block:** every recap ends with a "Previously:" bullet list, fenced between two horizontal rules, sitting between the narration and any DM notes. Plain-language reference anchor for players who want the facts. Keep bullets tight: one fact per line, no flourish.

### 2. Handout

A handout is a **physical-feeling object** the players receive. Your job is to write the *text of the object*, not a description of the object.

**Always ask (or infer from the session brief) before writing a handout:**

- **What is the object?** (Letter, ledger entry, torn page, inscription, item description card, prophecy, rumor sheet, map annotation, menu.)
- **Who is the in-world author or source?**
- **What is the intended reader in-fiction?**
- **What does the DM want the players to walk away knowing, feeling, or wondering?**

Do not write a handout without answers to these four questions.

**Writing rules:**

- **Voice matches the source.** An imperial letter does not sound like a street urchin's scrawled note. A prophecy fragment does not sound like a shop inventory. Use KB articles for the source's culture and voice when available.
- **Length is load-bearing.** A letter is usually 150 to 300 words. An inscription is 10 to 40 words. A prophecy is 20 to 60 words. If a handout is longer than it needs to be, players will skim and lose the detail that matters.
- **Plant one clear thing and one ambiguous thing.** Handouts that are all clarity are dull; all mystery is frustrating. Aim for roughly 80% legible, 20% ambiguous.
- **Avoid modern idiom.** "Update me ASAP" is wrong; "Send word at the earliest" is right.
- **Handouts may be formatted.** Letters have a salutation and sign-off. Ledgers have columns. Torn pages have visible damage. Use formatting that *reads as the object*, whether that is markdown, a Foundry fragment, or a printable page.

### 3. Setpiece (boxed text)

A setpiece is boxed text for a **specific upcoming scene**: entering a new location, a villain's monologue, a reveal, a dungeon entrance.

**Voice:** second-person present tense for sensory description ("You step through the gate..."), third-person when describing NPCs or distant actions.

**Length:** 80 to 200 words per setpiece. One setpiece does one scene.

**Structure (internal):**

1. **Sensory entry:** what the PCs see first, in one sentence. Lead with the thing most specific to this place.
2. **Sensory texture:** one detail from each of two other senses.
3. **The thing that is wrong:** one detail that is slightly off, which hooks the players' attention.
4. **Handoff to play:** end with something that demands their response, and stop.

**Do not:**

- Describe what the PCs feel emotionally. Players own emotions; you own senses.
- Describe what the PCs do. Players do.
- Resolve the reveal. Describe the figure; let the player make the connection.

### 4. Timeline visualization

A player-facing or table-facing visual representation of a campaign timeline. Unlike the timeline skill's DM-reference chronology documents, this is *presentation content*, designed to be shown, printed, or displayed at the table or in a VTT.

**Voice:** factual but evocative. Not the dry reference tone of a DM chronology document, and not the dramatic narrator tone of a recap. Think historical atlas: clear, authoritative, with enough flavor to feel like it belongs in the world.

**Length:** scale to scope. A 1000-year overview gets one line per era; a single-session timeline gets one line per scene. Aim for the timeline to fit on one displayed page or screen; if it cannot, the scope is too broad and should be split.

**Format:** tool-agnostic, and orthogonal to the output-format choice described below. Pick the best fit for the session's tools and the DM's audience:

- **Markdown table**, cleanest for printed handouts and most VTT rich-text editors. Columns: Date, Event, Involved (or similar).
- **ASCII timeline**, works in any plain-text journal or chat-based VTT. Vertical line with date markers and short event labels.
- **Fenced Mermaid block** (`timeline` or `gantt`), if the consumer renders Mermaid (Obsidian, GitHub, some VTTs), produces a clean visual. Verify the consumer supports Mermaid before defaulting to this.
- **HTML**, when the destination is a Foundry field or a printed page. Build it as a Foundry fragment or printable page per the rules below rather than a bare table.

If you are unsure what the consumer supports, ask the DM. Do not default to a format that the destination cannot render.

**Writing rules:**

- Use in-world calendar names and date formats. Add a parenthetical conversion only when a secondary calendar is genuinely useful to the audience.
- Cross-reference entities using the project's link format, but only when the destination renders links. A printed handout does not need wikilinks.
- For player-facing timelines, include only information the players know. Cross-check session reports for what has been revealed. Do not leak DM-only canon.
- Mark uncertain or approximate dates explicitly ("circa," "early in the reign of," "before the Sundering").
- The artifact should feel like an in-world object: a scholar's timeline, a temple's reckoning, a faction's official history. Give it an attributed source in-fiction when appropriate.

## Output formats

Every content type above can be rendered in one of three output formats. The output format is a packaging decision, separate from the content type's voice and structure rules, which apply unchanged regardless of format.

### Markdown (default)

A plain markdown file using the project's cross-reference and frontmatter conventions, same as the rest of the KB suite. This is the right default for recaps and setpieces the DM reads from their own notes, and for any handout that will live in the KB as a reference file.

### Foundry fragment

A self-contained HTML snippet, pasteable into **any** Foundry HTML field: journal entry pages, item descriptions, actor biographies, and other module fields, not journals alone. Because it can land in any of those fields, in any world's theme, it must carry its own visual identity rather than lean on Foundry's surrounding styles:

- **All styling inline**, via `style` attributes on each element. No `<style>` block, no CSS classes, no external stylesheet links, no `<script>` tags. Foundry's editor sanitization and theme variation both make anything outside inline styles unreliable.
- **A self-contained color scheme.** Set explicit background and text colors on the fragment's outer container (for example a parchment card, a sealed-letter look, a weathered-page look) rather than leaving backgrounds transparent or colors inherited. The fragment must look the same whether pasted into a dark journal theme or a light actor sheet.
- **A fragment, not a document.** No `<!DOCTYPE>`, `<html>`, `<head>`, or `<body>` tags. Start directly with the outer container element so it drops cleanly into a rich-text field.
- **No external assets.** No linked fonts, no remote image URLs, unless the DM has confirmed the destination world can load them. If the piece calls for art, use an image slot (below) instead.

### Printable page

A standalone HTML document with print CSS, for physical handouts or PDF export via a browser's print dialog.

- **A complete single file:** `<!DOCTYPE html>`, `<html>`, `<head>` with an inline `<style>` block, `<body>`. No external stylesheets, fonts, or scripts.
- **`@media print` rules:** sensible page margins (`@page { margin: ...; }`), print-safe colors (`-webkit-print-color-adjust: exact;` and the standard equivalent where backgrounds matter to the design), and page-break control so a handout does not split awkwardly.
- **A screen-friendly preview** that reasonably matches the print layout, so the DM can proof it before printing.

### Prompt sidecar

Whenever a Foundry fragment or printable page includes an image slot (a letterhead illustration, an item's icon, a portrait, a map fragment), reserve the slot as a placeholder element with explicit `width` and `height` in the HTML, and produce a companion sidecar file alongside it (same base filename, `-IMAGE-PROMPT` suffix, plain markdown). The sidecar contains:

- **A positive prompt**, written for Flux2/ComfyUI-style generation: subject, composition, medium, lighting, and the campaign's established visual tone.
- **A negative prompt**, covering anything that would break the piece's fit (modern artifacts, wrong art style, unwanted text or watermarks, as applicable).
- **Output settings**, most importantly generation **dimensions that match the HTML slot's pixel dimensions or aspect ratio exactly**, so the DM's generated image drops into the slot without cropping or distortion. Note the project's established house style or checkpoint if one exists.
- A one-line reminder that the DM generates the image manually and replaces the placeholder once it exists; this skill does not run image generation itself.

Never produce an image slot without its sidecar, and never produce a sidecar whose dimensions do not match the slot it belongs to.

## Workflow

### Phase 1: Identify the work

If the user named specific content items, skip to output-format selection below. Otherwise:

1. Read the session report's cliffhangers, new canon, and narrative sections.
2. If a session brief exists, read its handout and setpiece candidates.
3. Confirm with the user in one AskUserQuestion batch which items to generate.

**Choose the output format.** For each item in the work list, confirm the output format (markdown, Foundry fragment, or printable page) and, if HTML, whether it needs an image slot. This is a structured, enumerable decision and goes through AskUserQuestion, batched with the work-list confirmation where practical. Default to markdown for recaps and setpieces unless the DM says otherwise; default to asking explicitly for handouts and timeline visualizations, since those are the types most often destined for Foundry or print.

### Phase 2: Gather context

This phase has two tracks. Run whichever apply, in this order:

**Track A: voice for handouts (if any handouts are in the work).** For each handout, confirm the four questions from the Handout section above via AskUserQuestion. Batch if there are multiple handouts. Do not draft any handout until every handout has answers.

**Track B: agent-supported research (if any agent-supported content types are in the work).** Some content types depend on analytical pre-work that a specialized agent does better than the content skill. When the work list includes one of these types, spawn the appropriate agent before drafting and incorporate its structured output in Phase 3.

Current agent-supported types:

- **Timeline visualization:** spawn the `historian` agent. Pass it the scope (audience, calendar, date range, entities or themes in focus) and a note that the output is player-facing, so it should flag any DM-only content the visualization must omit. Receive the historian's structured chronological report. Use it as the source for the visualization's events; do not invent dates or fill in gaps the historian did not confirm.

If the work list contains no agent-supported types, skip Track B.

The pattern is additive. Future content types may opt in by adding a row above (and a matching agent) without changing the existing types' flow.

### Phase 3: Draft

Write each piece applying the rules for its content type first. The content type's voice, length, and structure govern what the piece says, before any formatting is applied.

**Render into the chosen output format.** Once the prose is right, wrap it per the Output formats section: plain markdown as-is, or the drafted text carried into a self-contained Foundry fragment or a standalone printable page. If an image slot was requested, size the placeholder and draft its prompt sidecar now, alongside the piece.

**Self-check before writing to disk:**

- **Recap:** would a player who missed the session catch up? Under 450 words? Lands on the cliffhanger?
- **Handout:** voice matches source? One clear thing plus one ambiguous thing? Feels like an object?
- **Setpiece:** one off detail? Am I describing PC actions or emotions? Between 80 and 200 words?
- **Foundry fragment or printable page:** all styling inline (fragment) or in one internal `<style>` block (page)? No external assets? Would it render identically wherever it lands?
- **Image slot:** does the sidecar's dimensions match the HTML slot exactly?

If any check fails, revise before saving.

### Phase 4: Review and save

**Step 4a: present drafts for review.** Show each drafted piece to the DM. For markdown, show the text. For a Foundry fragment or printable page, show the rendered HTML content (and describe how it will look) along with its prompt sidecar if one exists. Wait for approval, requested changes, or rejection. Do not write any files until the DM approves. If the DM requests changes, revise and re-present. If a revision suggests more than one reasonable direction, offer the drafted options via AskUserQuestion rather than picking one silently.

**Step 4b: save approved content.** Write each approved file, and any prompt sidecar, to the content directory using the project's conventions. Create the directory if it does not exist.

**Update indexes and logs** per the project's conventions, for any markdown file that participates in them. Foundry fragments, printable pages, and prompt sidecars are working files for the table, not KB articles, and do not need index entries unless the project's conventions say otherwise.

**Step 4c: confirm with the user.** Share links to each file. Do not quote the content back; it is meant to be *encountered* rather than reviewed line by line. One line per file describing what it is and when to use it.

## Final act: update pipeline state

After everything else in this workflow has succeeded, the very last thing you do is write `.professor-orb/pipeline-state.json`:

```json
{
  "lastStep": "content",
  "sessionDate": "<carried forward, or the date of the session the content was drawn from, YYYY-MM-DD>",
  "updatedAt": "<current UTC time, ISO 8601>"
}
```

For `sessionDate`: if `.professor-orb/pipeline-state.json` already exists (typically because `debrief` or `prep` just ran), read its `sessionDate` field and carry it forward unchanged. If no `pipeline-state.json` exists yet, use the date of the session report the content was drawn from. `updatedAt` must be the current time at the moment you write this file; the Stop hook ignores state older than two hours.

**If `.professor-orb/` does not exist** (setup never ran for this project), skip this step silently. Do not create the directory yourself, that is the setup skill's job.

## Things to never do

- **Never fabricate canon.** If you need a detail that does not exist, ask the DM or write around the absence.
- **Never ignore the session brief's handoff list.** If a session brief lists handouts or setpieces, those are your work order.
- **Never blend content types.** A recap with boxed text in the middle is not a recap.
- **Never exceed the length guidance by more than 20%.** Discipline is the craft.
- **Never write content that draws on excluded material.** If a scene requires excluded content, stop and ask the DM to reframe.
- **Never ship a Foundry fragment with external CSS, classes, or scripts.** It has to survive being pasted into a field you cannot predict.
- **Never produce an image slot without a matching prompt sidecar**, and never let the sidecar's dimensions drift from the slot's.
- **Never pick an output format for the DM.** Markdown, Foundry fragment, and printable page are a structured choice; confirm it with AskUserQuestion rather than assuming.

## How this skill connects to the others

- **Position in the session pipeline:** debrief, then prep, then content and/or chronicler, then the `kb-validator` agent.
- **Inputs:** the latest report from `debrief` (required), the latest session brief from `prep` (optional but preferred).
- **Outputs:** content files (markdown, Foundry fragments, printable pages) and any prompt sidecars, in the campaign's content subdirectory.
- **Spawns:** the `historian` agent when a timeline visualization is in the work list.
- **Downstream of `prep`:** reads the session brief's handout and setpiece candidates as its default work list.
- **Orthogonal to `chronicler`:** content never modifies KB articles. If writing content reveals a canonical detail worth memorializing, note it in the final summary; do not touch KB articles.
