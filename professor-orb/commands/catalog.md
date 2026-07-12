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

The primary source is the finalized homebrew the DM just confirmed, typically the homebrew skill's iterated output, whether pasted or referenced in the same message, or confirmed earlier in this conversation. This needs no Foundry. If the DM instead supplies a manual paste of finalized content, use that.

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

## Step 3: Establish how this catalog is versioned

Before writing anything, settle how this catalog records versions. This is decided once for the catalog, the first time it is used, and then followed silently on every later capture. The command never re-asks once the choice is on record.

Check these in order:

1. **Is the catalog folder already inside a git repository?** If yes, the mode is git: every capture is a commit, and the repository's own presence is the record of that choice. Skip the offer and carry `git` forward to Step 7.
2. **Does a versioning marker exist at `.professor-orb/catalog-versioning.json`?** This marker lives in the project's `.professor-orb/` state folder, alongside `conventions.json` from Step 2, not in the catalog folder. If it exists, read its `mode` (`git` or `changelog`) and carry that forward to Step 7. Skip the offer.
3. **Neither a git repository nor a marker exists.** Versioning has never been established for this catalog, so this is the moment to offer it, once. Pre-existing catalog entries do not count as "established": a catalog can already hold entries, including ones captured before this command existed, and still have never had its versioning set up. Do not read the presence of entries as a prior decision.

**Making the first-time offer (case 3 only).** Use AskUserQuestion to offer setting the catalog up as a local git repository, so every capture becomes a real commit with full history and recoverable prior versions. Recommend it, but do not force it; this is a single first-run offer, not a recurring prompt.

- **If the DM accepts:** run `git init` locally in the catalog root, then write `.professor-orb/catalog-versioning.json` containing `{"mode": "git", "decided": "<today's date>"}`. The mode is git for this capture and every future one.
- **If the DM declines, or does not answer:** write `.professor-orb/catalog-versioning.json` containing `{"mode": "changelog", "decided": "<today's date>"}`. The mode is the no-git changelog baseline. Because the choice is now recorded, the command will not offer git again for this catalog; the DM can set git up themselves later if they change their mind.

Creating a private remote and pushing to it stays entirely the DM's own action. Never attempt account creation, authentication, or pushing.

Carry the established mode (`git` or `changelog`) forward to Step 7, where the version is recorded.

## Step 4: Identify the type and select its template

Determine the artifact's type. If the DM named it, or it is unambiguous from the finalized content itself (a stat block is plainly a monster or npc, a five-level progression table is plainly a class), use that. If it is genuinely ambiguous, ask with AskUserQuestion, offering the ten type keys: `spell`, `magic-item`, `feat`, `feature`, `monster`, `npc`, `species`, `subclass`, `class`, `other`.

Read `references/catalog-type-templates.md` (relative to this command) and use the `## <type key>` section matching the chosen type. For `monster` or `npc`, both keys draw on the shared `## monster and npc (shared stat-block schema)` section; `npc` additionally populates that section's flavor fields.

Each template section tags its fields: **[F]** frontmatter fields, **[B]** the named body blocks, and **[H]** homebrew-only fields with no SRD basis. Fill the **[F]** fields from what is evident in the DM's finalized content. For anything ambiguous, missing, or not decidable from the content alone, use AskUserQuestion to confirm it before writing; never guess a frontmatter value. Treat the **[B]** blocks per the template's Preservation rule: they hold the DM's finalized content and are carried into the entry verbatim, not rewritten or filled in from your own judgment.

## Step 5: Assemble the entry

First determine whether an entry for this homebrew already exists in the catalog (by name, and by the owning index from Step 2). If it does, this capture is a revision, and you edit that existing entry file in place rather than creating a second new file. If not, this is a new capture and you create a new file. Carry that revision-or-new determination forward into Step 7.

Write (or, for a revision, update in place) one markdown file to the homebrew catalog folder (per Step 2). The file is:

1. YAML frontmatter combining the required floor (`name`, `type`, `status`, `version`, `date`) with the type's **[F]** fields from Step 4 and anything `.professor-orb/conventions.json` marks required, in the field order conventions defines. `status` and `version` are set per the command's lifecycle handling, not chosen here.
2. A body made of the type's **[B]** blocks, each holding the DM's finalized content verbatim. Never edit, reformat, complete, or otherwise improve it. Do not add wikilinks inside the entry: catalog entries sit outside the wikilink graph.

Follow the project's filename conventions (charset, suffix by type if one applies). The write should pass the PostToolUse validator hook without a warning or block; if a block violation comes back, fix the entry and retry rather than working around the hook.

Never write a raw `.html` file. Content only ever lives inside the assembled markdown entry's frontmatter or body blocks.

## Step 6: Stamp lifecycle status

Every catalog entry carries a `status` field, because all catalogued homebrew is playtest material until the DM says otherwise. Allowed values:

- `playtest`: the default for a new capture. Untested or lightly tested at the table.
- `active`: the DM has settled on this version as the one currently in play.
- `reverted`: the DM tried this version and pulled it back; the entry stays for the record.
- `discontinued`: retired and no longer in play.

Set `playtest` on a new capture unless the DM explicitly says otherwise. A later revision (Step 7) may change the status, for example moving a proven piece from `playtest` to `active`, or marking one that did not work out `reverted` or `discontinued`.

For a stat block with multiple parts (say, a monster with several abilities, or a class with several subclass features), the entry's overall `status` need not describe every part uniformly. A single part can be noted discontinued in place, as an inline note on that part in the body, while the rest of the entry and its `status` field stay as they are. Do not discontinue the whole entry over one part the DM has dropped.

## Step 7: Record the version

Versioning follows the mode established in Step 3 (`git` or `changelog`) and the revision-or-new determination from the start of Step 5.

**Revision or new.** If Step 5 determined this is a revision, it becomes the next version of the existing entry. If not, this is version 1.

**Git mode.** Once the entry (Step 5) and the owning index (Step 8) have both been written, commit that change with a message naming the entry and its version, for example `catalog: <entry name> v<version>`. This applies to every capture against a git-mode catalog, first capture or later revision alike. In git mode the entry carries no changelog block; the commit history is the record.

**Changelog mode.** Track versioning in the entry itself: the `version` frontmatter field (starting at 1, incremented by 1 on each revision), plus a short dated changelog line appended to the entry recording what this capture changed. Where useful, note the honest limitation in that changelog area: without git, there is no full recovery of a prior version's exact content, only the running description of what changed.

**Triggering a new version.** A new version is triggered by re-running `/catalog` on a piece of homebrew that already has an entry (per the revision-or-new determination in Step 5). There is no separate "revise" command; the same `/catalog` invocation handles both first capture and later revisions.

## Step 8: Update the owning index

Update the Homebrew catalog's owning index to list the entry, following whatever index format and ownership rule the project already uses. Ownership is single: the entry's link belongs in exactly one index, never duplicated across indexes. On a revision (per Step 5's determination), add the entry's link only if it is not already listed; do not duplicate the index line on re-capture.

If the catalog already has sub-indexes, follow that existing structure. Do not invent a new sub-index split on your own initiative. If the catalog has grown to the point where a new sub-index split looks warranted (per the project's split threshold convention, if one exists), propose that split to the DM with AskUserQuestion instead of creating it unprompted. Absent a clear threshold or an obvious existing split pattern, add the entry to the current owning index and move on.

Do not edit any other article to add a wikilink to the new entry. The only structural touch this command makes is the owning index update; catalog entries sit outside the wikilink graph, per Step 5.

In git mode (per Step 3), the entry and this index update are both now written, so make the commit described in Step 7 as the last action before reporting back.

## Step 9: Report back

Tell the DM, in one short block:

- The entry's file path
- Its type
- Its `status` (Step 6)
- Its `version` (Step 7), and whether this catalog folder is git-versioned or on the no-git baseline
- A one-line confirmation that the owning index was updated

Keep it short: a handful of facts, not a restatement of the entry's contents.

## Things to never do

- Never catalog an unfinished or unconfirmed draft. Only content the DM has explicitly finalized belongs in the catalog.
- Never edit, reformat, or complete the DM's finalized content. The **[B]** blocks are carried verbatim.
- Never write a raw `.html` file. Content only ever lives inside the assembled markdown entry.
- Never add a wikilink inside the entry, or edit another article to add a wikilink to it. Catalog entries sit outside the wikilink graph.
- Never invent a new sub-index split without proposing it to the DM first via AskUserQuestion.
- Never write `.professor-orb/pipeline-state.json`. This command is outside the session pipeline.
- Never force git, or attempt remote creation, authentication, or pushing. The git offer in Step 3 is DM-approval-gated, local-only, made once when the catalog's versioning is first established, and never repeated once a choice is on record.
- Never present a homebrew-only (**[H]**) field as SRD canon. **[H]** fields have no SRD basis and should read as house rules, not published rules.

## How this command connects to the others

- **Standalone**, like `homebrew` and `timeline`: runs on demand, independent of the session pipeline's state, and never writes `.professor-orb/pipeline-state.json`.
- **Fed by:** the `homebrew` skill (`professor-orb/skills/homebrew/SKILL.md`), which points the DM here once a design is finalized, and again later once that design is implemented in Foundry, but never runs this capture itself.
- **Reads:** `.professor-orb/conventions.json` (CLAUDE.md fallback) for KB structure and frontmatter rules, and `references/catalog-type-templates.md` (relative to this command) for the type-specific field and body-block schema.
- **Writes:** one markdown entry in the homebrew catalog folder (new, or updated in place on a revision), the owning Homebrew index, and, on the first capture that establishes versioning, the `.professor-orb/catalog-versioning.json` marker. Nothing else.
- **Read back by:** the `homebrew` skill, which treats catalogued entries as design precedent alongside published material when checking for design overlap.

Foundry-JSON sourcing (reading an exported actor or item JSON directly, per Step 1) arrives in Phase 2 and is not available in this version.
