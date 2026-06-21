# dnd-campaign-toolkit

Post-session workflow suite for D&D Dungeon Masters. Handles the full loop from "we just played" to "the knowledge base is updated and next session is prepped."

All pipeline skills follow a propose-then-execute model: they draft their output, present it for review, and only write files after the DM approves. A shared principles file (`skills/SHARED-PRINCIPLES.md`) codifies the behavioral rules all skills follow.

## What it does

Six skills form the toolkit: four pipeline skills and two standalone tools.

1. **debrief** -- Captures session events into a structured report via interactive interview. Performs deep lore analysis: non-obvious connections, contradiction detection, and lore candidate identification. Spawns the lore agent for independent KB cross-referencing.

2. **prep** -- Collaborates with the DM to build a session brief: a compact reference document with a work review, last session recap, planned scenes (north stars), and handout list. Drafts the brief and waits for DM approval before saving.

3. **content** -- Writes player-facing content: dramatic read-aloud recaps, in-world handouts (letters, inscriptions, prophecies), and boxed-text setpieces for upcoming scenes.

4. **chronicler** -- Proposes knowledge base changes from a session report (new articles, edits, index updates), gets DM approval, then executes autonomously following your project's conventions. Incorporates output from the lore agent when available.

5. **timeline** -- Standalone. Builds and maintains DM-reference chronology documents in the KB, or answers ad-hoc temporal questions. Discovers calendar systems from your KB articles, scopes the work with you, spawns the historian agent for the underlying analysis, and proposes a chronology document before saving.

6. **homebrew** -- D&D 5.5e (2024 rules) homebrew design assistant. Spells, items, feats, subclasses, monsters, custom mechanics. Includes tiered design intervention, 2024 language standards, CR and rarity balance frameworks, SRD integration, and VTT automation awareness.

Three agents provide automated QA and analysis:

- **lore** -- Cross-references session events against existing KB articles. Flags contradictions, drafts update proposals, identifies non-obvious connections and entities without articles. Read-only: never edits files. Spawned by debrief or on demand.
- **kb-validator** -- Audits articles for frontmatter compliance, dead cross-references, filename convention violations, and index ownership rules.
- **historian** -- Read-only temporal analyst. Builds chronological indexes from session reports and KB articles, converts dates between calendar systems, answers temporal queries, and flags inconsistencies. Spawned by the timeline skill (primary) and the content skill (for timeline visualizations), or on demand.

Two hooks keep the pipeline connected:

- **PostToolUse (Write/Edit)** -- Validates KB article metadata and filename conventions at write time.
- **Stop** -- Suggests the next pipeline step after completing a skill.

## System-agnostic design

This plugin adapts to your project. All skills read your project's `CLAUDE.md` to learn your specific conventions: folder structure, file formats, cross-reference style, writing tone, index rules, and any special framing requirements.

**What you need:**

1. **A CLAUDE.md** in your project describing your KB conventions. The more detailed it is, the better the skills perform. At minimum: where articles live, how they're structured, and how cross-references work.
2. **A knowledge base** of some kind (markdown files, wiki export, structured notes). The skills are format-flexible.

**What you don't need:**

- No specific folder structure required. The skills discover yours.
- No templates shipped. The skills find your existing templates, learn from your prior files, or help you create a format.
- No VTT commitment. The skills adapt to FoundryVTT, Roll20, or no VTT at all.
- No environment variables or external services.

## Session pipeline

The workflow flows naturally:

```
debrief --> prep --> content
              \--> chronicler --> kb-validator
```

- After a session: "debrief me" or "session report" triggers **debrief**
- After a debrief: "what do I need to prep" triggers **prep**
- After prep: "write the recap" or "do the handouts" triggers **content**
- When ready: "update the lore" or "canonize last session" triggers **chronicler**
- After lore updates: "validate the articles" spawns the **kb-validator** agent
- Anytime: "build a timeline," "when did X happen," or "campaign chronology" triggers **timeline** (spawns the **historian** agent)
- Anytime: "help me design a magic item" or "review this homebrew" triggers **homebrew**

## Components

| Component | Type | Files |
|-----------|------|-------|
| debrief | Skill | skills/debrief/SKILL.md |
| prep | Skill | skills/prep/SKILL.md |
| content | Skill | skills/content/SKILL.md |
| chronicler | Skill | skills/chronicler/SKILL.md |
| timeline | Skill | skills/timeline/SKILL.md |
| homebrew | Skill | skills/homebrew/SKILL.md + references/ |
| lore | Agent | agents/lore.md |
| kb-validator | Agent | agents/kb-validator.md |
| historian | Agent | agents/historian.md |
| Shared Principles | Reference | skills/SHARED-PRINCIPLES.md |
| Pipeline hooks | Hooks | hooks/hooks.json |
