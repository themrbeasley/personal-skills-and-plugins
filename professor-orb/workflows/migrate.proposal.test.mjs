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

// Reaching into an entry an implementation may not have created has to make the
// case go RED, not throw and take every later case in the file down with it: an
// exception here would hide exactly the red set that proves the suite can fail.
// Measured, not assumed. The first RED run of the setting-split cases below died
// on `settings[1].homebrewRoot` and reported one failure where there were six.
// The plan suite carries the same guard for the same reason.
const obj = (v) => (v && typeof v === "object" ? v : {});

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
  const r = conventionsAfterScope(CONVENTIONS, { settingRenames: [{ from: "rolara", to: "rolara-prime" }] });
  const s = r.conventions.settings[0];
  check("a rename repoints every root and the name",
    [s.name, s.kbRoot, s.homebrewRoot, s.sessionReportsRoot],
    ["rolara-prime", "settings/rolara-prime", "homebrew/rolara-prime", "session-reports/rolara-prime"]);
  check("and the tag registry path follows the name",
    s.tagRegistryPath, ".professor-orb/tag-registry.rolara-prime.json");
  // Pure, and it matters here more than anywhere: /migrate hands this function
  // the file it moved aside and has to be able to fall back to it unchanged.
  check("and the file it was handed is untouched",
    [CONVENTIONS.settings[0].name, CONVENTIONS.settings[0].kbRoot, CONVENTIONS.settings[0].tagRegistryPath],
    ["rolara", "settings/rolara", ".professor-orb/tag-registry.rolara.json"]);
}

{
  // THE SUBSTRING HAZARD, which is why the rewrite is by path COMPONENT rather
  // than by `split(old).join(new)`. This setting is called "orb", and the
  // canonical registry path holds "orb" twice: once inside ".professor-orb",
  // which is the plugin's own install directory and has nothing to do with the
  // setting, and once as the dot-delimited part that IS the setting's name. A
  // substring replacement rewrites both and moves the install directory out from
  // under the write-time hook, which reads this path to resolve a tag vocabulary.
  const orb = {
    settings: [
      {
        name: "orb",
        kbRoot: "settings/orb",
        homebrewRoot: "homebrew/orb",
        sessionReportsRoot: "session-reports/orb",
        campaigns: [],
        tagRegistryPath: ".professor-orb/tag-registry.orb.json",
      },
    ],
  };
  const r = conventionsAfterScope(orb, { settingRenames: [{ from: "orb", to: "orb-two" }] });
  check("a name that is also a substring of another path component rewrites only its own",
    r.conventions.settings[0].tagRegistryPath, ".professor-orb/tag-registry.orb-two.json");
  check("and the prong roots still follow, because there the name IS the whole component",
    r.conventions.settings[0].kbRoot, "settings/orb-two");
}

{
  const r = conventionsAfterScope(CONVENTIONS, { settingRetirements: [{ setting: "rolara" }] });
  const s = r.conventions.settings[0];
  check("retiring marks the entry rather than deleting it",
    [r.conventions.settings.length, s.retired], [1, true]);
  check("and repoints the roots into the archive", s.kbRoot, "archive/rolara/settings");
}

{
  const r = conventionsAfterScope(CONVENTIONS, {
    campaignRetirements: [{ setting: "rolara", campaign: "karsk" }],
  });
  const s = r.conventions.settings[0];
  check("a retired campaign leaves the active list", s.campaigns, []);
  check("and is recorded rather than forgotten", s.retiredCampaigns, ["karsk"]);
}

{
  // The planner declines a campaign the setting does not list, so this half must
  // not record one either. Otherwise conventions.json grows a retiredCampaigns
  // entry for a campaign that was never there and that nothing moved.
  const r = conventionsAfterScope(CONVENTIONS, {
    campaignRetirements: [{ setting: "rolara", campaign: "nope" }],
  });
  const s = r.conventions.settings[0];
  check("a campaign the setting never listed is not recorded as retired",
    [s.campaigns, s.retiredCampaigns, r.changes.length], [["karsk"], undefined, 0]);
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

{
  // MINOR 1, the DM-facing line. A setting recording ONE prong root was still
  // told all three were repointed, and a registry path the name does not appear
  // in was still told it "follows the name" when nothing about it changed. Both
  // land in the /migrate report, so both were reporting work that did not happen.
  const oneRoot = { settings: [{ name: "rolara", kbRoot: "settings/rolara" }] };
  const r = conventionsAfterScope(oneRoot, { settingRenames: [{ from: "rolara", to: "prime" }] });
  check("the change line names the roots actually repointed, not three of them",
    [/repointed every prong root it records \(kbRoot\)/.test(r.changes[0]), /all three/.test(r.changes[0])],
    [true, false]);
}

{
  const noMatch = JSON.parse(JSON.stringify(CONVENTIONS));
  noMatch.settings[0].tagRegistryPath = ".professor-orb/tag-registry.json";
  const r = conventionsAfterScope(noMatch, { settingRenames: [{ from: "rolara", to: "prime" }] });
  check("a registry path the name does not appear in is reported unchanged, not as following the name",
    [
      r.conventions.settings[0].tagRegistryPath,
      /is unchanged/.test(r.changes[0]),
      /follows the name/.test(r.changes[0]),
    ],
    [".professor-orb/tag-registry.json", true, false]);
}

{
  // MINOR 2. A setting whose name is also a file extension. The dot-delimited
  // basename rewrite matched the extension too, so ".../tag-registry.json.json"
  // came back as ".../tag-registry.ledger.ledger": a path with no extension at
  // all, pointing at a file that is not there.
  const named = {
    settings: [
      {
        name: "json",
        kbRoot: "settings/json",
        tagRegistryPath: ".professor-orb/tag-registry.json.json",
      },
    ],
  };
  const r = conventionsAfterScope(named, { settingRenames: [{ from: "json", to: "ledger" }] });
  check("a name that is also a file extension does not rewrite the extension",
    r.conventions.settings[0].tagRegistryPath, ".professor-orb/tag-registry.ledger.json");
  check("and the directory component is still left alone",
    r.conventions.settings[0].kbRoot, "settings/ledger");
}

{
  const r = conventionsAfterScope(CONVENTIONS, {
    settingSplits: [{ from: "rolara", name: "ashlands", kbRoot: "settings/ashlands", files: [] }],
  });
  check("a split adds a settings entry", r.conventions.settings.map((s) => s.name), ["rolara", "ashlands"]);
  check("the new setting gets defaulted sibling prongs",
    [obj(r.conventions.settings[1]).homebrewRoot, obj(r.conventions.settings[1]).sessionReportsRoot],
    ["homebrew/ashlands", "session-reports/ashlands"]);
  // A split divides ONE world's material, and the extras layer that world
  // accumulated describes the articles on both sides of the division. An empty
  // rule set would leave every article that moved unchecked by the rules it was
  // written under.
  check("and carries the source setting's rules, not an empty set",
    Object.keys(obj(obj(r.conventions.settings[1]).rules)), ["frontmatterTypeEnum"]);
  // A COPY of them. Sharing the object would make a later edit to either setting
  // silently change the other.
  check("as a copy rather than the same object",
    obj(r.conventions.settings[1]).rules === obj(r.conventions.settings[0]).rules, false);
  check("the source setting is untouched", r.conventions.settings[0].kbRoot, "settings/rolara");
  check("and so is the file this function was handed", CONVENTIONS.settings.length, 1);
}

{
  // One entry per name. A second under a name already recorded would leave
  // settingNamed resolving to whichever came first, which is how one world's
  // articles start being checked against another world's rules.
  const r = conventionsAfterScope(CONVENTIONS, {
    settingSplits: [{ from: "rolara", name: "rolara", kbRoot: "settings/rolara-two", files: [] }],
  });
  check("a split into a name already recorded adds no second entry, and says so",
    [r.conventions.settings.length, /already records a setting called rolara/.test(String(r.changes[0]))],
    [1, true]);
}

console.log("\n=== conventions after a scope: what RAN, not what was asked for ===");

// The third argument is the operations that actually applied. Without it this
// function has to assume the whole scope ran, and a scope entry that was declined
// at plan time or skipped at apply time still rewrote conventions.json to prong
// roots nothing created. See conventionsAfterScope's own header for the rule.
const RENAME = { settingRenames: [{ from: "rolara", to: "prime" }] };
const ranOp = (from, to, group) => ({
  op: "relocate-prong",
  from,
  to,
  applied: true,
  detail: "Relocated with git mv (direct).",
  groups: [group],
});
const FULL_RENAME = [
  ranOp("settings/rolara", "settings/prime", "settingRenames[0]"),
  ranOp("homebrew/rolara", "homebrew/prime", "settingRenames[0]"),
  ranOp("session-reports/rolara", "session-reports/prime", "settingRenames[0]"),
];

{
  // THE HEADLINE CASE. One git-ignored prong root declines the whole entry, so
  // all three moves are declined and the plan applies nothing. The conventions
  // file must come back exactly as it went in: the tree it describes is still
  // the tree on disk.
  const r = conventionsAfterScope(CONVENTIONS, RENAME, []);
  check("a rename whose every operation was declined leaves the file untouched", r.conventions, CONVENTIONS);
  check("...and reports no change to the DM", r.changes, []);
}

{
  // Some but not all. The homebrew move failed after the two others landed, and
  // applyPlan does not roll back, so two folders are at the new name and one is
  // still at the old. Each root is recorded where its folder actually IS.
  const partial = [
    ranOp("settings/rolara", "settings/prime", "settingRenames[0]"),
    ranOp("session-reports/rolara", "session-reports/prime", "settingRenames[0]"),
  ];
  const r = conventionsAfterScope(CONVENTIONS, RENAME, partial);
  const s = r.conventions.settings[0];
  check("a root whose move did not apply keeps the path its folder is still at",
    [s.kbRoot, s.homebrewRoot, s.sessionReportsRoot],
    ["settings/prime", "homebrew/rolara", "session-reports/prime"]);
  check("...and the change line names it rather than claiming it moved",
    /homebrewRoot \(homebrew\/rolara\) did not move/.test(r.changes[0]), true);
}

{
  // Recorded from the operation that ran, not from the scope. A proposal file the
  // DM edited can send a prong somewhere the scope's own arithmetic never would,
  // and the file has to describe where the folder went, not where it was aimed.
  const edited = [ranOp("settings/rolara", "worlds/prime", "settingRenames[0]")];
  const r = conventionsAfterScope(CONVENTIONS, RENAME, edited);
  check("a root is recorded where the operation actually put it",
    r.conventions.settings[0].kbRoot, "worlds/prime");
}

{
  // The gate is keyed on the entry's OWN group id. An operation belonging to a
  // different entry under the same key does not license this one.
  const two = {
    settings: [
      { name: "karsk", kbRoot: "settings/karsk" },
      { name: "rolara", kbRoot: "settings/rolara" },
    ],
  };
  const r = conventionsAfterScope(
    two,
    { settingRenames: [{ from: "karsk", to: "karsk-two" }, { from: "rolara", to: "prime" }] },
    [ranOp("settings/karsk", "settings/karsk-two", "settingRenames[0]")]
  );
  check("one entry running does not record a second entry that did not",
    [r.conventions.settings[0].name, r.conventions.settings[1].name, r.changes.length],
    ["karsk-two", "rolara", 1]);
}

{
  const r = conventionsAfterScope(CONVENTIONS, { settingRetirements: [{ setting: "rolara" }] }, []);
  const s = r.conventions.settings[0];
  check("a retirement whose every operation was declined does not mark the setting retired",
    [s.retired, s.kbRoot, r.changes.length], [undefined, "settings/rolara", 0]);
}

{
  const r = conventionsAfterScope(
    CONVENTIONS,
    { campaignRetirements: [{ setting: "rolara", campaign: "karsk" }] },
    []
  );
  const s = r.conventions.settings[0];
  check("a campaign retirement that did not run leaves the campaign in the active list",
    [s.campaigns, s.retiredCampaigns, r.changes.length], [["karsk"], undefined, 0]);
}

{
  // Retypes stay UNCONDITIONAL. Extending the type enum records the values the
  // scope introduced rather than a folder that moved, and an enum carrying a value
  // no article uses costs nothing, while an enum missing one fails the write-time
  // hook on output the migration itself produced. Tasks 13 and 14 add cases to
  // this function; this is the line that says which side of the gate they go on.
  const r = conventionsAfterScope(
    CONVENTIONS,
    { retypes: [{ files: ["a.md"], typeFrom: "Person", typeTo: "Character" }] },
    []
  );
  check("a retype extends the enum even when nothing in the plan applied",
    r.conventions.settings[0].rules.frontmatterTypeEnum.extendedBy, ["Character"]);
}

// A split has no root of its own to repoint, so repointProngs has nothing to key
// on: it repoints roots a setting ALREADY records, and this case creates the
// entry. What the entry is keyed on instead is an applied operation of its own
// group that landed an article INSIDE the kbRoot the entry would record. That
// satisfies both halves of the rule at appliedGate: at least one operation
// carrying the group applied, and the one path the entry records is a path an
// applied operation demonstrably put something at.
const SPLIT = {
  settingSplits: [
    { from: "rolara", name: "ashlands", kbRoot: "settings/ashlands", files: ["settings/rolara/Ashfall.md"] },
  ],
};
const splitOp = (to, group = "settingSplits[0]") => ({
  op: "relocate-path",
  from: "settings/rolara/Ashfall.md",
  to,
  applied: true,
  detail: "Relocated with git mv (direct).",
  groups: [group],
});

{
  const r = conventionsAfterScope(CONVENTIONS, SPLIT, [splitOp("settings/ashlands/Ashfall.md")]);
  check("a split whose move applied adds the settings entry",
    [r.conventions.settings.map((s) => s.name), r.changes.length], [["rolara", "ashlands"], 1]);
}

{
  // THE HEADLINE CASE. One git-ignored article declines the whole entry, so no
  // move applies. Adding a settings entry anyway would leave conventions.json
  // naming a kbRoot that is not on disk: /scribe refuses to resolve its lane, the
  // write-time hook goes silent because no rule resolves, and the sweep reports
  // every article under it as unattributed. None of that announces itself as a
  // conventions problem.
  const r = conventionsAfterScope(CONVENTIONS, SPLIT, []);
  check("a split whose every operation was declined or skipped adds no settings entry",
    [r.conventions.settings.map((s) => s.name), r.changes], [["rolara"], []]);
}

{
  // Keyed on where the articles actually LANDED, not merely on the entry having
  // run. A proposal file the DM edited can send every one of them somewhere the
  // scope's own arithmetic never would, and an entry recorded at a kbRoot nothing
  // was put in describes a folder that is not there.
  const r = conventionsAfterScope(CONVENTIONS, SPLIT, [splitOp("settings/rolara/notes/Ashfall.md")]);
  check("a split whose articles the DM redirected out of the new kbRoot records no entry",
    [r.conventions.settings.map((s) => s.name), r.changes], [["rolara"], []]);
}

{
  // The gate is keyed on the entry's OWN group id, the same way the rename's is.
  const r = conventionsAfterScope(CONVENTIONS, SPLIT, [
    splitOp("settings/ashlands/Ashfall.md", "settingSplits[1]"),
  ]);
  check("an operation belonging to a different entry does not license this one",
    [r.conventions.settings.map((s) => s.name), r.changes], [["rolara"], []]);
}

{
  // TWO-ARGUMENT COMPATIBILITY, stated as a property rather than left to the
  // cases above: an omitted third argument means "the whole scope ran", so it must
  // equal the same call handed every operation the scope emits, changes text and all.
  check("omitting the third argument is the same as being told everything applied",
    conventionsAfterScope(CONVENTIONS, RENAME),
    conventionsAfterScope(CONVENTIONS, RENAME, FULL_RENAME));
  check("...and the same holds for a split",
    conventionsAfterScope(CONVENTIONS, SPLIT),
    conventionsAfterScope(CONVENTIONS, SPLIT, [splitOp("settings/ashlands/Ashfall.md")]));
}

{
  // A SPLIT planSettingSplits DECLINES UNCONDITIONALLY, asked without the third
  // argument. "The whole scope ran" is the right default for a scope that could
  // run, and neither of these could: a kbRoot nested with the source's leaves
  // every article under the inner root claimed by both settings, and a source
  // recording no kbRoot has no knowledge base to divide. The plan half emits no
  // operation for either, so recording the world anyway would write down a
  // conventions file describing a split that cannot happen.
  const nested = conventionsAfterScope(CONVENTIONS, {
    settingSplits: [
      { from: "rolara", name: "ashlands", kbRoot: "settings/rolara/ashlands", files: [] },
    ],
  });
  check("a two-argument call records no entry for a kbRoot nested in the source's",
    [nested.conventions.settings.map((s) => s.name), nested.changes], [["rolara"], []]);
  const rootless = conventionsAfterScope(
    { ...CONVENTIONS, settings: [{ ...CONVENTIONS.settings[0], kbRoot: "" }] },
    { settingSplits: [{ from: "rolara", name: "ashlands", kbRoot: "settings/ashlands", files: [] }] }
  );
  check("and none for a source setting that records no kbRoot",
    [rootless.conventions.settings.map((s) => s.name), rootless.changes], [["rolara"], []]);
}

console.log("\n=== conventions after a scope: one world merged into another ===");

// TWO WORLDS, which is what a merge needs and what CONVENTIONS alone does not have.
// karsk carries a type extension of its own, and a campaign called deeps that rolara
// also ran: the same-name case that decides what a merge does with a campaign folder.
const MERGE_CONVENTIONS = {
  schemaVersion: 1,
  settings: [
    {
      ...JSON.parse(JSON.stringify(CONVENTIONS.settings[0])),
      campaigns: ["ember", "deeps"],
    },
    {
      name: "karsk",
      kbRoot: "settings/karsk",
      homebrewRoot: "homebrew/karsk",
      sessionReportsRoot: "session-reports/karsk",
      campaigns: ["deeps", "hollow"],
      tagRegistryPath: ".professor-orb/tag-registry.karsk.json",
      rules: {
        frontmatterTypeEnum: {
          provenance: "professor-orb",
          category: "frontmatter",
          check: "enum",
          enforcement: "block",
          description: "type must be recognized.",
          extendedBy: ["Settlement"],
          params: { field: "type", values: ["Person", "Location"] },
        },
      },
    },
  ],
};

const MERGE = { settingMerges: [{ from: "karsk", into: "rolara" }] };
const mergeOp = (from, to, group = "settingMerges[0]") => ({
  op: "relocate-path",
  from,
  to,
  applied: true,
  detail: "Relocated with git mv (direct).",
  groups: [group],
});
// Every prong, because a merge moves every prong. The campaign folders are the two
// under the source's sessionReportsRoot, and deeps lands under a disambiguated name
// because rolara already ran one.
const FULL_MERGE = [
  mergeOp("settings/karsk/Tavern.md", "settings/rolara/Tavern-karsk.md"),
  mergeOp("homebrew/karsk/Blade.md", "homebrew/rolara/Blade-karsk.md"),
  mergeOp("session-reports/karsk/deeps", "session-reports/rolara/deeps-karsk"),
  mergeOp("session-reports/karsk/hollow", "session-reports/rolara/hollow"),
];

{
  const r = conventionsAfterScope(MERGE_CONVENTIONS, MERGE, FULL_MERGE);
  const rolara = obj(r.conventions.settings[0]);
  const karsk = obj(r.conventions.settings[1]);
  // The source's campaigns fold in under the names their folders actually landed at.
  // A campaign both worlds ran is renamed rather than fused: two campaigns sharing
  // one lane would interleave two histories the DM never agreed to join.
  check("the source's campaigns fold into the target under the names their folders landed at",
    rolara.campaigns, ["ember", "deeps", "deeps-karsk", "hollow"]);
  // frontmatterTypeEnum ships at enforcement block, so dropping the source's
  // extensions would make every merged article of an extended type fail the
  // write-time hook on its next edit.
  check("and so do the source's type extensions, which describe articles that now live there",
    obj(obj(rolara.rules).frontmatterTypeEnum).extendedBy, ["Settlement"]);
  check("the merged entry is MARKED, not deleted",
    [r.conventions.settings.length, karsk.mergedInto, karsk.retired], [2, "rolara", true]);
  // Its roots are NOT repointed at the target's. Two entries recording one kbRoot
  // would leave settingForFolder resolving every article under it to whichever came
  // first, which is how one world's articles start being checked against another
  // world's rules.
  check("and its own roots stay where they are rather than being pointed at the target's",
    [karsk.kbRoot, karsk.homebrewRoot, karsk.sessionReportsRoot],
    ["settings/karsk", "homebrew/karsk", "session-reports/karsk"]);
  check("the change is reported in words", r.changes.length, 1);
  check("and the file this function was handed is not mutated",
    [MERGE_CONVENTIONS.settings[1].mergedInto, MERGE_CONVENTIONS.settings[0].campaigns],
    [undefined, ["ember", "deeps"]]);
}

{
  // THE HEADLINE CASE. One git-ignored article declines the whole entry, so nothing
  // applies. Folding the campaigns in anyway would leave rolara's lane list naming
  // folders that are still under karsk, and marking karsk merged would say a world
  // moved that did not.
  const r = conventionsAfterScope(MERGE_CONVENTIONS, MERGE, []);
  check("a merge whose every operation was declined or skipped records nothing",
    [r.conventions, r.changes], [MERGE_CONVENTIONS, []]);
}

{
  // Rule 2 of appliedGate, on a campaign folder, which is a recorded path exactly as
  // a prong root is: settings[].campaigns plus sessionReportsRoot resolves to one.
  // Only the campaign whose folder actually moved is written into the target's list;
  // a lane recorded at a folder that is still under the source is one /log cannot
  // resolve, and settings[].campaigns is a cache rather than the authority on which
  // folders exist, so a listed campaign with no folder at all is an ordinary way to
  // reach this.
  const r = conventionsAfterScope(MERGE_CONVENTIONS, MERGE, [
    mergeOp("settings/karsk/Tavern.md", "settings/rolara/Tavern-karsk.md"),
    mergeOp("session-reports/karsk/hollow", "session-reports/rolara/hollow"),
  ]);
  check("a campaign whose folder did not move is not written into the target's lane list",
    obj(r.conventions.settings[0]).campaigns, ["ember", "deeps", "hollow"]);
  check("...while the entry still records the merge, because something did move",
    [obj(r.conventions.settings[1]).mergedInto, obj(r.conventions.settings[1]).retired],
    ["rolara", true]);
}

{
  // Recorded from the operation that ran, not from the scope's own arithmetic. A
  // proposal file the DM edited can send a campaign folder somewhere this function
  // would never have computed, and the file has to describe the lane that exists.
  const r = conventionsAfterScope(MERGE_CONVENTIONS, MERGE, [
    mergeOp("session-reports/karsk/deeps", "session-reports/rolara/karsk-deeps"),
  ]);
  check("a campaign is recorded under the name the operation actually gave it",
    obj(r.conventions.settings[0]).campaigns, ["ember", "deeps", "karsk-deeps"]);
}

{
  // The gate is keyed on the entry's OWN group id, the same way the rename's and the
  // split's are.
  const r = conventionsAfterScope(MERGE_CONVENTIONS, MERGE, [
    mergeOp("settings/karsk/Tavern.md", "settings/rolara/Tavern-karsk.md", "settingMerges[1]"),
  ]);
  check("an operation belonging to a different entry does not license this one",
    [r.conventions, r.changes], [MERGE_CONVENTIONS, []]);
}

{
  // The same two conditions planSettingMerges declines on, so this half cannot
  // record a merge the plan half refused to plan.
  const self = conventionsAfterScope(MERGE_CONVENTIONS, { settingMerges: [{ from: "karsk", into: "karsk" }] });
  check("merging a setting into itself records nothing",
    [self.conventions, self.changes], [MERGE_CONVENTIONS, []]);
  const unknown = conventionsAfterScope(MERGE_CONVENTIONS, { settingMerges: [{ from: "nope", into: "rolara" }] });
  check("and neither does a merge naming a setting the file does not record",
    [unknown.conventions, unknown.changes], [MERGE_CONVENTIONS, []]);
}

{
  // TWO-ARGUMENT COMPATIBILITY, the same property the rename and the split state: an
  // omitted third argument means "the whole scope ran", so it must equal the same
  // call handed every operation the scope emits, changes text and all. The
  // disambiguation both sides compute is the same function, which is what keeps the
  // campaign names from drifting between the path that reads the applied list and
  // the path that reads the two campaign lists.
  check("omitting the third argument is the same as being told everything applied",
    conventionsAfterScope(MERGE_CONVENTIONS, MERGE),
    conventionsAfterScope(MERGE_CONVENTIONS, MERGE, FULL_MERGE));
}

{
  const plan = {
    operations: [
      {
        op: "split-folder",
        from: "settings/rolara/locations",
        buckets: [
          {
            folder: "settings/rolara/locations/north",
            name: "north",
            articles: [
              { from: "settings/rolara/locations/Coldwater.md", to: "settings/rolara/locations/north/Coldwater.md" },
              { from: "settings/rolara/locations/Hailstone.md", to: "settings/rolara/locations/north/Hailstone.md" },
            ],
            existing: ["Emberwatch.md", "Frosthollow.md", "North-INDEX.md"],
          },
          {
            folder: "settings/rolara/locations/south",
            name: "south",
            articles: [
              { from: "settings/rolara/locations/Dustmoor.md", to: "settings/rolara/locations/south/Dustmoor.md" },
            ],
          },
        ],
        reason: "DM scope",
      },
    ],
    declined: [],
    prechecks: { ok: true, collisions: [], ignored: [] },
  };
  const text = renderProposal({ scope: { summary: "split locations" }, plan, projectRoot: "/p", settings: [] });
  check("a merging bucket gets a disclosure section naming the folder and its contents",
    [text.includes("## Merging into existing folders"),
     text.includes("**settings/rolara/locations/north** (3 entries already there)"),
     text.includes("Emberwatch.md, Frosthollow.md, North-INDEX.md"),
     text.includes("2 moving in: Coldwater.md, Hailstone.md")],
    [true, true, true, true]);
  // Narrowed from a bare path substring: "settings/rolara/locations/south" is
  // already present twice before the merge section renders anything (the
  // operations table's To column and the fenced professor-orb:plan block both
  // serialize every bucket folder, and neither should change), so a whole-text
  // substring check can never be false regardless of what this section does.
  // The bolded folder heading is the form used only inside "## Merging into
  // existing folders", so it is what actually discriminates. Both halves are
  // asserted deliberately: the false half alone would also pass if the section
  // failed to render at all, which is the failure mode most worth catching.
  check("and a bucket merging into nothing is not listed there",
    [text.includes("**settings/rolara/locations/north**"),
     text.includes("**settings/rolara/locations/south**")],
    [true, false]);
}

{
  const plan = {
    operations: [
      { op: "create-index", to: "settings/rolara/notes/Notes-INDEX.md", reason: "new folder" },
    ],
    declined: [],
    prechecks: { ok: true, collisions: [], ignored: [] },
  };
  const text = renderProposal({ scope: { summary: "no merges" }, plan, projectRoot: "/p", settings: [] });
  check("a plan with no merging bucket has no disclosure section at all",
    text.includes("Merging into existing folders"), false);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
