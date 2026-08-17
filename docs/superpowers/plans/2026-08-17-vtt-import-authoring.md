# VTT Import-File Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give professor-orb's `homebrew` skill a procedure for authoring Foundry VTT import files against the consumer project's own exports, and make `/catalog` commit the results.

**Architecture:** No Foundry schema ships in the plugin. The skill reads schema and version from the DM's exports under `<homebrewRoot>/foundryvtt/`, states what it read on every run, and authors fresh rather than copying. World-scoped identifiers are read from a same-world export or omitted and handed off. `/catalog` extends its existing `:(literal)` pathspec to carry the JSONs alongside the entry.

**Tech Stack:** Markdown (plugin prose), Node.js built-ins for tests (no framework, run files directly), git pathspec mechanics.

**Spec:** `docs/superpowers/specs/2026-08-17-vtt-import-authoring-design.md`

## Global Constraints

- **No em dashes in plugin prose.** `professor-orb/skills/SHARED-PRINCIPLES.md` Principle 6: "Do not use em dashes in any output. Use commas, colons, parentheses, or restructure the sentence." Verify with `grep -c '—'`.
- **Version parity.** A release bumps `version` in **both** `.claude-plugin/marketplace.json` and `professor-orb/.claude-plugin/plugin.json`. They must match. Current: `1.13.0`. Target: `1.14.0`.
- **Lane pathspecs are `:(literal)`.** Both the `git add` and the `git commit --only` carry the identical pathspec list.
- **Tests are Node built-ins.** Run a file directly with `node <path>`; each exits non-zero on failure. No framework, no new dependencies.
- **Do not modify** `workflows/migrate.mjs`, `workflows/validation-sweep.mjs`, `hooks/validate-write.mjs`, or `/genesis`. The spec establishes that none needs changing.

## Merge coordination

`claude/professor-orb-commit-m-flag-e73120` (the branch fixing `-m` flag placement in the
`/scribe`, `/log`, and `/catalog` commit patterns) has landed on `main` as `30705d0` and is
already merged into this plan's working branch as of `57e226e`. `catalog.md`'s commit block
now reads:

```
git commit --only -m "<message>" -- ":(literal)<entry file path>" ":(literal)<index file path>"
```

**Task 2 edits that exact form.** No branching check is needed; the coordination this section
used to require is already resolved.

---

### Task 1: Prove the multi-path pathspec against real git

`/catalog` currently stages two paths. This change makes it N, and the new paths sit in a folder that can hold files belonging to *other* entries. This task proves the enumerated multi-path form carries exactly its own paths, and proves the tempting shortcut (adding the prong directory) does not.

**Files:**
- Modify: `professor-orb/commands/lane-staging.test.mjs:144-148` (generalize the helper)
- Modify: `professor-orb/commands/lane-staging.test.mjs:325` (append case 4 after case 3's closing brace, before the final tally)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `stageAndCommitLane(dir, lanePaths, message)` where `lanePaths` is a string **or** an array of strings. Cases 1 through 3 pass strings and must keep working unchanged.

- [ ] **Step 1: Generalize the helper to accept an array**

Replace the body of `stageAndCommitLane` at `professor-orb/commands/lane-staging.test.mjs:144-148`. Keep the existing comment block above it intact; add the two sentences shown at the end of it.

```js
// The mechanism under test, isolated in one place so a mutation pass can
// swap it for a wrong candidate without editing every call site. The
// pathspec carries git's literal pathspec magic, :(literal), so a setting
// or campaign name containing *, ?, or [ is never wildcard-interpreted (see
// case 3). Plain lane names (cases 1 and 2) are unaffected by the wrapper:
// :(literal) only changes behavior when the name contains a glob character.
//
// lanePaths accepts a string or an array. /catalog commits more than one
// path (the entry, its owning index, and any VTT import files for that
// artifact), so the same mechanism has to hold for N pathspecs, not just
// one. Case 4 covers that.
function stageAndCommitLane(dir, lanePaths, message) {
  const specs = (Array.isArray(lanePaths) ? lanePaths : [lanePaths]).map(
    (p) => `:(literal)${p}`
  );
  git(dir, ["add", "--", ...specs]);
  return git(dir, ["commit", "-q", "-m", message, "--only", "--", ...specs], true);
}
```

- [ ] **Step 2: Run the existing suite to confirm the helper change broke nothing**

Run: `node professor-orb/commands/lane-staging.test.mjs`
Expected: PASS, same expectation count as before the edit. Cases 1 through 3 pass strings; the `Array.isArray` branch leaves them on the identical code path.

- [ ] **Step 3: Append case 4, with its control**

Insert after case 3's closing `}` (currently `professor-orb/commands/lane-staging.test.mjs:325`) and before the `console.log(\`\n${passed}/...\`)` tally line.

```js
console.log(
  "\n=== case 4: a multi-path commit must carry exactly its enumerated paths ==="
);
{
  // /catalog stages the entry and its owning index, and now also any VTT
  // import files for that same artifact. Those live in a shared bucket:
  // homebrew/<setting>/foundryvtt/items/ holds one file per artifact, so
  // the folder necessarily contains OTHER entries' files. Enumerating paths
  // is what keeps those out; adding the prong directory does not, which is
  // the control below.
  const dir = freshRepo("multi-path");
  const ENTRY = "homebrew/rolara/magic-items/Bodkin.md";
  const INDEX = "homebrew/rolara/magic-items/Magic-items-INDEX.md";
  const IMPORT = "homebrew/rolara/foundryvtt/items/Bodkin.json";
  const FOREIGN = "homebrew/rolara/foundryvtt/items/Loom.json";

  // Baseline: the index and another artifact's import file already tracked.
  write(dir, INDEX, "old\n");
  write(dir, FOREIGN, '{"type":"weapon"}\n');
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "baseline"]);

  const before = git(dir, ["rev-parse", "HEAD"]);

  write(dir, ENTRY, "new entry\n");                       // new
  write(dir, INDEX, "modified\n");                        // modified
  write(dir, IMPORT, '{"type":"weapon"}\n');              // new, nested deeper
  write(dir, FOREIGN, '{"type":"weapon","touched":true}\n'); // another artifact's

  // Control: the rejected candidate. :(literal) stops glob interpretation
  // but a directory pathspec still recurses, so adding the prong sweeps the
  // other artifact's import file in.
  git(dir, ["add", "--", ":(literal)homebrew/rolara"]);
  check(
    "control: adding the prong directory stages the other artifact's import file",
    stagedPaths(dir).includes(FOREIGN),
    true,
    "this is why catalog.md enumerates paths instead of adding the prong"
  );
  git(dir, ["reset", "-q"]);
  check("control: the index is clean again before the real mechanism runs", stagedPaths(dir), []);
  check("control: HEAD did not move", git(dir, ["rev-parse", "HEAD"]), before);

  const result = stageAndCommitLane(
    dir,
    [ENTRY, INDEX, IMPORT],
    "catalog(rolara): Bodkin v1"
  );
  check(
    "a three-path commit succeeds",
    !(result && result.failed),
    true,
    result && result.failed ? result.stderr : undefined
  );

  check(
    "commits exactly the enumerated paths, including the nested import file",
    filesInHead(dir),
    [ENTRY, INDEX, IMPORT].sort()
  );

  check(
    "the other artifact's import file is left dirty, not staged and not committed",
    statusLines(dir),
    [` M ${FOREIGN}`]
  );
}
```

- [ ] **Step 4: Run the suite and read the control's result**

Run: `node professor-orb/commands/lane-staging.test.mjs`
Expected: PASS on every expectation, **including** the control. The control asserting `stagedPaths(dir).includes(FOREIGN) === true` is the red case: it passes by demonstrating that the wrong mechanism leaks. If that control fails, the leak did not reproduce and the rest of case 4 proves nothing; stop and investigate before continuing.

- [ ] **Step 5: Run the full suite for regressions**

Run:
```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```
Expected: all eight suites pass.

- [ ] **Step 6: Commit**

```bash
git add -- ":(literal)professor-orb/commands/lane-staging.test.mjs"
git commit -m "test(catalog): prove the multi-path lane pathspec against real git

/catalog is about to stage more than the entry and its index. The import
files it will also carry live in a bucket shared with other artifacts, so
the enumerated form has to be proven to exclude them and the directory-wide
shortcut proven not to.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Extend /catalog's commit pathspec

**Files:**
- Modify: `professor-orb/commands/catalog.md:103-112`

**Interfaces:**
- Consumes: the mechanism proven in Task 1.
- Produces: the documented pathspec form the `homebrew` skill points at in Task 3's "Committing" subsection.

- [ ] **Step 1: Confirm the current text matches this task's anchors**

Run: `sed -n '103,112p' professor-orb/commands/catalog.md`

Expected, verbatim (this reflects the `-m` flag fix already merged per the coordination note above):

```markdown
**Git or GitHub mode.** Once the entry (Step 5) and the owning index (Step 8) have both been written, stage and commit exactly those two files, by path, never a directory-wide add and never `-A` or `-a`, using the identical mechanism `/scribe` and `/log` use for their own lanes:

```
git add -- ":(literal)<entry file path>" ":(literal)<index file path>"
git commit --only -m "<message>" -- ":(literal)<entry file path>" ":(literal)<index file path>"
```

Never run a bare `git commit` after staging: with no pathspec it commits the entire index, sweeping in anything the DM staged elsewhere. Never run `git commit --only` without the identical prior `git add`: measured against real git, `--only` with nothing staged first silently omits a brand-new file whenever anything else in the index is already modified, exactly the shape of a first capture landing beside an unrelated in-progress edit. Keep the `:(literal)` prefix on both pathspec elements even though an entry filename rarely contains a glob character: the guarantee should not depend on inspecting the name first. Keep `-m "<message>"` before the `--` separator, not after: git parses everything after `--` as a pathspec, so a message placed there is not attached to the commit at all.

**Commit message** (the `<message>` above), naming the setting, the entry, and its version: `catalog(<setting>): <entry> v<version>`, for example `catalog(rolara): Frostbrand Dagger v2`. This applies to every capture against a git- or github-mode catalog, first capture or later revision alike. In this mode the entry carries no changelog block; the commit history is the record.
```

If the text differs from this, stop and report the actual content rather than guessing at a replacement; something changed since this plan was written.

- [ ] **Step 2: Replace lines 103-112 (the whole block quoted above)**

```markdown
**Git or GitHub mode.** Once the entry (Step 5) and the owning index (Step 8) have both been written, stage and commit exactly the files this capture produced, by path, never a directory-wide add and never `-A` or `-a`, using the identical mechanism `/scribe` and `/log` use for their own lanes:

```
git add -- ":(literal)<entry file path>" ":(literal)<index file path>" ":(literal)<each VTT import file>"
git commit --only -m "<message>" -- ":(literal)<entry file path>" ":(literal)<index file path>" ":(literal)<each VTT import file>"
```

**VTT import files.** Where this artifact has import files under `<homebrewRoot>/foundryvtt/<bucket>/`, written by the `homebrew` skill, name each one in both pathspecs. Reference exports the skill filed into `<homebrewRoot>/foundryvtt/reference/` during the same session are named the same way. Enumerate them individually: those buckets hold files belonging to other artifacts, and a directory-wide add would carry those into this entry's commit.

Never run a bare `git commit` after staging: with no pathspec it commits the entire index, sweeping in anything the DM staged elsewhere. Never run `git commit --only` without the identical prior `git add`: measured against real git, `--only` with nothing staged first silently omits a brand-new file whenever anything else in the index is already modified, exactly the shape of a first capture landing beside an unrelated in-progress edit. Keep the `:(literal)` prefix on every pathspec element even though a filename rarely contains a glob character: the guarantee should not depend on inspecting the name first. Keep `-m "<message>"` before the `--` separator, not after: git parses everything after `--` as a pathspec, so a message placed there is not attached to the commit at all.

**Commit message** (the `<message>` above), naming the setting, the entry, and its version: `catalog(<setting>): <entry> v<version>`, for example `catalog(rolara): Frostbrand Dagger v2`. This applies to every capture against a git- or github-mode catalog, first capture or later revision alike. In this mode the entry carries no changelog block; the commit history is the record.
```

- [ ] **Step 3: Verify no em dashes were introduced**

Run: `grep -c '—' professor-orb/commands/catalog.md`
Expected: `0`

- [ ] **Step 4: Commit**

```bash
git add -- ":(literal)professor-orb/commands/catalog.md"
git commit -m "feat(catalog): commit an artifact's VTT import files with its entry

The JSONs land in /catalog's own prong, and nothing committed them. A
permanently dirty tree also blocks /migrate, which requires a clean one.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: The authoring section in the homebrew skill

The deliverable is the section plus the two things that make it reachable: frontmatter routing, and one clause at the finalization handoff. A section the skill is never invoked for helps nobody, so they ship together.

**Files:**
- Modify: `professor-orb/skills/homebrew/SKILL.md:3` (frontmatter description)
- Modify: `professor-orb/skills/homebrew/SKILL.md:147` (insert the new section after VTT Automation Awareness)
- Modify: `professor-orb/skills/homebrew/SKILL.md:170` (one clause at the handoff)
- Modify: `professor-orb/skills/homebrew/SKILL.md:198` (one entry in Things to never do)
- Modify: `professor-orb/skills/homebrew/SKILL.md:205` (the Reads line)

> **Line numbers above are pre-edit.** Step 2 inserts roughly seventy lines, so every number after it shifts. From Step 3 onward, locate each edit by the quoted anchor text, not by line number.

**Interfaces:**
- Consumes: the pathspec documented in Task 2, referenced but not restated.
- Produces: the vocabulary Task 4 records in the glossary: "VTT import file", "VTT reference corpus", the bucket names, and the acquisition flow.

- [ ] **Step 1: Add authoring to the frontmatter description**

In `professor-orb/skills/homebrew/SKILL.md:3`, make two replacements inside the `description` string.

Find: `a mechanic checked against VTT automation constraints, or anything benchmarked against CR or magic item rarity.`
Replace: `a mechanic checked against VTT automation constraints, a Foundry VTT import file authored for a finalized design, or anything benchmarked against CR or magic item rarity.`

Find: `If the user mentions homebrew, balancing, stat blocks, spell design, subclass features, magic items, CR, or does this work mechanically, use this skill.`
Replace: `If the user mentions homebrew, balancing, stat blocks, spell design, subclass features, magic items, CR, getting a finalized design into Foundry, or does this work mechanically, use this skill.`

- [ ] **Step 2: Insert the authoring section**

Insert after the `---` that closes VTT Automation Awareness (`professor-orb/skills/homebrew/SKILL.md:147`) and before `## Setting`. Keep the surrounding `---` dividers so the new section sits between them exactly as its neighbors do. Zero em dashes.

````markdown
## VTT Import-File Authoring

The section above covers judging a design against automation. This one covers the task that follows a finalized design: authoring the file that imports it into the VTT.

Foundry is what this is written for, because it is the platform with a corpus to read. If the project runs a different VTT, say so plainly rather than adapting these steps to it.

### The corpus

Import files live in the homebrew prong, beside the catalog entries:

```
<homebrewRoot>/foundryvtt/
  actors/  facilities/  features/  items/  spells/
  reference/
    actors/  items/  spells/ ...
```

`reference/` holds the DM's own Foundry exports. They are the authority for schema and version, because they come from the install the DM actually runs. Nothing about the Foundry schema is written into this skill or recalled from training data.

A file's bucket comes from its own top-level `"type"`, read by parsing the JSON rather than by position in the file:

| `"type"` | bucket |
|---|---|
| `spell` | `spells` |
| `facility` | `facilities` |
| `feat` | `features` |
| `weapon`, `equipment`, `consumable`, `tool`, `loot`, `container` | `items` |
| `npc`, `character`, `vehicle`, `group` | `actors` |

For a `type` outside that table, ask the DM which bucket it belongs in. The bucket list is the DM's convention and stays open-ended.

Create a bucket when you first write into it. Do not lay the tree down in advance.

### When there is no exemplar

Capability follows the corpus: author what there is an exemplar for. An actor exemplar filed into `reference/actors/` extends this skill to actors with no change to the skill itself.

With no exemplar for the type at hand, say so, and ask the DM to export the closest published analogue from Foundry. Offer the mechanics as Windows specifics, named as such: Foundry's exports land in `Downloads/` by default, and Explorer's Ctrl+Shift+C copies a selected file's path. On another platform the DM pastes a path from wherever their exports land. Take the path, file the file into `reference/<bucket>/` yourself, and continue.

Say once that keeping the corpus current is the DM's: a major dnd5e, Foundry, or module update can leave an exemplar describing a schema they no longer run, and removing a stale one is a DM-side edit.

### Authoring

1. Resolve the type and its bucket.
2. Find an exemplar of that type, in `reference/<bucket>/` first, then `<bucket>/`. Exports already sitting in a type bucket are real exports and are valid sources. With neither, run the acquisition step above.
3. Read from it: `_stats.systemVersion`, `_stats.coreVersion`, the envelope, the `system` field set for that type, the `activities` map shape, and `damage.parts`.
4. State those two versions and the exemplar's path to the DM before producing output. This is how a stale corpus becomes visible at the moment it matters.
5. Author fresh. The file's `flags` object holds only what you deliberately put there. Because the output is authored rather than copied, an export carrying importer flags is exactly as good a source as a hand-authored one.
6. Generate the identity fields: `_id`, and the keys of the `activities` map. Inherited ones collide on import. The envelope carries the version fields from step 3, so the file declares what it was built against; per-install and per-user identifiers from the exemplar are left out.
7. Read world-scoped references, never construct them. Where a reference export from the same world carries a compendium UUID (`Compendium.world.<pack>.Item.<id>`), use it. Where none does, leave that activity out and name it in step 8. Same-world is load-bearing: the pack name embeds the world, so a UUID read from one world is wrong in another. Where the corpus shows more than one world, ask the DM which world this file is for.

   Module-scoped asset paths break the same way and just as silently, so the same rule governs them: use one only where a same-world reference carries it, otherwise a core Foundry icon.
8. Give the DM the handoff list: the activities left out under step 7, and anything else for them to wire after import.

A guessed UUID produces an activity that fails silently when clicked. That is worse than an absent one, because an absent activity is visibly missing while a broken one looks correct until it is needed at the table.

### Committing

These files land in the homebrew prong, so `/catalog` commits them alongside the entry. Point the DM there. Do not commit from this skill.
````

- [ ] **Step 3: Add the finalization clause**

In `professor-orb/skills/homebrew/SKILL.md`, at the end of the paragraph beginning "Once the DM confirms a design is finalized" (currently line 170), append one sentence:

```markdown
Where the project names a VTT, mention in the same breath that you can author the import file for this design, per VTT Import-File Authoring above.
```

- [ ] **Step 4: Add one entry to Things to never do**

Insert after the bullet beginning `- **Never catalog homebrew yourself.**`:

```markdown
- **Never construct a compendium UUID or a module asset path.** Read one from a same-world reference export, or leave the activity out and hand it off.
```

- [ ] **Step 5: Update the Reads line**

Replace the `**Reads (optionally):**` line (currently `professor-orb/skills/homebrew/SKILL.md:205`):

```markdown
- **Reads (optionally):** `.professor-orb/conventions.json` or `CLAUDE.md` for VTT platform notes and the homebrew catalog's location; the project's SRD copy if present; existing catalogued homebrew as design precedent; the project's Foundry exports under `<homebrewRoot>/foundryvtt/` as the authority for VTT schema and versions.
```

- [ ] **Step 6: Verify no new em dashes**

Run: `grep -c '—' professor-orb/skills/homebrew/SKILL.md`
Expected: `2`, unchanged. Both pre-date this work and belong to the Design Notes section. If the count is higher, the new prose introduced one; find it with `grep -n '—' professor-orb/skills/homebrew/SKILL.md` and rewrite that sentence.

- [ ] **Step 7: Verify the section landed between dividers**

Run: `grep -n '^## \|^---$' professor-orb/skills/homebrew/SKILL.md`
Expected: `## VTT Import-File Authoring` appears after `## VTT Automation Awareness` and before `## Setting`, with a `---` line between each pair of sections, matching the file's existing rhythm.

- [ ] **Step 8: Commit**

```bash
git add -- ":(literal)professor-orb/skills/homebrew/SKILL.md"
git commit -m "feat(homebrew): author VTT import files against the project's exports

The VTT section covered design review and had nothing for authoring an
import file for a finalized design, the task that follows its own /catalog
handoff. No Foundry schema ships here: the DM's own exports are read for
shape and version, and the run states which file it read them from.

World-scoped compendium UUIDs are read from a same-world export or omitted
and handed off, never constructed, because a guessed one fails silently.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Sync the glossary, the inventory, and the orb menu

Every user-facing surface that lists what the plugin does needs to describe what now exists. `professor-orb/CONTEXT.md` is the vocabulary authority and must be written before the prose that uses those terms is reviewed.

**Files:**
- Modify: `professor-orb/CONTEXT.md` (add two glossary entries after **homebrew catalog**)
- Modify: `professor-orb/README.md:27` (homebrew row), `:32` (/catalog row), `:72` (catalog paragraph)
- Modify: `professor-orb/skills/orb/SKILL.md:34` (homebrew row), `:40` (/catalog row)

**Interfaces:**
- Consumes: the behavior implemented in Tasks 2 and 3. Nothing here changes behavior.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add two glossary entries to CONTEXT.md**

Insert after the **homebrew catalog** entry and before **catalog command**. Zero em dashes; match the file's existing entry format, including the `_Avoid_:` line.

```markdown
**VTT import file**:
A Foundry-importable JSON the `homebrew` skill authors for a finalized design, written to
`homebrew/<setting>/foundryvtt/<bucket>/` and committed by `/catalog` alongside the entry.
The bucket comes from the JSON's own top-level `type`. Authored fresh against an exemplar
rather than copied from one, which is why an export carrying importer flags is as good a
source as a hand-authored file. Distinct from the Foundry fragment, which is `content`'s HTML
snippet for a rich-text field.
_Avoid_: "the Foundry export" (that is the DM's own file, read as input), calling it a
catalog entry

**VTT reference corpus**:
The DM's Foundry exports under `homebrew/<setting>/foundryvtt/reference/`, the authority for
schema and version because they come from the install the DM actually runs. Sub-bucketed
mirroring its sibling buckets once it holds enough to earn it. Read for shape, never copied
wholesale. Carries no automatic freshness guarantee: the skill states the `systemVersion` and
`coreVersion` it read and names the file it read them from on every run, and removing a stale
exemplar is a DM-side edit. Buckets are created on first write, so `/genesis` lays none of
this down.
_Avoid_: "the schema reference" (it is the DM's data, not the plugin's), treating a missing
exemplar as licence to recall a schema from memory
```

- [ ] **Step 2: Update the README inventory rows**

`professor-orb/README.md:27`, replace the homebrew row:

```markdown
| homebrew | Skill | D&D 5.5e (2024 rules) homebrew design, review, and balance assistant; authors Foundry import files against the project's own exports; points to `/catalog` once a design is locked | Any homebrew design, workshopping, balance, rules-language, or Foundry import question |
```

`professor-orb/README.md:32`, replace the /catalog row:

```markdown
| /catalog | Command | Captures one finalized, DM-confirmed piece of homebrew as a type-specific, versioned catalog entry, commits any VTT import files for that artifact alongside it, and maintains it across its playtest life | `/catalog` with the finalized homebrew pasted or referenced, or a name/type to catalog |
```

- [ ] **Step 3: Update the README catalog paragraph**

At `professor-orb/README.md:72`, the sentence "reading an exported Foundry actor or item JSON is a Phase 2 capability and not yet available" describes `/catalog` **sourcing** an entry from a JSON and stays true. Leave it. Append one sentence to the end of that paragraph:

```markdown
Where the `homebrew` skill authored VTT import files for the artifact, `/catalog` names each one in its commit pathspec so they travel with the entry; those buckets hold other artifacts' files, so they are enumerated individually rather than added as a directory.
```

- [ ] **Step 4: Update the orb menu rows**

`professor-orb/skills/orb/SKILL.md:34`, replace the homebrew row:

```markdown
| homebrew | Skill | D&D 5.5e (2024 rules) homebrew design, review, and balance assistant; points to `/catalog` once a design is finalized, offering to compose the entry's Design Notes block first when the conversation produced decisions worth recording, and authoring the Foundry import file for the design when the project runs one | Any homebrew design, workshopping, balance, rules-language, or Foundry import question |
```

`professor-orb/skills/orb/SKILL.md:40`, replace the /catalog row:

```markdown
| /catalog | Command | Capture a finalized piece of homebrew as a type-specific, versioned catalog entry across its playtest life, committing any VTT import files for it alongside the entry | Invoking `/catalog` once a design is finalized, optionally pasting it or naming what to catalog |
```

- [ ] **Step 5: Verify no em dashes across all four files**

Run:
```bash
for f in professor-orb/CONTEXT.md professor-orb/README.md professor-orb/skills/orb/SKILL.md professor-orb/commands/catalog.md; do printf "%s: %s\n" "$f" "$(grep -c '—' "$f")"; done
```
Expected: `0` for every file.

- [ ] **Step 6: Commit**

```bash
git add -- ":(literal)professor-orb/CONTEXT.md" ":(literal)professor-orb/README.md" ":(literal)professor-orb/skills/orb/SKILL.md"
git commit -m "docs(professor-orb): record VTT import authoring in the glossary and menus

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Version bump and full verification

**Files:**
- Modify: `.claude-plugin/marketplace.json:11`
- Modify: `professor-orb/.claude-plugin/plugin.json:4`

**Interfaces:**
- Consumes: Tasks 1 through 4 complete.
- Produces: the release.

- [ ] **Step 1: Bump both manifests to 1.14.0**

`.claude-plugin/marketplace.json:11` and `professor-orb/.claude-plugin/plugin.json:4`: change `"version": "1.13.0"` to `"version": "1.14.0"` in both.

- [ ] **Step 2: Verify the two versions match**

Run: `grep -h '"version"' .claude-plugin/marketplace.json professor-orb/.claude-plugin/plugin.json`
Expected: two identical `"version": "1.14.0",` lines. A mismatch is a release bug, not a cosmetic one.

- [ ] **Step 3: Run every test suite**

Run:
```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```
Expected: all eight suites pass, `lane-staging.test.mjs` included, with case 4's expectations in its tally.

- [ ] **Step 4: Confirm the untouched components really were untouched**

Run: `git diff --stat main -- professor-orb/workflows professor-orb/hooks`
Expected: empty. The spec establishes that `migrate.mjs`, `validation-sweep.mjs`, and `validate-write.mjs` need no change; a diff here means something was altered that the design says should not be.

- [ ] **Step 5: Commit**

```bash
git add -- ":(literal).claude-plugin/marketplace.json" ":(literal)professor-orb/.claude-plugin/plugin.json"
git commit -m "chore(professor-orb): 1.14.0

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Optional cleanup, DM approval required

`professor-orb/skills/homebrew/SKILL.md` carries **two em dashes**, both in the Design Notes paragraph added by commit `891314a`. Every other plugin markdown file has zero, and SHARED-PRINCIPLES Principle 6 forbids them.

This plan deliberately leaves them. They belong to the concurrently-designed Design Notes work, and rewriting another change's prose without being asked is the kind of drive-by edit that makes a diff harder to review. Raise it with the DM as its own small change if they want it fixed.

Find them with: `grep -n '—' professor-orb/skills/homebrew/SKILL.md`
