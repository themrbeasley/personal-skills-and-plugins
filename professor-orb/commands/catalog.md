---
description: "Capture a locked, post-tweak piece of homebrew (the DM's final as-built Foundry HTML) into the homebrew catalog: write one markdown entry and update the owning Homebrew index. Standalone, on demand, not part of the session pipeline."
argument-hint: "[paste the locked, post-tweak Foundry HTML]"
---

# /catalog: Capture Locked Homebrew

> **Before you begin:** read `../skills/SHARED-PRINCIPLES.md` (relative to this plugin) and apply its rules throughout this workflow.

You are capturing one piece of homebrew that the DM has already finished designing, implemented in their VTT (usually Foundry), and tweaked to its final table-real form. This command does exactly three things: write one markdown catalog entry, update the owning Homebrew index, and nothing else. It is precise and repeatable by design, capture is a command, not a reminder.

This command is **standalone**, like `homebrew` and `timeline`. It is not part of the debrief, prep, content, chronicler, kb-validator session pipeline and does not write `.professor-orb/pipeline-state.json`.

## What this command is not

- Not a place to store the homebrew skill's pre-tweak drafts. Only the locked, as-built version belongs here.
- Not a general KB writer. It writes exactly one entry file and touches exactly one index.
- Not an approval loop for the entry content. The DM invoking `/catalog` with pasted HTML is itself the explicit approval for that write (Shared Principle 2 still applies to the KB as a whole; this command is the one place where the DM's invocation already satisfies it).

## Step 1: Get the locked HTML

If the DM ran `/catalog` and pasted HTML in the same message, use that HTML. If they ran `/catalog` with nothing pasted, ask them for the locked, post-tweak HTML directly. Do not catalog a draft pulled from earlier conversation memory, even if one is sitting right there in the chat history. Skill drafts never enter the catalog; only the DM's confirmed, as-built paste does.

If the paste looks truncated, cut off mid-tag, or otherwise malformed, ask the DM about it rather than repairing or completing it yourself.

## Step 2: Resolve conventions

Check for `.professor-orb/conventions.json` first. If it exists, it is authoritative for:

- Where the homebrew catalog lives (the `homebrew/` folder of the KB, or wherever conventions locates it)
- Required frontmatter fields, their order, and any `type` enum values
- Filename rules (charset, suffix by type)
- Index conventions (owning index format, split thresholds for sub-indexes)

Read it rather than re-deriving these rules from prose (Shared Principle 9).

**If `.professor-orb/conventions.json` is missing,** fall back to reading the project's `CLAUDE.md` (or equivalent instructions file) directly. Extract the same information: where the homebrew catalog lives, frontmatter schema, filename conventions, and index format. If neither source says where the catalog lives, ask the DM.

## Step 3: Collect and confirm metadata

The entry's frontmatter needs at minimum:

- `name`, the homebrew item's name
- artifact type (spell, item, feat, subclass, class, monster, or whatever category fits)
- rarity or level, whichever applies to this artifact type (magic item rarity, spell level, and so on)
- `date`, the capture date (today, not the design date)
- `type: Homebrew`
- `publish: false`

If `.professor-orb/conventions.json` defines additional required fields, an order requirement, or a stricter enum for any of these, those govern; the fields above are the catalog-specific minimum, not a ceiling.

Fill in whatever is evident directly from the pasted HTML (a name in a heading, a rarity line, a level indicator). For anything not supplied by the DM and not evident from the HTML, such as an ambiguous artifact type, a missing rarity or level, or an unclear name, use AskUserQuestion to confirm it before writing. Do not guess.

## Step 4: Write the entry

Write one markdown file to the homebrew catalog folder (per Step 2). The file is:

1. YAML frontmatter with the fields confirmed in Step 3, matching the project's conventions in field order and required-field set.
2. The pasted HTML, wrapped in a fenced code block, byte-for-byte as the DM supplied it. Never edit, reformat, indent, or otherwise improve the HTML. Do not add wikilinks inside the entry: catalog entries sit outside the wikilink graph.

Follow the project's filename conventions (charset, suffix by type if one applies to Homebrew entries). If conventions.json is present, this write should pass the PostToolUse validator hook without a warning or block; if a block violation comes back, fix the entry and retry rather than working around the hook.

Never create a raw `.html` file. The HTML only ever lives inside the fenced block of the markdown entry.

## Step 5: Update the owning index

Update the Homebrew catalog's owning index to list the new entry, following whatever index format and ownership rule the project already uses (single ownership: the entry's link belongs in exactly one index).

If the catalog already has sub-indexes, follow that existing structure. Do not invent a new sub-index split on your own initiative. If the catalog has grown to the point where a new sub-index split looks warranted (per the project's split threshold convention, if one exists), propose that split to the DM with AskUserQuestion instead of creating it unprompted. Absent a clear threshold or an obvious existing split pattern, add the entry to the current owning index and move on.

Do not edit any other article to add a wikilink to the new entry. The only structural touch this command makes is the owning index update.

## Step 6: Report back

Tell the DM the file path of the new catalog entry and confirm the index update. Keep this short: a path and a one-line confirmation, not a restatement of the entry's contents.

## Things to never do

- Never catalog a draft from conversation memory instead of the DM's actual paste.
- Never edit, reformat, or complete the pasted HTML.
- Never write a raw `.html` file.
- Never add a wikilink inside the entry, or edit another article to link to it.
- Never invent a new sub-index split without proposing it to the DM first via AskUserQuestion.
- Never write `.professor-orb/pipeline-state.json`. This command is outside the session pipeline.
- Never ask for a second approval on the write itself once the DM has pasted the locked HTML; that paste is the approval.

## How this command connects to the others

- **Standalone**, like `homebrew` and `timeline`: runs on demand, independent of the session pipeline's state.
- **Fed by:** the `homebrew` skill (`professor-orb/skills/homebrew/SKILL.md`), which points the DM here once a design is locked and implemented, but never runs this capture itself.
- **Reads:** `.professor-orb/conventions.json` (CLAUDE.md fallback) for KB structure and frontmatter rules.
- **Writes:** exactly one new markdown entry in the homebrew catalog folder, plus the owning Homebrew index. Nothing else.
- **Read back by:** the `homebrew` skill, which treats catalogued entries as design precedent alongside published material when checking for design overlap.
