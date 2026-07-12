# /catalog Redesign Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the professor-orb `/catalog` command from a single-HTML-blob capture into an artifact-type-aware, versioned homebrew capture that works from the homebrew skill's finalized output or a manual paste (no Foundry required).

**Architecture:** `/catalog` becomes an orchestration command (`commands/catalog.md`) that resolves KB conventions, dispatches to one of ten per-type entry templates held in a companion reference file (`commands/references/catalog-type-templates.md`), preserves the DM's finalized content verbatim, stamps a lifecycle status, and records versions via a two-track scheme (an offered local git repo, or a no-git changelog baseline). This phase does NOT read Foundry JSON; that is Phase 2.

**Tech Stack:** Markdown command + markdown reference file. No executable code, no test framework (per professor-orb's design: "it is all markdown"). Validation is structural (frontmatter parses, references resolve, house-rule scans) plus one manual end-to-end exercise of a design-time capture.

## Global Constraints

Copied verbatim from the spec and the project house rules. Every task's requirements implicitly include this section.

- No em dashes anywhere in plugin files: neither the character `—` (U+2014) nor `--` used as a prose dash. (Rolara's own conventions block them; keep the plugin consistent.)
- Frontmatter `description` fields: double-quoted, under ~1500 characters (the Cowork content validator rejects the whole plugin otherwise; `claude plugin validate` does NOT catch this).
- Never modify `professor-orb/CONTEXT.md` or anything under `dnd-campaign-toolkit/`.
- Phase 1 EXCLUDES Foundry-JSON sourcing and the Bionoid Bond re-capture. Both are Phase 2. Where Phase 1 prose must mention Foundry sourcing, it states that reading an exported Foundry actor/item JSON is a Phase 2 capability, not yet available.
- Preserve existing machinery unchanged: conventions-first resolution (`.professor-orb/conventions.json`, `CLAUDE.md` fallback), single-ownership index update, PostToolUse write-time validator compliance, standalone status (never writes `.professor-orb/pipeline-state.json`), and the homebrew-skill handoff into `/catalog`.
- Per-type field sets are grounded in SRD 5.2.1 (2024 rules) exactly as enumerated in the spec `docs/superpowers/specs/2026-07-11-catalog-redesign-design.md`. Fields with no SRD basis are flagged as homebrew, never presented as canon.
- Anti-draft gate is DM-supremacy based: the guard is "only catalog finalized, confirmed content," and the DM's act of invoking `/catalog` on confirmed content is the approval. No re-paste of what the assistant already authored.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Do NOT stage `professor-orb/CONTEXT.md`, `.claude/`, `package.json`, or `package-lock.json`. Leave untracked things untracked.

## File Structure

- `professor-orb/commands/references/catalog-type-templates.md` — NEW. Holds all ten per-type entry templates (frontmatter field sets tagged F/B/H, body skeleton, per-type format conventions). Created by Tasks 1-3.
- `professor-orb/commands/catalog.md` — REWRITTEN. The orchestration command: framing, sourcing, conventions resolution, per-type dispatch, lifecycle, versioning, index update, report. Rewritten by Tasks 4-7.
- `professor-orb/README.md` — MODIFIED. The `/catalog` component row is updated to describe the new model. Task 8.
- `professor-orb/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` — MODIFIED. Version bump to 1.2.0. Task 8.

Reference convention: from `commands/catalog.md`, the templates file is referenced by the relative path `references/catalog-type-templates.md` (mirroring how skills reference `references/...`).

### Shared validation snippet

Several tasks reuse these checks. `FILE` is the file the task wrote.

```bash
# 1. Em dash character must not appear:
grep -nP "\x{2014}" "$FILE" && echo "FAIL: em dash char present" || echo "OK: no em dash char"
# 2. Prose double-hyphen scan (review hits by eye; code fences / CLI flags are allowed, prose dashes are not):
grep -n -- "--" "$FILE" || echo "OK: no double hyphen at all"
# 3. Relative references named in the file must resolve (run from the file's directory):
#    for each `references/X` or `../skills/Y` mentioned, test -f the resolved path.
```

For any file with YAML frontmatter, verify the `description` is double-quoted and under 1500 chars:

```bash
python -c "import re,sys; t=open(r'$FILE',encoding='utf-8').read(); m=re.search(r'^description:\s*\"(.*?)\"\s*$', t, re.M); print('len', len(m.group(1))) if m else sys.exit('FAIL: description not found or not double-quoted')"
```

---

### Task 1: Type templates — single-description types (spell, magic item, feat, feature)

**Files:**
- Create: `professor-orb/commands/references/catalog-type-templates.md`
- Validation: shared snippet above

**Interfaces:**
- Produces: the templates reference file with a stable top-level structure and the first four type sections. Later tasks (2, 3) append more type sections to the SAME file. `commands/catalog.md` (Task 5) will reference this file by relative path `references/catalog-type-templates.md` and dispatch by a type key. The type keys this task establishes: `spell`, `magic-item`, `feat`, `feature`.

- [ ] **Step 1: Create the file with its header and shared conventions**

The file opens with a short purpose paragraph and a shared-conventions block that every template obeys, then the per-type sections. Header content to write:

```markdown
# Catalog entry templates by artifact type

This file defines one entry template per homebrew artifact type. `/catalog` reads it and
uses the template matching the artifact's type. Each template lists its fields tagged:

- **[F]** frontmatter / metadata (structured, goes in the entry's YAML frontmatter)
- **[B]** rendered body (the DM's finalized content, preserved verbatim per Preservation below)
- **[H]** homebrew-only field with no SRD 5.2.1 basis; never present it as canon

Field sets are grounded in SRD 5.2.1 (2024 rules). See the design spec
`docs/superpowers/specs/2026-07-11-catalog-redesign-design.md` for provenance.

## Shared rules for every template

- **Preservation:** the body holds the DM's finalized content verbatim. The medium follows
  the source: content designed in the homebrew skill is preserved as the finalized formatted
  text; content exported from Foundry (Phase 2) is preserved as raw HTML in fenced blocks.
  Never silently rewrite the DM's content.
- **Skeleton vs content:** the template defines the frontmatter fields and which named body
  blocks exist for the type. The source fills each block verbatim.
- **Required frontmatter floor (all types):** `name`, `type` (the artifact type key),
  `status` (lifecycle; see the command), `version`, `date` (capture date, today), plus
  whatever `.professor-orb/conventions.json` marks required. Type-specific fields below are
  additive.
```

- [ ] **Step 2: Append the four single-description templates**

Append these four sections. Reproduce the field lists exactly.

```markdown
## spell

- **[F]** name; level (0-9, 0 = cantrip); school (enum: Abjuration, Conjuration, Divination,
  Enchantment, Evocation, Illusion, Necromancy, Transmutation); class tags; casting time
  (append `or Ritual` when applicable); range (a distance, Touch, or Self); components (V/S/M
  plus material text); duration (append `Concentration, up to ...` when applicable).
- **[B]** effect prose, then a trailing `Using a Higher-Level Spell Slot.` (leveled) or
  `Cantrip Upgrade.` (cantrip) paragraph when present.
- **[H]** optional boolean `ritual` / `concentration` for filtering. Save DC and attack bonus
  are never per-spell.

## magic-item

- **[F]** name; category (enum: Armor, Potion, Ring, Rod, Scroll, Staff, Wand, Weapon,
  Wondrous Item; plus subtype text where relevant); rarity (enum: Common, Uncommon, Rare,
  Very Rare, Legendary, Artifact); attunement (bool plus optional qualifier string); charges
  (count plus recharge phrasing, default "daily at dawn"); cursed (bool, default false).
- **[B]** effect prose plus optional `Regaining Charges.` paragraph; optional sentience
  sub-block only for items the DM makes sentient.
- **[H]** fixed GP price (SRD gives value by rarity band only); activation-method enum.

## feat

- **[F]** name; category (enum: Origin, General, Fighting Style, Epic Boon); prerequisite
  (optional free text); repeatable (bool plus optional condition string).
- **[B]** a single prose block, or `You gain the following benefits.` followed by a
  named-benefit list. An `Ability Score Increase.` benefit is a conventionally-named list
  item, not a field.
- **[H]** machine-checkable prerequisite parts; "has ASI" boolean.

## feature

Inherently a homebrew shape (the SRD has no standalone feature type; the closest analogue is
a class/subclass feature). Bionoid Bond is the exemplar.

- **[F]** name; source (class / subclass / species / campaign); level or grant condition.
- **[B]** a single prose block; internal sub-sections allowed (for example Armor Mode and
  Combat Mode headings).
- **[H]** the entire standalone / campaign-granted notion, plus prerequisite / trigger /
  scope. None are SRD.
```

- [ ] **Step 3: Validate**

Run the shared validation snippet with `FILE=professor-orb/commands/references/catalog-type-templates.md`.
Expected: no em dash char; any `--` hits are inside field enums only if written as prose (there should be none, rewrite any prose dash as a comma or restructure); the spec reference path resolves.

Confirm the four sections exist:

```bash
grep -nE "^## (spell|magic-item|feat|feature)$" professor-orb/commands/references/catalog-type-templates.md
```
Expected: four matching lines.

- [ ] **Step 4: Commit**

```bash
git add professor-orb/commands/references/catalog-type-templates.md
git commit -m "feat(professor-orb/catalog): add single-description type templates

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Type templates — stat-block types (monster, npc)

**Files:**
- Modify: `professor-orb/commands/references/catalog-type-templates.md` (append)

**Interfaces:**
- Consumes: the file and shared-rules block from Task 1.
- Produces: type keys `monster` and `npc`, backed by one shared stat-block schema.

- [ ] **Step 1: Append the shared stat-block section**

Append this. `monster` and `npc` share the schema; `npc` adds the flavor fields.

```markdown
## monster and npc (shared stat-block schema)

`monster` and `npc` are two type keys over one stat-block schema. An NPC is, per the SRD
glossary, a monster with a personal name and personality: same stat block, differing only in
which flavor fields are populated. Use type key `monster` for a bestiary creature and `npc`
for a named, characterized one; `npc` entries additionally populate the flavor fields below.

- **[F]** name; size; creature type (plus descriptive tag); alignment; AC; initiative
  (modifier plus score); HP (number plus hit-dice expression); speed (walking plus special
  movement); six ability scores (STR, DEX, CON, INT, WIS, CHA); saving-throw modifiers;
  skills; resistances; vulnerabilities; damage and condition immunities; gear; senses
  (special senses plus passive Perception); languages (plus telepathy); CR (plus XP, plus
  Proficiency Bonus).
- **[B]** Traits, Actions, Bonus Actions, Reactions, Legendary Actions. Each named entry is a
  `{name, description}` pair. Omit an empty section entirely. Use 2024 phrasing verbatim from
  the source: `Melee/Ranged Attack Roll: +X, reach/range N ft. Hit: N (dice) Type damage.`;
  saves as `<Ability> Saving Throw: DC N, <targets>. Failure: ... Success: ...`; Multiattack
  first in Actions; Legendary Actions preceded by the usage boilerplate line; Legendary
  Resistance is a Trait, not its own section.
- **[H]** (npc flavor only) roleplay bio, personality, faction / affiliation, location(s),
  plot hooks / secrets, relationships, portrait reference. Also "Habitat" and "Treasure"
  lines (absent from SRD 5.2.1; Monster-Manual-style, not SRD-native).
```

- [ ] **Step 2: Validate**

```bash
grep -nE "^## monster and npc" professor-orb/commands/references/catalog-type-templates.md
```
Expected: one matching line. Run the shared em-dash and double-hyphen scans on the file; fix any prose dash.

- [ ] **Step 3: Commit**

```bash
git add professor-orb/commands/references/catalog-type-templates.md
git commit -m "feat(professor-orb/catalog): add shared monster/npc stat-block template

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Type templates — collection types (species, subclass, class) and other/custom

**Files:**
- Modify: `professor-orb/commands/references/catalog-type-templates.md` (append)

**Interfaces:**
- Consumes: the file from Tasks 1-2.
- Produces: type keys `species`, `subclass`, `class`, `other`. After this task the file defines all ten keys: `spell`, `magic-item`, `feat`, `feature`, `monster`, `npc`, `species`, `subclass`, `class`, `other`.

- [ ] **Step 1: Append the collection and catch-all templates**

```markdown
## species

- **[F]** name; creature type; size; speed.
- **[B]** a flat set of named traits (`{name, description}`); named sub-choice tables
  (draconic ancestry, elven / gnomish lineage, giant ancestry, fiendish legacy) where the
  species presents a choice.
- **[H]** structured resource tracking (uses / recharge) parsed out of trait prose; "size
  chosen at creation" boolean.

## subclass

- **[F]** name; parent class; subclass-feature levels (array of ints).
- **[B]** a one-line tagline; a flavor paragraph; level-keyed features (`Level N: Name` plus
  prose).
- **[H]** balance / tier tags; author; version metadata.

## class

- **[F]** name; primary ability; hit point die; saving-throw proficiencies; skill
  proficiencies (choose-N plus list); weapon proficiencies; armor training; tool
  proficiencies (optional, some classes grant none); starting-equipment options;
  subclass-choice level.
- **[B]** the progression table (`Level | Proficiency Bonus | Features | class-resource
  columns`); level-keyed features; the multiclass-entry subset.
- **[H]** a flexible `extraColumns` structure for class-specific resource trackers (names
  vary per class); playstyle / tier tags.

## other

Catch-all so no novel kind of homebrew is ever blocked.

- **[F]** name; a DM-defined type label.
- **[B]** free-form, preserved verbatim.
- **[H]** everything.
```

- [ ] **Step 2: Validate the full file defines all ten keys**

```bash
grep -nE "^## (spell|magic-item|feat|feature|monster and npc|species|subclass|class|other)$" professor-orb/commands/references/catalog-type-templates.md
```
Expected: nine heading lines (the monster/npc heading covers two keys, for ten keys total). Run the em-dash and double-hyphen scans; fix any prose dash.

- [ ] **Step 3: Commit**

```bash
git add professor-orb/commands/references/catalog-type-templates.md
git commit -m "feat(professor-orb/catalog): add collection and catch-all type templates

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Rewrite catalog.md — frontmatter, framing, and sourcing

**Files:**
- Modify: `professor-orb/commands/catalog.md` (replace lines 1-24: frontmatter through "Step 1: Get the locked HTML")

**Interfaces:**
- Produces: the command's opening: updated `description`/`argument-hint` frontmatter, the "what this is / is not" framing, and the sourcing step establishing the corrected anti-draft gate. Later tasks (5-7) continue the command body below this.

- [ ] **Step 1: Replace the frontmatter and framing**

Rewrite the frontmatter and opening framing. Requirements:
- `description` (double-quoted, under 1500 chars) states: capture a finalized piece of homebrew as a type-specific catalog entry and maintain it across its playtest life; standalone, on demand, not part of the session pipeline.
- `argument-hint` no longer says "paste the locked HTML"; it reads `"[optionally paste finalized homebrew, or name what to catalog]"`.
- Keep the `> **Before you begin:** read ../skills/SHARED-PRINCIPLES.md ...` line unchanged.
- The framing paragraph reframes the command: it captures one finalized piece of homebrew (designed and confirmed by the DM, usually via the homebrew skill) as a per-type entry, stamps its lifecycle status, and records a version. It writes one entry file, updates the owning index, and records versioning. It remains standalone (never writes `pipeline-state.json`).
- Keep a "What this command is not" list, updated: not a store for pre-finalization drafts (only finalized, confirmed homebrew); not a general KB writer (one entry plus one index); not a second approval loop (the DM's invocation on confirmed content is the approval).

- [ ] **Step 2: Replace Step 1 with the corrected sourcing step**

Write a "## Step 1: Get the finalized homebrew" section. Required content:
- Primary source: the finalized homebrew the DM just confirmed, typically the homebrew skill's iterated output. This needs no Foundry.
- Fallback source: a manual paste, when the DM supplies one.
- Phase 2 note, stated plainly: reading an exported Foundry actor or item JSON is a planned enrichment and is not yet available in this version; for now, capture from the finalized design or a paste.
- The anti-draft gate, verbatim: `Catalog only finalized, confirmed homebrew. The guard is not "only a fresh paste"; it is "only content the DM has finalized." The DM invoking /catalog on content they just confirmed is the approval. Do not re-paste what the assistant already authored, and do not catalog an unfinished draft.`
- If content looks truncated or malformed, ask the DM rather than repairing it.

- [ ] **Step 3: Validate**

```bash
FILE=professor-orb/commands/catalog.md
python -c "import re,sys; t=open(r'$FILE',encoding='utf-8').read(); m=re.search(r'^description:\s*\"(.*?)\"\s*$', t, re.M|re.S); print('desc len', len(m.group(1))) if m else sys.exit('FAIL desc')"
grep -nP "\x{2014}" "$FILE" && echo "FAIL em dash" || echo "OK no em dash"
grep -n "argument-hint" "$FILE"
```
Expected: description under 1500 chars; no em dash; argument-hint updated. Confirm the `../skills/SHARED-PRINCIPLES.md` reference still resolves.

- [ ] **Step 4: Commit**

```bash
git add professor-orb/commands/catalog.md
git commit -m "feat(professor-orb/catalog): reframe command and correct sourcing gate

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: catalog.md — conventions resolution and per-type dispatch

**Files:**
- Modify: `professor-orb/commands/catalog.md` (replace the old "Step 2: Resolve conventions", "Step 3: Collect and confirm metadata", "Step 4: Write the entry")

**Interfaces:**
- Consumes: the sourcing step from Task 4; the ten type keys and `references/catalog-type-templates.md` from Tasks 1-3.
- Produces: the resolution + dispatch + assembly steps that later steps (lifecycle, versioning, index) build on.

- [ ] **Step 1: Write the conventions-resolution step**

Write "## Step 2: Resolve conventions". Preserve the current behavior verbatim in intent: read `.professor-orb/conventions.json` first (authoritative for catalog location, required frontmatter fields and order, filename rules, index conventions); fall back to `CLAUDE.md`; ask the DM if neither locates the catalog. This is unchanged from the current command except wording; keep it faithful.

- [ ] **Step 2: Write the type-dispatch step**

Write "## Step 3: Identify the type and select its template". Required content:
- Determine the artifact type. If the DM named it or it is unambiguous from the content, use that. If ambiguous, ask with AskUserQuestion, offering the ten type keys: `spell`, `magic-item`, `feat`, `feature`, `monster`, `npc`, `species`, `subclass`, `class`, `other`.
- Read `references/catalog-type-templates.md` and use the section matching the chosen type key. For `monster`/`npc`, use the shared stat-block section.
- The template names the frontmatter fields (F), the body skeleton (B), and homebrew-only fields (H). Fill F from what is evident in the finalized content and confirm anything ambiguous with AskUserQuestion; never guess. Preserve B verbatim per the template's Preservation rule.

- [ ] **Step 3: Write the assembly step**

Write "## Step 4: Assemble the entry". Required content:
- One markdown file in the catalog folder (per Step 2).
- YAML frontmatter: the required floor (`name`, `type`, `status`, `version`, `date`) plus the type's F fields plus anything `conventions.json` marks required, in the conventions-defined order. `status` and `version` are set by Tasks 6.
- Body: the type's B blocks, each holding the DM's finalized content verbatim. Never edit, reformat, or complete it. Do not add wikilinks inside the entry (catalog entries sit outside the wikilink graph).
- Follow the project's filename conventions. The write should pass the PostToolUse validator; on a block, fix the entry and retry rather than working around the hook.
- Never write a raw `.html` file.

- [ ] **Step 4: Validate**

```bash
FILE=professor-orb/commands/catalog.md
grep -nE "^## Step [234]:" "$FILE"
grep -n "references/catalog-type-templates.md" "$FILE"
grep -nP "\x{2014}" "$FILE" && echo "FAIL em dash" || echo "OK"
test -f professor-orb/commands/references/catalog-type-templates.md && echo "OK ref resolves"
```
Expected: Steps 2-4 present; the template reference path is mentioned and resolves; no em dash.

- [ ] **Step 5: Commit**

```bash
git add professor-orb/commands/catalog.md
git commit -m "feat(professor-orb/catalog): add conventions resolution and per-type dispatch

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: catalog.md — lifecycle status and two-track versioning

**Files:**
- Modify: `professor-orb/commands/catalog.md` (insert new steps after Task 5's Step 4)

**Interfaces:**
- Consumes: the assembled entry from Task 5.
- Produces: the `status` and `version` frontmatter values consumed by Task 5's assembly, and the versioning behavior. Defines the "existing entry" detection that a revision uses.

- [ ] **Step 1: Write the lifecycle-status step**

Write "## Step 5: Stamp lifecycle status". Required content:
- Every entry carries `status`, since all catalogued homebrew is playtest material. Allowed values: `playtest` (default for a new capture), `active`, `reverted`, `discontinued`.
- Set `playtest` unless the DM says otherwise; a revision may change it. For a stat block, a single part may be noted discontinued while the rest stays, via an inline note on that part.

- [ ] **Step 2: Write the versioning step**

Write "## Step 6: Record the version". Required content, two tracks:
- **Detect existing entry:** before writing, check whether an entry for this homebrew already exists in the catalog. If it does, this capture is a revision; if not, it is version 1.
- **Offered git track:** if the catalog folder is not already inside a git repository, OFFER (with AskUserQuestion, DM-approval-gated, never forced) to make it one so every capture is versioned. If the DM accepts, run `git init` locally in the catalog root and, after writing the entry and index, commit with a message naming the entry and version. Creating a private remote and pushing stays the DM's own action; do not attempt account creation, authentication, or pushing.
- **No-git baseline:** if the DM declines, or the catalog is not a git repo, track `version` (increment on a revision) plus a short dated changelog line appended to the entry recording what this capture changed. State the honest limitation in the entry's changelog area only if useful: without git there is no full recovery of prior content.
- A new version is triggered by re-running `/catalog` on a homebrew that already has an entry.

- [ ] **Step 3: Validate**

```bash
FILE=professor-orb/commands/catalog.md
grep -nE "^## Step [56]:" "$FILE"
grep -niE "playtest|git init|AskUserQuestion" "$FILE" | head
grep -nP "\x{2014}" "$FILE" && echo "FAIL em dash" || echo "OK"
```
Expected: Steps 5-6 present; status values, the git-offer, and the DM-gated AskUserQuestion all mentioned; no em dash.

- [ ] **Step 4: Commit**

```bash
git add professor-orb/commands/catalog.md
git commit -m "feat(professor-orb/catalog): add lifecycle status and two-track versioning

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: catalog.md — index update, report, never-do list, connections

**Files:**
- Modify: `professor-orb/commands/catalog.md` (replace the old "Step 5: Update the owning index", "Step 6: Report back", "Things to never do", "How this command connects to the others")

**Interfaces:**
- Consumes: the entry, status, and version from Tasks 5-6.
- Produces: the command's closing sections. After this task `catalog.md` is a complete rewrite.

- [ ] **Step 1: Write the index-update step**

Write "## Step 7: Update the owning index". Preserve current behavior: update exactly one owning index per single-ownership; follow the project's existing index format and any sub-index structure; do not invent a sub-index split without proposing it via AskUserQuestion; do not edit any other article to add a wikilink.

- [ ] **Step 2: Write the report step**

Write "## Step 8: Report back". The command reports the entry path, the type, the status, the version, whether git versioning is on, and confirms the index update. Keep it short.

- [ ] **Step 3: Rewrite the "Things to never do" list**

Update the list for the new model. Required items: never catalog an unfinished or unconfirmed draft; never edit, reformat, or complete the DM's finalized content; never write a raw `.html` file; never add a wikilink inside the entry or edit another article to link to it; never invent a sub-index split without asking; never write `.professor-orb/pipeline-state.json`; never force git or attempt remote creation, authentication, or pushing; never present a homebrew-only (H) field as SRD canon.

- [ ] **Step 4: Update the "How this command connects" section**

Keep it faithful to the current section but update: standalone like homebrew and timeline; fed by the homebrew skill (which points here once a design is finalized, and, later, once it is implemented in Foundry); reads `.professor-orb/conventions.json` (CLAUDE.md fallback) and `references/catalog-type-templates.md`; writes one entry plus the owning index; read back by the homebrew skill as design precedent. Add: Foundry-JSON sourcing arrives in Phase 2.

- [ ] **Step 5: Validate the full command**

```bash
FILE=professor-orb/commands/catalog.md
grep -nE "^## Step [1-8]:" "$FILE"
grep -nP "\x{2014}" "$FILE" && echo "FAIL em dash" || echo "OK no em dash"
grep -n -- "--" "$FILE" || echo "OK no double hyphen"
python -c "import re,sys; t=open(r'$FILE',encoding='utf-8').read(); m=re.search(r'^description:\s*\"(.*?)\"\s*$', t, re.M|re.S); print('desc len', len(m.group(1))) if m else sys.exit('FAIL desc')"
```
Expected: eight numbered steps present; no em dash; no prose double-hyphen; description under 1500 chars. Manually read the command end to end and confirm it flows and references resolve.

- [ ] **Step 6: Manual end-to-end exercise**

Dry-run a design-time capture in reasoning: take a short finalized feat (name, category, prerequisite, one benefit) and walk the command steps 1-8. Confirm you can produce a valid entry (correct frontmatter floor + feat F fields, verbatim body, `status: playtest`, `version: 1`) and an index line, with no step ambiguous or missing. Note any gap and fix the prose before committing.

- [ ] **Step 7: Commit**

```bash
git add professor-orb/commands/catalog.md
git commit -m "feat(professor-orb/catalog): add index update, report, and closing sections

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: README update and version bump

**Files:**
- Modify: `professor-orb/README.md` (the `/catalog` component-table row, and the paragraph describing catalog philosophy if it names "as-built Foundry HTML")
- Modify: `professor-orb/.claude-plugin/plugin.json` (`version`)
- Modify: `.claude-plugin/marketplace.json` (professor-orb `version`)

**Interfaces:**
- Consumes: the finished command from Tasks 4-7.
- Produces: an accurate README and a bumped version so the change can reach a consumer install.

- [ ] **Step 1: Update the README `/catalog` row**

In the components table, replace the `/catalog` row's Purpose text. Current text names "one locked, post-tweak piece of homebrew (the DM's final as-built Foundry HTML)". Replace with a description of the new model: captures a finalized piece of homebrew as a type-specific, versioned catalog entry across its playtest life. Update the Invoke cell if it references pasted HTML. Also scan the "Design philosophy" section (the `/catalog` paragraph mentioning "as-tweaked Foundry HTML verbatim") and update it to the verbatim-preservation, type-aware, versioned description without claiming Foundry HTML is the only source.

- [ ] **Step 2: Bump versions**

```bash
# plugin.json: "version": "1.1.1" -> "1.2.0"
# marketplace.json (professor-orb entry): "1.1.1" -> "1.2.0"
```
Edit both files to `1.2.0` (minor bump: additive new capability).

- [ ] **Step 3: Validate**

```bash
grep -n "1.2.0" professor-orb/.claude-plugin/plugin.json ".claude-plugin/marketplace.json"
grep -niE "as-built Foundry HTML|pasted HTML|locked.*HTML" professor-orb/README.md || echo "OK: stale HTML-only phrasing gone"
grep -nP "\x{2014}" professor-orb/README.md && echo "FAIL em dash" || echo "OK no em dash"
```
Expected: both manifests show 1.2.0; no stale "Foundry HTML only" phrasing remains; no em dash introduced.

- [ ] **Step 4: Commit**

```bash
git add professor-orb/README.md professor-orb/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "feat(professor-orb): bump to 1.2.0, update README for catalog redesign (Phase 1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Deployment (post-implementation, optional, DM-run)

Not a task. After Phase 1 lands and the DM wants it live in Rolara, update the project-scoped install (keeping it project-scoped, never global), per the same procedure used for 1.1.1:

```bash
cd "C:/Users/jorda/OneDrive/Documents/Claude/Projects/World of Rolara"
claude plugin update professor-orb@professor-orb-marketplace --scope project
```
Then verify the global `~/.claude/settings.json` still has zero professor-orb mentions.

## Self-Review

**Spec coverage:**
- Reframed purpose -> Task 4. Sourcing (design-first, paste fallback, Foundry deferred) -> Task 4. Anti-draft gate -> Task 4. Format/preservation principle -> Tasks 1 (shared rule) + 5 (assembly). Per-type templates, all ten keys, SRD-grounded -> Tasks 1-3. Monster/NPC two-types-shared-schema -> Task 2. Lifecycle status -> Task 6. Two-track versioning (git offer + baseline) -> Task 6. Preserved machinery (conventions-first, single-ownership index, hook compliance, standalone, homebrew handoff) -> Tasks 5 and 7. README/version -> Task 8. Phase-2 items (Foundry JSON, Bionoid Bond) explicitly deferred, noted in Tasks 4 and 7. No spec Phase-1 requirement is left without a task.

**Placeholder scan:** No "TBD"/"handle appropriately". Each prose task specifies exact required content and verbatim wording for load-bearing instructions (anti-draft gate, git-offer). Validation steps use concrete commands. This is a markdown deliverable, so tasks specify required content rather than executable code; that is the appropriate analog and not a placeholder.

**Type consistency:** The ten type keys (`spell`, `magic-item`, `feat`, `feature`, `monster`, `npc`, `species`, `subclass`, `class`, `other`) are defined in Tasks 1-3 and consumed by name in Task 5's dispatch. The template reference path `references/catalog-type-templates.md` is identical in Tasks 1 and 5 and 7. The frontmatter floor (`name`, `type`, `status`, `version`, `date`) defined in Task 1 is emitted in Task 5 and populated in Task 6. Consistent.
