#!/usr/bin/env node
// Regression suite for the /migrate proposal file: rendering, parsing, and the
// property that matters most, which is that execution follows the FILE.
//
// No repository and no fixture project: these are pure text and object
// transforms, and the two repository-backed suites would bury them under
// machinery they do not need.
//
// Run: node professor-orb/workflows/migrate.proposal.test.mjs

import { renderProposal, parseProposal, conventionsAfterScope } from "./migrate.mjs";

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failures.push(name);
    console.log(`  [FAIL] ${name}`);
    console.log(`         expected: ${JSON.stringify(expected)}`);
    console.log(`         actual:   ${JSON.stringify(actual)}`);
  }
}

const PLAN = {
  operations: [
    { op: "relocate-path", from: "settings/rolara/misc/A.md", to: "settings/rolara/notes/A.md", reason: "DM scope" },
    { op: "rebuild-index", to: "settings/rolara/notes/Notes-INDEX.md", folder: "settings/rolara/notes", reason: "membership changed" },
  ],
  declined: [
    { op: "absorb-folder", target: "settings/rolara/drafts", reason: "git-ignored, so not in the snapshot" },
  ],
  prechecks: { ok: true, collisions: [], ignored: [] },
};

console.log("=== rendering ===");

{
  const text = renderProposal({
    scope: { summary: "Tidy the notes folder" },
    plan: PLAN,
    projectRoot: "C:/proj",
    settings: [{ name: "rolara" }],
  });
  check("the DM's scope summary appears", text.includes("Tidy the notes folder"), true);
  check("every operation is named by path", text.includes("settings/rolara/misc/A.md"), true);
  check("declined items appear with their reason", text.includes("git-ignored"), true);
  check("the machine-readable block is tagged", text.includes("professor-orb:plan"), true);
  // The prechecks ran while the plan was being built, so the DM reads their
  // outcome before approving rather than meeting a collision mid-run.
  check("the precheck outcome is stated", /precheck/i.test(text), true);
}

console.log("\n=== round trip ===");

{
  const text = renderProposal({ scope: {}, plan: PLAN, projectRoot: "C:/proj", settings: [] });
  const parsed = parseProposal(text);
  check("a rendered proposal parses", parsed.ok, true);
  check("the operations survive the round trip verbatim", parsed.plan.operations, PLAN.operations);
  check("the declined list survives too", parsed.plan.declined, PLAN.declined);
}

console.log("\n=== the DM edited the file ===");

{
  // THE PLAN-FIDELITY PROPERTY. The DM struck the rebuild and changed a
  // destination. Execution has to follow the file, not the conversation that
  // produced it, or "you may edit this file" is a lie.
  const text = renderProposal({ scope: {}, plan: PLAN, projectRoot: "C:/proj", settings: [] });
  const edited = text
    .replace('"to": "settings/rolara/notes/A.md"', '"to": "settings/rolara/archive/A.md"')
    // Strikes the WHOLE rebuild-index object, including the comma that
    // precedes it. A regex matching only the object itself (no leading comma)
    // was verified against the real rendered output to leave a dangling comma
    // before the array's closing `]`, which is invalid JSON: parseProposal then
    // (correctly) refused the file as malformed, rather than the fidelity
    // property this case exists to prove. Confirmed by running the match
    // against renderProposal's actual pretty-printed output before trusting it
    // here, per the brief's own warning that this regex is exactly the kind of
    // thing to verify rather than assume.
    .replace(/,\s*\{[^{}]*"op": "rebuild-index"[\s\S]*?\}/, "");
  const parsed = parseProposal(edited);
  check("the edited file parses", parsed.ok, true);
  check("the edited destination is what comes back",
    parsed.plan.operations[0].to, "settings/rolara/archive/A.md");
  check("the struck operation is gone", parsed.plan.operations.length, 1);
}

console.log("\n=== refusals ===");

{
  check("a file with no plan block refuses",
    parseProposal("# A proposal\n\nJust prose.\n").ok, false);
  const broken = parseProposal("```json professor-orb:plan\n{ not json\n```\n");
  check("a malformed plan block refuses rather than guessing", broken.ok, false);
  check("and says the block is unreadable", /parse|json/i.test(broken.reason), true);
  check("a plan block with no operations array refuses",
    parseProposal('```json professor-orb:plan\n{"declined": []}\n```\n').ok, false);
  // Two blocks means two answers to "what did the DM approve". Refusing is the
  // only safe reading: picking one silently executes something they may have
  // struck by pasting a replacement above the original.
  const two =
    '```json professor-orb:plan\n{"operations": []}\n```\n\n```json professor-orb:plan\n{"operations": []}\n```\n';
  check("two plan blocks refuse", parseProposal(two).ok, false);
}

console.log("\n=== groups survive the round trip ===");

// `groups`, a string array of <scopeKey>[<entryIndex>], is the unit
// declineIgnoredSources and applyPlan's own skip logic key on: every operation
// one scope entry emitted is skipped together when one of its named files is
// git-ignored. A round trip that drops it silently turns that back into
// per-operation skipping, so this is pinned directly rather than left to the
// generic round-trip check above, which never exercises an operation carrying
// `groups` at all (PLAN's fixtures do not have one).
const GROUPS_PLAN = {
  operations: [
    { op: "relocate-path", from: "settings/rolara/a.md", to: "settings/rolara/notes/a.md", groups: ["pathMoves[0]"], reason: "r" },
    {
      op: "rebuild-index",
      to: "settings/rolara/notes/Notes-INDEX.md",
      folder: "settings/rolara/notes",
      groups: ["pathMoves[0]", "rebuildIndexes[1]"],
      reason: "r2",
    },
  ],
  declined: [],
  prechecks: { ok: true },
};

{
  const text = renderProposal({ scope: {}, plan: GROUPS_PLAN, projectRoot: "C:/proj", settings: [] });
  const parsed = parseProposal(text);
  check("a single-entry groups array survives verbatim", parsed.ok && parsed.plan.operations[0].groups, ["pathMoves[0]"]);
  check(
    "a multi-entry groups array (an operation two scope entries share) survives verbatim",
    parsed.ok && parsed.plan.operations[1].groups,
    ["pathMoves[0]", "rebuildIndexes[1]"]
  );
}

console.log("\n=== varied operation shapes ===");

// buildScopedPlan's ten operation kinds do not all carry `from` and `to`:
// split-folder, normalize-type, repair-frontmatter, and update-prose-paths
// carry no `to`; rebuild-index and create-index carry no `from`. The DM-facing
// table has to render something useful for each of these rather than a blank
// cell, and the JSON block has to lose nothing regardless of shape. Distinct
// folder names per operation so a substring match cannot accidentally hit a
// different row's text.
const SHAPES_PLAN = {
  operations: [
    {
      op: "split-folder",
      from: "settings/rolara/locations-split",
      buckets: [
        {
          folder: "settings/rolara/locations-split/north",
          name: "north",
          articles: [{ from: "settings/rolara/locations-split/Ashfall.md", to: "settings/rolara/locations-split/north/Ashfall.md" }],
        },
        { folder: "settings/rolara/locations-split/south", name: "south", articles: [] },
      ],
      groups: ["splitFolders[0]"],
      reason: "Split by scope",
    },
    {
      op: "normalize-type",
      from: "settings/rolara/npcs/Old.md",
      typeFrom: "npc-old",
      typeTo: "npc-current",
      groups: ["retypes[0]"],
      reason: "Retyped by scope",
    },
    {
      op: "repair-frontmatter",
      from: "settings/rolara/npcs/Broken.md",
      insert: ["status-field"],
      reorder: true,
      groups: ["repairs[0]"],
      reason: "Repaired by scope",
    },
    {
      op: "update-prose-paths",
      from: "CLAUDE.md",
      replacements: [{ from: "rolara-kb/", to: "settings/rolara/" }],
      groups: ["prose[0]"],
      reason: "Path updated by scope",
    },
    {
      op: "rebuild-index",
      to: "settings/rolara/archive-notes/Notes-INDEX.md",
      folder: "settings/rolara/archive-notes",
      groups: ["splitFolders[0]"],
      reason: "Rebuilt by scope",
    },
    {
      op: "create-index",
      to: "settings/rolara/locations-split/north/North-INDEX.md",
      groups: ["splitFolders[0]"],
      reason: "Created by scope",
    },
  ],
  declined: [],
  prechecks: { ok: true },
};

function tableSection(text) {
  // Isolated from "## Declined" onward and, crucially, from the fenced JSON
  // block: the JSON always carries every field, so a check against the WHOLE
  // rendered text would pass even if the table itself rendered a blank cell.
  const start = text.indexOf("## What will happen");
  const end = text.indexOf("## Declined");
  return text.slice(start, end);
}

// Parses the "| # | Operation | From | To | Detail | Why |" rows into cell
// arrays, rather than substring-searching the table as a blob. A blob search
// is too weak here: rebuild-index's `folder` and its `to` (the index file
// living inside that folder) usually share a substring in real plans, so
// checking "does the table CONTAIN this folder name" passes whether the From
// cell holds it or is blank and it only leaked in from the To cell. Reading
// the actual cell is what tells the two apart.
function tableRows(text) {
  return tableSection(text)
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| # ") && !line.startsWith("| --- "))
    .map((line) => line.split("|").map((c) => c.trim()).slice(1, -1));
}

{
  const text = renderProposal({ scope: {}, plan: SHAPES_PLAN, projectRoot: "C:/proj", settings: [] });
  const rows = tableRows(text);
  const rowFor = (opKind) => rows.find((r) => r[1] === opKind) || [];

  // Nothing is lost from the JSON block regardless of shape.
  const parsed = parseProposal(text);
  check("split-folder's buckets survive the round trip", parsed.ok && parsed.plan.operations[0].buckets, SHAPES_PLAN.operations[0].buckets);
  check(
    "normalize-type's typeFrom/typeTo survive the round trip",
    parsed.ok && [parsed.plan.operations[1].typeFrom, parsed.plan.operations[1].typeTo],
    ["npc-old", "npc-current"]
  );
  check(
    "repair-frontmatter's insert/reorder survive the round trip",
    parsed.ok && [parsed.plan.operations[2].insert, parsed.plan.operations[2].reorder],
    [["status-field"], true]
  );
  check(
    "update-prose-paths's replacements survive the round trip",
    parsed.ok && parsed.plan.operations[3].replacements,
    SHAPES_PLAN.operations[3].replacements
  );
  check("rebuild-index's folder survives the round trip", parsed.ok && parsed.plan.operations[4].folder, "settings/rolara/archive-notes");
  check("create-index's to survives the round trip", parsed.ok && parsed.plan.operations[5].to, "settings/rolara/locations-split/north/North-INDEX.md");

  // The DM-facing TABLE's own cells (not the JSON block, and not a blob search
  // that a coincidental substring could satisfy) render something useful for a
  // kind carrying no `to` or no `from`, rather than sitting blank.
  const splitRow = rowFor("split-folder");
  check(
    "split-folder's To cell names its buckets rather than sitting blank",
    splitRow[3] !== "" && splitRow[3].includes("north") && splitRow[3].includes("south"),
    true
  );
  const normRow = rowFor("normalize-type");
  check("normalize-type's Detail cell states the type change rather than sitting blank", normRow[4], "type npc-old -> npc-current");
  const repairRow = rowFor("repair-frontmatter");
  check(
    "repair-frontmatter's Detail cell states what will be inserted rather than sitting blank",
    repairRow[4],
    "insert: status-field; reorder: yes"
  );
  const proseRow = rowFor("update-prose-paths");
  check("update-prose-paths's Detail cell states the replacement count rather than sitting blank", proseRow[4], "1 path replacement");
  const rebuildRow = rowFor("rebuild-index");
  check("rebuild-index's From cell names its source folder rather than sitting blank", rebuildRow[2], "settings/rolara/archive-notes");
}

console.log("\n=== fences are lines, not substrings ===");

// The DM is explicitly invited to "edit this file freely" and leave notes
// about what they changed. A note that quotes the fence marker mid-sentence
// is not a second block: markdown fences open at the start of a line, and a
// marker sitting inside a sentence never does.
{
  const text = renderProposal({ scope: {}, plan: PLAN, projectRoot: "C:/proj", settings: [] });
  const withNote = text.replace(
    "## Approval",
    "Note: this replaces an earlier draft that had two ```json professor-orb:plan blocks in it by mistake.\n\n## Approval"
  );
  const parsed = parseProposal(withNote);
  check("a proposal whose prose quotes the fence marker mid-sentence still parses", parsed.ok, true);
  check("...and returns the operations untouched", parsed.ok && parsed.plan.operations, PLAN.operations);
}

// The other direction still has to hold: a genuine second block, fully
// fenced, is still two answers to "what did the DM approve" and still
// refuses. Included even though it likely already passed, so the prose-note
// fix above cannot have over-corrected into accepting two real blocks.
{
  const text = renderProposal({ scope: {}, plan: PLAN, projectRoot: "C:/proj", settings: [] });
  const twoReal = `${text}\n${text}`;
  const parsed = parseProposal(twoReal);
  check("two genuine plan blocks still refuse", parsed.ok, false);
  check("...with the two-block reason, not a parse failure", /2 professor-orb:plan blocks/.test(parsed.reason), true);
}

// The closing scan used to look for a bare newline-plus-backticks substring
// anywhere past the open, so a string value whose own raw text happened to
// contain that sequence would truncate the block early: JSON.parse would then
// see an unterminated string and blame the wrong thing. A hand-typed value
// spanning a raw line break (invalid JSON either way, since JSON strings
// cannot carry a literal control character) still has to refuse, but it
// should refuse because of the real problem, not because the scan gave up
// early on an unterminated fragment.
{
  const raw =
    "```json professor-orb:plan\n" +
    '{"operations": [{"op": "relocate-path", "from": "a.md", "to": "b.md", ' +
    '"reason": "line one\n``` still inside the string, not a real fence"}], "declined": []}\n' +
    "```\n";
  const parsed = parseProposal(raw);
  check("a string value's own line break still refuses", parsed.ok, false);
  check(
    "...but for the actual control-character problem, not a truncated-slice artifact",
    /control character/i.test(parsed.reason),
    true
  );
}

// The shape the DM is actually invited to produce: a note above the block
// explaining an edit, quoting the marker, with the block itself struck and a
// destination changed. Both fixes have to hold at once for this to parse.
{
  const text = renderProposal({ scope: {}, plan: PLAN, projectRoot: "C:/proj", settings: [] });
  const edited = text
    .replace(
      "## Approval",
      "Note: I struck the rebuild-index entry from the ```json professor-orb:plan block below; the index already looked right.\n\n## Approval"
    )
    .replace('"to": "settings/rolara/notes/A.md"', '"to": "settings/rolara/archive/A.md"')
    .replace(/,\s*\{[^{}]*"op": "rebuild-index"[\s\S]*?\}/, "");
  const parsed = parseProposal(edited);
  check("a note-plus-edit proposal, quoting the marker and striking an operation, parses", parsed.ok, true);
  check("...with the edited destination", parsed.ok && parsed.plan.operations[0].to, "settings/rolara/archive/A.md");
  check("...and the struck operation gone", parsed.ok && parsed.plan.operations.length, 1);
}

console.log("\n=== conventions after a scope ===");

const CONVENTIONS = {
  schemaVersion: 1,
  settings: [
    {
      name: "rolara",
      kbRoot: "settings/rolara",
      homebrewRoot: "homebrew/rolara",
      sessionReportsRoot: "session-reports/rolara",
      campaigns: ["karsk"],
      tagRegistryPath: ".professor-orb/tag-registry.rolara.json",
      rules: {
        frontmatterTypeEnum: {
          provenance: "professor-orb",
          category: "frontmatter",
          check: "enum",
          enforcement: "block",
          description: "type must be recognized.",
          params: { field: "type", values: ["Person", "Location"] },
        },
      },
    },
  ],
};

{
  const r = conventionsAfterScope(CONVENTIONS, {
    retypes: [{ files: ["a.md"], typeFrom: "Person", typeTo: "Character" }],
  });
  // frontmatterTypeEnum blocks. Retyping articles to a value the enum does not
  // carry would make every one of them fail the write-time hook on the next
  // edit, on output professor-orb's own migration produced.
  check("a retype extends the type enum",
    r.conventions.settings[0].rules.frontmatterTypeEnum.extendedBy, ["Character"]);
  check("the base values are untouched",
    r.conventions.settings[0].rules.frontmatterTypeEnum.params.values, ["Person", "Location"]);
  check("the change is reported in words", r.changes.length, 1);
  check("the input object is not mutated",
    CONVENTIONS.settings[0].rules.frontmatterTypeEnum.extendedBy, undefined);
}

{
  const withExisting = JSON.parse(JSON.stringify(CONVENTIONS));
  withExisting.settings[0].rules.frontmatterTypeEnum.extendedBy = ["Settlement"];
  const r = conventionsAfterScope(withExisting, {
    retypes: [
      { files: ["a.md"], typeFrom: "Person", typeTo: "Settlement" },
      { files: ["b.md"], typeFrom: "Person", typeTo: "Character" },
    ],
  });
  check("an existing extension is not duplicated",
    r.conventions.settings[0].rules.frontmatterTypeEnum.extendedBy, ["Settlement", "Character"]);
}

{
  const r = conventionsAfterScope(CONVENTIONS, {});
  check("an empty scope changes nothing", r.changes, []);
  check("and returns the file as it was", r.conventions, CONVENTIONS);
}

{
  const r = conventionsAfterScope(CONVENTIONS, {
    retypes: [{ files: ["a.md"], typeFrom: "Person", typeTo: "Location" }],
  });
  // Already a base value. Adding it to extendedBy would be noise in a file the
  // DM reads, and would imply the project contributed something it did not.
  check("a value already in the base enum is not added as an extension",
    r.conventions.settings[0].rules.frontmatterTypeEnum.extendedBy, undefined);
  check("and nothing is reported as changed", r.changes, []);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
