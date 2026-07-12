---
description: "Capture one finalized, DM-confirmed piece of homebrew as a type-specific catalog entry and maintain it across its playtest life: write one markdown entry, stamp its lifecycle status, record a version, and update the owning Homebrew index. Standalone, on demand, not part of the session pipeline."
argument-hint: "[optionally paste finalized homebrew, or name what to catalog]"
---

# /catalog: Capture Finalized Homebrew

> **Before you begin:** read `../skills/SHARED-PRINCIPLES.md` (relative to this plugin) and apply its rules throughout this workflow.

You are capturing one piece of homebrew the DM has already finished designing and confirmed, usually the homebrew skill's iterated output. This command turns that finalized design into a per-type catalog entry: it stamps the entry's lifecycle status, records a version, writes one markdown catalog entry, and updates the owning Homebrew index, then stops. It is precise and repeatable by design, capture is a command, not a reminder.

This command is **standalone**, like `homebrew` and `timeline`. It is not part of the debrief, prep, content, chronicler, kb-validator session pipeline and never writes `.professor-orb/pipeline-state.json`.

## What this command is not

- Not a store for pre-finalization drafts. Only finalized, confirmed homebrew belongs here.
- Not a general KB writer. It writes exactly one entry file and touches exactly one index.
- Not a second approval loop. The DM invoking `/catalog` on content they just confirmed is itself the approval for that write (Shared Principle 2 still applies to the KB as a whole; this command is the one place where the DM's invocation already satisfies it).

## Step 1: Get the finalized homebrew

The primary source is the finalized homebrew the DM just confirmed, typically the homebrew skill's iterated output pasted or referenced in the same message. This needs no Foundry. If the DM instead supplies a manual paste of finalized content, use that.

Reading an exported Foundry actor or item JSON is a planned enrichment and is not yet available in this version. For now, capture from the finalized design or a paste; do not ask the DM for a Foundry export.

Catalog only finalized, confirmed homebrew. The guard is not "only a fresh paste"; it is "only content the DM has finalized." The DM invoking /catalog on content they just confirmed is the approval. Do not re-paste what the assistant already authored, and do not catalog an unfinished draft.

If content looks truncated, cut off mid-tag, or otherwise malformed, ask the DM about it rather than repairing or completing it yourself.

## Step 2: Resolve conventions

Check for `.professor-orb/conventions.json` first. If it exists, it is authoritative for:

- Where the homebrew catalog lives (the `homebrew/` folder of the KB, or wherever conventions locates it)
- Required frontmatter fields, their order, and any `type` enum values
- Filename rules (charset, suffix by type)
- Index conventions (owning index format, split thresholds for sub-indexes)

Read it rather than re-deriving these rules from prose (Shared Principle 9).

**If `.professor-orb/conventions.json` is missing,** fall back to reading the project's `CLAUDE.md` (or equivalent instructions file) directly. Extract the same information: where the homebrew catalog lives, frontmatter schema, filename conventions, and index format. If neither source says where the catalog lives, ask the DM.

## Step 3: Identify the type and select its template

Determine the artifact's type. If the DM named it, or it is unambiguous from the finalized content itself (a stat block is plainly a monster or npc, a five-level progression table is plainly a class), use that. If it is genuinely ambiguous, ask with AskUserQuestion, offering the ten type keys: `spell`, `magic-item`, `feat`, `feature`, `monster`, `npc`, `species`, `subclass`, `class`, `other`.

Read `references/catalog-type-templates.md` (relative to this command) and use the `## <type key>` section matching the chosen type. For `monster` or `npc`, both keys draw on the shared `## monster and npc (shared stat-block schema)` section; `npc` additionally populates that section's flavor fields.

Each template section tags its fields: **[F]** frontmatter fields, **[B]** the named body blocks, and **[H]** homebrew-only fields with no SRD basis. Fill the **[F]** fields from what is evident in the DM's finalized content. For anything ambiguous, missing, or not decidable from the content alone, use AskUserQuestion to confirm it before writing; never guess a frontmatter value. Treat the **[B]** blocks per the template's Preservation rule: they hold the DM's finalized content and are carried into the entry verbatim, not rewritten or filled in from your own judgment.

## Step 4: Assemble the entry

Write one markdown file to the homebrew catalog folder (per Step 2). The file is:

1. YAML frontmatter combining the required floor (`name`, `type`, `status`, `version`, `date`) with the type's **[F]** fields from Step 3 and anything `.professor-orb/conventions.json` marks required, in the field order conventions defines. `status` and `version` are set per the command's lifecycle handling, not chosen here.
2. A body made of the type's **[B]** blocks, each holding the DM's finalized content verbatim. Never edit, reformat, complete, or otherwise improve it. Do not add wikilinks inside the entry: catalog entries sit outside the wikilink graph.

Follow the project's filename conventions (charset, suffix by type if one applies). The write should pass the PostToolUse validator hook without a warning or block; if a block violation comes back, fix the entry and retry rather than working around the hook.

Never write a raw `.html` file. Content only ever lives inside the assembled markdown entry's frontmatter or body blocks.

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
