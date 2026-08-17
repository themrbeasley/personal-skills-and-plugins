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

- Where the homebrew catalog lives: the resolved setting's `homebrewRoot`, per SHARED-PRINCIPLES Principle 12
- Required frontmatter fields, their order, and any `type` enum values
- Filename rules (charset, suffix by type)
- Index conventions (owning index format, split thresholds for sub-indexes)

Read it rather than re-deriving these rules from prose (Shared Principle 9).

If it is missing, apply professor-orb's base schema per SHARED-PRINCIPLES Principle 11 and note that setup has not run. If nothing says where the catalog lives, ask the DM.

## Step 3: Establish how this catalog is versioned

Before writing anything, settle how this catalog records versions. This is decided once for the catalog, the first time it is used, and then followed silently on every later capture. The command never re-asks once the choice is on record.

Check these three cases, in this order:

1. **`.professor-orb/versioning.json` exists.** This marker lives in the project's `.professor-orb/` state folder, alongside `conventions.json` from Step 2, not in the catalog folder. Read its `mode` (`github`, `git`, or `changelog`) and carry that forward to Step 7. The rest of this step does not apply.
2. **`versioning.json` is absent, but the legacy `.professor-orb/catalog-versioning.json` exists.** Convert it: copy its `mode` and `decided` values unchanged into a new `.professor-orb/versioning.json`, and mention the conversion in passing. Never rewrite `decided`. Writing a fresh date destroys the only record of when the DM actually chose, and a later reader cannot tell a converted decision from a new one; that date is the single field this conversion exists to carry across. Do not delete the old file here; setup deletes it after its own snapshot commit has captured it. Carry the copied `mode` forward to Step 7. This case is not a variant of case 3 below and must never be folded into it: a DM who chose their mode before this command existed already made that decision, and re-asking it, or overwriting `decided` with today's date, would silently discard it.
3. **Neither file exists.** Versioning has genuinely never been established for this project, which means `/catalog` is running before `setup` ever has. Pre-existing catalog entries do not count as "established": a catalog can already hold entries, including ones captured before this command existed, and still have never had its versioning set up; do not read the presence of entries as a prior decision. Say plainly that setup has not recorded a versioning decision for this project, and point the DM at setup: that is where a real git repository is created, at the project root, and where GitHub can be connected.

   **Then offer the choice inline, once, but only between the no-git changelog baseline and waiting.** Use AskUserQuestion:
   - **If the DM wants to proceed now, on the changelog baseline:** write `.professor-orb/versioning.json` containing `{"mode": "changelog", "decided": "<today's date>"}`, and continue. Once the DM later runs setup, it can move the project onto `git` or `github`; this command never re-asks in the meantime.
   - **If the DM wants to wait, declines, or does not answer:** stop here without writing anything, and tell the DM to run setup first, then re-invoke `/catalog`.

   **This inline offer covers `changelog` only, and it never initializes a repository.** Under the canonical layout, the catalog root is the resolved setting's `homebrewRoot`, a sibling prong of `kbRoot` inside the project repository (SHARED-PRINCIPLES Principle 12), not a folder of its own. Initializing one there would plant a nested repository that setup's own state detection has no case for. If the DM wants git or GitHub tracking, that is established by running setup at the project root, never by this command reaching for it locally.

Creating a private remote and pushing to it stays entirely the DM's own action, arranged through setup and later pushed through `/scribe` or `/log`'s own push option. Never attempt account creation, authentication, or pushing here.

Carry the established mode (`git`, `github`, or `changelog`) forward to Step 7, where the version is recorded.

## Step 4: Identify the type and select its template

Determine the artifact's type. If the DM named it, or it is unambiguous from the finalized content itself (a stat block is plainly a monster or npc, a five-level progression table is plainly a class), use that. If it is genuinely ambiguous, ask with AskUserQuestion, offering the ten type keys: `spell`, `magic-item`, `feat`, `feature`, `monster`, `npc`, `species`, `subclass`, `class`, `other`.

Read `references/catalog-type-templates.md` (relative to this command) and use the `## <type key>` section matching the chosen type. For `monster` or `npc`, both keys draw on the shared `## monster and npc (shared stat-block schema)` section; `npc` additionally populates that section's flavor fields.

Each template section tags its fields: **[F]** frontmatter fields, **[B]** the named body blocks, and **[H]** homebrew-only fields with no SRD basis. Fill the **[F]** fields from what is evident in the DM's finalized content. For anything ambiguous, missing, or not decidable from the content alone, use AskUserQuestion to confirm it before writing; never guess a frontmatter value. Treat the **[B]** blocks per the template's Preservation rule: they hold the DM's finalized content and are carried into the entry verbatim, not rewritten or filled in from your own judgment.

## Step 5: Assemble the entry

First determine whether an entry for this homebrew already exists in the catalog (by name, and by the owning index from Step 2). If it does, this capture is a revision, and you edit that existing entry file in place rather than creating a second new file. If not, this is a new capture and you create a new file. Carry that revision-or-new determination forward into Step 7.

Write (or, for a revision, update in place) one markdown file to the homebrew catalog folder (per Step 2). The file is:

1. YAML frontmatter combining the required floor (`name`, `type`, `status`, `version`, `date`) with the type's **[F]** fields from Step 4 and anything `.professor-orb/conventions.json` marks required, in the field order conventions defines. `status` and `version` are set per the command's lifecycle handling, not chosen here.
2. A body made of the type's **[B]** blocks, each holding the DM's finalized content verbatim, plus the shared Design Notes block when one was composed via the homebrew skill's offer or otherwise supplied as part of the finalized content, per that block's own rules in `catalog-type-templates.md`. Never edit, reformat, complete, or otherwise improve it. Do not add wikilinks inside the entry: catalog entries sit outside the wikilink graph.

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

Versioning follows the mode established in Step 3 (`git`, `github`, or `changelog`) and the revision-or-new determination from the start of Step 5.

**Revision or new.** If Step 5 determined this is a revision, it becomes the next version of the existing entry. If not, this is version 1.

**Git or GitHub mode.** Once the entry (Step 5) and the owning index (Step 8) have both been written, stage and commit exactly those two files, by path, never a directory-wide add and never `-A` or `-a`, using the identical mechanism `/scribe` and `/log` use for their own lanes:

```
git add -- ":(literal)<entry file path>" ":(literal)<index file path>"
git commit --only -m "<message>" -- ":(literal)<entry file path>" ":(literal)<index file path>"
```

Never run a bare `git commit` after staging: with no pathspec it commits the entire index, sweeping in anything the DM staged elsewhere. Never run `git commit --only` without the identical prior `git add`: measured against real git, `--only` with nothing staged first silently omits a brand-new file whenever anything else in the index is already modified, exactly the shape of a first capture landing beside an unrelated in-progress edit. Keep the `:(literal)` prefix on both pathspec elements even though an entry filename rarely contains a glob character: the guarantee should not depend on inspecting the name first. Keep `-m "<message>"` before the `--` separator, not after: git parses everything after `--` as a pathspec, so a message placed there is not attached to the commit at all.

**Commit message** (the `<message>` above), naming the setting, the entry, and its version: `catalog(<setting>): <entry> v<version>`, for example `catalog(rolara): Frostbrand Dagger v2`. This applies to every capture against a git- or github-mode catalog, first capture or later revision alike. In this mode the entry carries no changelog block; the commit history is the record.

**Changelog mode.** Track versioning in the entry itself: the `version` frontmatter field (starting at 1, incremented by 1 on each revision), plus a short dated changelog line appended to the entry recording what this capture changed. Where useful, note the honest limitation in that changelog area: without git, there is no full recovery of a prior version's exact content, only the running description of what changed.

**Triggering a new version.** A new version is triggered by re-running `/catalog` on a piece of homebrew that already has an entry (per the revision-or-new determination in Step 5). There is no separate "revise" command; the same `/catalog` invocation handles both first capture and later revisions.

## Step 8: Update the owning index

Update the Homebrew catalog's owning index to list the entry, following the index format and single-ownership rule set by the conventions file's structural rules, which professor-orb owns. Ownership is single: the entry's link belongs in exactly one index, never duplicated across indexes. On a revision (per Step 5's determination), add the entry's link only if it is not already listed; do not duplicate the index line on re-capture.

If the catalog already has sub-indexes, follow that existing structure. Do not invent a new sub-index split on your own initiative. If the catalog has grown to the point where a new sub-index split looks warranted (per the `structuralSplitThreshold` rule), propose that split to the DM with AskUserQuestion instead of creating it unprompted.

Do not edit any other article to add a wikilink to the new entry. The only structural touch this command makes is the owning index update; catalog entries sit outside the wikilink graph, per Step 5.

In git mode (per Step 3), the entry and this index update are both now written, so make the commit described in Step 7 as the last action before reporting back.

## Step 9: Report back

Tell the DM, in one short block:

- The entry's file path
- Its type
- Its `status` (Step 6)
- Its `version` (Step 7), and whether this catalog folder is on git, GitHub, or the no-git changelog baseline
- A one-line confirmation that the owning index was updated
- How many commits are unpushed, if a remote exists for this project (`git` mode with a recorded remote, or `github` mode)
- Any other lane with uncommitted work that this command happened to notice while committing its own, named with the command that owns it: `/scribe` for the setting KB, `/log` for the session-reports lane. `/catalog` does not gain the surprise guard `/scribe` and `/log` carry, since it commits only the one entry and index it just authored itself, never a whole directory; this notice is a passing observation, not a scan, and it never leads to staging or committing anything outside those two files.

Keep it short: a handful of facts, not a restatement of the entry's contents.

## Things to never do

- Never catalog an unfinished or unconfirmed draft. Only content the DM has explicitly finalized belongs in the catalog.
- Never edit, reformat, or complete the DM's finalized content. The **[B]** blocks are carried verbatim.
- Never write a raw `.html` file. Content only ever lives inside the assembled markdown entry.
- Never add a wikilink inside the entry, or edit another article to add a wikilink to it. Catalog entries sit outside the wikilink graph.
- Never invent a new sub-index split without proposing it to the DM first via AskUserQuestion.
- Never write `.professor-orb/pipeline-state.json`. This command is outside the session pipeline.
- Never force git, or attempt remote creation, authentication, or pushing. The git and GitHub offer itself lives in `setup`, run once at the project root; `/catalog`'s Step 3 inline fallback is the one exception, reached only when neither `versioning.json` nor the legacy marker exists, and it offers only the no-git changelog baseline, never git or GitHub, and never initializes a repository of its own. Like setup's own offer, it is DM-approval-gated, made once when the catalog's versioning is first established, and never repeated once a choice is on record.
- Never present a homebrew-only (**[H]**) field as SRD canon. **[H]** fields have no SRD basis and should read as house rules, not published rules.

## How this command connects to the others

- **Standalone**, like `homebrew` and `timeline`: runs on demand, independent of the session pipeline's state, and never writes `.professor-orb/pipeline-state.json`.
- **Fed by:** the `homebrew` skill (`professor-orb/skills/homebrew/SKILL.md`), which points the DM here once a design is finalized, and again later once that design is implemented in Foundry, but never runs this capture itself.
- **Reads:** `.professor-orb/conventions.json` (CLAUDE.md fallback) for KB structure and frontmatter rules, and `references/catalog-type-templates.md` (relative to this command) for the type-specific field and body-block schema.
- **Writes:** one markdown entry in the homebrew catalog folder (new, or updated in place on a revision), the owning Homebrew index, and, on the first capture that establishes versioning, the `.professor-orb/versioning.json` marker. Nothing else.
- **Read back by:** the `homebrew` skill, which treats catalogued entries as design precedent alongside published material when checking for design overlap.

Foundry-JSON sourcing (reading an exported actor or item JSON directly, per Step 1) arrives in Phase 2 and is not available in this version.
