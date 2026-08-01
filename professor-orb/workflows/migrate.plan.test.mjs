#!/usr/bin/env node
// Regression suite for the migration executor's PLAN phase.
//
// The plan phase is read-only by contract: it surveys and describes, and the
// apply phase is what mutates. One case here asserts that contract directly by
// comparing the fixture project byte for byte across a buildPlan call.
//
// Node built-ins only, no test framework.
//
// Run: node professor-orb/workflows/migrate.plan.test.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import {
  buildPlan,
  runPrechecks,
  OPERATION_ORDER,
  DEFERRED_OPERATIONS,
  buildScopedPlan,
  APPLY_ORDER,
  SCOPED_PLANNERS,
  scopedPlannerSequence,
  assertScopedPlannerDeclarations,
  retypeExtensions,
  crossBoundaryLinks,
  mergeCollisions,
} from "./migrate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE_RULES = JSON.parse(readFileSync(path.join(HERE, "..", "references", "base-rules.json"), "utf8"));

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

const list = (v) => (Array.isArray(v) ? v : []);
const kindsOf = (operations) => operations.map((o) => o.op);
const dedupeConsecutive = (xs) => xs.filter((x, i) => i === 0 || x !== xs[i - 1]);
const find = (operations, op) => operations.find((o) => o.op === op) || {};
// Reaching into a field an implementation may have stopped emitting has to make
// the case go RED, not throw and take every later case in the file down with it:
// an exception here would hide exactly the red set that proves the suite can
// fail. Measured, not assumed. Dropping the sourceLinks half of the plan phase
// crashed this file at the Object.keys below until this guard went in.
const obj = (v) => (v && typeof v === "object" ? v : {});

// Written out rather than imported. Comparing the planned order against
// OPERATION_ORDER would compare the module against itself: reorder the constant
// and both sides move together, so the case would pass whether or not the
// ordering rule held. This literal is the rule, from the phase 2 spec's
// dependency-ordered operation list.
const EXPECTED_ORDER = [
  "relocate-prong",
  "normalize-type",
  "rename-with-link-rewrite",
  "create-index",
  "merge-index",
  "repair-frontmatter",
  "vault",
  "tag-registry",
];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Two settings, because the layout exists to hold more than one world and the
// cross-setting duplicate basename case needs a second one to be legitimate.
// The second carries its own indexParity rule: under v3 rules live per setting.
const SETTINGS = [
  {
    name: "rolara",
    kbRoot: "settings/rolara",
    homebrewRoot: "homebrew/rolara",
    sessionReportsRoot: "session-reports/rolara",
    campaigns: ["ashes-of-the-first-crown"],
    rules: {},
    tagRegistryPath: ".professor-orb/tag-registry.rolara.json",
  },
  {
    name: "karsk",
    kbRoot: "settings/karsk",
    homebrewRoot: "homebrew/karsk",
    sessionReportsRoot: "session-reports/karsk",
    campaigns: [],
    rules: { structuralIndexParity: { params: { indexSuffix: "-IDX" } } },
    tagRegistryPath: ".professor-orb/tag-registry.karsk.json",
  },
];

// One entry of every discoverable kind, so the order assertion has something
// of each operation to order.
const FULL_SURVEY = {
  prongMoves: [
    { settingIndex: 0, setting: "rolara", kind: "kb", from: "rolara-kb", to: "settings/rolara" },
    { settingIndex: 0, setting: "rolara", kind: "homebrew", from: "homebrew", to: "homebrew/rolara" },
  ],
  typeMismatches: [
    { file: "settings/rolara/history/First-Age.md", typeFrom: "chronology", typeTo: "Chronology" },
  ],
  renames: [
    {
      file: "settings/rolara/history/First-Age.md",
      to: "settings/rolara/history/First-Age-CHRONOLOGY.md",
      ruleId: "filenameSuffixChronology",
      links: ["settings/rolara/Master-INDEX.md", "settings/rolara/history/History-INDEX.md"],
    },
  ],
  missingIndexes: [
    { folder: "settings/rolara/culture", settingIndex: 0 },
    { folder: "settings/karsk/culture", settingIndex: 1 },
  ],
  multiIndexFolders: [
    {
      folder: "settings/rolara/items",
      survivor: "settings/rolara/items/Items-INDEX.md",
      sources: [
        "settings/rolara/items/Artifacts-INDEX.md",
        "settings/rolara/items/Materials-INDEX.md",
        "settings/rolara/items/Spells-INDEX.md",
      ],
    },
  ],
  frontmatterRepairs: [
    { file: "settings/rolara/characters/Aria.md", insert: ["publish", "type"], reorder: true },
  ],
  vaults: [{ settingIndex: 0, setting: "rolara", to: "settings/rolara/.obsidian" }],
  tagRegistries: [
    { settingIndex: 0, setting: "rolara", to: ".professor-orb/tag-registry.rolara.json" },
  ],
  splitCandidates: [
    { folder: "settings/rolara/locations", entryCount: 9, proposal: "one subfolder per region" },
  ],
  absorbCandidates: [{ folder: "settings/rolara/misc", entryCount: 2 }],
};

const plan = (discovered, projectRoot) =>
  buildPlan({ projectRoot, settings: SETTINGS, baseRules: BASE_RULES, discovered });

// base-rules.json ships structuralIndexParity.indexSuffix as "-INDEX", which is
// byte-identical to the hardcoded fallback in indexSuffixFor. Asserting
// "-INDEX" therefore passes whether the base rules were read or never opened at
// all. This copy pins a suffix that differs from the fallback, so only an
// actual read of the base layer can produce it.
const BASE_RULES_DISTINCT_SUFFIX = {
  ...BASE_RULES,
  rules: {
    ...BASE_RULES.rules,
    structuralIndexParity: {
      ...BASE_RULES.rules.structuralIndexParity,
      params: { ...BASE_RULES.rules.structuralIndexParity.params, indexSuffix: "-BASEIDX" },
    },
  },
};

// ---------------------------------------------------------------------------
// Disposable git fixture, for the two cases that need a real repository:
// git-ignored sources, and the read-only assertion.
// ---------------------------------------------------------------------------

function makeRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-migrate-plan-"));
  const write = (rel, body) => {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  // The middle two entries are paths git C-quotes in its default porcelain
  // output, one for a byte above 0x7F and one for a space. The reference
  // consumer's character class already holds 18 markdown files with non-ASCII
  // names. The last entry is the largest-blast-radius shape: an ignored
  // DIRECTORY whose own name is non-ASCII, so every file beneath it is hidden
  // in one stroke if the parser regresses, exactly the way editor-state/
  // (ASCII) already proves the directory-rule mechanism itself.
  write(
    ".gitignore",
    "settings/rolara/editor-state/\nsettings/rolara/éclair-notes.md\nsettings/rolara/two words.md\n" +
      "settings/rolara/Café/\n"
  );
  // Missing publish. Reported, never inserted.
  write("settings/rolara/Ashfall-Compact.md", "---\ntype: Organization\ntags: [faction]\n---\n\nBody.\n");
  // publish present, and false: nothing to report. Doubles as the destination
  // that is ALREADY OCCUPIED for the on-disk collision cases.
  write("settings/rolara/Vault-Of-Secrets.md", "---\npublish: false\ntype: Location\n---\n\nBody.\n");
  // Inside a prong root, and git-ignored: the reference consumer keeps editor
  // state exactly here, which is why an ignored file must not abort a run. It
  // carries publish so that the missing-publish case below stays about publish.
  write("settings/rolara/editor-state/scratch.md", "---\npublish: false\ntype: Concept\n---\n\nScratch.\n");
  // Ignored, and named so that git quotes the path. Both carry publish, for the
  // same reason scratch.md does.
  write("settings/rolara/éclair-notes.md", "---\npublish: false\ntype: Concept\n---\n\nBody.\n");
  write("settings/rolara/two words.md", "---\npublish: false\ntype: Concept\n---\n\nBody.\n");
  // A file beneath a non-ASCII ignored directory: the shape with the largest
  // blast radius, since one directory rule hides every file beneath it.
  write("settings/rolara/Café/Secret-Recipe.md", "---\npublish: false\ntype: Concept\n---\n\nBody.\n");
  // A prefix sibling that must NOT match the Café/ rule. Only the trailing
  // slash on the ignore entry keeps "Café-Rouge" from being read as starting
  // with "Café"; drop that slash and this file wrongly reads as ignored too.
  write("settings/rolara/Café-Rouge/Menu.md", "---\npublish: false\ntype: Concept\n---\n\nBody.\n");
  // A folder holding an index that already exists, for the merge-index and
  // create-index destination cases.
  write("settings/rolara/items/Items-INDEX.md", "---\npublish: false\ntype: Index\n---\n\nSurvivor.\n");
  write("settings/rolara/items/Artifacts-INDEX.md", "---\npublish: false\ntype: Index\n---\n\nSource.\n");
  // Two vaults that are ALREADY on disk, which is the ordinary state of any
  // project that has been set up once: the reference consumer already carries
  // rolara-kb/.obsidian. One is the create shape's destination, the other is a
  // move shape's destination.
  write("settings/rolara/.obsidian/app.json", "{}\n");
  write("settings/karsk/.obsidian/app.json", "{}\n");
  const git = (...argv) =>
    execFileSync("git", argv, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Plan Test");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  return root;
}

// Everything about the working tree that a mutation would disturb, plus git's
// own view of it. Compared across a buildPlan call.
//
// .git/ is walked past rather than into: running git status refreshes the
// index's stat cache, so .git/index's mtime moves on every call and would make
// this compare unequal no matter what the plan phase did. The porcelain line
// below is what covers git's side, and it reports any added, modified, deleted,
// untracked, or ignored path.
function snapshotTree(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === ".git") continue;
      const abs = path.join(dir, name);
      const st = statSync(abs);
      const rel = path.relative(root, abs).replace(/\\/g, "/");
      if (st.isDirectory()) {
        out.push(`d ${rel}`);
        walk(abs);
      } else {
        out.push(`f ${rel} ${st.size} ${st.mtimeMs}`);
      }
    }
  };
  walk(root);
  out.push(
    "git " +
      execFileSync("git", ["status", "--porcelain", "--ignored"], { cwd: root, encoding: "utf8" })
  );
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

console.log("\nOperation order");

{
  const p = plan(FULL_SURVEY);
  check("the declared order is the spec's dependency order", OPERATION_ORDER, EXPECTED_ORDER);
  check("every kind is planned, in that order, with no interleaving",
    dedupeConsecutive(kindsOf(p.operations)), EXPECTED_ORDER);
  check("type normalization precedes the rename pass, so suffixes are computed from corrected types",
    kindsOf(p.operations).indexOf("normalize-type") <
      kindsOf(p.operations).indexOf("rename-with-link-rewrite"), true);
  check("a rename carries the link rewrite it requires as one unit of work",
    list(find(p.operations, "rename-with-link-rewrite").links).length, 2);
}

console.log("\nDeferred operations");

{
  const p = plan(FULL_SURVEY);
  check("split and absorb never appear in operations",
    p.operations.filter((o) => DEFERRED_OPERATIONS.includes(o.op)), []);
  check("split appears in declined, naming the folder",
    p.declined.filter((d) => d.op === "split").map((d) => d.target), ["settings/rolara/locations"]);
  check("absorb appears in declined, naming the folder",
    p.declined.filter((d) => d.op === "absorb").map((d) => d.target), ["settings/rolara/misc"]);
  check("the split reason states the run did not execute it",
    /Not executed/.test(find(p.declined, "split").reason || ""), true);
}

console.log("\nDestination collisions");

{
  // Two sources renaming into one destination in one directory. A move would
  // overwrite, so this aborts before anything is mutated.
  const p = plan({
    renames: [
      { file: "settings/rolara/items/Sword.md", to: "settings/rolara/items/Sword-of-Dawn.md", ruleId: "filenameCharset" },
      { file: "settings/rolara/items/Sword of Dawn.md", to: "settings/rolara/items/Sword-of-Dawn.md", ruleId: "filenameCharset" },
    ],
  });
  check("a same-directory basename collision sets prechecks.ok false", p.prechecks.ok, false);
  check("the colliding pair is reported", p.prechecks.collisions.length, 1);
}

{
  // Case-insensitive filesystem: two destinations differing only in case are
  // one file, so they collide.
  const p = plan({
    renames: [
      { file: "settings/rolara/items/a.md", to: "settings/rolara/items/Sword-of-Dawn.md", ruleId: "filenameCharset" },
      { file: "settings/rolara/items/b.md", to: "settings/rolara/items/SWORD-OF-DAWN.md", ruleId: "filenameCharset" },
    ],
  });
  check("collision detection within a directory is case-insensitive", p.prechecks.ok, false);
}

{
  // The DIRECTORY half of the key folds too. settings/Rolara/items and
  // settings/rolara/items are one directory on Windows and macOS, so folding
  // only the basename let a pair through that is one file. No projectRoot here,
  // so this is about the key alone and not about anything on disk.
  const p = plan({
    renames: [
      { file: "settings/rolara/items/a.md", to: "settings/Rolara/items/Sword.md", ruleId: "filenameCharset" },
      { file: "settings/rolara/items/b.md", to: "settings/rolara/items/sword.md", ruleId: "filenameCharset" },
    ],
  });
  check("two destinations differing only in the case of a DIRECTORY collide", p.prechecks.ok, false);
  check("and that pair is reported once", p.prechecks.collisions.length, 1);
}

{
  // Two worlds are each entitled to a Tavern.md. Aborting here would abort for
  // the exact duplication the per-setting layout exists to permit.
  const p = plan({
    renames: [
      { file: "settings/rolara/locations/The Tavern.md", to: "settings/rolara/locations/Tavern.md", ruleId: "filenameCharset" },
      { file: "settings/karsk/locations/The Tavern.md", to: "settings/karsk/locations/Tavern.md", ruleId: "filenameCharset" },
    ],
  });
  check("a cross-setting duplicate basename does not collide", p.prechecks.ok, true);
  check("and reports no collisions", p.prechecks.collisions, []);
}

{
  // The reference consumer's items/ holds six sub-index files. One merge
  // operation per SOURCE would give every source the same destination and read
  // as five collisions, aborting a run with nothing wrong with it.
  const p = plan({ multiIndexFolders: FULL_SURVEY.multiIndexFolders });
  check("a multi-index folder is one merge operation, not one per source",
    p.operations.filter((o) => o.op === "merge-index").length, 1);
  check("the merge carries every source it will consume",
    list(find(p.operations, "merge-index").sources).length, 3);
  check("a three-source merge does not read as a collision", p.prechecks.ok, true);
}

console.log("\nA merge carries the link rewrites it requires");

{
  // A merge REMOVES its sources, so every wikilink that named one dies with
  // them. That is the same class of dead reference a rename carries `links` to
  // prevent, and the reference consumer's items/ orphans six of them, which is
  // why the merge has to carry its referring files the same way. Backslashes
  // here because a survey may hand back native separators, and every path in a
  // plan is posix so the collision key built from it stays stable.
  const p = plan({
    multiIndexFolders: [
      {
        folder: "settings\\rolara\\items",
        survivor: "settings\\rolara\\items\\Items-INDEX.md",
        sources: ["settings\\rolara\\items\\Artifacts-INDEX.md"],
        sourceLinks: {
          "settings\\rolara\\items\\Artifacts-INDEX.md": [
            "settings\\rolara\\items\\Items-INDEX.md",
            "settings\\rolara\\items\\Items-INDEX.md",
          ],
        },
      },
    ],
  });
  const merge = find(p.operations, "merge-index");
  check("a merge carries the files referring to each source it removes, posix and deduped",
    merge.sourceLinks,
    { "settings/rolara/items/Artifacts-INDEX.md": ["settings/rolara/items/Items-INDEX.md"] });
  check("and the reason states how many pairs it will rewrite",
    /Rewrites 1 referring file\/source pair\(s\)/.test(merge.reason || ""), true);
}

{
  // The rewrite half edits ARTICLE CONTENT rather than only moving files, so
  // the only files it may touch are ones named against a source this operation
  // is actually removing. A key naming anything else is dropped rather than
  // smuggling an unrelated rewrite into the unit of work.
  const p = plan({
    multiIndexFolders: [
      {
        folder: "settings/rolara/items",
        survivor: "settings/rolara/items/Items-INDEX.md",
        sources: ["settings/rolara/items/Artifacts-INDEX.md"],
        sourceLinks: {
          "settings/rolara/items/Artifacts-INDEX.md": ["settings/rolara/items/Items-INDEX.md"],
          "settings/rolara/items/Spells-INDEX.md": ["settings/rolara/Everything.md"],
        },
      },
    ],
  });
  check("a sourceLinks key naming something this merge does not consume is dropped",
    Object.keys(obj(find(p.operations, "merge-index").sourceLinks)),
    ["settings/rolara/items/Artifacts-INDEX.md"]);
}

{
  // Carried only when there are any, the same terms a rename carries `links`
  // on. FULL_SURVEY's merge names no referring files.
  const p = plan({ multiIndexFolders: FULL_SURVEY.multiIndexFolders });
  check("a merge whose sources nothing refers to carries no sourceLinks field",
    "sourceLinks" in find(p.operations, "merge-index"), false);
  check("and says so in its reason rather than staying silent",
    /Rewrites 0 referring file\/source pair\(s\)/.test(find(p.operations, "merge-index").reason || ""), true);
}

console.log("\nCase-only renames");

{
  const p = plan({
    renames: [
      { file: "settings/rolara/items/items-INDEX.md", to: "settings/rolara/items/Items-INDEX.md", ruleId: "filenameCharset" },
    ],
  });
  check("a rename differing only in case is flagged", p.prechecks.caseRenames.length, 1);
  check("and a case-only rename does not abort the run", p.prechecks.ok, true);
}

console.log("\npublish is never written");

{
  const p = plan({ frontmatterRepairs: FULL_SURVEY.frontmatterRepairs });
  const repair = p.operations.find((o) => o.op === "repair-frontmatter");
  check("a frontmatter repair asked to insert publish drops it", repair.insert, ["type"]);
  check("no operation in the plan inserts publish",
    p.operations.some((o) => list(o.insert).includes("publish")), false);
}

console.log("\nIndex suffix comes from the owning setting");

{
  // Driven with a base layer whose suffix differs from the hardcoded fallback,
  // so producing it proves the base rules were actually consulted.
  const p = buildPlan({
    settings: SETTINGS,
    baseRules: BASE_RULES_DISTINCT_SUFFIX,
    discovered: { missingIndexes: FULL_SURVEY.missingIndexes },
  });
  check("a setting with no rule of its own takes the BASE suffix, not the hardcoded fallback",
    p.operations[0].to, "settings/rolara/culture/Culture-BASEIDX.md");
  check("a setting carrying its own indexParity rule overrides the base layer",
    p.operations[1].to, "settings/karsk/culture/Culture-IDX.md");
}

console.log("\nGit-ignored sources, and the read-only contract");

let repo = null;
try {
  repo = makeRepo();

  {
    const before = snapshotTree(repo);
    const p = plan(
      {
        renames: [
          {
            file: "settings/rolara/editor-state/scratch.md",
            to: "settings/rolara/editor-state/Scratch-NOTE.md",
            ruleId: "filenameSuffixByType",
          },
          {
            file: "settings/rolara/Ashfall-Compact.md",
            to: "settings/rolara/Ashfall-Compact-ORG.md",
            ruleId: "filenameSuffixByType",
          },
        ],
      },
      repo
    );

    check("an ignored file inside a prong is reported",
      p.prechecks.ignored.map((i) => i.source), ["settings/rolara/editor-state/scratch.md"]);
    check("and an ignored file does not abort the run", p.prechecks.ok, true);
    check("a tracked source is not reported as ignored",
      p.prechecks.ignored.some((i) => i.source.includes("Ashfall")), false);
    check("the plan phase leaves the project byte-identical", snapshotTree(repo), before);
  }

  {
    const p = plan({}, repo);
    check("an article with no publish field is declined, by path",
      p.declined.filter((d) => d.op === "publish").map((d) => d.target),
      ["settings/rolara/Ashfall-Compact.md"]);
    check("an article carrying publish false is not reported",
      p.declined.some((d) => d.op === "publish" && d.target.includes("Vault-Of-Secrets")), false);
    check("reporting missing publish plans no operation", p.operations, []);
  }

  {
    // runPrechecks is exported for re-running against a plan the DM edited.
    const pre = runPrechecks({
      operations: [
        { op: "rename-with-link-rewrite", from: "settings/rolara/editor-state/scratch.md", to: "settings/rolara/editor-state/Scratch-NOTE.md" },
      ],
      projectRoot: repo,
    });
    check("runPrechecks alone reaches the same ignored verdict", pre.ignored.length, 1);
    check("and still turns on collisions alone", pre.ok, true);
  }

  console.log("\nThe two ignore shapes the skip rule does NOT cover");

  {
    // The skip rule tests the operation's own SOURCE. settings/rolara is
    // tracked, so a move of it is not skipped, and git mv carries every ignored
    // path inside it along to the new location, where the snapshot can no longer
    // restore them. Not an abort and not a skip: reported, so the apply phase
    // can disclose it.
    const pre = runPrechecks({
      operations: [{ op: "relocate-prong", from: "settings/rolara", to: "worlds/rolara" }],
      projectRoot: repo,
    });
    check("a directory move whose own source is tracked is not skipped", pre.ignored, []);
    check("but every git-ignored path beneath it is reported",
      pre.ignoredBeneath.map((e) => e.entries).flat(),
      [
        "settings/rolara/Café/",
        "settings/rolara/editor-state/",
        "settings/rolara/two words.md",
        "settings/rolara/éclair-notes.md",
      ]);
    check("against the operation that carries them",
      pre.ignoredBeneath.map((e) => `${e.op} ${e.from} -> ${e.to}`),
      ["relocate-prong settings/rolara -> worlds/rolara"]);
    check("and it still does not abort the run", pre.ok, true);
  }

  {
    // A git-ignored file named as a REFERRER is not skipped either: its wikilink
    // is rewritten in place, because the rename breaks that link whether or not
    // the rewrite runs, and a repaired ignored file beats a broken one. Reported
    // so the apply phase can disclose an edit the snapshot will not undo.
    const pre = runPrechecks({
      operations: [
        {
          op: "rename-with-link-rewrite",
          from: "settings/rolara/Ashfall-Compact.md",
          to: "settings/rolara/Ashfall-Compact-ORG.md",
          links: ["settings/rolara/editor-state/scratch.md", "settings/rolara/Vault-Of-Secrets.md"],
        },
      ],
      projectRoot: repo,
    });
    check("the operation's own source is tracked, so nothing is skipped", pre.ignored, []);
    check("the git-ignored referring file is reported",
      pre.ignoredReferrers.map((r) => r.referrer), ["settings/rolara/editor-state/scratch.md"]);
    check("a tracked referring file is not",
      pre.ignoredReferrers.some((r) => /Vault-Of-Secrets/.test(r.referrer)), false);
    check("and neither shape aborts the run", pre.ok, true);
  }

  console.log("\nIgnored paths git would quote");

  {
    // git C-quotes the WHOLE path when any byte in it needs quoting, and
    // escapes non-ASCII bytes in octal, which is not JSON. Decoding those by
    // hand dropped the accented path entirely, so the never-move-ignored-files
    // rail never fired for it. The spaced path survived that decode; it is here
    // so a regression in either direction is caught.
    const p = plan(
      {
        renames: [
          { file: "settings/rolara/éclair-notes.md", to: "settings/rolara/Eclair-Notes-CONCEPT.md", ruleId: "filenameCharset" },
          { file: "settings/rolara/two words.md", to: "settings/rolara/Two-Words-CONCEPT.md", ruleId: "filenameCharset" },
        ],
      },
      repo
    );
    check("an ignored path holding a non-ASCII byte is reported",
      p.prechecks.ignored.some((i) => i.source === "settings/rolara/éclair-notes.md"), true);
    check("an ignored path holding a space is reported",
      p.prechecks.ignored.some((i) => i.source === "settings/rolara/two words.md"), true);
    check("both quoted paths are reported and nothing else is",
      p.prechecks.ignored.map((i) => i.source).sort(),
      ["settings/rolara/two words.md", "settings/rolara/éclair-notes.md"]);
    check("and neither aborts the run", p.prechecks.ok, true);
  }

  console.log("\nAn ignored directory whose own name is non-ASCII");

  {
    // The flat-file non-ASCII fixture above (éclair-notes.md) is a file rule.
    // Under the old line-oriented, JSON-decode parser, a single ignored
    // directory whose name needs quoting would have hidden EVERY file
    // beneath it, which is the largest blast radius of the two shapes: the
    // reference consumer's ignore rules are directory rules, not flat-file
    // ones. Café-Rouge/ shares the "Café" prefix and must NOT match; only the
    // trailing slash on the ignore entry, preserved end to end by -z, keeps
    // the two apart.
    const p = plan(
      {
        renames: [
          {
            file: "settings/rolara/Café/Secret-Recipe.md",
            to: "settings/rolara/Café/Secret-Recipe-CONCEPT.md",
            ruleId: "filenameSuffixByType",
          },
          {
            file: "settings/rolara/Café-Rouge/Menu.md",
            to: "settings/rolara/Café-Rouge/Menu-CONCEPT.md",
            ruleId: "filenameSuffixByType",
          },
        ],
      },
      repo
    );
    check("a file beneath a non-ASCII ignored directory is reported ignored",
      p.prechecks.ignored.some((i) => i.source === "settings/rolara/Café/Secret-Recipe.md"), true);
    check("a prefix sibling directory does not match the ignored directory rule",
      p.prechecks.ignored.some((i) => i.source.startsWith("settings/rolara/Café-Rouge")), false);
    check("only the directory's own file is reported, nothing from its prefix sibling",
      p.prechecks.ignored.map((i) => i.source), ["settings/rolara/Café/Secret-Recipe.md"]);
    check("and neither aborts the run", p.prechecks.ok, true);
  }

  console.log("\nDestinations already occupied on disk");

  {
    // The likelier collision shape. The in-plan comparison needs TWO files to
    // both violate the filename schema. This needs one, whose corrected name is
    // already taken precisely because the file holding it already conforms and
    // so generates no operation of its own. Nothing in the plan can see that.
    const p = plan(
      {
        renames: [
          { file: "settings/rolara/éclair-notes.md", to: "settings/rolara/Vault-Of-Secrets.md", ruleId: "filenameCharset" },
        ],
      },
      repo
    );
    check("a rename onto a path that already exists on disk aborts the run", p.prechecks.ok, false);
    check("and the collision names the occupied destination",
      p.prechecks.collisions.map((c) => c.to), ["settings/rolara/Vault-Of-Secrets.md"]);
  }

  {
    // A file renamed away frees its own path, so A -> B, B -> C is legal and
    // must not be flagged.
    const p = plan(
      {
        renames: [
          { file: "settings/rolara/Vault-Of-Secrets.md", to: "settings/rolara/Vault-Of-Secrets-LOCATION.md", ruleId: "filenameSuffixByType" },
          { file: "settings/rolara/éclair-notes.md", to: "settings/rolara/Vault-Of-Secrets.md", ruleId: "filenameCharset" },
        ],
      },
      repo
    );
    check("a destination another operation renames away from is free: A -> B, B -> C is legal",
      p.prechecks.ok, true);
  }

  console.log("\nA dotted spelling of a destination names the same destination");

  // The key this check builds its two sets from used to be local:
  // `path.dirname(p) + "::" + path.basename(p)`, lowercased. It folded letter
  // case, and nothing else, because neither path.dirname nor path.basename
  // normalizes away a leading `./`, a doubled separator, or an interior `.` or
  // `..` segment. The five cases below are the two directions that gap opened
  // plus the three pins that the fold for it is not too wide.

  {
    // The dangerous direction. Two operations target one real file, one of them
    // spelling it with a `./` prefix, and the plan came back conflict-free: one
    // operation would have overwritten the other with nothing reporting it.
    // Weapon.md is NOT on disk, so the on-disk half cannot be what refuses here.
    const p = plan(
      {
        renames: [
          { file: "settings/rolara/Ashfall-Compact.md", to: "settings/rolara/items/Weapon.md", ruleId: "filenameCharset" },
          { file: "settings/rolara/Vault-Of-Secrets.md", to: "./settings/rolara/items/Weapon.md", ruleId: "filenameCharset" },
        ],
      },
      repo
    );
    check("a destination spelled with a leading ./ collides with the same destination spelled plainly",
      [p.prechecks.ok, p.prechecks.collisions.map((c) => c.kind)], [false, ["in-plan"]]);
    check("and the collision names both spellings, so the DM can see which pair it means",
      p.prechecks.collisions.map((c) => [c.a, c.b]),
      [["settings/rolara/items/Weapon.md", "./settings/rolara/items/Weapon.md"]]);
  }

  {
    // The same miss through a `..` hop instead of a `./` prefix. Same file, same
    // silent overwrite, a spelling a hand-edited proposal produces just as
    // easily as the one above.
    const p = plan(
      {
        renames: [
          { file: "settings/rolara/Ashfall-Compact.md", to: "settings/rolara/items/Weapon.md", ruleId: "filenameCharset" },
          {
            file: "settings/rolara/Vault-Of-Secrets.md",
            to: "settings/rolara/locations/../items/Weapon.md",
            ruleId: "filenameCharset",
          },
        ],
      },
      repo
    );
    check("a destination reached through a .. hop collides with the same destination spelled plainly",
      [p.prechecks.ok, p.prechecks.collisions.map((c) => c.kind)], [false, ["in-plan"]]);
  }

  {
    // The safe direction, and the one that cost a legitimate migration a rerun.
    // The vacate lookup asks its question with the DESTINATION's key and answers
    // it from the vacating operation's `from`, so a dotted destination missed a
    // path the plan genuinely frees and the run refused an A -> B, B -> C chain
    // the module's own comment names as legal.
    const p = plan(
      {
        renames: [
          {
            file: "settings/rolara/Ashfall-Compact.md",
            to: "./settings/rolara/Vault-Of-Secrets.md",
            ruleId: "filenameCharset",
          },
          {
            file: "settings/rolara/Vault-Of-Secrets.md",
            to: "settings/rolara/Vault-Of-Secrets-LOCATION.md",
            ruleId: "filenameSuffixByType",
          },
        ],
      },
      repo
    );
    check("a dotted destination still gets the vacate credit its plain spelling earns: A -> ./B, B -> C is legal",
      [p.prechecks.ok, p.prechecks.collisions], [true, []]);
  }

  {
    // Pin one: the ordinary chain, no dotted spelling anywhere, on the same two
    // files as the case above. Widening the fold must not have changed this, and
    // the pair together is the differential.
    const p = plan(
      {
        renames: [
          { file: "settings/rolara/Ashfall-Compact.md", to: "settings/rolara/Vault-Of-Secrets.md", ruleId: "filenameCharset" },
          {
            file: "settings/rolara/Vault-Of-Secrets.md",
            to: "settings/rolara/Vault-Of-Secrets-LOCATION.md",
            ruleId: "filenameSuffixByType",
          },
        ],
      },
      repo
    );
    check("the same chain with no dotted spelling at all is still legal",
      [p.prechecks.ok, p.prechecks.collisions], [true, []]);
  }

  {
    // Pin two: two operations whose destinations are plainly different files,
    // one differing only in the last character of the basename and one only in
    // the setting it lives under. Neither may be merged into a collision.
    const p = plan(
      {
        renames: [
          { file: "settings/rolara/Ashfall-Compact.md", to: "settings/rolara/items/Weapon.md", ruleId: "filenameCharset" },
          { file: "settings/rolara/Vault-Of-Secrets.md", to: "settings/rolara/items/Weapons.md", ruleId: "filenameCharset" },
          { file: "settings/karsk/Keep.md", to: "settings/karsk/items/Weapon.md", ruleId: "filenameCharset" },
        ],
      },
      repo
    );
    check("three genuinely different destinations are not merged into a collision",
      [p.prechecks.ok, p.prechecks.collisions], [true, []]);
  }

  {
    // Pin three: a genuine on-disk collision, with nothing in the plan vacating
    // the destination, spelled both ways. Both must still refuse. The dotted one
    // never had the gap, since that half resolves through path.resolve, and it
    // is asserted because normalizing the KEY must not have handed it credit no
    // operation earned.
    const plain = plan(
      {
        renames: [
          { file: "settings/rolara/Ashfall-Compact.md", to: "settings/rolara/Vault-Of-Secrets.md", ruleId: "filenameCharset" },
        ],
      },
      repo
    );
    const dotted = plan(
      {
        renames: [
          { file: "settings/rolara/Ashfall-Compact.md", to: "./settings/rolara/Vault-Of-Secrets.md", ruleId: "filenameCharset" },
        ],
      },
      repo
    );
    check("a destination on disk that nothing vacates still refuses, spelled plainly",
      [plain.prechecks.ok, plain.prechecks.collisions.map((c) => c.kind)], [false, ["on-disk"]]);
    check("and still refuses spelled with a leading ./",
      [dotted.prechecks.ok, dotted.prechecks.collisions.map((c) => c.kind)], [false, ["on-disk"]]);
  }

  console.log("\nAn ignored source does not vacate its destination");

  {
    // scratch.md is git-ignored (an editor-state/ directory rule) and stays
    // exactly where it is: the apply phase skips any operation whose source is
    // ignored (prechecks.ignored's own contract). op1 here proposes to move it
    // away, but since apply will never run op1, scratch.md still occupies its
    // path when op2 tries to write Ashfall-Compact.md there. Before this fix,
    // op1's `from` unconditionally vacated that path regardless of whether
    // apply would ever run it, so op2 read as collision-free and would have
    // overwritten a file with no pre-migration snapshot, unrecoverably.
    const p = plan(
      {
        renames: [
          {
            file: "settings/rolara/editor-state/scratch.md",
            to: "settings/rolara/editor-state/Scratch-Moved.md",
            ruleId: "filenameSuffixByType",
          },
          {
            file: "settings/rolara/Ashfall-Compact.md",
            to: "settings/rolara/editor-state/scratch.md",
            ruleId: "filenameSuffixByType",
          },
        ],
      },
      repo
    );
    check("a rename whose source is ignored does not free its destination for another operation",
      p.prechecks.ok, false);
    check("the collision names the path the skipped, ignored-source operation would have vacated",
      p.prechecks.collisions.map((c) => c.to), ["settings/rolara/editor-state/scratch.md"]);
    check("the ignored-source operation is still reported as ignored, not silently dropped",
      p.prechecks.ignored.some((i) => i.source === "settings/rolara/editor-state/scratch.md"), true);
  }

  {
    // ignored undetermined (no repository at all): the conservative choice
    // means no operation is credited with vacating its source, so a same-path
    // A -> B, B -> C chain that is legal once the ignored question is
    // answered (proved just above with a real repo) instead reads as a
    // collision while the question cannot be answered at all. This is the
    // deliberate tradeoff: crediting an unverified vacate would reproduce the
    // silent overwrite; withholding credit only costs a false-positive abort.
    const bare = mkdtempSync(path.join(os.tmpdir(), "orb-migrate-plan-norepo-vacate-"));
    try {
      mkdirSync(path.join(bare, "settings", "rolara"), { recursive: true });
      writeFileSync(path.join(bare, "settings", "rolara", "A.md"), "body\n");
      writeFileSync(path.join(bare, "settings", "rolara", "B.md"), "body\n");
      const pre = runPrechecks({
        operations: [
          { op: "rename-with-link-rewrite", from: "settings/rolara/A.md", to: "settings/rolara/B.md" },
          { op: "rename-with-link-rewrite", from: "settings/rolara/B.md", to: "settings/rolara/C.md" },
        ],
        projectRoot: bare,
      });
      check("with ignored undetermined, a same-path chain legal under a determined verdict reads as a collision instead",
        pre.ok, false);
    } finally {
      try {
        rmSync(bare, { recursive: true, force: true, maxRetries: 5 });
      } catch {
        /* Same Windows handle caveat as the fixture repo below. */
      }
    }
  }

  {
    // An in-place edit carries `from` and no `to` because it leaves the file
    // where it is, so its source is NOT freed and a rename onto it still
    // collides. This is the exact confusion that would reintroduce the bug.
    const p = plan(
      {
        typeMismatches: [
          { file: "settings/rolara/Vault-Of-Secrets.md", typeFrom: "location", typeTo: "Location" },
        ],
        renames: [
          { file: "settings/rolara/éclair-notes.md", to: "settings/rolara/Vault-Of-Secrets.md", ruleId: "filenameCharset" },
        ],
      },
      repo
    );
    check("an in-place edit does not free the path it edits", p.prechecks.ok, false);
  }

  {
    // A case-only rename is the same file on a case-insensitive filesystem, so
    // finding the destination on disk is not something to overwrite.
    const p = plan(
      {
        renames: [
          { file: "settings/rolara/items/Items-INDEX.md", to: "settings/rolara/items/items-INDEX.md", ruleId: "filenameCharset" },
        ],
      },
      repo
    );
    check("a case-only rename against a real project still does not abort", p.prechecks.ok, true);
    check("and is still flagged as a case rename", p.prechecks.caseRenames.length, 1);
  }

  {
    // merge-index targets the surviving index, which is on disk BY DEFINITION.
    // Reading that as a collision would abort every real merge.
    const p = plan(
      {
        multiIndexFolders: [
          {
            folder: "settings/rolara/items",
            survivor: "settings/rolara/items/Items-INDEX.md",
            sources: ["settings/rolara/items/Artifacts-INDEX.md"],
          },
        ],
      },
      repo
    );
    check("a merge into a survivor that is already on disk is not a collision", p.prechecks.ok, true);
  }

  {
    // create-index is NOT exempt. The survey only reports a folder with no
    // index at all, so a destination already on disk means the survey is stale
    // and creating it would overwrite the DM's file.
    const p = plan(
      { missingIndexes: [{ folder: "settings/rolara/items", settingIndex: 0, basename: "Items" }] },
      repo
    );
    check("a create-index onto an index that already exists is a collision", p.prechecks.ok, false);
  }

  console.log("\nA vault that is already there is a resync, not a collision");

  {
    // The reference consumer already carries rolara-kb/.obsidian, so without
    // this exemption every resync aborts in the plan phase over a destination
    // that legitimately exists and that applyVault is idempotent about.
    const p = plan(
      { vaults: [{ settingIndex: 0, setting: "rolara", to: "settings/rolara/.obsidian" }] },
      repo
    );
    check("a vault CREATE onto a vault already on disk does not abort the run", p.prechecks.ok, true);
  }

  {
    // The MOVE shape stays checked, which is why the exemption is a predicate
    // on the operation rather than a third entry in the kind set. Measured in
    // migrate.apply.test.mjs: git mv onto a destination that is already a
    // directory reports success and nests the source inside it, leaving the
    // setting with no vault where Obsidian looks for one.
    const p = plan(
      {
        vaults: [
          {
            settingIndex: 0,
            setting: "rolara",
            from: "settings/rolara/.obsidian",
            to: "settings/karsk/.obsidian",
          },
        ],
      },
      repo
    );
    check("a vault MOVE onto a destination that already exists still aborts", p.prechecks.ok, false);
    check("and the collision names that destination",
      p.prechecks.collisions.map((c) => c.to), ["settings/karsk/.obsidian"]);
  }

  {
    // The exemption is per KIND. A rename targeting that same occupied path is
    // a rename, not a vault, so it still aborts: this is the half the exemption
    // must not widen into.
    const p = plan(
      {
        renames: [
          { file: "settings/rolara/Ashfall-Compact.md", to: "settings/rolara/.obsidian", ruleId: "filenameCharset" },
        ],
      },
      repo
    );
    check("the exemption does not widen to a rename targeting that same path", p.prechecks.ok, false);
  }

  {
    // And it suppresses only the ON-DISK half. Two operations targeting one
    // path would overwrite one another whatever their kinds, so the in-plan
    // half still fires for two vaults as well.
    const p = plan(
      {
        vaults: [
          { settingIndex: 0, setting: "rolara", to: "settings/rolara/.obsidian" },
          { settingIndex: 1, setting: "karsk", to: "settings/rolara/.obsidian" },
        ],
      },
      repo
    );
    check("two vault operations targeting one path still abort", p.prechecks.ok, false);
    check("and that pair is reported as an in-plan collision",
      p.prechecks.collisions.map((c) => c.kind), ["in-plan"]);
  }

  console.log("\nIgnored has three states, not two");

  {
    // A bare plan object carries no projectRoot, so the question cannot be
    // answered at all. An empty array would be the claim that nothing is
    // ignored, which is a different and unearned answer.
    const pre = runPrechecks({
      operations: [
        { op: "rename-with-link-rewrite", from: "settings/rolara/Ashfall-Compact.md", to: "settings/rolara/Ashfall-Compact-ORG.md" },
      ],
    });
    check("runPrechecks with no projectRoot reports ignored undetermined, not empty", pre.ignored, null);
    check("and undetermined ignored does not by itself abort", pre.ok, true);
    // The two later fields answer the same git question, so they carry the same
    // third state. An empty array on either would claim there is nothing to
    // disclose, which is not what "could not ask git" means.
    check("and the two disclosure fields are undetermined with it, not empty",
      [pre.ignoredBeneath, pre.ignoredReferrers], [null, null]);
  }

  {
    // A real repository where no operation source is ignored. This [] and the
    // null above are different answers, and a skip list has to tell them apart.
    const pre = runPrechecks({
      operations: [
        { op: "rename-with-link-rewrite", from: "settings/rolara/Ashfall-Compact.md", to: "settings/rolara/Ashfall-Compact-ORG.md" },
      ],
      projectRoot: repo,
    });
    check("a real repository with no ignored source reports the empty list, not null", pre.ignored, []);
  }

  {
    // Not a git repository. No repository means no snapshot either, so every
    // source is outside it, and reporting [] would say exactly the opposite.
    const bare = mkdtempSync(path.join(os.tmpdir(), "orb-migrate-plan-norepo-"));
    try {
      mkdirSync(path.join(bare, "settings", "rolara"), { recursive: true });
      writeFileSync(path.join(bare, "settings", "rolara", "Ashfall-Compact.md"), "body\n");
      const pre = runPrechecks({
        operations: [
          { op: "rename-with-link-rewrite", from: "settings/rolara/Ashfall-Compact.md", to: "settings/rolara/Ashfall-Compact-ORG.md" },
        ],
        projectRoot: bare,
      });
      check("a project that is not a git repository reports ignored undetermined", pre.ignored, null);
      check("and reports the disclosure fields undetermined too",
        [pre.ignoredBeneath, pre.ignoredReferrers], [null, null]);
    } finally {
      try {
        rmSync(bare, { recursive: true, force: true, maxRetries: 5 });
      } catch {
        /* Same Windows handle caveat as the fixture repo below. */
      }
    }
  }
} finally {
  if (repo) {
    try {
      rmSync(repo, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      /* Windows keeps handles on .git objects; a leftover temp dir is not a failure. */
    }
  }
}

console.log("\n=== scoped plans: order and the generic move ===");

const scoped = (scope, projectRoot) =>
  buildScopedPlan({ projectRoot, settings: SETTINGS, baseRules: BASE_RULES, scope });

{
  // APPLY_ORDER is the one order findOutOfOrder ranks against, so it has to be
  // a superset of OPERATION_ORDER that preserves its relative order. A future
  // insertion that reorders the setup kinds would make every shipped setup plan
  // refuse as out of order, which no setup test would catch.
  const ranks = OPERATION_ORDER.map((k) => APPLY_ORDER.indexOf(k));
  check("every setup kind has a rank in APPLY_ORDER", ranks.every((r) => r >= 0), true);
  check("APPLY_ORDER preserves the setup order",
    ranks.slice().sort((a, b) => a - b), ranks);
}

console.log("\n=== scoped plans: the planner registry orders itself ===");

// The order the scoped planners RUN in is load-bearing for correctness, not cosmetic:
// precedingOperations answers out of the operations produced so far, so a planner that
// runs before one whose operations it needs to see reasons about an incomplete list and
// declines a legitimate path as a typo. That order used to be read off source position
// in SCOPED_PLANNERS, enforced by a comment, while this release's own plan document
// instructs three later tasks to APPEND planners whose kinds rank 4, 10, and 5 after
// one that ranks 9. These cases are the enforcement that replaces the comment.

// One probe scope per registry entry, all of them satisfiable against absorbFixture.
// The walk below runs each planner for real and checks its DECLARATION against the
// kinds it actually emitted, because a declaration that disagrees with its planner is
// the same hazard as a mis-ordered array. The coverage check is what stops a planner
// added later from being silently unwalked.
const PLANNER_PROBES = {
  pathMoves: [{ from: "settings/rolara/misc/Odds.md", to: "settings/rolara/Odds.md", reason: "x" }],
  absorbFolders: [{ folder: "settings/rolara/misc" }],
  splitFolders: [{ folder: "settings/rolara/misc", buckets: [{ name: "odds", articles: ["Odds.md"] }] }],
  entityRenames: [
    {
      file: "settings/rolara/misc/Odds.md",
      to: "settings/rolara/misc/Sundries.md",
      nameFrom: "Odds",
      nameTo: "Sundries",
      links: ["settings/rolara/misc/Misc-INDEX.md"],
    },
  ],
  rebuildIndexes: [{ index: "settings/rolara/misc/Misc-INDEX.md" }],
  retypes: [
    { files: ["settings/rolara/misc/Ends.md"], typeFrom: "Concept", typeTo: "Chronology", suffix: "-CHRONOLOGY" },
  ],
  frontmatterRepairs: [{ file: "settings/rolara/misc/Odds.md" }],
  suffixRenames: [{ file: "settings/rolara/misc/Ends.md", to: "settings/rolara/misc/Ends-RENAMED.md" }],
  prosePathUpdates: [
    { file: "settings/rolara/Rolara-INDEX.md", replacements: [{ from: "misc/", to: "notes/" }] },
  ],
  settingRenames: [{ from: "rolara", to: "rolara-prime" }],
  settingRetirements: [{ setting: "rolara", archiveRoot: "archive" }],
  campaignRetirements: [{ setting: "rolara", campaign: "ashes-of-the-first-crown", archiveRoot: "archive" }],
  // Ends.md is the one article in absorbFixture that neither links out nor is
  // linked to, so this split crosses no boundary and declines nothing, which is
  // what the walk below requires of every probe. The boundary cost itself is
  // covered by the setting-split section at the end of this file.
  settingSplits: [
    { from: "rolara", name: "ashlands", kbRoot: "settings/ashlands", files: ["settings/rolara/misc/Ends.md"] },
  ],
  // rolara emptied into karsk, rather than the other way round, because the walk
  // below runs against absorbFixture and rolara is the world that is actually on
  // disk there. A merge reads the SOURCE's prongs off the disk and writes into the
  // TARGET's recorded roots, so a target with nothing on disk yet is exactly the
  // case that declines nothing: no destination is occupied, so no name has to be
  // disambiguated.
  settingMerges: [{ from: "rolara", into: "karsk" }],
};

// The registry walk's settings, which are SETTINGS plus a second world. A merge is
// the one planner whose scope names TWO settings, and buildScopedPlan resolves both
// out of ctx.settings, so against a one-setting array its probe would decline rather
// than plan and the walk would read that as a planner emitting nothing. Recorded but
// not on disk, which is all the target side of a merge needs.
const PROBE_SETTINGS = [
  ...SETTINGS,
  {
    name: "karsk",
    kbRoot: "settings/karsk",
    homebrewRoot: "homebrew/karsk",
    sessionReportsRoot: "session-reports/karsk",
    campaigns: [],
  },
];

{
  check("every registry entry declares a kind APPLY_ORDER can rank",
    SCOPED_PLANNERS.map(([, , kind]) => kind).filter((kind) => APPLY_ORDER.indexOf(kind) < 0), []);

  // An unrankable kind sorts to -1, which is silently FIRST, so this is the one
  // malformed declaration that would reproduce the exact failure the mechanism exists
  // to prevent.
  let unrankable = "";
  try {
    assertScopedPlannerDeclarations([["retypes", () => ({}), "normalise-type"]]);
    unrankable = "(accepted)";
  } catch (err) {
    unrankable = String(err && err.message);
  }
  check("and the validator refuses a kind APPLY_ORDER cannot rank",
    [/retypes/.test(unrankable), /normalise-type/.test(unrankable)], [true, true]);

  // The old two-member shape, which is what a copy-paste from an older revision of the
  // plan document would produce.
  let twoMember = "";
  try {
    assertScopedPlannerDeclarations([["pathMoves", () => ({})]]);
    twoMember = "(accepted)";
  } catch (err) {
    twoMember = String(err && err.message);
  }
  check("and refuses an entry carrying no declared kind at all", /pathMoves/.test(twoMember), true);
}

{
  // The exact shape the plan document's append instructions actually produced:
  // `retypes`, `frontmatterRepairs`, `suffixRenames` appended after
  // `rebuildIndexes` in SCOPED_PLANNERS's own source order, ranking 4, 10, and 5
  // against the five already there, then `prosePathUpdates` at 11 after those.
  // This used to be rehearsed here against a simulated registry, before those
  // planners existed; now that they are registered for real, the rehearsal and
  // the reality are the same array, and this case pins that shape directly rather
  // than reconstructing it.
  // Three more appended since, ranking 0, 0, and 1: the setting-lifecycle
  // planners. They make this case STRONGER rather than merely longer. The three
  // that came before ranked 4, 10, and 5 after one that ranks 9, so reading the
  // registry off source position mis-ordered the middle of the run; these rank at
  // the very FRONT while sitting at the very END of the array, so source position
  // would now run the whole rest of the registry before the operation every
  // later planner's checks have to be able to see. settingSplits is the fourth,
  // ranking 1 at the very end, and settingMerges the fifth, likewise at rank 1.
  check("the append landed in source order, out of rank order as written",
    SCOPED_PLANNERS.map(([, , kind]) => APPLY_ORDER.indexOf(kind)), [1, 2, 3, 6, 9, 4, 10, 5, 11, 0, 0, 1, 1, 1]);
  check("and the order those planners RUN in is ascending rank anyway",
    scopedPlannerSequence().map(([, , kind]) => APPLY_ORDER.indexOf(kind)),
    [0, 0, 1, 1, 1, 1, 2, 3, 4, 5, 6, 9, 10, 11]);
  check("which puts each scope key where its planner's rank belongs",
    scopedPlannerSequence().map(([key]) => key),
    ["settingRenames", "settingRetirements", "pathMoves", "campaignRetirements", "settingSplits",
     "settingMerges", "absorbFolders", "splitFolders", "retypes", "suffixRenames", "entityRenames",
     "rebuildIndexes", "frontmatterRepairs", "prosePathUpdates"]);
}

{
  // Order irrelevance over a BOUNDED SAMPLE of registry source orders, not
  // every permutation.
  //
  // Exhaustive was O(n!): measured at 6s with 9 planners registered. Tasks 12,
  // 13, and 14 add five more, taking the registry to 14 entries; 14! is
  // roughly 87 billion, which would never finish, and would have been
  // discovered mid-task rather than here.
  //
  // WHAT THIS STILL GUARANTEES: scopedPlannerSequence sorts by declared rank
  // (applyRank(kind)), so Array.prototype.sort producing one answer for one
  // input generalizes to every permutation by the comparator's own
  // transitivity; the exhaustive walk was re-proving the comparator's
  // correctness on inputs that differ only in an order the comparator does not
  // read, not hunting for a bug only a specific arrangement could expose.
  //
  // THE RANKS ARE NO LONGER DISTINCT, and the assertion below is written to what
  // that leaves true rather than to what it used to be. settingRenames and
  // settingRetirements both declare relocate-prong, and campaignRetirements
  // declares relocate-path alongside pathMoves, so sort's stability is now
  // observable: a permuted registry puts tied entries in a different relative
  // order, and the sequence is NOT identical array-for-array any more. That is
  // sound, and SCOPED_PLANNERS argues why: two planners declaring one kind emit
  // operations of one rank, same-rank operations run in the order they were
  // produced, so whichever planner runs first is also the one whose operations
  // run first, and each still sees exactly the operations preceding its own.
  // What must hold, and what is checked, is that every sample comes out in
  // ascending rank and that the SAME keys sit at each rank. Asserting an
  // identical array here would now be asserting something false, and asserting
  // only the key set would drop the ordering property entirely.
  //
  // WHAT IS NOW SAMPLED RATHER THAN EXHAUSTIVE: "every permutation" becomes
  // "the identity order, the reverse, every single-position rotation, and a
  // fixed handful of pseudo-random shuffles". A hypothetical bug that broke
  // sort's correctness only on some OTHER arrangement, not reachable by
  // rotating or reversing the registry and not hit by the seeded shuffles,
  // would not be caught here. That residual is native sort's own contract
  // rather than this module's, and it is the trade the brief calls for: a
  // later task appending a planner anywhere in SCOPED_PLANNERS is exactly a
  // rotation or a near-rotation of an order already sampled below, so the
  // property this test exists to protect (an append is safe wherever it
  // lands) stays covered.
  const rotations = (xs) => xs.map((_, i) => [...xs.slice(i), ...xs.slice(0, i)]);
  // mulberry32: a tiny deterministic PRNG, not Math.random(). A shuffle that
  // differs on every run would turn a real failure into a flake and a flake
  // into a mystery; this one reproduces identically every run from the fixed
  // seed below.
  const mulberry32 = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const shuffled = (xs, rng) => {
    const out = xs.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const SHUFFLE_COUNT = 8;
  const SHUFFLE_SEED = 0xc0ffee;
  const rng = mulberry32(SHUFFLE_SEED);
  const shuffles = Array.from({ length: SHUFFLE_COUNT }, () => shuffled(SCOPED_PLANNERS, rng));

  const samples = [
    SCOPED_PLANNERS, // the actual, as-appended source order: "the specific broken order the plan document would produce"
    [...SCOPED_PLANNERS].reverse(),
    ...rotations(SCOPED_PLANNERS),
    ...shuffles,
  ];
  const expected = scopedPlannerSequence().map(([key]) => key);
  // Keys grouped by declared rank, in ascending rank, with each rank's keys
  // sorted so a tie's internal order does not enter the comparison. Sorting the
  // whole list instead would compare a bag of names and lose the ordering; this
  // keeps the ranks in sequence and normalizes only the ties.
  const byRank = (entries) => {
    const ranks = new Map();
    for (const [key, , kind] of scopedPlannerSequence(entries)) {
      const rank = APPLY_ORDER.indexOf(kind);
      if (!ranks.has(rank)) ranks.set(rank, []);
      ranks.get(rank).push(key);
    }
    return [...ranks.entries()].map(([rank, keys]) => [rank, keys.slice().sort()]);
  };
  const ascending = (entries) => {
    const ranks = scopedPlannerSequence(entries).map(([, , kind]) => APPLY_ORDER.indexOf(kind));
    return ranks.every((r, i) => i === 0 || ranks[i - 1] <= r);
  };
  const shape = JSON.stringify(byRank(SCOPED_PLANNERS));
  check("the sample is non-empty, so an all-vacuous .every() cannot masquerade as coverage",
    samples.length >= 2 + SCOPED_PLANNERS.length + SHUFFLE_COUNT, true);
  check("a bounded sample of registry orderings all run the planners in ascending declared rank",
    samples.every(ascending), true);
  check("and every one of them puts the same planners at the same rank",
    samples.every((p) => JSON.stringify(byRank(p)) === shape), true);
  check("and that order is the declared ranks ascending",
    expected,
    ["settingRenames", "settingRetirements", "pathMoves", "campaignRetirements", "settingSplits",
     "settingMerges", "absorbFolders", "splitFolders", "retypes", "suffixRenames", "entityRenames",
     "rebuildIndexes", "frontmatterRepairs", "prosePathUpdates"]);
}

{
  check("every registry entry has a probe here, so none can skip the walk below",
    SCOPED_PLANNERS.map(([key]) => key).filter((key) => !PLANNER_PROBES[key]), []);
  const rows = [];
  for (const [key, , kind] of SCOPED_PLANNERS) {
    const root = absorbFixture();
    const r = buildScopedPlan({
      projectRoot: root,
      settings: PROBE_SETTINGS,
      baseRules: BASE_RULES,
      scope: { [key]: PLANNER_PROBES[key] },
    });
    const ranks = r.operations.map((o) => APPLY_ORDER.indexOf(o.op));
    rows.push([
      key,
      r.declined.length,
      Math.min(...ranks) === APPLY_ORDER.indexOf(kind),
      kindsOf(r.operations).includes(kind),
    ]);
    rmSync(root, { recursive: true, force: true });
  }
  // Both halves matter: the declared kind must be the LOWEST-ranked one the planner
  // emits (or it runs later than a planner needing to see that operation), and it must
  // actually be one of them (or the declaration is fiction).
  check("each declared kind is the lowest-ranked kind its planner emits, and is emitted",
    rows, SCOPED_PLANNERS.map(([key]) => [key, 0, true, true]));
}

{
  // The emit-side half of the contract, proved by a deliberately mis-declared entry
  // rather than asserted. Nothing else would show it: buildScopedPlan's final sort
  // still hands applyPlan a plan in dependency order, so the only trace of the mistake
  // is the checks that already ran against a list the operation was missing from.
  const probe = [
    "orderingProbe",
    () => ({ operations: [{ op: "relocate-path", from: "a", to: "b", reason: "probe" }], declined: [] }),
    "rebuild-index",
  ];
  SCOPED_PLANNERS.push(probe);
  let message = "";
  try {
    scoped({ orderingProbe: [{}] });
    message = "(planned without complaint)";
  } catch (err) {
    message = String(err && err.message);
  } finally {
    SCOPED_PLANNERS.pop();
  }
  check("a planner emitting an operation ranked below its declaration fails loudly",
    [/orderingProbe/.test(message), /relocate-path/.test(message), /rebuild-index/.test(message)],
    [true, true, true]);
  check("and the registry is back to its fourteen entries",
    SCOPED_PLANNERS.map(([key]) => key),
    ["pathMoves", "absorbFolders", "splitFolders", "entityRenames", "rebuildIndexes",
     "retypes", "frontmatterRepairs", "suffixRenames", "prosePathUpdates",
     "settingRenames", "settingRetirements", "campaignRetirements", "settingSplits", "settingMerges"]);
}

{
  // The check-side half, proved against a REAL planner rather than a probe:
  // planRebuildIndexes asks with rebuild-index (rank 9), so declaring it at rank 1
  // makes it ask about ranks whose planners have not run. Needs a real root, or the
  // predicates answer undetermined and never reach the question.
  const root = absorbFixture();
  const entry = SCOPED_PLANNERS.find(([key]) => key === "rebuildIndexes") || [];
  const declared = entry[2];
  entry[2] = "relocate-path";
  let message = "";
  try {
    scoped({ rebuildIndexes: [{ index: "settings/rolara/misc/Misc-INDEX.md" }] }, root);
    message = "(planned without complaint)";
  } catch (err) {
    message = String(err && err.message);
  } finally {
    entry[2] = declared;
    rmSync(root, { recursive: true, force: true });
  }
  check("a planner asking about a rank above its declaration fails loudly too",
    [/rebuildIndexes/.test(message), /rebuild-index/.test(message)], [true, true]);
  check("and its declaration is restored", entry[2], "rebuild-index");
}

{
  // The stronger property, end to end: buildScopedPlan returns the SAME plan from a
  // registry in the reverse of rank order, so the mis-ordered array is harmless rather
  // than merely detected. Mutated in place and restored, because buildScopedPlan reads
  // the module's own array. Non-vacuous by construction: read off source position, the
  // reversed registry runs planEntityRenames first against an empty plan, which
  // declines this scope's rename as a typo for a file the relocate puts there five
  // ranks earlier.
  //
  // The third planner is entityRenames (rank 6) rather than rebuildIndexes (rank 9),
  // and the swap is forced by a correctness fix rather than a preference: the split
  // now emits the rebuild of its own folder's index itself, which it silently did not
  // when that folder was moved into place by the same plan, so a rebuildIndexes entry
  // naming that index makes two operations share one destination, and a
  // rebuildIndexes entry naming the BUCKET's index shares one with the create-index
  // that makes it. Either is an in-plan collision by the generic rule, which would
  // leave this case pinning a plan that cannot execute. A rename of the OTHER article
  // the move carries keeps three planners in the scope, every one of them reasoning
  // about a path the rank-1 move puts there, and every destination distinct.
  const root = absorbFixture();
  const scope = {
    pathMoves: [{ from: "settings/rolara/misc", to: "settings/rolara/notes", reason: "x" }],
    entityRenames: [{ file: "settings/rolara/notes/Ends.md", to: "settings/rolara/notes/Ends-CONCEPT.md" }],
    splitFolders: [
      { folder: "settings/rolara/notes", buckets: [{ name: "odds", articles: ["Odds.md"] }] },
    ],
  };
  const inOrder = scoped(scope, root);
  check("the scope exercises three planners, each depending on an earlier one",
    [kindsOf(inOrder.operations), inOrder.declined.length, inOrder.prechecks.ok],
    [["relocate-path", "split-folder", "rename-entity", "create-index", "rebuild-index"], 0, true]);
  const original = [...SCOPED_PLANNERS];
  SCOPED_PLANNERS.reverse();
  let reversed = null;
  try {
    reversed = scoped(scope, root);
  } finally {
    SCOPED_PLANNERS.length = 0;
    SCOPED_PLANNERS.push(...original);
  }
  check("and a registry in the reverse of rank order produces an identical plan",
    reversed, inOrder);
  check("with the registry restored afterward",
    SCOPED_PLANNERS.map(([key]) => key),
    ["pathMoves", "absorbFolders", "splitFolders", "entityRenames", "rebuildIndexes",
     "retypes", "frontmatterRepairs", "suffixRenames", "prosePathUpdates",
     "settingRenames", "settingRetirements", "campaignRetirements", "settingSplits", "settingMerges"]);
  rmSync(root, { recursive: true, force: true });
}

{
  // The append itself, which is what the plan document instructs and what a positional
  // rule would break: a planner added at the END of the registry, emitting a kind that
  // ranks BELOW rebuildIndexes, whose operation the rebuild must see. Read off source
  // position this declines the rebuild as a typo, for an index the appended planner's
  // own relocate creates eight ranks earlier.
  const root = absorbFixture();
  const probe = [
    "probeMoves",
    (items, ctx, key) => ({
      operations: [
        {
          op: "relocate-path",
          from: "settings/rolara/misc",
          to: "settings/rolara/notes",
          groups: [`${key}[0]`],
          reason: "probe",
        },
      ],
      declined: [],
    }),
    "relocate-path",
  ];
  SCOPED_PLANNERS.push(probe);
  let r = null;
  try {
    r = scoped(
      { probeMoves: [{}], rebuildIndexes: [{ index: "settings/rolara/notes/Misc-INDEX.md" }] },
      root
    );
  } finally {
    SCOPED_PLANNERS.pop();
    rmSync(root, { recursive: true, force: true });
  }
  check("a planner appended LAST still runs first when its kind ranks lower",
    [kindsOf(r.operations), r.declined.length], [["relocate-path", "rebuild-index"], 0]);
}

{
  const r = scoped({
    pathMoves: [
      { from: "settings/rolara/misc/Old-Note.md", to: "settings/rolara/notes/Old-Note.md", reason: "DM scope" },
    ],
  });
  check("a path move plans one relocate-path", kindsOf(r.operations), ["relocate-path"]);
  check("it carries from and to verbatim",
    [r.operations[0].from, r.operations[0].to],
    ["settings/rolara/misc/Old-Note.md", "settings/rolara/notes/Old-Note.md"]);
}

{
  const r = scoped({});
  check("an empty scope plans nothing and declines nothing",
    [r.operations.length, r.declined.length], [0, 0]);
  check("an empty scope still returns prechecks", typeof r.prechecks, "object");
}

{
  // The read-only contract covers this entry point too, not only buildPlan.
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-scoped-ro-"));
  mkdirSync(path.join(root, "settings", "rolara"), { recursive: true });
  writeFileSync(path.join(root, "settings", "rolara", "A.md"), "---\ntype: Person\n---\n\nBody.\n");
  // snapshotTree shells out to `git status`, so the fixture needs a repository
  // under it, the same way every other snapshotTree caller in this file (via
  // makeRepo) provides one. No commit is needed: status reports untracked files
  // against an empty history just as well as against a populated one.
  execFileSync("git", ["init", "-q"], { cwd: root });
  const before = snapshotTree(root);
  scoped({ pathMoves: [{ from: "settings/rolara/A.md", to: "settings/rolara/people/A.md", reason: "x" }] }, root);
  check("buildScopedPlan mutates nothing", snapshotTree(root), before);
  rmSync(root, { recursive: true, force: true });
}

console.log("\n=== scoped plans: rebuild-index ===");

{
  const r = scoped({ rebuildIndexes: [{ index: "settings/rolara/items/Items-INDEX.md" }] });
  check("a rebuild scope plans one rebuild-index", kindsOf(r.operations), ["rebuild-index"]);
  check("the folder is derived from the index path",
    r.operations[0].folder, "settings/rolara/items");
}

{
  // The move has to land before the rebuild reads the folder, or the rebuild
  // lists yesterday's membership. This is APPLY_ORDER doing its job, asserted
  // here because a planner added to SCOPED_PLANNERS in the wrong slot is the
  // easy mistake and applyPlan would refuse the whole run rather than explain it.
  //
  // Driven against a REAL project root, and against a rebuild whose index the move
  // itself puts there. With no root the plan-time existence checks are inert, so
  // this case read as coverage of the cross-key sequencing while proving nothing
  // about it. Measured with those checks asking existsSync about the pre-migration
  // tree: this scope was declined with "No index exists at
  // settings/rolara/notes/Misc-INDEX.md ... Check that path for a typo", for an
  // index the relocate-path above creates eight ranks earlier.
  const root = absorbFixture();
  const r = scoped(
    {
      rebuildIndexes: [{ index: "settings/rolara/notes/Misc-INDEX.md" }],
      pathMoves: [{ from: "settings/rolara/misc", to: "settings/rolara/notes", reason: "x" }],
    },
    root
  );
  check("moves are ordered before rebuilds", kindsOf(r.operations), ["relocate-path", "rebuild-index"]);
  check("and a path an earlier operation in the same plan creates is not called a typo",
    r.declined, []);
  check("the rebuild still reads the folder at its post-move path",
    find(r.operations, "rebuild-index").folder, "settings/rolara/notes");
  rmSync(root, { recursive: true, force: true });
}

console.log("\n=== scoped plans: absorb-folder ===");

function writeAt(root, rel, body) {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

function absorbFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-absorb-"));
  const w = (rel, body) => writeAt(root, rel, body);
  w("settings/rolara/Rolara-INDEX.md", "---\ntype: Index\n---\n\n- [[Misc-INDEX]]\n");
  w("settings/rolara/misc/Misc-INDEX.md", "---\ntype: Index\n---\n\n- [[Odds]]\n");
  w("settings/rolara/misc/Odds.md", "---\ntype: Concept\n---\n\nBody.\n");
  w("settings/rolara/misc/Ends.md", "---\ntype: Concept\n---\n\nBody.\n");
  // rolara's OTHER TWO prong roots. SETTINGS has recorded all three since it was
  // written, and this fixture carried only the knowledge base, so any planner
  // reasoning about a whole setting rather than about one folder inside it saw a
  // world two thirds of which was not on disk. The setting-lifecycle probes are
  // the first planners that do.
  w("homebrew/rolara/Homebrew-INDEX.md", "---\ntype: Index\n---\n\n- [[Blade]]\n");
  w("homebrew/rolara/Blade.md", "---\ntype: Item\n---\n\nBody.\n");
  w(
    "session-reports/rolara/ashes-of-the-first-crown/2026-01-01-One-REPORT.md",
    "---\ntype: Session Report\n---\n\nBody.\n"
  );
  return root;
}

// The ignored-source cases need a real repository under the fixture, because
// ignoreOracle asks git rather than parsing .gitignore itself.
function commitFixture(root) {
  const git = (...argv) =>
    execFileSync("git", argv, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Plan Test");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
}

{
  const root = absorbFixture();
  const r = scoped({ absorbFolders: [{ folder: "settings/rolara/misc" }] }, root);
  check("an absorb scope plans absorb then a parent rebuild",
    kindsOf(r.operations), ["absorb-folder", "rebuild-index"]);
  const op = r.operations[0];
  check("the destination is the parent folder", op.to, "settings/rolara");
  check("every article is enumerated by name, not left implicit",
    op.articles.map((a) => a.from).sort(),
    ["settings/rolara/misc/Ends.md", "settings/rolara/misc/Odds.md"]);
  check("the folder's own index is named for removal", op.index, "settings/rolara/misc/Misc-INDEX.md");
  // The parent index still carries [[Misc-INDEX]], which dies with the folder.
  // rebuild-index lists only articles, so running it on the parent is what
  // clears that link. Absorbing without it leaves a dead wikilink behind.
  check("the rebuild targets the parent index",
    r.operations[1].to, "settings/rolara/Rolara-INDEX.md");
  rmSync(root, { recursive: true, force: true });
}

{
  const root = absorbFixture();
  mkdirSync(path.join(root, "settings", "rolara", "misc", "deeper"), { recursive: true });
  const r = scoped({ absorbFolders: [{ folder: "settings/rolara/misc" }] }, root);
  check("a folder holding a subfolder is declined, not dissolved",
    [r.operations.length, r.declined.length], [0, 1]);
  check("and the reason says why", /leaf/i.test(r.declined[0].reason), true);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = absorbFixture();
  const r = scoped({ absorbFolders: [{ folder: "settings/rolara" }] }, root);
  // Dissolving a prong root would move a whole knowledge base into whatever
  // happens to sit above it. Permanently exempt, per the spec's operation
  // catalog, and not a judgment the DM can override in a scope.
  check("a prong root is permanently exempt",
    [r.operations.length, r.declined.length], [0, 1]);
  rmSync(root, { recursive: true, force: true });
}

// Absorbing two sibling stub folders into one parent is the ORDINARY shape of
// this feature, and a plan its own prechecks refuse is a plan the DM cannot
// apply without splitting one approved migration into two runs.
{
  const root = absorbFixture();
  writeAt(root, "settings/rolara/notes/Notes-INDEX.md", "---\ntype: Index\n---\n\n- [[Jot]]\n");
  writeAt(root, "settings/rolara/notes/Jot.md", "---\ntype: Concept\n---\n\nBody.\n");
  const r = scoped(
    { absorbFolders: [{ folder: "settings/rolara/misc" }, { folder: "settings/rolara/notes" }] },
    root
  );
  // ONE rebuild, not two. Two absorbs sharing a parent emit the same
  // rebuild-index twice without a dedupe, and two operations with one
  // destination is an in-plan collision by the generic rule.
  check("two sibling absorbs into one parent plan one parent rebuild",
    kindsOf(r.operations), ["absorb-folder", "absorb-folder", "rebuild-index"]);
  check("and the rebuild's reason names both absorbed folders",
    [/misc/.test(r.operations[2].reason), /notes/.test(r.operations[2].reason)], [true, true]);
  // The folder-level `to` of both absorbs is the same parent folder, which the
  // generic in-plan rule reads as a collision. It is not one: for this kind the
  // real destinations are the enumerated files, not the parent folder, which is
  // supposed to be there already and is never written as a unit.
  check("and the planner does not hand its own prechecks a plan they refuse",
    [r.declined.length, r.prechecks.ok, r.prechecks.collisions], [0, true, []]);
  rmSync(root, { recursive: true, force: true });
}

// Absorbing must not strand the files it does not consider markdown. A folder
// left holding an image and a text file with no index is content the validation
// sweep flags on every later run.
{
  const root = absorbFixture();
  writeAt(root, "settings/rolara/misc/Map.png", "PNG");
  writeAt(root, "settings/rolara/misc/notes.txt", "Loose notes.\n");
  const r = scoped({ absorbFolders: [{ folder: "settings/rolara/misc" }] }, root);
  check("every file in the folder is enumerated, not only the markdown",
    r.operations[0].articles.map((a) => a.from).sort(),
    ["settings/rolara/misc/Ends.md", "settings/rolara/misc/Map.png",
     "settings/rolara/misc/Odds.md", "settings/rolara/misc/notes.txt"]);
  check("each one carries its own destination in the parent",
    r.operations[0].articles.map((a) => a.to).sort(),
    ["settings/rolara/Ends.md", "settings/rolara/Map.png",
     "settings/rolara/Odds.md", "settings/rolara/notes.txt"]);
  check("and the folder's own index is still named for removal rather than moved",
    r.operations[0].index, "settings/rolara/misc/Misc-INDEX.md");
  rmSync(root, { recursive: true, force: true });
}

{
  const root = absorbFixture();
  writeAt(root, "settings/rolara/misc/Map.png", "PNG");
  writeAt(root, "settings/rolara/Map.png", "A different image already in the parent.");
  const r = scoped({ absorbFolders: [{ folder: "settings/rolara/misc" }] }, root);
  // A non-markdown file is a destination like any other now that it is
  // enumerated, so overwriting one in the parent has to abort on the same terms.
  check("a non-markdown file colliding in the parent aborts the prechecks",
    [r.prechecks.ok, list(r.prechecks.collisions).map((c) => c.to)],
    [false, ["settings/rolara/Map.png"]]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = absorbFixture();
  writeAt(root, "settings/rolara/misc/Hidden.md", "---\ntype: Concept\n---\n\nA draft kept out of git.\n");
  writeAt(root, "settings/rolara/Spare.md", "---\ntype: Concept\n---\n\nBody.\n");
  writeAt(root, ".gitignore", "settings/rolara/misc/Hidden.md\n");
  commitFixture(root);
  const r = scoped(
    {
      absorbFolders: [{ folder: "settings/rolara/misc" }],
      pathMoves: [
        { from: "settings/rolara/Spare.md", to: "settings/rolara/misc/Hidden.md", reason: "DM scope" },
      ],
    },
    root
  );
  // An absorb moves each file it names one git mv at a time, so the file that
  // can be git-ignored is one of those files rather than the folder. Reaching
  // the ignored precheck is what makes it declinable AND what withholds vacate
  // credit from it: `git mv` on an ignored file hard-fails with "not under
  // version control", so it never leaves the path a later operation is aiming
  // at, and a git-ignored file has no snapshot to restore either.
  //
  // The DISCLOSURE now lands in `declined` rather than in prechecks.ignored,
  // because a scoped plan declines an ignored source outright so it reaches the
  // DM's proposal instead of a skipped list after the run. That the absorb was
  // declined at all is the proof that findIgnoredSources reached inside the
  // folder: nothing else in this scope names Hidden.md.
  check("a git-ignored file inside an absorbed folder declines the absorb, by name",
    list(r.declined).map((d) => [d.op, d.target, /Hidden\.md/.test(String(d.reason))]),
    [["absorb-folder", "settings/rolara/misc", true],
     ["rebuild-index", "settings/rolara/Rolara-INDEX.md", true]]);
  check("so nothing is credited with vacating a path it will never leave",
    [r.prechecks.ok, list(r.prechecks.collisions).map((c) => [c.kind, c.op, c.to])],
    [false, [["on-disk", "relocate-path", "settings/rolara/misc/Hidden.md"]]]);
  // ignoredBeneath's reason says `git mv` carries the ignored paths to the new
  // path, which is true of a directory move and false of this kind. The
  // accurate disclosure is the decline above, which says the operation will not
  // run at all.
  check("and the folder is not disclosed as a directory move that carries them along",
    list(r.prechecks.ignoredBeneath).map((b) => b.op), []);
  // The group-level checks above prove the DECISION (the whole entry declines).
  // They cannot prove the SHAPE findIgnoredSources reports the file in, because
  // `declined` only carries {op, target, reason} and the decline pass removes
  // the row from the shipped prechecks entirely. Pin that shape directly: a
  // hand-built operation carrying the same `articles` shape the real planner
  // emits, run through runPrechecks without going anywhere near
  // declineIgnoredSources, so this is the per-file `articleMovesOf` contract
  // findIgnoredSources documents at migrate.mjs:2514-2519, not the group
  // contract above it.
  const directAbsorb = runPrechecks({
    operations: [
      {
        op: "absorb-folder",
        from: "settings/rolara/misc",
        articles: [{ from: "settings/rolara/misc/Hidden.md", to: "settings/rolara/Hidden.md" }],
        reason: "hand-built, mirrors the shape planAbsorbFolders emits",
      },
    ],
    projectRoot: root,
  });
  check("findIgnoredSources reports the file's own from and to, not the folder's",
    list(directAbsorb.ignored).map((i) => [i.op, i.source, i.from, i.to]),
    [["absorb-folder", "settings/rolara/misc/Hidden.md",
      "settings/rolara/misc/Hidden.md", "settings/rolara/Hidden.md"]]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

console.log("\n=== scoped plans: split-folder ===");

function splitFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-split-"));
  const w = (rel, body) => writeAt(root, rel, body);
  w("settings/rolara/locations/Locations-INDEX.md", "---\ntype: Index\n---\n\n- [[Ashfall]]\n- [[Karsk]]\n");
  w("settings/rolara/locations/Ashfall.md", "---\ntype: Location\n---\n\nBody.\n");
  w("settings/rolara/locations/Karsk.md", "---\ntype: Location\n---\n\nBody.\n");
  return root;
}

{
  const root = splitFixture();
  const r = scoped(
    {
      splitFolders: [
        {
          folder: "settings/rolara/locations",
          buckets: [
            { name: "north", articles: ["Ashfall.md"] },
            { name: "south", articles: ["Karsk.md"] },
          ],
        },
      ],
    },
    root
  );
  check("a split plans the move, an index per bucket, then the parent rebuild",
    kindsOf(r.operations), ["split-folder", "create-index", "create-index", "rebuild-index"]);
  check("each article gets a full destination path",
    obj(list(find(r.operations, "split-folder").buckets)[0]).articles,
    [{ from: "settings/rolara/locations/Ashfall.md", to: "settings/rolara/locations/north/Ashfall.md" }]);
  check("the bucket index lands inside the bucket",
    obj(r.operations[1]).to, "settings/rolara/locations/north/North-INDEX.md");
  check("the parent rebuild targets the folder's own index",
    obj(r.operations[3]).to, "settings/rolara/locations/Locations-INDEX.md");
  // A bucket folder does not exist yet, so its fresh index is the DEFAULT
  // collision posture rather than an exemption: nothing on disk occupies the
  // path. Pinned because adding split-folder or create-index to
  // DESTINATION_MAY_EXIST to "make the split work" would silently license
  // overwriting a DM's index everywhere else that kind is used.
  check("and a fresh bucket index is not read as a collision",
    [r.declined.length, r.prechecks.ok, r.prechecks.collisions], [0, true, []]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  const r = scoped(
    {
      splitFolders: [
        {
          folder: "settings/rolara/locations",
          buckets: [
            { name: "north", articles: ["Ashfall.md"] },
            { name: "south", articles: ["Ashfall.md"] },
          ],
        },
      ],
    },
    root
  );
  // One article, two destinations. Executing this would move it to the first
  // bucket and then fail to find it for the second, leaving a partition the DM
  // approved and a tree that does not match it.
  check("an article claimed by two buckets is declined",
    [r.operations.length, r.declined.length], [0, 1]);
  check("and the reason names the article",
    String(obj(r.declined[0]).reason).includes("Ashfall.md"), true);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  mkdirSync(path.join(root, "settings", "rolara", "locations", "north"), { recursive: true });
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  // Merging unorganized material into organized material is the ordinary use of
  // a split, not a hazard. The overwrite this used to refuse for is caught per
  // file by findDestinationCollisions, which is the check that actually protects
  // the DM's files; see the case below that exercises it from the planner.
  check("a bucket whose folder already exists merges into it",
    [kindsOf(r.operations), r.declined.length, r.prechecks.ok],
    [["split-folder", "create-index", "rebuild-index"], 0, true]);
  check("and the bucket index is created inside the folder it merged into",
    find(r.operations, "create-index").to,
    "settings/rolara/locations/north/North-INDEX.md");
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  // A FILE where the bucket names a folder. git mv into it fails at apply time,
  // and the per-article collision check cannot catch it, because the article's
  // own destination path (north/Ashfall.md) does not exist either.
  writeAt(root, "settings/rolara/locations/north", "not a folder\n");
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  check("a bucket whose destination holds a file is declined",
    [r.operations.length, r.declined.length], [0, 1]);
  check("and the reason names the path and says it is a file",
    [String(obj(r.declined[0]).target), /is a file, not a folder/.test(String(obj(r.declined[0]).reason))],
    ["settings/rolara/locations/north", true]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  // The protection the old guard stood in for, now reachable from the PLANNER
  // rather than only from a hand-edited plan. An article merging onto a
  // same-named file in the destination is an on-disk collision, and a collision
  // aborts the whole run before anything moves.
  writeAt(root, "settings/rolara/locations/north/Ashfall.md",
    "---\ntype: Location\n---\n\nA different article that already lives here.\n");
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  check("an article merging onto a same-named existing file aborts the run",
    [r.prechecks.ok, list(r.prechecks.collisions).map((c) => [c.kind, c.op, c.to])],
    [false, [["on-disk", "split-folder", "settings/rolara/locations/north/Ashfall.md"]]]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  // The destination already has an index. Creating a second one would be a
  // destination collision, and a folder with two indexes is the multi-index
  // finding the validation sweep reports as needing judgment.
  writeAt(root, "settings/rolara/locations/north/North-INDEX.md",
    "---\ntype: Index\n---\n\n- [[Emberwatch]]\n");
  writeAt(root, "settings/rolara/locations/north/Emberwatch.md",
    "---\ntype: Location\n---\n\nBody.\n");
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  check("a bucket merging into a folder that has an index rebuilds it",
    [kindsOf(r.operations), r.prechecks.ok],
    [["split-folder", "rebuild-index", "rebuild-index"], true]);
  check("and the rebuild names the index that was already there",
    list(r.operations).filter((o) => o.op === "rebuild-index").map((o) => o.to).sort(),
    ["settings/rolara/locations/Locations-INDEX.md", "settings/rolara/locations/north/North-INDEX.md"]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  // The existing index does NOT match the stem indexStemFor would pick. Rebuild
  // what is there rather than creating North-INDEX.md beside it.
  writeAt(root, "settings/rolara/locations/north/Northern-Reaches-INDEX.md",
    "---\ntype: Index\n---\n\n- [[Emberwatch]]\n");
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  check("an existing index under a different stem is the one rebuilt",
    [kindsOf(r.operations),
     list(r.operations).filter((o) => o.op === "rebuild-index").map((o) => o.to).sort()],
    [["split-folder", "rebuild-index", "rebuild-index"],
     ["settings/rolara/locations/Locations-INDEX.md",
      "settings/rolara/locations/north/Northern-Reaches-INDEX.md"]]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  // Two entries naming ONE bucket folder. Legal now that a bucket may merge, and
  // it was the narrowed guard that made it reachable: planCreatesOutright reports
  // the first entry's bucket as creating that directory, so the old existence
  // check declined the second entry outright. Two index operations on one path
  // would be an in-plan collision.
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Karsk.md"] }] },
      ],
    },
    root
  );
  check("two entries naming one bucket emit one index operation, not two",
    [kindsOf(r.operations), r.declined.length, r.prechecks.ok],
    [["split-folder", "split-folder", "create-index", "rebuild-index"], 0, true]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  // The intersection of the two cases above: two entries naming ONE bucket
  // folder, and that folder already holds an index under a NON-default stem.
  // Keying the dedup on the index PATH let entry 2's existingIndexIn call be
  // blinded by entry 1's own not-yet-excluded split-folder operation
  // (planCreatesOutright reports entry 1's bucket as creating that
  // directory), so entry 2 fell back to indexStemFor's default and emitted a
  // second create-index beside the real rebuild: two indexes in one folder,
  // with prechecks reporting ok.
  writeAt(root, "settings/rolara/locations/north/Northern-Reaches-INDEX.md",
    "---\ntype: Index\n---\n\n- [[Emberwatch]]\n");
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Karsk.md"] }] },
      ],
    },
    root
  );
  const bucketOps = list(r.operations).filter(
    (o) => (o.op === "rebuild-index" || o.op === "create-index") && String(o.to).includes("/north/"));
  check("two entries with a non-default existing bucket index emit exactly one index op",
    bucketOps.length, 1);
  check("and it rebuilds the index that was already there",
    [bucketOps[0] && bucketOps[0].op, bucketOps[0] && bucketOps[0].to],
    ["rebuild-index", "settings/rolara/locations/north/Northern-Reaches-INDEX.md"]);
  check("and prechecks pass", r.prechecks.ok, true);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  // Same bucket, two spellings of the split folder: a leading ./ that toPosix
  // does not fold. Keying the dedup on the raw computed `to` string missed
  // this: the two entries built two differently-spelled index paths for the
  // same real bucket, so two create-index operations were emitted, and
  // findDestinationCollisions (which DOES fold a leading ./, through
  // samePathKey) then caught them as an in-plan collision. The run refused
  // with a message about an index path rather than about the scope, which is
  // exactly the harm the Map's comment says it exists to prevent.
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
        { folder: "./settings/rolara/locations", buckets: [{ name: "north", articles: ["Karsk.md"] }] },
      ],
    },
    root
  );
  check("a leading ./ on one entry still dedupes to one bucket index",
    [kindsOf(r.operations), r.declined.length, r.prechecks.ok],
    [["split-folder", "split-folder", "create-index", "rebuild-index"], 0, true]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  // Karsk.md is in no bucket. That is legitimate: a partial split leaves the
  // rest where it is. Asserting it explicitly stops a future "every article
  // must be assigned" rule from being added without anyone noticing it forbids
  // the ordinary case.
  check("an article in no bucket simply stays put",
    JSON.stringify(r.operations).includes("Karsk"), false);
  check("and the split still plans", r.declined.length, 0);
  rmSync(root, { recursive: true, force: true });
}

// The one-article-one-home rail has to hold ACROSS scope entries, not only
// within one. The fixture drops the folder's index deliberately, and the reason has
// since narrowed: back when planSplitFolders emitted one rebuild-index per entry
// rather than deduping them, an index here made the two entries collide in-plan and
// the run refused before the double claim could do any harm, which masked the
// hazard without fixing it. The dedupe removes that masking, and the index-free
// fixture is kept because it isolates the ledger from every other refusal path. A
// folder with no index yet is an ordinary split candidate anyway, since "content
// with no index" is one of the things the sweep flags. Measured with the claim
// ledger scoped per entry: the plan
// carried TWO moves of one file with the prechecks reporting ok, and applying it
// moved Ashfall.md into north, failed the second split with "bad source", and left
// a south bucket holding nothing but a freshly created index.
{
  const root = splitFixture();
  rmSync(path.join(root, "settings", "rolara", "locations", "Locations-INDEX.md"));
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
        { folder: "settings/rolara/locations", buckets: [{ name: "south", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  const destinations = r.operations
    .filter((o) => o.op === "split-folder")
    .flatMap((o) => list(o.buckets))
    .flatMap((b) => list(obj(b).articles))
    .filter((a) => String(obj(a).from).endsWith("Ashfall.md"))
    .map((a) => obj(a).to);
  check("one article is planned to move exactly once, however the scope is split up",
    destinations, ["settings/rolara/locations/north/Ashfall.md"]);
  check("and the second claim on it is declined rather than planned",
    [r.declined.length, r.prechecks.ok], [1, true]);
  rmSync(root, { recursive: true, force: true });
}

// A split's real destinations are the per-article paths inside its buckets, and
// those live one level deeper than absorb-folder's flat `articles`. Every case
// below pins that the precheck sees THROUGH the bucket. Measured before the fix:
// destinationEntriesOf and findIgnoredSources both enumerated only `articles`, so
// a split contributed no destination and no source at all, and each case here
// reported a clean plan over exactly the hazard it is named for.
{
  const root = splitFixture();
  writeAt(root, "settings/rolara/Spare.md", "---\ntype: Location\n---\n\nBody.\n");
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
      pathMoves: [
        {
          from: "settings/rolara/Spare.md",
          to: "settings/rolara/locations/north/Ashfall.md",
          reason: "DM scope",
        },
      ],
    },
    root
  );
  check("a bucket destination another operation also targets is an in-plan collision",
    [r.prechecks.ok, list(r.prechecks.collisions).map((c) => [c.kind, c.b])],
    [false, [["in-plan", "settings/rolara/locations/north/Ashfall.md"]]]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  writeAt(root, "settings/rolara/locations/north/Ashfall.md",
    "---\ntype: Location\n---\n\nA different article that already lives here.\n");
  commitFixture(root);
  // A hand-edited plan reaches applyPlan without passing through the planner,
  // which is a designed path, and applyPlan re-runs the prechecks against the
  // operations it was actually handed. The planner declines a bucket whose folder
  // exists, so this shape can only arrive that way, and the collision half has to
  // catch it there.
  const pre = runPrechecks({
    operations: [
      {
        op: "split-folder",
        from: "settings/rolara/locations",
        buckets: [
          {
            folder: "settings/rolara/locations/north",
            name: "north",
            articles: [
              {
                from: "settings/rolara/locations/Ashfall.md",
                to: "settings/rolara/locations/north/Ashfall.md",
              },
            ],
          },
        ],
        reason: "hand-edited",
      },
    ],
    projectRoot: root,
  });
  check("a bucket destination already on disk aborts before anything moves",
    [pre.ok, list(pre.collisions).map((c) => [c.kind, c.op, c.to])],
    [false, [["on-disk", "split-folder", "settings/rolara/locations/north/Ashfall.md"]]]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  const root = splitFixture();
  writeAt(root, "settings/rolara/Spare.md", "---\ntype: Location\n---\n\nBody.\n");
  writeAt(root, ".gitignore", "settings/rolara/locations/Karsk.md\n");
  commitFixture(root);
  const r = scoped(
    {
      splitFolders: [
        {
          folder: "settings/rolara/locations",
          buckets: [
            { name: "north", articles: ["Ashfall.md"] },
            { name: "south", articles: ["Karsk.md"] },
          ],
        },
      ],
      pathMoves: [
        { from: "settings/rolara/Spare.md", to: "settings/rolara/locations/Karsk.md", reason: "DM scope" },
      ],
    },
    root
  );
  // A split never moves its own `from`; it moves each article named inside a
  // bucket, one git mv at a time, so the source that can be git-ignored is one of
  // those articles. Reaching this precheck is what makes the split declinable AND
  // what withholds vacate credit from the ignored article: `git mv` on it
  // hard-fails with "not under version control", so it never leaves the path the
  // relocate-path below is aiming at, and it has no snapshot to be restored from
  // either.
  //
  // The whole entry goes, not the split alone: a split emits one create-index per
  // bucket and a rebuild of the folder's own index, and those bucket folders would
  // otherwise be created and committed empty by a partition that never happened.
  check("a git-ignored article inside a bucket declines the whole split entry, by name",
    list(r.declined).map((d) => [d.op, d.target, /Karsk\.md/.test(String(d.reason))]),
    [["split-folder", "settings/rolara/locations", true],
     ["create-index", "settings/rolara/locations/north/North-INDEX.md", true],
     ["create-index", "settings/rolara/locations/south/South-INDEX.md", true],
     ["rebuild-index", "settings/rolara/locations/Locations-INDEX.md", true]]);
  check("so nothing is credited with vacating a path the split will never empty",
    [r.prechecks.ok, list(r.prechecks.collisions).map((c) => [c.kind, c.op, c.to])],
    [false, [["on-disk", "relocate-path", "settings/rolara/locations/Karsk.md"]]]);
  // Same reasoning as the absorb case above: the group-level check proves the
  // whole entry declines, not the shape of the row findIgnoredSources reports
  // the article in. Pin that shape directly, including which bucket the
  // article was assigned to (`to`), which the declined-list check above
  // cannot see either.
  const directSplit = runPrechecks({
    operations: [
      {
        op: "split-folder",
        from: "settings/rolara/locations",
        buckets: [
          {
            folder: "settings/rolara/locations/south",
            name: "south",
            articles: [
              { from: "settings/rolara/locations/Karsk.md", to: "settings/rolara/locations/south/Karsk.md" },
            ],
          },
        ],
        reason: "hand-built, mirrors the shape planSplitFolders emits",
      },
    ],
    projectRoot: root,
  });
  check("findIgnoredSources reports the article's own from and to, not the folder's",
    list(directSplit.ignored).map((i) => [i.op, i.source, i.from, i.to]),
    [["split-folder", "settings/rolara/locations/Karsk.md",
      "settings/rolara/locations/Karsk.md", "settings/rolara/locations/south/Karsk.md"]]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

console.log("\n=== scoped plans: every path a scope names is checked at plan time ===");

// The module's stated posture is that the prechecks run BEFORE the plan is shown
// and that a plan which cannot execute is worse than no plan. The scoped planners
// did not honour it: no planner did a per-article existsSync, so a DM typo in a
// filename passed every precheck, produced a clean-looking proposal, and then
// half-applied the partition before failing on the missing file. Measured on a
// bucket naming Ashfal.md: prechecks ok true, one failed split entry, and the
// paired create-index operations ran and committed empty bucket folders on top of
// it.
{
  const root = splitFixture();
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfal.md"] }] },
      ],
    },
    root
  );
  check("a bucket article that is not on disk is declined at plan time",
    [r.operations.length, r.declined.length], [0, 1]);
  check("and the reason names the path, so the typo is visible in the proposal",
    String(obj(r.declined[0]).reason).includes("settings/rolara/locations/Ashfal.md"), true);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/lcoations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  check("a split folder that is not on disk is declined at plan time",
    [r.operations.length, r.declined.length], [0, 1]);
  check("and that reason names the folder",
    String(obj(r.declined[0]).reason).includes("settings/rolara/lcoations"), true);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  const r = scoped(
    {
      pathMoves: [
        { from: "settings/rolara/locations/Ashfal.md", to: "settings/rolara/north/Ashfal.md", reason: "DM scope" },
      ],
    },
    root
  );
  check("a path move whose source is not on disk is declined at plan time",
    [r.operations.length, r.declined.length], [0, 1]);
  check("and names the missing source",
    String(obj(r.declined[0]).reason).includes("settings/rolara/locations/Ashfal.md"), true);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  const r = scoped({ rebuildIndexes: [{ index: "settings/rolara/locations/Locatons-INDEX.md" }] }, root);
  // rebuild-index is in DESTINATION_MAY_EXIST precisely because it edits an index
  // that is supposed to be there already, so the collision half never checks it
  // and applyRebuildIndex is left to discover the typo after the snapshot.
  check("a rebuild whose index is not on disk is declined at plan time",
    [r.operations.length, r.declined.length], [0, 1]);
  check("and names the missing index",
    String(obj(r.declined[0]).reason).includes("settings/rolara/locations/Locatons-INDEX.md"), true);
  rmSync(root, { recursive: true, force: true });
}

{
  // absorb-folder deliberately gains NO per-file check: every file it names comes
  // out of readdirSync plus statSync, so the enumeration itself is the proof they
  // exist, and a second existsSync there would be noise. Its one DM-supplied path
  // is the folder, and the readdirSync it already does declines that. Pinned so
  // the asymmetry between the planners is a decision rather than an oversight.
  const root = absorbFixture();
  const r = scoped({ absorbFolders: [{ folder: "settings/rolara/msic" }] }, root);
  check("an absorb folder that is not on disk is already declined by the enumeration",
    [r.operations.length, r.declined.length], [0, 1]);
  rmSync(root, { recursive: true, force: true });
}

{
  // The check is guarded on a USABLE project root, the same way
  // findDestinationCollisions guards its own on-disk half. A planner re-run
  // against a scope with no root on disk cannot answer the question, and
  // answering "missing" there would decline every legitimate scope in the suite.
  const r = scoped({
    pathMoves: [{ from: "settings/rolara/A.md", to: "settings/rolara/people/A.md", reason: "x" }],
  });
  check("with no project root nothing is declined for not existing",
    [kindsOf(r.operations), r.declined.length], [["relocate-path"], 0]);
}

// The check has to reason about the tree the operation will MEET, not the one on
// disk when the plan is built. APPLY_ORDER is a dependency order, so a scope whose
// later entry names a path an EARLIER entry creates is legitimate, and declining it
// with "Check that path for a typo" is both a false refusal and the wrong
// diagnosis: the remedy it implies is editing the scope, when nothing is wrong with
// it. Every case below combines two scope keys against a real root, which is the
// combination the suite had no case for.
{
  const root = absorbFixture();
  const r = scoped(
    {
      rebuildIndexes: [{ index: "settings/rolara/notes/Msic-INDEX.md" }],
      pathMoves: [{ from: "settings/rolara/misc", to: "settings/rolara/notes", reason: "x" }],
    },
    root
  );
  // The widening must not swallow what the check is for. Nothing puts this index at
  // that path, before or after the move, so the typo is still declined by name.
  check("a typo UNDER a folder the plan moves is still declined at plan time",
    [kindsOf(r.operations), r.declined.length], [["relocate-path"], 1]);
  check("and the decline still names the path the DM typed",
    String(obj(r.declined[0]).reason).includes("settings/rolara/notes/Msic-INDEX.md"), true);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = absorbFixture();
  const r = scoped(
    {
      pathMoves: [{ from: "settings/rolara/misc", to: "settings/rolara/notes", reason: "x" }],
      splitFolders: [
        { folder: "settings/rolara/notes", buckets: [{ name: "odds", articles: ["Odds.md"] }] },
      ],
    },
    root
  );
  // Four checks at once: the split's folder, its bucket article, the bucket folder
  // that must NOT exist, and the folder's own index. The first two are satisfied by
  // the move; the third is not, and reading the move as creating it would decline
  // the whole entry.
  //
  // The rebuild is the fourth, and it used to be silently absent: existingIndexIn
  // read the raw disk, found nothing at settings/rolara/notes because the move has
  // not run yet, and dropped the rebuild that the identical split of a folder
  // already in place emits. The index travels with the folder, so it is there by
  // rank 3 and the rebuild is planned on the same terms.
  check("a split of a folder the same plan moves into place plans rather than declines",
    [kindsOf(r.operations), r.declined.length],
    [["relocate-path", "split-folder", "create-index", "rebuild-index"], 0]);
  check("and the moved folder's own index is rebuilt at its post-move path",
    [find(r.operations, "rebuild-index").to, r.prechecks.ok],
    ["settings/rolara/notes/Misc-INDEX.md", true]);
  check("and the bucket article is read at its post-move source",
    obj(list(find(r.operations, "split-folder").buckets)[0]).articles,
    [{ from: "settings/rolara/notes/Odds.md", to: "settings/rolara/notes/odds/Odds.md" }]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = absorbFixture();
  const r = scoped(
    {
      pathMoves: [
        { from: "settings/rolara/misc", to: "settings/rolara/notes", reason: "x" },
        { from: "settings/rolara/notes/Odds.md", to: "settings/rolara/Odds.md", reason: "x" },
      ],
    },
    root
  );
  check("a second move whose source the first move creates plans too",
    [kindsOf(r.operations), r.declined.length], [["relocate-path", "relocate-path"], 0]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = absorbFixture();
  const r = scoped(
    {
      pathMoves: [
        { from: "settings/rolara/notes/Odds.md", to: "settings/rolara/Odds.md", reason: "x" },
        { from: "settings/rolara/misc", to: "settings/rolara/notes", reason: "x" },
      ],
    },
    root
  );
  // The credit is for what runs EARLIER, not for anything the plan happens to
  // mention. Same-kind operations keep the order the planner emitted them in, so
  // the move below this one runs second and the source is still absent at rank 1.
  // Crediting it would plan a move that fails after the snapshot, which is the
  // failure this whole check exists to move to plan time.
  check("but a source only a LATER operation creates is still declined",
    [kindsOf(r.operations), r.declined.length], [["relocate-path"], 1]);
  rmSync(root, { recursive: true, force: true });
}

// The plan is a model of FILLS and of FREES, because the checks ask in both
// directions. namedPathPresent is the one that wants a path ABSENT, and with frees
// unmodelled it refused a bucket name an earlier operation carries away, declining
// the split-folder entry over a path that will be empty by the time the split runs.
// The relocate is rank 1 and the split rank 3, so the order is not in doubt.
// namedPathPresent still gates the split guard today, now paired with a kind check
// that answers false for a directory whether or not frees resolves it, so only a
// FILE at the vacated path exercises the frees model. Both cases below put a file
// there for exactly that reason: a directory would pass whether planVacates works
// or not, which is the discrimination a directory fixture would silently lose.
{
  const root = splitFixture();
  // A FILE at the vacated path, not a directory. namedPathNotAFolder answers true
  // for a directory regardless of whether planVacates runs, so a directory here
  // would pass this check even with the frees model removed; a file is what makes
  // the case depend on planVacates.
  writeAt(root, "settings/rolara/locations/north", "not a folder\n");
  const r = scoped(
    {
      pathMoves: [
        { from: "settings/rolara/locations/north", to: "settings/rolara/north", reason: "x" },
      ],
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  check("a bucket name an earlier operation vacates is not refused as already there",
    [kindsOf(r.operations), r.declined.length],
    [["relocate-path", "split-folder", "create-index", "rebuild-index"], 0]);
  rmSync(root, { recursive: true, force: true });
}

{
  // The variant the FILLS half introduced, rather than merely failed to fix: the
  // rewind maps settings/rolara/notes/odds back through the folder move to
  // settings/rolara/misc/odds, which is on disk, so a bucket name that was correctly
  // accepted before the rewind existed started being declined. Both moves rank 1 and
  // the second empties the path, so the name is free at rank 3.
  //
  // A FILE at that rewound path, not a directory, for the same reason as the case
  // above: the guard's kind check exempts a directory whether or not planVacates
  // runs, so a file is what makes this pin the chain of moves rather than the kind
  // check alone.
  const root = absorbFixture();
  writeAt(root, "settings/rolara/misc/odds", "not a folder\n");
  const r = scoped(
    {
      pathMoves: [
        { from: "settings/rolara/misc", to: "settings/rolara/notes", reason: "x" },
        { from: "settings/rolara/notes/odds", to: "settings/rolara/attic", reason: "x" },
      ],
      splitFolders: [
        { folder: "settings/rolara/notes", buckets: [{ name: "odds", articles: ["Odds.md"] }] },
      ],
    },
    root
  );
  check("a bucket name freed by a chain of earlier moves is not refused either",
    [kindsOf(r.operations), r.declined.length],
    [["relocate-path", "relocate-path", "split-folder", "create-index", "rebuild-index"], 0]);
  rmSync(root, { recursive: true, force: true });
}

{
  // The frees model must not become a licence in the present-direction checks. A
  // rebuild naming an index inside a folder an earlier operation carries away cannot
  // execute, and declining it at plan time is the point: with fills alone this planned
  // and then failed after the snapshot, with the paired operations running on top.
  const root = absorbFixture();
  const r = scoped(
    {
      pathMoves: [{ from: "settings/rolara/misc", to: "settings/rolara/notes", reason: "x" }],
      rebuildIndexes: [{ index: "settings/rolara/misc/Misc-INDEX.md" }],
    },
    root
  );
  check("and a rebuild of an index an earlier move carries away is declined, not planned",
    [kindsOf(r.operations), r.declined.length], [["relocate-path"], 1]);
  check("with a reason naming the index the DM typed",
    String(obj(r.declined[0]).reason).includes("settings/rolara/misc/Misc-INDEX.md"), true);
  rmSync(root, { recursive: true, force: true });
}

{
  // existsSync answers a weaker question than this planner is asking. rebuild-index
  // edits an existing index FILE's link list in place, so a directory sitting at
  // that path passed the check and reached applyRebuildIndex after the snapshot.
  const root = absorbFixture();
  mkdirSync(path.join(root, "settings", "rolara", "misc", "Odd-INDEX.md"), { recursive: true });
  const r = scoped({ rebuildIndexes: [{ index: "settings/rolara/misc/Odd-INDEX.md" }] }, root);
  check("a directory sitting at an index path is declined rather than planned",
    [r.operations.length, r.declined.length], [0, 1]);
  rmSync(root, { recursive: true, force: true });
}

{
  // The same weakness on the other path the rebuild names: applyRebuildIndex lists
  // the folder's contents, and a FILE there is not a folder to list.
  const root = absorbFixture();
  const r = scoped(
    {
      rebuildIndexes: [
        { index: "settings/rolara/misc/Misc-INDEX.md", folder: "settings/rolara/misc/Odds.md" },
      ],
    },
    root
  );
  check("a file named as the folder to rebuild from is declined too",
    [r.operations.length, r.declined.length], [0, 1]);
  rmSync(root, { recursive: true, force: true });
}

console.log("\n=== scoped plans: one folder, two scope entries ===");

// planAbsorbFolders dedupes its parent rebuild and planSplitFolders did not, so
// two entries naming one folder emitted two rebuild-index operations with one
// `to`. That is an in-plan collision by the generic rule, and the run refused
// with a message about an index path rather than about the scope the DM wrote.
{
  const root = splitFixture();
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
        { folder: "settings/rolara/locations", buckets: [{ name: "south", articles: ["Karsk.md"] }] },
      ],
    },
    root
  );
  check("two scope entries splitting one folder plan ONE parent rebuild",
    kindsOf(r.operations),
    ["split-folder", "split-folder", "create-index", "create-index", "rebuild-index"]);
  check("and the planner does not hand its own prechecks a plan they refuse",
    [r.declined.length, r.prechecks.ok, r.prechecks.collisions], [0, true, []]);
  check("the surviving rebuild counts every bucket, not only the first entry's",
    /2 subfolder/.test(String(find(r.operations, "rebuild-index").reason)), true);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  const r = scoped(
    {
      splitFolders: [
        {
          folder: "settings/rolara/locations",
          buckets: [{ name: "north", articles: ["Ashfall.md", "Ashfall.md"] }],
        },
      ],
    },
    root
  );
  check("one bucket listing an article twice is declined",
    [r.operations.length, r.declined.length], [0, 1]);
  // The old message read "claimed by two buckets (locations/north and
  // locations/north)", which names one bucket twice and describes a situation
  // that did not happen.
  const reason = String(obj(r.declined[0]).reason);
  check("and the reason describes the real situation rather than naming one bucket twice",
    [/two buckets/.test(reason), /same bucket/.test(reason)], [false, true]);
  rmSync(root, { recursive: true, force: true });
}

console.log("\n=== scoped plans: one index, several scope entries ===");

// The section above covers two entries under ONE planner, which each planner's own
// `rebuilds` Map already handled. Neither Map can see the other, and
// planRebuildIndexes holds no Map at all, so a scope combining two of the three
// emitted two rebuild-index operations with one `to`. findDestinationCollisions
// correctly reads that as an in-plan collision and applyPlan refused the whole run,
// naming an index path rather than the scope the DM wrote. Rebuilding one index
// twice from one folder is redundant rather than contradictory, so the redundancy is
// folded out in buildScopedPlan before the collision check sees it, on exactly the
// terms the two Maps already fold on.

// Every operation in the plan that writes `to`, whatever its kind, which is the set
// findDestinationCollisions ranks. Written out rather than filtered on rebuild-index
// alone, so a case asserting "one operation writes this path" cannot pass while a
// create-index quietly writes it too.
const writersOf = (r, to) => list(r.operations).filter((o) => o.to === to);
const inPlanAt = (r, to) =>
  list(r.prechecks.collisions).filter((c) => c.kind === "in-plan" && (c.a === to || c.b === to));

{
  // SHAPE 1. A rebuildIndexes entry and a splitFolders entry naming one index. The
  // split emits the rebuild of its own folder's index, and the DM named that same
  // index outright.
  const root = splitFixture();
  const to = "settings/rolara/locations/Locations-INDEX.md";
  const r = scoped(
    {
      rebuildIndexes: [{ index: to }],
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  check("a split and a rebuildIndexes entry naming one index plan ONE rebuild",
    [kindsOf(r.operations), writersOf(r, to).length],
    [["split-folder", "create-index", "rebuild-index"], 1]);
  check("and the surviving rebuild is traceable to BOTH scope entries",
    find(r.operations, "rebuild-index").groups, ["splitFolders[0]", "rebuildIndexes[0]"]);
  check("and its reason carries what each entry contributed",
    [/was split into 1 subfolder/.test(String(find(r.operations, "rebuild-index").reason)),
     /DM-approved \/migrate scope/.test(String(find(r.operations, "rebuild-index").reason))],
    [true, true]);
  check("and the plan is not refused over an index path",
    [r.prechecks.ok, inPlanAt(r, to), r.declined.length], [true, [], 0]);
  check("the folder the merged rebuild reads is the one both entries named",
    find(r.operations, "rebuild-index").folder, "settings/rolara/locations");
  rmSync(root, { recursive: true, force: true });
}

{
  // SHAPE 3. An absorbFolders entry and a rebuildIndexes entry naming one parent
  // index. The absorb emits the rebuild of the parent it dissolves into, and the DM
  // named that parent's index outright.
  const root = absorbFixture();
  const to = "settings/rolara/Rolara-INDEX.md";
  const r = scoped({ absorbFolders: [{ folder: "settings/rolara/misc" }], rebuildIndexes: [{ index: to }] }, root);
  check("an absorb and a rebuildIndexes entry naming one parent index plan ONE rebuild",
    [kindsOf(r.operations), writersOf(r, to).length], [["absorb-folder", "rebuild-index"], 1]);
  check("and that rebuild is traceable to BOTH scope entries",
    find(r.operations, "rebuild-index").groups, ["absorbFolders[0]", "rebuildIndexes[0]"]);
  check("and the plan is not refused over an index path",
    [r.prechecks.ok, inPlanAt(r, to), r.declined.length], [true, [], 0]);
  rmSync(root, { recursive: true, force: true });
}

{
  // Two rebuildIndexes entries naming ONE index. planAbsorbFolders and
  // planSplitFolders each dedupe within themselves; this planner never did, because a
  // DM naming one index twice is not the shape it was written for. The cross-planner
  // fold covers it for free, which is the point of folding at the plan level rather
  // than adding a third Map.
  const root = splitFixture();
  const to = "settings/rolara/locations/Locations-INDEX.md";
  const r = scoped({ rebuildIndexes: [{ index: to }, { index: to }] }, root);
  check("one index named twice under rebuildIndexes plans ONE rebuild",
    [kindsOf(r.operations), r.prechecks.ok, inPlanAt(r, to)], [["rebuild-index"], true, []]);
  check("carrying both entries", find(r.operations, "rebuild-index").groups,
    ["rebuildIndexes[0]", "rebuildIndexes[1]"]);
  rmSync(root, { recursive: true, force: true });
}

// THE FOLD AND findDestinationCollisions HAVE TO AGREE ON WHAT ONE DESTINATION IS.
// The four shapes above are spelled plainly on both sides, so they pass under any
// key the two happen to share. The pairs below spell ONE of the two paths with a
// `./` prefix or a `..` hop, which is what separates a shared key from two keys
// that merely look alike: findDestinationCollisions folds those away, so if this
// fold does not, it leaves two rebuild-index operations that check then correctly
// reads as one destination and applyPlan refuses the whole run over a path
// spelling. Measured on exactly this shape when the two keys were stated
// separately. A `./` prefix is an ordinary spelling of a project-relative path,
// and the absorb pair shows it need only appear on a FOLDER, with the index path
// derived from it, so the DM never types an index path at all.
{
  // SHAPE 3 again, with the DM's rebuildIndexes entry spelling the parent index
  // `./`. The absorb derives the same index plainly from the folder it dissolves.
  const root = absorbFixture();
  const to = "settings/rolara/Rolara-INDEX.md";
  const r = scoped(
    { absorbFolders: [{ folder: "settings/rolara/misc" }], rebuildIndexes: [{ index: `./${to}` }] },
    root
  );
  check("an absorb and a DOTTED rebuildIndexes entry naming one parent index plan ONE rebuild",
    [kindsOf(r.operations), writersOf(r, to).length], [["absorb-folder", "rebuild-index"], 1]);
  check("and that rebuild is still traceable to BOTH scope entries",
    find(r.operations, "rebuild-index").groups, ["absorbFolders[0]", "rebuildIndexes[0]"]);
  check("and the plan is not refused over the spelling of an index path",
    [r.prechecks.ok, r.prechecks.collisions, r.declined.length], [true, [], 0]);
  rmSync(root, { recursive: true, force: true });
}

{
  // The same pair from the other side: the DOTTED spelling is on the absorbed
  // FOLDER, and the parent index the absorb rebuilds is derived from it, so the
  // dotted path is one no scope entry ever names. The absorb runs first, so the
  // merged operation keeps ITS spelling of the destination, which the executor
  // resolves through path.resolve like every other path it is handed.
  const root = absorbFixture();
  const derived = "./settings/rolara/Rolara-INDEX.md";
  const r = scoped(
    {
      absorbFolders: [{ folder: "./settings/rolara/misc" }],
      rebuildIndexes: [{ index: "settings/rolara/Rolara-INDEX.md" }],
    },
    root
  );
  check("a DOTTED absorb folder and a plain rebuildIndexes entry plan ONE rebuild",
    [kindsOf(r.operations), writersOf(r, derived).length], [["absorb-folder", "rebuild-index"], 1]);
  check("carrying both entries there too",
    find(r.operations, "rebuild-index").groups, ["absorbFolders[0]", "rebuildIndexes[0]"]);
  check("and that plan is not refused either",
    [r.prechecks.ok, r.prechecks.collisions, r.declined.length], [true, [], 0]);
  rmSync(root, { recursive: true, force: true });
}

{
  // The fold on its own, with nothing else in the scope: one index named twice,
  // the second spelling only a `./` apart from the first. This is the pair that
  // isolates the key, since no planner-derived path is involved on either side.
  const root = splitFixture();
  const to = "settings/rolara/locations/Locations-INDEX.md";
  const r = scoped({ rebuildIndexes: [{ index: to }, { index: `./${to}` }] }, root);
  check("one index named twice, the second spelled ./, plans ONE rebuild",
    [kindsOf(r.operations), r.prechecks.ok, inPlanAt(r, to)], [["rebuild-index"], true, []]);
  check("and the merged rebuild carries both entries",
    find(r.operations, "rebuild-index").groups, ["rebuildIndexes[0]", "rebuildIndexes[1]"]);
  check("and reads the folder both spellings resolve to",
    find(r.operations, "rebuild-index").folder, "settings/rolara/locations");
  rmSync(root, { recursive: true, force: true });
}

{
  // The same, through a `..` hop rather than a `./` prefix, because the two reach
  // path.posix.normalize by different routes and only the second changes the number
  // of segments in the string.
  const root = splitFixture();
  const to = "settings/rolara/locations/Locations-INDEX.md";
  const r = scoped(
    {
      rebuildIndexes: [
        { index: to },
        { index: "settings/rolara/locations/../locations/Locations-INDEX.md" },
      ],
    },
    root
  );
  check("one index named twice, the second through a .. hop, plans ONE rebuild",
    [kindsOf(r.operations), r.prechecks.ok, inPlanAt(r, to)], [["rebuild-index"], true, []]);
  check("carrying both entries through the hop as well",
    find(r.operations, "rebuild-index").groups, ["rebuildIndexes[0]", "rebuildIndexes[1]"]);
  rmSync(root, { recursive: true, force: true });
}

{
  // SHAPE 2, AND IT IS NOT THE SAME SHAPE AS THE OTHER TWO. A rebuildIndexes entry
  // naming a split bucket's own fresh index pairs a rebuild-index with a
  // CREATE-INDEX, not with a second rebuild, so no rebuild fold can reach it. The
  // two are different kinds with different executors and the pair cannot be merged
  // into one operation of either kind:
  //
  //   the create-index cannot be dropped, because applyRebuildIndex refuses a path
  //   with no index at it, so the rebuild alone would not execute;
  //
  //   the create-index must not take the rebuild entry's group either, because an
  //   operation is skipped only when EVERY group it carries is skipped, so a
  //   create-index carrying a second group would survive a skip of the split that
  //   paired it and create the bucket folder that skipped split never populated,
  //   which is the measured defect recorded at groupsOf.
  //
  // So the redundant entry is DECLINED rather than folded, which is the same channel
  // every other scoped refusal reaches the DM through, and the work it asked for is
  // still done: applyCreateIndex writes that index's link list from the same folder
  // through the same articleStemsIn. The count asserted here is therefore ZERO
  // rebuilds at that path and one writer, not one rebuild.
  const root = splitFixture();
  const to = "settings/rolara/locations/north/North-INDEX.md";
  const r = scoped(
    {
      rebuildIndexes: [{ index: to }],
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  check("a rebuildIndexes entry naming an index this plan CREATES leaves one writer at that path",
    [writersOf(r, to).map((o) => o.op), r.prechecks.ok, inPlanAt(r, to)],
    [["create-index"], true, []]);
  check("and the redundant entry is declined rather than dropped without a word",
    r.declined.map((d) => [d.op, d.target]), [["rebuild-index", to]]);
  check("with a reason saying the same plan already builds that list, and from where",
    [/creates it/.test(String(obj(r.declined[0]).reason)),
     /settings\/rolara\/locations\/north/.test(String(obj(r.declined[0]).reason))],
    [true, true]);
  check("the split's own parent rebuild is untouched by that decline",
    [kindsOf(r.operations), find(r.operations, "rebuild-index").to],
    [["split-folder", "create-index", "rebuild-index"], "settings/rolara/locations/Locations-INDEX.md"]);
  rmSync(root, { recursive: true, force: true });
}

// THE FOLD MUST NOT OVER-MERGE. findDestinationCollisions catches a genuine
// collision, which is two operations that must not both write one path, and the fold
// removes a redundant duplicate rather than teaching that check to look away. Four
// cases, each a pair the fold must leave exactly as it found it.

{
  // Same destination, DIFFERENT folder. `folder` is DM-supplied and defaults to the
  // index's own directory, so two rebuilds of one index reading two folders write two
  // different link lists to one path. That is two operations that genuinely must not
  // both run, and it still refuses.
  const root = splitFixture();
  const to = "settings/rolara/locations/Locations-INDEX.md";
  const r = scoped(
    { rebuildIndexes: [{ index: to }, { index: to, folder: "settings/rolara" }] },
    root
  );
  check("two rebuilds of one index reading DIFFERENT folders are not merged",
    [kindsOf(r.operations), r.operations.map((o) => o.folder)],
    [["rebuild-index", "rebuild-index"], ["settings/rolara/locations", "settings/rolara"]]);
  check("and are still refused as a genuine in-plan collision",
    [r.prechecks.ok, inPlanAt(r, to).length], [false, 1]);
  rmSync(root, { recursive: true, force: true });
}

{
  // The same guard on the create-index pair: the redundancy decline is gated on the
  // rebuild reading the very folder the create-index builds its list from. Naming a
  // different folder is a rebuild that writes different content to that path, so it
  // is NOT declined as redundant and the collision check refuses the pair.
  const root = splitFixture();
  const to = "settings/rolara/locations/north/North-INDEX.md";
  const r = scoped(
    {
      rebuildIndexes: [{ index: to, folder: "settings/rolara/locations" }],
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  check("a rebuild writing a DIFFERENT list to a created index is not declined as redundant",
    [r.declined.length, writersOf(r, to).map((o) => o.op)], [0, ["create-index", "rebuild-index"]]);
  check("and the pair is still refused as a genuine in-plan collision",
    [r.prechecks.ok, inPlanAt(r, to).length], [false, 1]);
  rmSync(root, { recursive: true, force: true });
}

{
  // A rebuild-index and an operation of another kind colliding on one path. Only
  // rebuild-index is folded, so nothing here is merged and the refusal stands.
  const root = splitFixture();
  const to = "settings/rolara/locations/Locations-INDEX.md";
  const r = scoped(
    { pathMoves: [{ from: "settings/rolara/locations/Karsk.md", to }], rebuildIndexes: [{ index: to }] },
    root
  );
  check("a relocate-path and a rebuild aimed at one path are two operations, not one",
    writersOf(r, to).map((o) => o.op), ["relocate-path", "rebuild-index"]);
  check("and the run is still refused",
    [r.prechecks.ok, inPlanAt(r, to).length], [false, 1]);
  rmSync(root, { recursive: true, force: true });
}

{
  // Two rebuilds that share a path COMPONENT and nothing else. Folding on the
  // directory or on the basename alone would collapse these into one operation and
  // silently drop a rebuild the DM asked for.
  const root = absorbFixture();
  const r = scoped(
    {
      rebuildIndexes: [
        { index: "settings/rolara/Rolara-INDEX.md" },
        { index: "settings/rolara/misc/Misc-INDEX.md" },
      ],
    },
    root
  );
  check("two rebuilds of DIFFERENT indexes are left alone",
    [r.operations.map((o) => o.to), r.operations.map((o) => o.groups)],
    [["settings/rolara/Rolara-INDEX.md", "settings/rolara/misc/Misc-INDEX.md"],
     [["rebuildIndexes[0]"], ["rebuildIndexes[1]"]]]);
  check("and neither is refused", [r.prechecks.ok, r.prechecks.collisions], [true, []]);
  rmSync(root, { recursive: true, force: true });
}

{
  // A merged rebuild reaching declineIgnoredSources' surviving-shared disclosure. One
  // of the two entries that produced it is skipped for a git-ignored article, so the
  // rebuild survives on the multi-group rule and the decline has to say so. It needs
  // no new code to survive: rebuild-index names no source of its own, so the merged
  // groups array alone decides it, exactly as it does for an intra-planner merge.
  //
  // The wording is the part that needed care. Only an ABSORB unlinks anything: a
  // skipped absorb leaves its folder on disk with the surviving parent rebuild no
  // longer listing it. A skipped SPLIT dissolves nothing and a folder's own index does
  // not link itself, so the absorb sentence described something that had not happened.
  const root = splitFixture();
  writeAt(root, ".gitignore", "settings/rolara/locations/Ashfall.md\n");
  commitFixture(root);
  const to = "settings/rolara/locations/Locations-INDEX.md";
  const r = scoped(
    {
      rebuildIndexes: [{ index: to }],
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  check("the merged rebuild survives a skip of only ONE of its two entries",
    [kindsOf(r.operations), find(r.operations, "rebuild-index").groups],
    [["rebuild-index"], ["splitFolders[0]", "rebuildIndexes[0]"]]);
  check("and the declined entry still discloses it, attributed to the entry that shares it",
    r.declined.map((d) => [d.op, d.target]),
    [["split-folder", "settings/rolara/locations"],
     ["create-index", "settings/rolara/locations/north/North-INDEX.md"]]);
  const reason = String(obj(r.declined[0]).reason);
  check("naming the surviving operation and what a surviving rebuild costs in general",
    [new RegExp(`rebuild-index ${to.replace(/\//g, "\\/")}`).test(reason),
     /describes the tree this entry did not change/.test(reason)],
    [true, true]);
  check("but NOT claiming a link was lost, which only a skipped absorb does",
    /no longer linked from that index/.test(reason), false);
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    /* Windows keeps handles on .git objects; a leftover temp dir is not a failure. */
  }
}

console.log("\n=== scoped plans: scope-entry groups ===");

// Every operation ONE scope entry emits carries the same `groups` id, so
// applyPlan's skip pass can treat the entry as the unit rather than the single
// operation. Plain JSON data on the operation rather than a closure or a symbol,
// because the DM may hand-edit the plan file between the two phases and a later
// task renders and re-parses it, so the id has to survive that round trip.
{
  const root = splitFixture();
  const r = scoped(
    {
      splitFolders: [
        {
          folder: "settings/rolara/locations",
          buckets: [
            { name: "north", articles: ["Ashfall.md"] },
            { name: "south", articles: ["Karsk.md"] },
          ],
        },
      ],
    },
    root
  );
  check("every operation a split entry emits carries the same group id",
    r.operations.map((o) => list(o.groups)),
    [["splitFolders[0]"], ["splitFolders[0]"], ["splitFolders[0]"], ["splitFolders[0]"]]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = absorbFixture();
  const r = scoped({ absorbFolders: [{ folder: "settings/rolara/misc" }] }, root);
  check("an absorb entry stamps its parent rebuild with the same group id",
    r.operations.map((o) => list(o.groups)),
    [["absorbFolders[0]"], ["absorbFolders[0]"]]);
  rmSync(root, { recursive: true, force: true });
}

{
  // The parent rebuild two sibling absorbs share belongs to BOTH entries, so it
  // carries both ids. applyPlan skips a multi-group operation only when every
  // group it belongs to is skipped: dropping it because ONE of them was would
  // leave the absorb that DID run with a parent index still linking the index it
  // just removed, which is a dead wikilink and blocks the whole commit.
  const root = absorbFixture();
  writeAt(root, "settings/rolara/notes/Notes-INDEX.md", "---\ntype: Index\n---\n\n- [[Jot]]\n");
  writeAt(root, "settings/rolara/notes/Jot.md", "---\ntype: Concept\n---\n\nBody.\n");
  const r = scoped(
    { absorbFolders: [{ folder: "settings/rolara/misc" }, { folder: "settings/rolara/notes" }] },
    root
  );
  check("a rebuild two entries share carries both group ids",
    list(find(r.operations, "rebuild-index").groups),
    ["absorbFolders[0]", "absorbFolders[1]"]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  const r = scoped(
    {
      pathMoves: [
        { from: "settings/rolara/locations/Ashfall.md", to: "settings/rolara/north/Ashfall.md", reason: "x" },
      ],
      rebuildIndexes: [{ index: "settings/rolara/locations/Locations-INDEX.md" }],
    },
    root
  );
  check("the one-operation planners stamp a group too, so the shape is uniform",
    r.operations.map((o) => list(o.groups)), [["pathMoves[0]"], ["rebuildIndexes[0]"]]);
  rmSync(root, { recursive: true, force: true });
}

{
  // Setup's unattended migration is untouched by the grouping: no setup planner
  // stamps a group, so applyPlan's grouping pass is inert for every kind buildPlan
  // emits. This is the same emission-site argument the last three tasks used, and
  // it is pinned here rather than left to a grep.
  const p = plan(FULL_SURVEY);
  check("no setup operation carries a group",
    p.operations.some((o) => Object.prototype.hasOwnProperty.call(o, "groups")), false);
}

console.log("\n=== scoped plans: rename-entity ===");

{
  const r = scoped({
    entityRenames: [
      {
        file: "settings/rolara/factions/Ashfall-Compact.md",
        to: "settings/rolara/factions/Cinder-Pact.md",
        nameFrom: "Ashfall Compact",
        nameTo: "Cinder Pact",
        links: ["settings/rolara/factions/Factions-INDEX.md"],
      },
    ],
  });
  // Every reach goes through obj(), which is this file's own rule: a field an
  // implementation never emitted has to make the case go RED rather than throw and
  // take every later case down with it. Measured here, not theorised. The bare
  // `r.operations[0].links` this case was drafted with crashed the whole suite on
  // the red run, which hides exactly the red set that proves the suite can fail.
  const op = obj(r.operations[0]);
  check("an entity rename plans one rename-entity", kindsOf(r.operations), ["rename-entity"]);
  check("the referring files ride along on the operation",
    op.links, ["settings/rolara/factions/Factions-INDEX.md"]);
  // The rename, the frontmatter name, and the wikilinks are one unit of work, so
  // the plan has to carry all three halves: re-deriving any of them at apply time
  // would be the apply phase inventing an operation.
  check("and so do both halves of the frontmatter name",
    [op.nameFrom, op.nameTo], ["Ashfall Compact", "Cinder Pact"]);
  check("with the scope entry's group id stamped on it",
    list(op.groups), ["entityRenames[0]"]);
}

{
  const r = scoped({
    entityRenames: [{ file: "settings/rolara/factions/A.md", to: "settings/rolara/factions/A.md" }],
  });
  check("a rename to the same path is declined", [r.operations.length, r.declined.length], [0, 1]);
}

{
  const r = scoped({ entityRenames: [{ to: "settings/rolara/factions/Cinder-Pact.md" }] });
  check("an entry naming no file is declined", [r.operations.length, r.declined.length], [0, 1]);
}

{
  // An entity with no `name` field is the ordinary case for the base schema, which
  // does not require one, so a scope carrying neither half plans rather than
  // declines. Nulls rather than absent fields, because the executor tests for null
  // to decide whether it has anything to match on.
  const r = scoped({
    entityRenames: [
      { file: "settings/rolara/factions/A.md", to: "settings/rolara/factions/B.md" },
    ],
  });
  const op = obj(r.operations[0]);
  check("a rename carrying no frontmatter name still plans",
    [kindsOf(r.operations), op.nameFrom, op.nameTo, op.links],
    [["rename-entity"], null, null, []]);
}

// Every path an entityRenames entry names is one the DM typed, and this planner
// enumerates nothing, so nothing else proves any of them are there. Both halves are
// checked for the same reason the split's articles are: a typo plans cleanly, passes
// every precheck, and then half-applies after the snapshot, with the file moved and
// the entry reporting applied false.
{
  const root = splitFixture();
  const r = scoped(
    {
      entityRenames: [
        { file: "settings/rolara/locations/Ashfal.md", to: "settings/rolara/locations/Cinder.md" },
      ],
    },
    root
  );
  check("an entity rename whose source is not on disk is declined at plan time",
    [r.operations.length, r.declined.length], [0, 1]);
  check("and the reason names the path, so the typo is visible in the proposal",
    String(obj(r.declined[0]).reason).includes("settings/rolara/locations/Ashfal.md"), true);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  const r = scoped(
    {
      entityRenames: [
        {
          file: "settings/rolara/locations/Ashfall.md",
          to: "settings/rolara/locations/Cinder.md",
          links: ["settings/rolara/locations/Locatons-INDEX.md"],
        },
      ],
    },
    root
  );
  // The whole ENTRY is declined rather than the one referrer dropped. Dropping it
  // would rename the file and leave the wikilink the DM named unrewritten, which is
  // the dead link the coupling exists to prevent.
  check("a referring file that is not on disk declines the whole entry",
    [r.operations.length, r.declined.length], [0, 1]);
  check("with the missing referrer named",
    String(obj(r.declined[0]).reason).includes("settings/rolara/locations/Locatons-INDEX.md"), true);
  rmSync(root, { recursive: true, force: true });
}

{
  // The check reasons about the tree the operation will MEET. rename-entity ranks
  // below rebuild-index and above relocate-path, so a move in the same scope puts
  // both the article and its referrer where this entry names them.
  const root = absorbFixture();
  const r = scoped(
    {
      pathMoves: [{ from: "settings/rolara/misc", to: "settings/rolara/notes", reason: "x" }],
      entityRenames: [
        {
          file: "settings/rolara/notes/Odds.md",
          to: "settings/rolara/notes/Sundries.md",
          links: ["settings/rolara/notes/Misc-INDEX.md"],
        },
      ],
    },
    root
  );
  check("a rename of an article the same plan moves into place plans rather than declines",
    [kindsOf(r.operations), r.declined.length], [["relocate-path", "rename-entity"], 0]);
  rmSync(root, { recursive: true, force: true });
}

{
  // The other direction of the same model: a rename of an article an earlier
  // operation carries away cannot execute, so it is declined rather than planned to
  // fail after the snapshot.
  const root = absorbFixture();
  const r = scoped(
    {
      pathMoves: [{ from: "settings/rolara/misc", to: "settings/rolara/notes", reason: "x" }],
      entityRenames: [
        { file: "settings/rolara/misc/Odds.md", to: "settings/rolara/misc/Sundries.md" },
      ],
    },
    root
  );
  check("but a rename of an article an earlier move carries away is declined",
    [kindsOf(r.operations), r.declined.length], [["relocate-path"], 1]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = absorbFixture();
  const r = scoped(
    {
      entityRenames: [
        { file: "settings/rolara/misc/Odds.md", to: "settings/rolara/misc/Sundries.md" },
        { file: "settings/rolara/misc/Sundries.md", to: "settings/rolara/misc/Oddments.md" },
      ],
    },
    root
  );
  // Same-kind operations run in the order this planner emits them, so a second
  // entry renaming what the first produced is legitimate and must not read as a
  // typo. It is also the shape a DM writes by accident, which is why the chain is
  // pinned rather than assumed.
  check("a chained rename whose source the first entry creates plans too",
    [kindsOf(r.operations), r.declined.length], [["rename-entity", "rename-entity"], 0]);
  check("and each entry keeps its own group id",
    r.operations.map((o) => list(o.groups)), [["entityRenames[0]"], ["entityRenames[1]"]]);
  rmSync(root, { recursive: true, force: true });
}

console.log("\n=== scoped plans: retype, repair, suffix renames ===");

{
  const r = scoped({
    retypes: [
      {
        files: ["settings/rolara/people/Thoric.md", "settings/rolara/people/Aria.md"],
        typeFrom: "Person",
        typeTo: "Character",
      },
    ],
  });
  check("a retype plans one normalize-type per file",
    kindsOf(r.operations), ["normalize-type", "normalize-type"]);
  check("each carries the from and to values the executor matches on",
    [r.operations[0].typeFrom, r.operations[0].typeTo], ["Person", "Character"]);
}

{
  const r = scoped({
    retypes: [
      {
        files: ["settings/rolara/history/First-Age.md"],
        typeFrom: "Concept",
        typeTo: "Chronology",
        suffix: "-CHRONOLOGY",
        links: { "settings/rolara/history/First-Age.md": ["settings/rolara/Master-INDEX.md"] },
      },
    ],
  });
  // Type first, then the rename: a required suffix derives from the type, so
  // renaming first computes it from a stale value. That is the reason
  // OPERATION_ORDER puts normalize-type ahead of rename-with-link-rewrite, and
  // it is why retype emits both rather than asking the DM to sequence them.
  check("a type whose suffix the file lacks also plans the rename",
    kindsOf(r.operations), ["normalize-type", "rename-with-link-rewrite"]);
  check("the rename target carries the suffix",
    r.operations[1].to, "settings/rolara/history/First-Age-CHRONOLOGY.md");
  check("and the referring files ride along",
    r.operations[1].links, ["settings/rolara/Master-INDEX.md"]);
}

{
  const r = scoped({
    retypes: [
      {
        files: ["settings/rolara/history/First-Age-CHRONOLOGY.md"],
        typeFrom: "Concept",
        typeTo: "Chronology",
        suffix: "-CHRONOLOGY",
      },
    ],
  });
  check("a file already carrying the suffix is not renamed to itself",
    kindsOf(r.operations), ["normalize-type"]);
}

{
  const r = scoped({
    frontmatterRepairs: [{ file: "settings/rolara/people/Aria.md", reorder: true, insert: [] }],
  });
  check("a repair scope plans one repair-frontmatter", kindsOf(r.operations), ["repair-frontmatter"]);
  // publish is never inserted by any unattended process, and a scope is not an
  // exception: the guard that forces publish false on DM-only content is a
  // project-scope check, so inserting a default in bulk would publish unmarked
  // secret lore. buildPlan already refuses this; buildScopedPlan must too.
  const p = scoped({
    frontmatterRepairs: [{ file: "settings/rolara/people/Aria.md", insert: ["publish"] }],
  });
  check("inserting publish is declined even when the DM's scope asks",
    [p.operations.length, p.declined.length], [0, 1]);
}

{
  const r = scoped({
    suffixRenames: [
      {
        file: "settings/rolara/history/First-Age-TIMELINE.md",
        to: "settings/rolara/history/First-Age-CHRONOLOGY.md",
        links: ["settings/rolara/history/History-INDEX.md"],
      },
    ],
  });
  check("a suffix rename plans one rename-with-link-rewrite",
    kindsOf(r.operations), ["rename-with-link-rewrite"]);
}

{
  check("retypeExtensions collects the new type values",
    retypeExtensions({
      retypes: [
        { files: ["a.md"], typeFrom: "Person", typeTo: "Character" },
        { files: ["b.md"], typeFrom: "Person", typeTo: "Character" },
        { files: ["c.md"], typeFrom: "Item", typeTo: "Relic" },
      ],
    }),
    ["Character", "Relic"]);
}

console.log("\n=== scoped plans: retype, repair, suffix rename path checks and groups ===");

// The cases above never pass a projectRoot, so namedPathNotAFile answers
// undetermined for every one of them and the checks these three planners added
// are never exercised. These cases exercise them for real, against splitFixture,
// on the same terms as the pathMoves/splitFolders/entityRenames cases in the
// "every path a scope names is checked at plan time" section above.

{
  const root = splitFixture();
  const r = scoped(
    { retypes: [{ files: ["settings/rolara/locations/Ghost.md"], typeFrom: "Location", typeTo: "Ruin" }] },
    root
  );
  check("a retype naming a file that is not on disk is declined at plan time",
    [r.operations.length, r.declined.length], [0, 1]);
  check("and the reason names the path",
    String(obj(r.declined[0]).reason).includes("settings/rolara/locations/Ghost.md"), true);
  rmSync(root, { recursive: true, force: true });
}

{
  // The file exists, but the referrer the suffix's rename would rewrite does
  // not. The whole entry declines rather than emitting the type change alone:
  // silently retyping without the rename the new type requires would apply a
  // narrower change than the one the DM approved.
  const root = splitFixture();
  const r = scoped(
    {
      retypes: [
        {
          files: ["settings/rolara/locations/Ashfall.md"],
          typeFrom: "Location",
          typeTo: "Ruin",
          suffix: "-RUIN",
          links: { "settings/rolara/locations/Ashfall.md": ["settings/rolara/locations/Ghost-INDEX.md"] },
        },
      ],
    },
    root
  );
  check("a retype whose rename names a referrer that is not on disk declines the whole entry",
    [r.operations.length, r.declined.length], [0, 1]);
  check("with the missing referrer named",
    String(obj(r.declined[0]).reason).includes("settings/rolara/locations/Ghost-INDEX.md"), true);
  rmSync(root, { recursive: true, force: true });
}

{
  // Plan-aware in the same way planEntityRenames and planSplitFolders are: the
  // file a retypes entry names can be one an earlier-ranked operation in the
  // SAME scope puts there. relocate-path (rank 1) runs before normalize-type
  // (rank 4), so this is legitimate rather than a typo.
  const root = splitFixture();
  const r = scoped(
    {
      pathMoves: [
        { from: "settings/rolara/locations/Ashfall.md", to: "settings/rolara/ruins/Ashfall.md", reason: "x" },
      ],
      retypes: [{ files: ["settings/rolara/ruins/Ashfall.md"], typeFrom: "Location", typeTo: "Ruin" }],
    },
    root
  );
  check("a retype of a file the same plan moves into place plans rather than declines",
    [kindsOf(r.operations), r.declined.length], [["relocate-path", "normalize-type"], 0]);
  rmSync(root, { recursive: true, force: true });
}

{
  // The property the brief calls out explicitly: one retypes entry can name
  // several files and emit up to two operations per file, and every one of
  // them has to carry the SAME group id, because the group is the skip unit an
  // ignored source collapses to. Two files, each retyped and renamed, is four
  // operations sharing one id.
  const root = splitFixture();
  const r = scoped(
    {
      retypes: [
        {
          files: ["settings/rolara/locations/Ashfall.md", "settings/rolara/locations/Karsk.md"],
          typeFrom: "Location",
          typeTo: "Ruin",
          suffix: "-RUIN",
        },
      ],
    },
    root
  );
  // buildScopedPlan sorts the finished plan into APPLY_ORDER, so both
  // normalize-type operations land ahead of both rename-with-link-rewrite ones
  // rather than interleaved per file; the sort is stable, so each pair keeps
  // the per-file emission order within its own rank. Four operations either
  // way, and each file's normalize-type still precedes its own rename.
  check("a multi-file retype plans two operations per file",
    kindsOf(r.operations),
    ["normalize-type", "normalize-type", "rename-with-link-rewrite", "rename-with-link-rewrite"]);
  check("and every operation from the one entry shares the one group id",
    r.operations.map((o) => list(o.groups)),
    [["retypes[0]"], ["retypes[0]"], ["retypes[0]"], ["retypes[0]"]]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  const r = scoped(
    { frontmatterRepairs: [{ file: "settings/rolara/locations/Ghost.md", insert: [] }] },
    root
  );
  check("a repair naming a file that is not on disk is declined at plan time",
    [r.operations.length, r.declined.length], [0, 1]);
  check("and the reason names the path",
    String(obj(r.declined[0]).reason).includes("settings/rolara/locations/Ghost.md"), true);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  const r = scoped(
    { frontmatterRepairs: [{ file: "settings/rolara/locations/Ashfall.md", insert: [] }] },
    root
  );
  check("a repair scope stamps its entry's group id",
    r.operations.map((o) => list(o.groups)), [["frontmatterRepairs[0]"]]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  const r = scoped(
    {
      suffixRenames: [
        { file: "settings/rolara/locations/Ghost-TIMELINE.md", to: "settings/rolara/locations/Ghost-HISTORY.md" },
      ],
    },
    root
  );
  check("a suffix rename whose source is not on disk is declined at plan time",
    [r.operations.length, r.declined.length], [0, 1]);
  check("and the reason names the path",
    String(obj(r.declined[0]).reason).includes("settings/rolara/locations/Ghost-TIMELINE.md"), true);
  rmSync(root, { recursive: true, force: true });
}

{
  // Modelled on planEntityRenames's own referrer check: dropping a missing
  // referrer instead of declining the whole entry would rename the file and
  // leave the wikilink the DM named pointing at a filename that is gone.
  const root = splitFixture();
  const r = scoped(
    {
      suffixRenames: [
        {
          file: "settings/rolara/locations/Ashfall.md",
          to: "settings/rolara/locations/Ashfall-HISTORY.md",
          links: ["settings/rolara/locations/Ghost-INDEX.md"],
        },
      ],
    },
    root
  );
  check("a suffix rename whose referrer is not on disk declines the whole entry",
    [r.operations.length, r.declined.length], [0, 1]);
  check("with the missing referrer named",
    String(obj(r.declined[0]).reason).includes("settings/rolara/locations/Ghost-INDEX.md"), true);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  const r = scoped(
    {
      suffixRenames: [
        {
          file: "settings/rolara/locations/Ashfall.md",
          to: "settings/rolara/locations/Ashfall-HISTORY.md",
          links: ["settings/rolara/locations/Locations-INDEX.md"],
        },
      ],
    },
    root
  );
  check("a suffix rename with a real referrer plans and stamps its group id",
    [kindsOf(r.operations), r.operations.map((o) => list(o.groups))],
    [["rename-with-link-rewrite"], [["suffixRenames[0]"]]]);
  rmSync(root, { recursive: true, force: true });
}

console.log("\n=== scoped plans: prose paths ===");

{
  const r = scoped({
    prosePathUpdates: [
      {
        file: "CLAUDE.md",
        replacements: [
          { from: "rolara-kb/", to: "settings/rolara/" },
          { from: "rolara-kb/sessions/", to: "session-reports/rolara/karsk/" },
        ],
      },
    ],
  });
  check("a prose scope plans one update-prose-paths", kindsOf(r.operations), ["update-prose-paths"]);
  // Longest first, regardless of the order the DM listed them. A shorter path
  // that is a prefix of a longer one would otherwise consume it.
  check("replacements are sorted longest source first",
    list(obj(r.operations[0]).replacements).map((x) => obj(x).from),
    ["rolara-kb/sessions/", "rolara-kb/"]);
  check("and the entry's group id is stamped, because the entry is the skip unit",
    r.operations.map((o) => list(o.groups)), [["prosePathUpdates[0]"]]);
  check("the file being edited is carried as from, with no to, because nothing moves",
    [obj(r.operations[0]).from, obj(r.operations[0]).to], ["CLAUDE.md", undefined]);
}

{
  const r = scoped({ prosePathUpdates: [{ file: "CLAUDE.md", replacements: [{ from: "", to: "x" }] }] });
  check("an entry with no usable replacement is declined rather than planned as a no-op",
    [r.operations.length, r.declined.map((d) => d.op)], [0, ["update-prose-paths"]]);
}

{
  // Verified corrupting (task-7 review, Minor 2): applied in sequence, this
  // exact pair turns "Reports live in rolara-kb/sessions/ today." into
  // "Reports live in session-docs/rolara/ today.", not the two independent
  // substitutions the DM wrote, because the first replacement's own `to`
  // contains the second's `from`. A DIFFERENT hazard from the prefix case the
  // longest-first sort handles just above: sorting does nothing for this one,
  // and the sort order (longest `from` first) is exactly the order that lets it
  // happen, since it puts the feeding replacement first.
  const r = scoped({
    prosePathUpdates: [
      {
        file: "CLAUDE.md",
        replacements: [
          { from: "rolara-kb/sessions/", to: "session-reports/rolara/" },
          { from: "reports/", to: "docs/" },
        ],
      },
    ],
  });
  check("a replacement whose destination feeds a later replacement's source declines rather than corrupts",
    [r.operations.length, r.declined.map((d) => d.op)], [0, ["update-prose-paths"]]);
  check("and the reason names both replacements",
    [
      String(obj(r.declined[0]).reason).includes("rolara-kb/sessions/"),
      String(obj(r.declined[0]).reason).includes("reports/"),
    ],
    [true, true]);
}

{
  // The prefix case (shorter `from` eating a longer one) must NOT be mistaken
  // for a cascade. Same replacement pair as the very first case in this
  // section, sorted the same way, and it still plans: neither `to` contains
  // the other's `from`.
  const r = scoped({
    prosePathUpdates: [
      {
        file: "CLAUDE.md",
        replacements: [
          { from: "rolara-kb/", to: "settings/rolara/" },
          { from: "rolara-kb/sessions/", to: "session-reports/rolara/karsk/" },
        ],
      },
    ],
  });
  check("the prefix case sorting already handles is not flagged as a cascade",
    [r.operations.length, r.declined.length], [1, 0]);
}

{
  const root = splitFixture();
  const r = scoped({ prosePathUpdates: [{ file: "CLAUDE.md", replacements: [{ from: "a/", to: "b/" }] }] }, root);
  check("a prose entry naming a file that is not on disk is declined at plan time",
    [r.operations.length, r.declined.length], [0, 1]);
  check("and the reason names the path", String(obj(r.declined[0]).reason).includes("CLAUDE.md"), true);
  rmSync(root, { recursive: true, force: true });
}

{
  // A FILE rather than merely a path, which is why the check is the file-ness
  // variant. This operation edits its target in place through readFileSync and
  // writeFileSync, so a directory sitting at that path cannot execute either, and
  // a bare existence check answers yes for it.
  const root = splitFixture();
  const r = scoped(
    { prosePathUpdates: [{ file: "settings/rolara/locations", replacements: [{ from: "a/", to: "b/" }] }] },
    root
  );
  check("a prose entry naming a directory is declined too, not planned as an edit",
    [r.operations.length, r.declined.length], [0, 1]);
  rmSync(root, { recursive: true, force: true });
}

{
  // Plan-aware, the same way every other named-path check in this file is: the
  // document a prose entry names can be one an earlier-ranked operation in the
  // SAME scope puts there. update-prose-paths ranks last of the content kinds,
  // so every operation a scoped plan can hold runs before it. A bare existsSync
  // here would decline this as a typo for a file the relocate-path creates.
  const root = splitFixture();
  const r = scoped(
    {
      pathMoves: [
        { from: "settings/rolara/locations/Ashfall.md", to: "docs/Conventions.md", reason: "x" },
      ],
      prosePathUpdates: [
        { file: "docs/Conventions.md", replacements: [{ from: "rolara-kb/", to: "settings/rolara/" }] },
      ],
    },
    root
  );
  check("a prose entry naming a file the same plan moves into place plans rather than declines",
    [kindsOf(r.operations), r.declined.length], [["relocate-path", "update-prose-paths"], 0]);
  rmSync(root, { recursive: true, force: true });
}

console.log("\n=== scoped plans: ignored sources reach the proposal ===");

{
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-scoped-ign-"));
  writeAt(root, ".gitignore", "settings/rolara/drafts/\n");
  writeAt(root, "settings/rolara/drafts/Sketch.md", "---\ntype: Concept\n---\n\nBody.\n");
  commitFixture(root);

  const r = scoped(
    {
      pathMoves: [
        { from: "settings/rolara/drafts/Sketch.md", to: "settings/rolara/Sketch.md", reason: "DM scope" },
      ],
    },
    root
  );
  // An ignored file is outside the snapshot, so moving it is unrecoverable.
  // The apply half already skips it. Surfacing it as a declined item is what
  // puts it in front of the DM in the proposal, with the one action that makes
  // it movable: un-ignore it, so it lands in the snapshot.
  check("an ignored source is declined in the plan, not left to be skipped later",
    r.declined.some((d) => d.target === "settings/rolara/drafts/Sketch.md"), true);
  check("and the reason names un-ignoring as the way forward",
    /gitignore|un-ignore|ignored/i.test(
      String(obj(r.declined.find((d) => d.target === "settings/rolara/drafts/Sketch.md")).reason)),
    true);
  check("the operation itself is not planned", r.operations.length, 0);
  // The prechecks that ship with the plan describe the operations that SURVIVED
  // the pass. A row naming an operation the plan no longer carries would be an
  // ignored verdict about work nobody can approve, and findDestinationCollisions
  // would go on ranking a destination against an operation that will never run.
  check("and the prechecks shipped with the plan describe what is left, not what was declined",
    [list(r.prechecks.ignored).length, r.prechecks.ok], [0, true]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // THE UNIT. One scope entry emits several operations, and the apply half skips
  // every one of them when any one names a git-ignored source; see groupsOf for
  // the two measured defects that rule exists to prevent. The plan-side decline
  // has to use the same unit, or it moves that defect from the apply half into
  // the plan half: an absorb declined for its ignored file while its paired parent
  // rebuild stays in the plan would run that rebuild, dropping [[Misc-INDEX]] out
  // of the parent index while the folder holding that very index is still on disk.
  //
  // The rebuild names no ignored source of its own. Nothing but the shared group
  // id connects it to the one that does.
  const root = absorbFixture();
  writeAt(root, "settings/rolara/misc/Hidden.md", "---\ntype: Concept\n---\n\nA draft kept out of git.\n");
  writeAt(root, ".gitignore", "settings/rolara/misc/Hidden.md\n");
  commitFixture(root);
  const r = scoped({ absorbFolders: [{ folder: "settings/rolara/misc" }] }, root);

  check("an entry emitting several operations is declined whole, not just the one naming the ignored file",
    kindsOf(r.operations), []);
  check("and every operation that entry emitted reaches the DM as a declined item",
    r.declined.map((d) => [d.op, d.target]),
    [["absorb-folder", "settings/rolara/misc"],
     ["rebuild-index", "settings/rolara/Rolara-INDEX.md"]]);
  check("the sibling that names no ignored source of its own says which entry took it",
    [/absorbFolders\[0\]/.test(String(obj(r.declined[1]).reason)),
     /Hidden\.md/.test(String(obj(r.declined[1]).reason))],
    [true, true]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // The other half of the same unit, and the harder one. An operation belonging to
  // BOTH a declined entry and one that survives is KEPT, because dropping it would
  // leave the entry that DID go ahead holding a dead wikilink; that asymmetry is
  // argued at groupsOf and applyPlan carries a note disclosing what it costs. That
  // note can no longer fire for a scoped plan, because the declined operations never
  // reach the apply half to be compared against, so the disclosure has to be here or
  // nowhere. Two sibling absorbs into one parent share one deduped parent rebuild,
  // which is exactly that shape.
  const root = absorbFixture();
  writeAt(root, "settings/rolara/misc/Hidden.md", "---\ntype: Concept\n---\n\nA draft kept out of git.\n");
  writeAt(root, "settings/rolara/lore/Lore-INDEX.md", "---\ntype: Index\n---\n\n- [[Tale]]\n");
  writeAt(root, "settings/rolara/lore/Tale.md", "---\ntype: Concept\n---\n\nBody.\n");
  writeAt(root, ".gitignore", "settings/rolara/misc/Hidden.md\n");
  commitFixture(root);
  const r = scoped(
    { absorbFolders: [{ folder: "settings/rolara/misc" }, { folder: "settings/rolara/lore" }] },
    root
  );

  check("an operation two entries share survives one of them being declined",
    [kindsOf(r.operations), r.declined.map((d) => [d.op, d.target])],
    [["absorb-folder", "rebuild-index"], [["absorb-folder", "settings/rolara/misc"]]]);
  check("and the decline discloses the shared operation that still runs, and what it costs",
    [/rebuild-index settings\/rolara\/Rolara-INDEX\.md/.test(String(obj(r.declined[0]).reason)),
     /no longer linked from that index/.test(String(obj(r.declined[0]).reason))],
    [true, true]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

console.log("\n=== scoped plans: setting lifecycle ===");

// HONEST FRAMING FOR THIS WHOLE SECTION. Nothing in the plugin can create a
// second setting yet; that is a later release. So the multi-prong cases below
// run against this literal settings array and against temporary fixtures, never
// against a project a DM could have today, and the two operations a reference
// consumer could actually exercise are the single-setting ones: a rename and a
// campaign retirement. Read the coverage that way.
const LIFECYCLE_SETTINGS = [
  {
    name: "rolara",
    kbRoot: "settings/rolara",
    homebrewRoot: "homebrew/rolara",
    sessionReportsRoot: "session-reports/rolara",
    campaigns: ["karsk", "ember"],
  },
];

// The default root does not exist, which makes the plan-time path checks answer
// UNDETERMINED and stand aside; see namedPathMissing. That is deliberate for the
// shape cases here, which are about which operations a scope resolves to. The
// fixture-backed cases further down pass a real root, and they are the only ones
// that exercise those checks at all.
const lifecycle = (scope, projectRoot = "C:/proj") =>
  buildScopedPlan({ projectRoot, settings: LIFECYCLE_SETTINGS, baseRules: BASE_RULES, scope });

function lifecycleFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-lifecycle-"));
  const w = (rel, body) => writeAt(root, rel, body);
  w("settings/rolara/Rolara-INDEX.md", "---\ntype: Index\n---\n\n- [[Tale]]\n");
  w("settings/rolara/Tale.md", "---\ntype: Concept\n---\n\nBody.\n");
  // The vault, at its canonical place INSIDE kbRoot. See the rename case above.
  w("settings/rolara/.obsidian/app.json", "{}\n");
  w("homebrew/rolara/Homebrew-INDEX.md", "---\ntype: Index\n---\n\n- [[Blade]]\n");
  w("homebrew/rolara/Blade.md", "---\ntype: Item\n---\n\nBody.\n");
  w("session-reports/rolara/karsk/2026-01-01-One-REPORT.md", "---\ntype: Session Report\n---\n\nBody.\n");
  w("session-reports/rolara/ember/2026-02-01-Two-REPORT.md", "---\ntype: Session Report\n---\n\nBody.\n");
  return root;
}

{
  const r = lifecycle({ settingRenames: [{ from: "rolara", to: "rolara-prime" }] });
  check("a setting rename moves all three prongs",
    r.operations.map((o) => [o.from, o.to]),
    [
      ["settings/rolara", "settings/rolara-prime"],
      ["homebrew/rolara", "homebrew/rolara-prime"],
      ["session-reports/rolara", "session-reports/rolara-prime"],
    ]);
  check("each is a prong relocation, not a bare path move",
    kindsOf(r.operations), ["relocate-prong", "relocate-prong", "relocate-prong"]);
  // The Obsidian vault lives at <kbRoot>/.obsidian, inside the root that just
  // moved, so it rides along and needs no operation of its own. Asserted so a
  // future "also move the vault" addition cannot double-move it.
  check("the vault is not moved separately",
    JSON.stringify(r.operations).includes(".obsidian"), false);
}

{
  const r = lifecycle({ settingRenames: [{ from: "nope", to: "x" }] });
  check("renaming a setting that is not in conventions.json is declined",
    [r.operations.length, r.declined.length], [0, 1]);
}

{
  const r = lifecycle({ settingRetirements: [{ setting: "rolara", archiveRoot: "archive" }] });
  check("retiring a setting moves its prongs into the archive",
    r.operations.map((o) => o.to),
    ["archive/rolara/settings", "archive/rolara/homebrew", "archive/rolara/session-reports"]);
}

{
  const r = lifecycle({ campaignRetirements: [{ setting: "rolara", campaign: "karsk", archiveRoot: "archive" }] });
  // Through obj(), for the reason recorded at that helper: with no planner yet
  // this list is empty, and indexing straight into it throws and takes every
  // later case in the file down with it, hiding the very red set that proves
  // the suite can fail. Measured: the brief's own `r.operations[0].from` did
  // exactly that on the first RED run.
  check("retiring a campaign moves one folder",
    [kindsOf(r.operations), obj(r.operations[0]).from, obj(r.operations[0]).to],
    [["relocate-path"], "session-reports/rolara/karsk", "archive/rolara/session-reports/karsk"]);
}

{
  const r = lifecycle({ campaignRetirements: [{ setting: "rolara", campaign: "nope" }] });
  check("retiring a campaign the setting does not list is declined",
    [r.operations.length, r.declined.length], [0, 1]);
}

{
  // THE SKIP UNIT, stamped. Three prong moves out of ONE scope entry have to
  // carry ONE group id, because that is what makes the apply half take them
  // together. Two of a world's three prongs moved is worse than none of them.
  const r = lifecycle({
    settingRenames: [{ from: "rolara", to: "rolara-prime" }],
    settingRetirements: [{ setting: "rolara" }],
  });
  // Both entries plan here, because the root is unusable and the plan-time
  // checks stand aside; the fixture-backed case below is where the retirement
  // is declined for roots the rename already carried away.
  check("every operation a lifecycle entry emits carries its entry's group id",
    r.operations.map((o) => o.groups),
    [
      ["settingRenames[0]"], ["settingRenames[0]"], ["settingRenames[0]"],
      ["settingRetirements[0]"], ["settingRetirements[0]"], ["settingRetirements[0]"],
    ]);
  // Same rank, so the tie falls to source order and the renames come first. The
  // ordering itself is not what this pins: it is that the two keys stay DISTINCT
  // skip units, so declining one never takes the other's operations with it.
  check("and each entry's operations are its own unit, not one shared id",
    new Set(r.operations.flatMap((o) => o.groups)).size, 2);
}

{
  // THE GROUP UNIT AS A REGRESSION, against a real repository. One of the three
  // prong roots is git-ignored, so the pre-migration snapshot does not contain
  // it and moving it could not be undone. The whole entry has to go, all three
  // moves: a world whose knowledge base and session reports moved while its
  // homebrew stayed behind matches neither its old shape nor the approved one,
  // and conventions.json would then point two roots one way and one the other.
  //
  // Non-vacuous by measurement rather than by assertion: with the `groups` stamp
  // removed from the emitted operations, this case reports 2 operations kept and
  // 1 declined instead of 0 and 3.
  const root = lifecycleFixture();
  writeAt(root, ".gitignore", "homebrew/rolara/\n");
  commitFixture(root);
  const r = lifecycle({ settingRenames: [{ from: "rolara", to: "rolara-prime" }] }, root);
  check("one git-ignored prong root declines all three moves, not two of them",
    [r.operations.length, r.declined.length], [0, 3]);
  check("and every declined row names the entry that took it and the ignored root",
    r.declined.map((d) => [
      d.op,
      /settingRenames\[0\]/.test(String(d.reason)),
      /homebrew\/rolara/.test(String(d.reason)),
    ]),
    [["relocate-prong", true, true], ["relocate-prong", true, true], ["relocate-prong", true, true]]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // A root conventions.json records but that is not on disk. A world with no
  // homebrew folder yet is ordinary, so this is not a reason to refuse the whole
  // rename: there is simply nothing to move for that prong. It is still reported
  // rather than silently dropped, because silence about a whole prong of a world
  // reads as "it moved".
  const root = lifecycleFixture();
  rmSync(path.join(root, "homebrew"), { recursive: true, force: true });
  commitFixture(root);
  const r = lifecycle({ settingRenames: [{ from: "rolara", to: "rolara-prime" }] }, root);
  check("a prong root that is not on disk is not planned, and the other two still are",
    [r.operations.map((o) => o.from), r.declined.map((d) => d.target)],
    [["settings/rolara", "session-reports/rolara"], ["homebrew/rolara"]]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // Renaming and retiring one setting in a single scope. The rename runs first
  // and carries all three roots away, so the retirement's own sources are gone
  // by the time it would run. Without the plan-time check this plans two `git
  // mv`s per prong from the same source: the first succeeds, the second fails
  // after the snapshot, and conventions.json is then updated to describe an
  // archive that half happened.
  const root = lifecycleFixture();
  commitFixture(root);
  const r = lifecycle(
    {
      settingRenames: [{ from: "rolara", to: "rolara-prime" }],
      settingRetirements: [{ setting: "rolara" }],
    },
    root
  );
  check("a retirement whose roots an earlier rename already moved is declined, not planned twice",
    [r.operations.map((o) => o.to), r.declined.map((d) => d.target)],
    [
      ["settings/rolara-prime", "homebrew/rolara-prime", "session-reports/rolara-prime"],
      ["settings/rolara", "homebrew/rolara", "session-reports/rolara"],
    ]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // RENAMING ONE SETTING ONTO ANOTHER, which is the most destructive scope this
  // section can be handed: `git mv settings/rolara settings/karsk` with the
  // destination already a directory does not fail, it moves the source INSIDE
  // the destination, and conventions.json would then carry two settings with one
  // name, which settingNamed resolves to whichever comes first.
  //
  // No new guard for it. The destination collision precheck already refuses,
  // because relocate-prong is not in DESTINATION_MAY_EXIST, and applyPlan
  // refuses a plan whose prechecks did not pass. Pinned here so that stays true.
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-lifecycle-collide-"));
  const two = ["rolara", "karsk"].map((n) => ({
    name: n,
    kbRoot: `settings/${n}`,
    homebrewRoot: `homebrew/${n}`,
    sessionReportsRoot: `session-reports/${n}`,
    campaigns: ["c1"],
  }));
  for (const n of ["rolara", "karsk"]) {
    writeAt(root, `settings/${n}/A.md`, "---\ntype: Concept\n---\n\nBody.\n");
    writeAt(root, `homebrew/${n}/B.md`, "---\ntype: Item\n---\n\nBody.\n");
    writeAt(root, `session-reports/${n}/c1/R.md`, "---\ntype: Session Report\n---\n\nBody.\n");
  }
  commitFixture(root);
  const r = buildScopedPlan({
    projectRoot: root,
    settings: two,
    baseRules: BASE_RULES,
    scope: { settingRenames: [{ from: "rolara", to: "karsk" }] },
  });
  check("renaming one setting onto another is refused by the prechecks, not applied",
    [r.prechecks.ok, r.prechecks.collisions.map((c) => [c.kind, c.to])],
    [false, [["on-disk", "settings/karsk"], ["on-disk", "homebrew/karsk"], ["on-disk", "session-reports/karsk"]]]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // settings[].campaigns is a cache, not the authority, so a campaign it lists
  // may have no folder. Moving nothing is a plan that fails after the snapshot.
  const root = lifecycleFixture();
  rmSync(path.join(root, "session-reports", "rolara", "ember"), { recursive: true, force: true });
  commitFixture(root);
  const r = lifecycle({ campaignRetirements: [{ setting: "rolara", campaign: "ember" }] }, root);
  check("a listed campaign with no folder on disk is declined rather than planned",
    [r.operations.length, r.declined.map((d) => [d.op, d.target])],
    [0, [["relocate-path", "session-reports/rolara/ember"]]]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

console.log("\n=== setting split: the boundary cost ===");

// THE SAME HONEST FRAMING as the lifecycle section above. Nothing in the plugin
// creates a setting yet, so every case below runs against a temporary fixture
// and the literal LIFECYCLE_SETTINGS array, never against a project a DM could
// have today. Read the coverage that way.
//
// Three articles in one setting, wired so that both directions of the boundary
// are reachable: Ashfall links out to two neighbours, and both of them link back.
function splitSettingFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-setsplit-"));
  const w = (rel, body) => writeAt(root, rel, body);
  w("settings/rolara/Ashfall.md", "---\ntype: Location\n---\n\nNorth of [[Karsk]], allied with [[Thoric]].\n");
  w("settings/rolara/Karsk.md", "---\ntype: Location\n---\n\nSouth of [[Ashfall]].\n");
  w("settings/rolara/Thoric.md", "---\ntype: Person\n---\n\nLives in [[Ashfall]].\n");
  return root;
}

{
  const root = splitSettingFixture();
  const links = crossBoundaryLinks({
    projectRoot: root,
    movingFiles: ["settings/rolara/Ashfall.md"],
    stayingRoots: ["settings/rolara"],
  });
  const outgoing = links.filter((l) => l.direction === "outgoing").map((l) => l.target).sort();
  const incoming = links.filter((l) => l.direction === "incoming").map((l) => l.file).sort();
  check("outgoing links from the moving article are enumerated", outgoing, ["Karsk", "Thoric"]);
  check("incoming links from articles that stay are enumerated too",
    incoming, ["settings/rolara/Karsk.md", "settings/rolara/Thoric.md"]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  const root = splitSettingFixture();
  const links = crossBoundaryLinks({
    projectRoot: root,
    movingFiles: ["settings/rolara/Ashfall.md", "settings/rolara/Karsk.md"],
    stayingRoots: ["settings/rolara"],
  });
  // Ashfall and Karsk link to each other and both move, so that link does not
  // cross anything. Counting it would inflate the cost the DM is shown and make
  // a clean split look expensive, which is the direction that talks them out of
  // a migration that was fine.
  check("a link between two articles that both move is not a boundary crossing",
    links.some((l) => l.target === "Karsk" || (l.file || "").endsWith("Karsk.md")), false);
  check("the genuine crossings survive",
    links.filter((l) => l.direction === "outgoing").map((l) => l.target), ["Thoric"]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // WHAT wikilinkTargetsIn ACTUALLY RETURNS, which decides how the comparison has
  // to be written: the target as WRITTEN, not a bare stem. A path prefix, an
  // extension, and an anchor all survive it; only the display half is already
  // gone. So the stem is taken the way assertLinkIntegrity takes it, through
  // dissectTarget, and every one of these forms names the one article that moves.
  //
  // Two of the bracketed pairs below are not article links at all and must not be
  // counted: [[#Trade]] is a link into the file's own headings, and [[Ashfall.png]]
  // names an attachment. The fenced block is not link-bearing text, on the same
  // terms the rewriter and the link-integrity rail leave fenced examples alone.
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-setsplit-forms-"));
  writeAt(root, "settings/rolara/Ashfall.md", "---\ntype: Location\n---\n\nBody.\n");
  writeAt(
    root,
    "settings/rolara/Karsk.md",
    "---\ntype: Location\n---\n\n" +
      "[[Ashfall.md]], [[people/Ashfall]], [[Ashfall#Trade]], [[Ashfall|the ash city]].\n\n" +
      "Neither of these is a link to an article: [[#Trade]], [[Ashfall.png]].\n\n" +
      "```\n[[Ashfall]]\n```\n"
  );
  const links = crossBoundaryLinks({
    projectRoot: root,
    movingFiles: ["settings/rolara/Ashfall.md"],
    stayingRoots: ["settings/rolara"],
  });
  check("every written form of a link to a moving article counts, and nothing else does",
    links.map((l) => [l.direction, l.target]),
    [
      ["incoming", "Ashfall.md"],
      ["incoming", "people/Ashfall"],
      ["incoming", "Ashfall#Trade"],
      ["incoming", "Ashfall"],
    ]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // The plan phase's read-only contract, on the one function here that walks a
  // whole knowledge base reading files.
  const root = splitSettingFixture();
  execFileSync("git", ["init", "-q"], { cwd: root });
  const before = snapshotTree(root);
  crossBoundaryLinks({
    projectRoot: root,
    movingFiles: ["settings/rolara/Ashfall.md"],
    stayingRoots: ["settings/rolara"],
  });
  check("crossBoundaryLinks mutates nothing", snapshotTree(root), before);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

const splitScope = (over) => ({
  settingSplits: [
    { from: "rolara", name: "ashlands", kbRoot: "settings/ashlands", files: [], ...over },
  ],
});

{
  const root = splitSettingFixture();
  const r = lifecycle(splitScope({ files: ["settings/rolara/Ashfall.md"] }), root);
  check("a split plans one move per file", kindsOf(r.operations), ["relocate-path"]);
  check("to the new setting's kbRoot", obj(r.operations[0]).to, "settings/ashlands/Ashfall.md");
  // ONE group id for every move the entry emits. The cost the DM approved was
  // computed from the set that moves, and a link between two articles that BOTH
  // move was excluded from it; leave one of them behind and that link becomes a
  // crossing nobody was shown. So a split moves all of its articles or none.
  check("and every move carries the entry's own group id",
    obj(r.operations[0]).groups, ["settingSplits[0]"]);
  // The cost lands in declined, which is what renderProposal prints under
  // "Declined" and therefore what the DM reads before approving. Putting it in
  // the report instead would tell them after it had already happened.
  check("every boundary crossing is declined into the proposal, both directions",
    r.declined.map((d) => [d.op, d.target]),
    [
      ["cross-boundary-link", "settings/rolara/Ashfall.md -> [[Karsk]]"],
      ["cross-boundary-link", "settings/rolara/Ashfall.md -> [[Thoric]]"],
      ["cross-boundary-link", "settings/rolara/Karsk.md -> [[Ashfall]]"],
      ["cross-boundary-link", "settings/rolara/Thoric.md -> [[Ashfall]]"],
    ]);
  // Nothing repairs them, and the row says so. Rewriting the article text under a
  // structural approval would be chronicler's work done without chronicler's gate.
  check("and the row says the link is reported rather than repaired",
    /the DM's to change/.test(String(obj(r.declined[0]).reason)), true);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

// THE SAME SETTING, WITH ALL THREE OF ITS PRONGS ON DISK. rolara's knowledge base
// is not the whole of rolara: prongRootsOf has said so since the settings array was
// written, and assertLinkIntegrity, the rail that decides whether a finished run may
// commit, resolves against all three roots. A session report or a homebrew entry that
// names a moving article loses that link on exactly the terms an article in the
// knowledge base does, so it is the same crossing and costs the DM the same thing.
function splitProngFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-setsplit-prongs-"));
  const w = (rel, body) => writeAt(root, rel, body);
  w("settings/rolara/Ashfall.md", "---\ntype: Location\n---\n\nNorth of [[Karsk]].\n");
  w("settings/rolara/Karsk.md", "---\ntype: Location\n---\n\nSouth of [[Ashfall]].\n");
  w("homebrew/rolara/Blade.md", "---\ntype: Item\n---\n\nForged in [[Ashfall]].\n");
  w(
    "session-reports/rolara/karsk/2026-01-01-One-REPORT.md",
    "---\ntype: Session Report\n---\n\nThe party reached [[Ashfall]] at dusk.\n"
  );
  return root;
}

{
  // THE EXPORTED SIGNATURE TAKES THE ROOT LIST, not one root, so that a caller
  // hands it prongRootsOf and cannot accidentally measure a third of a setting.
  // A root repeated, which is what a setting whose prongs nest inside one another
  // produces, is walked once: assertLinkIntegrity deduplicates its file list for
  // the same reason, and a file counted twice would double a row in the proposal.
  const root = splitProngFixture();
  const links = crossBoundaryLinks({
    projectRoot: root,
    movingFiles: ["settings/rolara/Ashfall.md"],
    stayingRoots: ["settings/rolara", "homebrew/rolara", "session-reports/rolara", "settings/rolara"],
  });
  check("crossBoundaryLinks enumerates every root it is handed, reading each file once",
    links.map((l) => [l.direction, l.file]),
    [
      ["outgoing", "settings/rolara/Ashfall.md"],
      ["incoming", "settings/rolara/Karsk.md"],
      ["incoming", "homebrew/rolara/Blade.md"],
      ["incoming", "session-reports/rolara/karsk/2026-01-01-One-REPORT.md"],
    ]);
  check("and no roots at all is no crossings, rather than a walk of the whole project",
    crossBoundaryLinks({ projectRoot: root, movingFiles: ["settings/rolara/Ashfall.md"], stayingRoots: [] }),
    []);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // debrief tells session reports to cross-reference aggressively, and reports
  // accumulate one per session against the locations and people a campaign
  // touches. Enumerating the knowledge base alone would leave every one of those
  // references out of the number the DM approves the split on, and understating
  // that number is the one direction of error this operation exists to avoid.
  const root = splitProngFixture();
  const r = lifecycle(splitScope({ files: ["settings/rolara/Ashfall.md"] }), root);
  check("a session report and a homebrew entry linking a moving article are crossings too",
    r.declined.map((d) => [d.op, d.target]),
    [
      ["cross-boundary-link", "settings/rolara/Ashfall.md -> [[Karsk]]"],
      ["cross-boundary-link", "settings/rolara/Karsk.md -> [[Ashfall]]"],
      ["cross-boundary-link", "homebrew/rolara/Blade.md -> [[Ashfall]]"],
      ["cross-boundary-link", "session-reports/rolara/karsk/2026-01-01-One-REPORT.md -> [[Ashfall]]"],
    ]);
  check("and each of those reads as an article that stays losing a link that moves",
    r.declined
      .filter((d) => /Blade\.md|REPORT\.md/.test(String(d.target)))
      .map((d) => /stays in rolara and links to \[\[Ashfall\]\], which/.test(String(d.reason))),
    [true, true]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // A LINK THAT WAS ALREADY DEAD. A crossing is a link that resolves today and
  // will not resolve after; [[NoSuchArticle]] resolves nowhere either side of the
  // split, so the split costs nothing there. Counting it would inflate the cost
  // and make a clean split look expensive, which is the same harm the both-move
  // exclusion exists to prevent, and the row would tell the DM that an article
  // they do not have "stays in rolara".
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-setsplit-dead-"));
  writeAt(root, "settings/rolara/Ashfall.md",
    "---\ntype: Location\n---\n\nSee [[NoSuchArticle]] and [[Karsk]].\n");
  writeAt(root, "settings/rolara/Karsk.md", "---\ntype: Location\n---\n\nBody.\n");
  const r = lifecycle(splitScope({ files: ["settings/rolara/Ashfall.md"] }), root);
  check("a link that resolves nowhere today is not a boundary crossing",
    r.declined.map((d) => [d.op, d.target]),
    [["cross-boundary-link", "settings/rolara/Ashfall.md -> [[Karsk]]"]]);
  check("and no row claims the already-dead target stays behind",
    r.declined.some((d) => /NoSuchArticle/.test(`${d.target} ${d.reason}`)), false);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  const root = splitSettingFixture();
  const r = lifecycle(splitScope({ from: "nope", files: ["settings/rolara/Ashfall.md"] }), root);
  check("splitting a setting that is not in conventions.json is declined",
    [r.operations.length, r.declined.length], [0, 1]);
  const noName = lifecycle(splitScope({ name: "", files: ["settings/rolara/Ashfall.md"] }), root);
  check("and so is a split with no name for the world it creates",
    [noName.operations.length, noName.declined.length], [0, 1]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // A name conventions.json already records. conventionsAfterScope keeps one
  // entry per name and refuses to add a second, so planning the moves anyway
  // would carry the articles across and leave the world they landed in
  // unrecorded: unattributed to the sweep, unresolvable to /scribe and /log.
  const root = splitSettingFixture();
  const r = lifecycle(splitScope({ name: "rolara", kbRoot: "settings/rolara-two", files: ["settings/rolara/Ashfall.md"] }), root);
  check("splitting into a name a setting already has is declined",
    [r.operations.length, r.declined.map((d) => [d.op, d.target])],
    [0, [["relocate-path", "rolara"]]]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // The new knowledge base inside the old one, or at the very same path.
  // settingOwning resolves an article to whichever setting claims it first, so
  // two roots nested one inside the other leave every article under the inner one
  // claimed by both; identical roots would move each file onto itself.
  const root = splitSettingFixture();
  const nested = lifecycle(splitScope({ kbRoot: "settings/rolara/ashlands", files: ["settings/rolara/Ashfall.md"] }), root);
  check("a new knowledge base nested inside the source setting's is declined",
    [nested.operations.length, nested.declined.map((d) => d.target)], [0, ["settings/rolara/ashlands"]]);
  const same = lifecycle(splitScope({ kbRoot: "settings/rolara", files: ["settings/rolara/Ashfall.md"] }), root);
  check("and so is one at the very same path",
    [same.operations.length, same.declined.map((d) => d.target)], [0, ["settings/rolara"]]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // A file outside the knowledge base being divided. A split's destination is the
  // new kbRoot, so a homebrew entry sent there would be filed under the wrong
  // prong of the world it arrived in; it is refused as a MOVE and stays exactly
  // where it is.
  //
  // THE ASSERTION USED TO FILTER TO relocate-path AND STOP THERE, and that is why
  // it passed while the cost was wrong: this fixture's Blade.md carries
  // `Forged in [[Ashfall]]`, so once the move is refused Blade stays behind and
  // loses a link to an article that moves, which is an incoming crossing on the
  // same terms as any other. The old expectation was silent about it, and the
  // walk, reading kbRoot alone, never produced it. Both rows are asserted now, so
  // narrowing the walk again fails here as well as in the prong case above.
  const root = splitSettingFixture();
  writeAt(root, "homebrew/rolara/Blade.md", "---\ntype: Item\n---\n\nForged in [[Ashfall]].\n");
  const r = lifecycle(
    splitScope({ files: ["homebrew/rolara/Blade.md", "settings/rolara/Ashfall.md"] }),
    root
  );
  check("a file outside the source setting's knowledge base is declined, and the rest still move",
    [r.operations.map((o) => o.from), r.declined.map((d) => [d.op, d.target])],
    [
      ["settings/rolara/Ashfall.md"],
      [
        ["relocate-path", "homebrew/rolara/Blade.md"],
        ["cross-boundary-link", "settings/rolara/Ashfall.md -> [[Karsk]]"],
        ["cross-boundary-link", "settings/rolara/Ashfall.md -> [[Thoric]]"],
        ["cross-boundary-link", "settings/rolara/Karsk.md -> [[Ashfall]]"],
        ["cross-boundary-link", "settings/rolara/Thoric.md -> [[Ashfall]]"],
        ["cross-boundary-link", "homebrew/rolara/Blade.md -> [[Ashfall]]"],
      ],
    ]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // A typo in a filename. Without the check the plan reads clean and then fails
  // on `git mv` after the snapshot; and the article that IS at that stem would
  // have had every link into it counted as a crossing that never happens.
  const root = splitSettingFixture();
  const r = lifecycle(splitScope({ files: ["settings/rolara/notes/Karsk.md"] }), root);
  check("a file that is not there is declined, and no crossing is reported for it",
    [r.operations.length, r.declined.map((d) => [d.op, d.target])],
    [0, [["relocate-path", "settings/rolara/notes/Karsk.md"]]]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // The destination is the new kbRoot plus the BASENAME, so two articles that sat
  // in different subfolders under one basename aim at one path. No new guard for
  // it: findDestinationCollisions already refuses, because relocate-path is not in
  // DESTINATION_MAY_EXIST, and applyPlan refuses a plan whose prechecks did not
  // pass. Pinned here so that stays true.
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-setsplit-flat-"));
  writeAt(root, "settings/rolara/north/Keep.md", "---\ntype: Location\n---\n\nBody.\n");
  writeAt(root, "settings/rolara/south/Keep.md", "---\ntype: Location\n---\n\nBody.\n");
  const r = lifecycle(
    splitScope({ files: ["settings/rolara/north/Keep.md", "settings/rolara/south/Keep.md"] }),
    root
  );
  check("two articles flattening onto one destination are refused by the prechecks",
    [r.operations.map((o) => o.to), r.prechecks.ok, r.prechecks.collisions.map((c) => [c.kind, c.b])],
    [
      ["settings/ashlands/Keep.md", "settings/ashlands/Keep.md"],
      false,
      [["in-plan", "settings/ashlands/Keep.md"]],
    ]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // THE GROUP UNIT AS A REGRESSION, against a real repository. One article is
  // git-ignored, so the pre-migration snapshot does not contain it and moving it
  // could not be undone. The whole entry goes, both moves: the cost the DM read
  // excluded the Ashfall-to-Thoric link because both of them were moving, and
  // leaving Thoric behind turns that into a crossing they were never shown.
  //
  // The cross-boundary rows this entry already pushed stay in the declined list.
  // They cannot be withdrawn from here: prechecks.ignored is computed from the
  // FINISHED plan, after every planner has run, so the planner that reported the
  // cost cannot know the entry will be dropped. What the DM reads is a split whose
  // moves are all declined, alongside the crossings it would have cost, which is
  // wordy rather than wrong.
  const root = splitSettingFixture();
  writeAt(root, ".gitignore", "settings/rolara/Thoric.md\n");
  commitFixture(root);
  const r = lifecycle(
    splitScope({ files: ["settings/rolara/Ashfall.md", "settings/rolara/Thoric.md"] }),
    root
  );
  check("one git-ignored article declines the whole split, not just its own move",
    [r.operations.length, r.declined.filter((d) => d.op === "relocate-path").length], [0, 2]);
  check("and every declined move names the entry that took it and the ignored article",
    r.declined
      .filter((d) => d.op === "relocate-path")
      .map((d) => [/settingSplits\[0\]/.test(String(d.reason)), /Thoric\.md/.test(String(d.reason))]),
    [[true, true], [true, true]]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

console.log("\n=== setting merge: two worlds into one vault ===");

// THE SAME HONEST FRAMING as the two sections above. Nothing in the plugin creates
// a second setting yet, so every case below runs against a temporary fixture and the
// literal MERGE_SETTINGS array, never against a project a DM could have today. Read
// the coverage that way.
//
// TWO WHOLE WORLDS, all three prongs of each on disk, with a genuine collision in
// EVERY one of them. A setting is its knowledge base, its homebrew catalogue, and
// its session reports; prongRootsOf has said so since the settings array was
// written. A merge that walked the knowledge base alone would leave the source
// world's homebrew and every session report it ever produced behind, belonging to a
// setting conventions.json has just marked merged, and the fixture is built so that
// narrowing the walk back to one prong fails these cases rather than passing quietly.
function mergeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-setmerge-"));
  const w = (rel, body) => writeAt(root, rel, body);
  // Knowledge bases. Two worlds legitimately holding a Tavern.md is not a mistake;
  // it becomes a collision only when they share a vault.
  w("settings/rolara/Ashfall.md", "---\ntype: Location\n---\n\nBody.\n");
  w("settings/rolara/Tavern.md", "---\ntype: Location\n---\n\nRolara's tavern.\n");
  w("settings/karsk/Emberhold.md", "---\ntype: Location\n---\n\nBody.\n");
  w("settings/karsk/Tavern.md", "---\ntype: Location\n---\n\nKarsk's tavern.\n");
  // The source world's Obsidian vault, at its canonical place inside kbRoot. The
  // target has its own, and a world's vault configuration is not part of its lore.
  w("settings/karsk/.obsidian/app.json", "{}\n");
  // Homebrew catalogues.
  w("homebrew/rolara/Blade.md", "---\ntype: Item\n---\n\nRolara's blade.\n");
  w("homebrew/karsk/Blade.md", "---\ntype: Item\n---\n\nKarsk's blade.\n");
  w("homebrew/karsk/Censer.md", "---\ntype: Item\n---\n\nBody.\n");
  // Session reports, which are NOT a flat file move: a campaign is a FOLDER under
  // sessionReportsRoot, and both of these worlds ran one called deeps.
  w("session-reports/rolara/deeps/2026-01-02-Two-REPORT.md", "---\ntype: Session Report\n---\n\nBody.\n");
  w("session-reports/rolara/ember/2026-01-01-One-REPORT.md", "---\ntype: Session Report\n---\n\nBody.\n");
  w("session-reports/karsk/deeps/2026-02-01-Three-REPORT.md", "---\ntype: Session Report\n---\n\nBody.\n");
  w("session-reports/karsk/hollow/2026-03-01-Four-REPORT.md", "---\ntype: Session Report\n---\n\nBody.\n");
  return root;
}

const MERGE_SETTINGS = [
  {
    name: "rolara",
    kbRoot: "settings/rolara",
    homebrewRoot: "homebrew/rolara",
    sessionReportsRoot: "session-reports/rolara",
    campaigns: ["deeps", "ember"],
  },
  {
    name: "karsk",
    kbRoot: "settings/karsk",
    homebrewRoot: "homebrew/karsk",
    sessionReportsRoot: "session-reports/karsk",
    campaigns: ["deeps", "hollow"],
  },
];

const mergeScoped = (scope, projectRoot) =>
  buildScopedPlan({ projectRoot, settings: MERGE_SETTINGS, baseRules: BASE_RULES, scope });

const MERGE_KARSK = { settingMerges: [{ from: "karsk", into: "rolara" }] };

{
  // THE EXPORTED SIGNATURE TAKES THE TWO SETTINGS, not one pair of roots, so that a
  // caller cannot hand it a third of a world and be told there are no collisions in
  // the other two thirds. Every row here is named, so narrowing the walk back to
  // kbRoot fails this case rather than merely reporting a smaller number.
  const root = mergeFixture();
  const collisions = mergeCollisions({
    projectRoot: root,
    source: MERGE_SETTINGS[1],
    target: MERGE_SETTINGS[0],
    suffix: "-INDEX",
  });
  check("a collision in every one of the three prongs is reported, and nothing else is",
    collisions.map((c) => [c.field, c.from, c.proposed]),
    [
      ["kbRoot", "settings/karsk/Tavern.md", "settings/rolara/Tavern-karsk.md"],
      ["homebrewRoot", "homebrew/karsk/Blade.md", "homebrew/rolara/Blade-karsk.md"],
      ["sessionReportsRoot", "session-reports/karsk/deeps", "session-reports/rolara/deeps-karsk"],
    ]);
  // The suffix is the SOURCE setting's name, so the article already at the
  // destination keeps the name every existing wikilink uses and only the incoming
  // one needs its links looked at. The extension stays last, because a file that
  // does not end in .md is not an article Obsidian will resolve at all.
  check("and each collision names the child that collided",
    collisions.map((c) => c.basename), ["Tavern.md", "Blade.md", "deeps"]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // The plan phase's read-only contract, on the one function here that reads two
  // whole worlds off the disk.
  const root = mergeFixture();
  execFileSync("git", ["init", "-q"], { cwd: root });
  const before = snapshotTree(root);
  mergeCollisions({ projectRoot: root, source: MERGE_SETTINGS[1], target: MERGE_SETTINGS[0], suffix: "-INDEX" });
  check("mergeCollisions mutates nothing", snapshotTree(root), before);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  const root = mergeFixture();
  const r = mergeScoped(MERGE_KARSK, root);
  // ALL THREE PRONGS EMPTIED INTO THE TARGET'S MATCHING PRONG. kbRoot into kbRoot,
  // homebrewRoot into homebrewRoot, sessionReportsRoot into sessionReportsRoot:
  // merging the knowledge base alone would file nothing wrong, it would simply
  // leave two thirds of a world behind with no setting left to claim it.
  check("every prong of the source world is emptied into the target's matching prong",
    r.operations.map((o) => [o.op, o.from, o.to]),
    [
      ["relocate-path", "settings/karsk/Emberhold.md", "settings/rolara/Emberhold.md"],
      ["relocate-path", "settings/karsk/Tavern.md", "settings/rolara/Tavern-karsk.md"],
      ["relocate-path", "homebrew/karsk/Blade.md", "homebrew/rolara/Blade-karsk.md"],
      ["relocate-path", "homebrew/karsk/Censer.md", "homebrew/rolara/Censer.md"],
      // A campaign is a FOLDER, so this one move carries every report inside it.
      ["relocate-path", "session-reports/karsk/deeps", "session-reports/rolara/deeps-karsk"],
      ["relocate-path", "session-reports/karsk/hollow", "session-reports/rolara/hollow"],
    ]);
  // Every collision in the proposal, with the rename that resolves it, so the DM
  // APPROVES the resolution rather than discovering it. renderProposal prints
  // declined items, which is what makes this the thing they read while deciding.
  check("every collision is surfaced with its proposed rename before approval",
    r.declined.map((d) => [d.op, d.target]),
    [
      ["merge-collision", "settings/karsk/Tavern.md collides with settings/rolara/Tavern.md"],
      ["merge-collision", "homebrew/karsk/Blade.md collides with homebrew/rolara/Blade.md"],
      ["merge-collision", "session-reports/karsk/deeps collides with session-reports/rolara/deeps"],
    ]);
  check("and the row says the incoming article is the one renamed, and why",
    [/Tavern-karsk\.md/.test(String(obj(r.declined[0]).reason)),
     /every existing wikilink uses/.test(String(obj(r.declined[0]).reason))],
    [true, true]);
  // THE MERGE'S LARGEST SILENT EFFECT, said out loud in the row the DM actually
  // reads while deciding. Once Tavern.md becomes Tavern-karsk.md, a [[Tavern]]
  // written inside karsk's own articles resolves BY BASENAME to rolara's Tavern.md,
  // a different world's article. assertLinkIntegrity resolves by basename too, finds
  // a live file, and reports clean, so a mis-resolved link is quieter than a dead
  // one and this row is the only place it can be said.
  check("and it says plainly that the incoming article's own links now point at the other world's",
    [/\[\[Tavern\]\]/.test(String(obj(r.declined[0]).reason)),
     /CHANGE MEANING/.test(String(obj(r.declined[0]).reason)),
     /link-integrity check cannot see that/.test(String(obj(r.declined[0]).reason))],
    [true, true, true]);
  // ONE group id for every move the entry emits, and here it is load-bearing rather
  // than tidy: conventionsAfterScope marks the source world merged off this same
  // entry, and half a world moved while the entry says it was merged leaves the
  // rest belonging to a setting nothing points at any more.
  check("every move carries the entry's own group id",
    dedupeConsecutive(r.operations.map((o) => JSON.stringify(o.groups))), ['["settingMerges[0]"]']);
  // The vault rides with neither world. rolara has its own configuration and
  // karsk's is not lore; it stays with the entry that is being marked merged.
  check("the source world's Obsidian vault is not merged in",
    JSON.stringify(r.operations).includes(".obsidian"), false);
  check("and the plan can execute as written", r.prechecks.ok, true);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  const root = mergeFixture();
  const r = mergeScoped({ settingMerges: [{ from: "karsk", into: "karsk" }] }, root);
  check("merging a setting into itself is declined",
    [r.operations.length, r.declined.map((d) => [d.op, d.target])],
    [0, [["relocate-path", "karsk"]]]);
  const unknown = mergeScoped({ settingMerges: [{ from: "nope", into: "rolara" }] }, root);
  check("and so is a merge naming a setting conventions.json does not record",
    [unknown.operations.length, unknown.declined.length], [0, 1]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // AN INDEX COLLIDING WITH AN INDEX IS NOT RENAMED. That is a merge-index job:
  // renaming would leave two indexes claiming one folder, which is exactly the
  // multi-index violation the validation sweep reports, and the rename would also
  // strip the -INDEX suffix off the end of the stem and turn the file into an
  // article. The move is declined and the index stays where it is.
  const root = mergeFixture();
  writeAt(root, "settings/rolara/Lore-INDEX.md", "---\ntype: Index\n---\n\n- [[Tavern]]\n");
  writeAt(root, "settings/karsk/Lore-INDEX.md", "---\ntype: Index\n---\n\n- [[Emberhold]]\n");
  const r = mergeScoped(MERGE_KARSK, root);
  check("an index colliding with an index is neither renamed nor moved",
    [r.operations.filter((o) => /Lore-INDEX/.test(`${o.from} ${o.to}`)).length,
     r.declined.filter((d) => /Lore-INDEX/.test(String(d.target))).map((d) => [d.op, d.target])],
    [0, [["relocate-path", "settings/karsk/Lore-INDEX.md"]]]);
  check("and the decline names the job it actually is",
    /merge-index/.test(String((r.declined.find((d) => /Lore-INDEX/.test(String(d.target))) || {}).reason)), true);
  // The articles either side of it still merge. One index left behind is not a
  // reason to refuse a world.
  check("the rest of the merge is unaffected",
    r.operations.map((o) => o.from),
    ["settings/karsk/Emberhold.md", "settings/karsk/Tavern.md", "homebrew/karsk/Blade.md",
     "homebrew/karsk/Censer.md", "session-reports/karsk/deeps", "session-reports/karsk/hollow"]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // A prong the TARGET does not record. The source's material has nowhere to go,
  // and guessing a canonical sibling path here would invent a folder the
  // conventions file does not name. Declined, with the prong named, and the two
  // that can be merged still are.
  const root = mergeFixture();
  const settings = JSON.parse(JSON.stringify(MERGE_SETTINGS));
  settings[0].homebrewRoot = "";
  const r = buildScopedPlan({ projectRoot: root, settings, baseRules: BASE_RULES, scope: MERGE_KARSK });
  check("a prong the target does not record is declined rather than guessed at",
    [r.operations.map((o) => o.from),
     r.declined.filter((d) => d.target === "homebrew/karsk").map((d) => d.op)],
    [["settings/karsk/Emberhold.md", "settings/karsk/Tavern.md",
      "session-reports/karsk/deeps", "session-reports/karsk/hollow"],
     ["relocate-path"]]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // THE GROUP UNIT AS A REGRESSION, against a real repository. One article is
  // git-ignored, so the pre-migration snapshot does not contain it and moving it
  // could not be undone. The whole entry goes, every prong of it: a merge that
  // moved a world's knowledge base and homebrew while leaving one article behind
  // would still have conventions.json marking that world merged.
  const root = mergeFixture();
  writeAt(root, ".gitignore", "settings/karsk/Emberhold.md\n");
  commitFixture(root);
  const r = mergeScoped(MERGE_KARSK, root);
  check("one git-ignored article declines the whole merge, not just its own move",
    [r.operations.length, r.declined.filter((d) => d.op === "relocate-path").length], [0, 6]);
  check("and every declined move names the entry that took it and the ignored article",
    dedupeConsecutive(
      r.declined
        .filter((d) => d.op === "relocate-path")
        .map((d) => [/settingMerges\[0\]/.test(String(d.reason)), /Emberhold\.md/.test(String(d.reason))])
        .map((pair) => JSON.stringify(pair))
    ),
    ["[true,true]"]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // A PROPOSED RENAME THAT IS ITSELF ALREADY TAKEN. rolara holds Tavern.md and
  // Tavern-karsk.md both, which is the ordinary shape for a DM who once hand-copied
  // one article across, or who suffixes articles by world already. The rename this
  // merge would otherwise propose lands on the second one, and a plan that writes
  // onto an occupied path is a plan applyPlan refuses OUTRIGHT: the unrelated
  // Emberhold move would die with it and the DM would get no merge at all, over a
  // collision the proposal simultaneously promised to resolve.
  const root = mergeFixture();
  writeAt(root, "settings/rolara/Tavern-karsk.md", "---\ntype: Location\n---\n\nHand-copied years ago.\n");
  const r = mergeScoped(MERGE_KARSK, root);
  check("a rename onto a name that is itself taken leaves the plan executable", r.prechecks.ok, true);
  check("and the moves that had nothing to do with the collision still happen",
    r.operations.filter((o) => String(o.from).startsWith("settings/karsk/")).map((o) => [o.from, o.to]),
    [["settings/karsk/Emberhold.md", "settings/rolara/Emberhold.md"]]);
  check("nothing is planned onto the name that was already occupied",
    r.operations.some((o) => String(o.to) === "settings/rolara/Tavern-karsk.md"), false);
  // ALL THREE FILES NAMED IN ONE ROW, because the DM is the only one who can say
  // which of rolara's two Taverns this one is. A machine-invented Tavern-karsk-2.md
  // would carry no information at all: the whole point of the -karsk suffix is that
  // it says which world the article came from, and a second one cannot say it.
  const row = r.declined.find((d) => d.op === "relocate-path" && d.target === "settings/karsk/Tavern.md") || {};
  check("and one decline names all three files, so the DM resolves it from the proposal",
    [/settings\/rolara\/Tavern\.md/.test(String(row.reason)),
     /settings\/rolara\/Tavern-karsk\.md/.test(String(row.reason))],
    [true, true]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // THE SAME COLLISION FROM THE OTHER SIDE: the name the rename wants is one THIS
  // MERGE is about to fill. karsk holds Tavern.md and Tavern-karsk.md both, rolara
  // holds Tavern.md, and the second of karsk's two moves in unrenamed onto exactly
  // the name the first one's rename wants. The occupancy check cannot see it, by
  // design (no planner shows a check its own item's operations), so mergeCollisions
  // tracks what this merge has already spoken for. Two operations targeting one path
  // is refused as an in-plan collision, and applyPlan refuses a plan carrying one
  // whole, so this is the same unapplicable migration by a shorter route.
  const root = mergeFixture();
  writeAt(root, "settings/karsk/Tavern-karsk.md", "---\ntype: Location\n---\n\nAlready suffixed by hand.\n");
  const r = mergeScoped(MERGE_KARSK, root);
  const tos = r.operations.map((o) => String(o.to));
  check("no two operations in the plan target the same destination", tos.length, new Set(tos).size);
  check("and the plan is still executable", r.prechecks.ok, true);
  check("the article whose rename has nowhere to go is the one dropped",
    [r.operations.filter((o) => /^settings\/karsk\//.test(String(o.from))).map((o) => o.from),
     r.declined.filter((d) => d.op === "relocate-path").map((d) => d.target)],
    [["settings/karsk/Emberhold.md", "settings/karsk/Tavern-karsk.md"], ["settings/karsk/Tavern.md"]]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // ORDER-INDEPENDENT BY CONSTRUCTION: the identical sibling collision, presented in
  // both possible visiting orders, reaches the identical outcome. A single left-to-
  // right pass with a running claimed set cannot promise this, because whether one
  // sibling's rename target is free depends on a fact about the OTHER sibling that a
  // one-pass walk has not looked at yet when it decides the first one it meets.
  // mergeCollisions takes a `children` hook precisely so this can be asked directly,
  // without depending on which order a real directory listing happens to sort into.
  const root = mergeFixture();
  const source = MERGE_SETTINGS[1]; // karsk
  const target = MERGE_SETTINGS[0]; // rolara, which already holds session-reports/rolara/deeps
  const withOrder = (order) => (rel) => (rel === source.sessionReportsRoot ? order : []);
  const forward = mergeCollisions({ projectRoot: root, source, target, children: withOrder(["deeps", "deeps-karsk"]) });
  const backward = mergeCollisions({ projectRoot: root, source, target, children: withOrder(["deeps-karsk", "deeps"]) });
  check("a sibling collision reaches the identical outcome whichever order it is visited in",
    JSON.stringify(forward), JSON.stringify(backward));
  check("and the outcome is a decline naming the occupied rename target, not a second suffix",
    forward.map((c) => [c.basename, c.blocked, c.blockedBy, c.proposed]),
    [["deeps", "taken", "session-reports/rolara/deeps-karsk", null]]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // THE EXTENSIONLESS CASE, which is what campaign folders under sessionReportsRoot
  // always are. disambiguatedName APPENDS the suffix rather than inserting it before
  // an extension, so the plain name (deeps) is a SORT-PREFIX of its own suffixed form
  // (deeps-karsk) and sorts first, the opposite of the .md case above where the
  // suffixed form sorts first by an accident of ASCII (- before .). karsk holds both
  // deeps and deeps-karsk, the ordinary shape for a DM who once hand-suffixed a
  // folder before ever running /migrate; rolara already holds deeps. Before the fix,
  // this order silently invented session-reports/rolara/deeps-karsk-karsk instead of
  // declining.
  const root = mergeFixture();
  writeAt(root, "session-reports/karsk/deeps-karsk/2026-02-03-Five-REPORT.md",
    "---\ntype: Session Report\n---\n\nHand-suffixed years ago.\n");
  const r = mergeScoped(MERGE_KARSK, root);
  check("the plan is still executable", r.prechecks.ok, true);
  check("no machine-invented double suffix is ever proposed",
    JSON.stringify(r.operations).includes("deeps-karsk-karsk"), false);
  check("the pre-suffixed sibling moves to its own name unrenamed",
    r.operations.some((o) => o.from === "session-reports/karsk/deeps-karsk" &&
      o.to === "session-reports/rolara/deeps-karsk"), true);
  const row = r.declined.find((d) => d.op === "relocate-path" && d.target === "session-reports/karsk/deeps") || {};
  check("the plain sibling declines instead, naming all three files",
    [String(row.reason).includes("session-reports/rolara/deeps,"),
     String(row.reason).includes("session-reports/rolara/deeps-karsk")],
    [true, true]);
  check("and the moves that had nothing to do with the collision still happen",
    r.operations.map((o) => o.from).filter((f) => !/session-reports/.test(f)),
    ["settings/karsk/Emberhold.md", "settings/karsk/Tavern.md", "homebrew/karsk/Blade.md", "homebrew/karsk/Censer.md"]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // A pathMoves ENTRY THAT CARRIES A MERGE SOURCE AWAY. pathMoves is declared at
  // rank 1 and registered first, so it runs before this merge does. Enumerating the
  // source prong off the RAW DISK plans a second move reading a path the first one
  // has already taken: two operations, one source, prechecks clean, and at apply the
  // first git mv succeeds and the second fails on a source that is no longer there,
  // which applyPlan records and keeps going. That is a half-applied merge from a
  // plan the prechecks approved.
  const root = mergeFixture();
  const r = mergeScoped(
    {
      pathMoves: [{ from: "settings/karsk/Emberhold.md", to: "settings/rolara/Emberhold.md" }],
      settingMerges: [{ from: "karsk", into: "rolara" }],
    },
    root
  );
  const froms = r.operations.map((o) => String(o.from));
  check("no two operations in the plan read the same source", froms.length, new Set(froms).size);
  check("the merge does not re-plan a move an earlier operation already makes",
    r.operations.filter((o) => String(o.from) === "settings/karsk/Emberhold.md").map((o) => o.to),
    ["settings/rolara/Emberhold.md"]);
  check("and the path the earlier operation carries away is declined by name",
    (r.declined.find((d) => d.op === "relocate-path" && d.target === "settings/karsk/Emberhold.md") || {}).op,
    "relocate-path");
  check("the rest of the merge is unaffected and the plan still executes",
    [r.operations.filter((o) => /^settings\/karsk\//.test(String(o.from))).map((o) => o.from), r.prechecks.ok],
    [["settings/karsk/Emberhold.md", "settings/karsk/Tavern.md"], true]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

{
  // CHAINED MERGES IN ONE SCOPE. karsk into rolara, then rolara into dunn. Reading
  // the raw disk for rolara's children finds R.md and not K.md, so K.md lands under
  // settings/rolara and the SAME RUN marks rolara merged into dunn: the first
  // merge's material is stranded under a world conventions.json has just stopped
  // treating as live, which is the exact harm the merge exists to prevent, reached
  // through a two-entry scope instead of a one-prong walk.
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-setchain-"));
  writeAt(root, "settings/karsk/K.md", "---\ntype: Location\n---\n\nBody.\n");
  writeAt(root, "settings/rolara/R.md", "---\ntype: Location\n---\n\nBody.\n");
  writeAt(root, "settings/dunn/D.md", "---\ntype: Location\n---\n\nBody.\n");
  const chain = [
    { name: "karsk", kbRoot: "settings/karsk" },
    { name: "rolara", kbRoot: "settings/rolara" },
    { name: "dunn", kbRoot: "settings/dunn" },
  ];
  const r = buildScopedPlan({
    projectRoot: root,
    settings: chain,
    baseRules: BASE_RULES,
    scope: {
      settingMerges: [
        { from: "karsk", into: "rolara" },
        { from: "rolara", into: "dunn" },
      ],
    },
  });
  check("a chained merge leaves nothing under a world the same run marks merged",
    r.operations.map((o) => [o.from, o.to]),
    [
      ["settings/karsk/K.md", "settings/rolara/K.md"],
      ["settings/rolara/K.md", "settings/dunn/K.md"],
      ["settings/rolara/R.md", "settings/dunn/R.md"],
    ]);
  check("and the chain can execute as written", r.prechecks.ok, true);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

// INVARIANT 4, GLOBALLY: every plan-time path check reasons about the tree as the
// plan will leave it. planAbsorbFolders was the last holdout, enumerating its
// folder with a bare readdirSync while every other scoped planner routes its named
// paths through planResolve. absorb-folder ranks 2 and pathMoves ranks 1, so a
// pathMoves entry in the same scope runs first and both directions went wrong.
{
  const root = absorbFixture();
  const r = scoped(
    {
      pathMoves: [{ from: "settings/rolara/misc", to: "settings/rolara/notes/misc", reason: "x" }],
      absorbFolders: [{ folder: "settings/rolara/notes/misc" }],
    },
    root
  );
  // RED before the fix: one operation and one decline reading "Could not read the
  // folder: ENOENT: no such file or directory, scandir ...", for a folder the same
  // plan puts there eight ranks earlier. The remedy that message implies is editing
  // a scope that was already correct.
  // No rebuild here, and that is right rather than a leftover: the parent the
  // absorb dissolves into is settings/rolara/notes, which nothing puts an index
  // in. The third case below is the one that pins the rebuild.
  check("an absorb of a folder the same plan moves into place plans rather than declines",
    [kindsOf(r.operations), r.declined.length],
    [["relocate-path", "absorb-folder"], 0]);
  check("and its files are enumerated at the pre-move path but named at the post-move one",
    find(r.operations, "absorb-folder").articles,
    [
      { from: "settings/rolara/notes/misc/Ends.md", to: "settings/rolara/notes/Ends.md" },
      { from: "settings/rolara/notes/misc/Odds.md", to: "settings/rolara/notes/Odds.md" },
    ]);
  check("with the folder's own index found at the post-move path too",
    find(r.operations, "absorb-folder").index, "settings/rolara/notes/misc/Misc-INDEX.md");
  rmSync(root, { recursive: true, force: true });
}

{
  const root = absorbFixture();
  const r = scoped(
    {
      pathMoves: [{ from: "settings/rolara/misc", to: "settings/rolara/notes/misc", reason: "x" }],
      absorbFolders: [{ folder: "settings/rolara/misc" }],
    },
    root
  );
  // The other direction, and the worse one. RED before the fix: three operations
  // with prechecks.ok true and no collision, because the move vacates
  // settings/rolara/misc while the absorb's per-file entries name files INSIDE it,
  // a different fold key, so findDestinationCollisions cannot see it. The plan
  // reached the DM clean, was approved, and failed after the snapshot with
  // "git mv ... fatal: bad source".
  check("an absorb of a folder the same plan carries away is declined at plan time",
    [kindsOf(r.operations), r.declined.map((d) => d.op)],
    [["relocate-path"], ["absorb-folder"]]);
  check("with a reason naming the move rather than a filesystem error",
    [
      String(obj(r.declined[0]).reason).includes("carries settings/rolara/misc away"),
      /ENOENT/.test(String(obj(r.declined[0]).reason)),
    ],
    [true, false]);
  rmSync(root, { recursive: true, force: true });
}

{
  // existingIndexIn had the same raw-disk problem in both its callers, and it is
  // the half that decides whether the paired rebuild is emitted at all. Here the
  // PARENT the absorb dissolves into is itself put in place by the move, so its
  // index is only readable at the pre-move path.
  const root = absorbFixture();
  writeAt(root, "settings/rolara/misc/inner/Inner-INDEX.md", "---\ntype: Index\n---\n\n- [[Deep]]\n");
  writeAt(root, "settings/rolara/misc/inner/Deep.md", "---\ntype: Concept\n---\n\nBody.\n");
  const r = scoped(
    {
      pathMoves: [{ from: "settings/rolara/misc", to: "settings/rolara/notes", reason: "x" }],
      absorbFolders: [{ folder: "settings/rolara/notes/inner" }],
    },
    root
  );
  check("the parent index a move puts in place is still found, so the rebuild is emitted",
    [kindsOf(r.operations), find(r.operations, "rebuild-index").to],
    [["relocate-path", "absorb-folder", "rebuild-index"], "settings/rolara/notes/Misc-INDEX.md"]);
  rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// A folder spelling never decides whether a run is declined or refused
// ---------------------------------------------------------------------------
//
// planRebuildIndexes declines an entry whose index an earlier create-index in the
// same plan already builds from the same folder, and that gate compared the two
// folder strings lowercased and nothing else. The shape that reaches past a case
// fold is the one planResolve documents: a pathMoves entry carries a folder away and
// a split claims the freed name for a bucket, so the bucket folder IS on disk at plan
// time. Both guards ahead of the gate then pass a dotted spelling, because
// namedPathSatisfies falls through to statSync on a path.resolve'd path, and the
// entry reached the gate, missed the decline, and emitted a second writer at the
// create-index's destination. findDestinationCollisions reads that as an in-plan
// collision and applyPlan turns it into "Nothing was touched": a whole migration
// refused over a `./`, the exact failure this cluster of fixes exists to remove.
//
// All five spellings, plain and default included, because the plain rows are what
// show the gate still DOES decline; a fix that simply stopped declining would pass a
// dotted-only case.
{
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-rebuild-spelling-"));
  const w = (rel, body) => writeAt(root, rel, body);
  w("settings/rolara/locations/Locations-INDEX.md", "---\ntype: Index\n---\n\n- [[Ashfall]]\n");
  w("settings/rolara/locations/Ashfall.md", "---\ntype: Location\n---\n\nBody.\n");
  w("settings/rolara/locations/Karsk.md", "---\ntype: Location\n---\n\nBody.\n");
  // The folder the move vacates and the split then re-claims as a bucket name.
  w("settings/rolara/locations/north/Nordhal.md", "---\ntype: Location\n---\n\nBody.\n");

  const rowFor = (folder) => {
    const entry = { index: "settings/rolara/locations/north/North-INDEX.md" };
    if (folder !== undefined) entry.folder = folder;
    const r = scoped(
      {
        pathMoves: [{ from: "settings/rolara/locations/north", to: "settings/rolara/attic", reason: "x" }],
        splitFolders: [
          { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
        ],
        rebuildIndexes: [entry],
      },
      root
    );
    return [r.prechecks.ok, r.declined.filter((d) => d.op === "rebuild-index").length];
  };

  const expected = [true, 1];
  check("plain: the redundant rebuild is declined and the run stands",
    rowFor("settings/rolara/locations/north"), expected);
  check("no folder at all: the default dirname declines the same way",
    rowFor(undefined), expected);
  check("a leading ./ declines rather than refusing the whole run",
    rowFor("./settings/rolara/locations/north"), expected);
  check("a doubled separator declines rather than refusing the whole run",
    rowFor("settings/rolara/locations//north"), expected);
  check("an interior .. hop declines rather than refusing the whole run",
    rowFor("settings/rolara/locations/sub/../north"), expected);
  rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// A folder spelling never decides which setting owns a folder
// ---------------------------------------------------------------------------
//
// settingForFolder is settingOwning's plan-half twin and picks the indexSuffix rule
// that tells an absorb which enumerated file is the folder's own INDEX rather than
// one of its articles. It prefix-matched the two raw strings, so under karsk, which
// declares "-IDX", a dotted folder matched no root, took the base "-INDEX", and
// planned the folder's index as an ARTICLE to be moved into the parent, with no
// rebuild for the parent whose link to it just died.
{
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-owner-spelling-"));
  const w = (rel, body) => writeAt(root, rel, body);
  w("settings/karsk/Karsk-IDX.md", "---\ntype: Index\n---\n\n- [[Misc-IDX]]\n");
  w("settings/karsk/misc/Misc-IDX.md", "---\ntype: Index\n---\n\n- [[Odds]]\n");
  w("settings/karsk/misc/Odds.md", "---\ntype: Concept\n---\n\nBody.\n");

  const rowFor = (folder) => {
    const r = scoped({ absorbFolders: [{ folder }] }, root);
    const absorb = find(r.operations, "absorb-folder");
    return [
      kindsOf(r.operations),
      Boolean(absorb.index),
      list(absorb.articles).map((a) => path.posix.basename(a.from)),
    ];
  };
  const expected = [["absorb-folder", "rebuild-index"], true, ["Odds.md"]];
  check("plain: the folder's own -IDX index is recognised as the index",
    rowFor("settings/karsk/misc"), expected);
  check("a leading ./ resolves the same owner, so the index is not moved as an article",
    rowFor("./settings/karsk/misc"), expected);
  check("and a doubled separator resolves it too",
    rowFor("settings/karsk//misc"), expected);
  rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// A merging bucket records what its destination already holds
// ---------------------------------------------------------------------------

{
  const root = splitFixture();
  writeAt(root, "settings/rolara/locations/north/Emberwatch.md", "---\ntype: Location\n---\n\nBody.\n");
  writeAt(root, "settings/rolara/locations/north/Frosthollow.md", "---\ntype: Location\n---\n\nBody.\n");
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  check("a merging bucket records what the destination already holds",
    obj(list(find(r.operations, "split-folder").buckets)[0]).existing,
    ["Emberwatch.md", "Frosthollow.md"]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  // A bucket destination that does not exist holds nothing, and the field is
  // omitted rather than set to an empty array, so an ordinary split's operation
  // shape is unchanged.
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  check("a bucket that merges into nothing carries no existing field",
    Object.prototype.hasOwnProperty.call(
      obj(list(find(r.operations, "split-folder").buckets)[0]), "existing"),
    false);
  rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// folderContentsAfterPlan's own plan-aware filter, not just the plain lookup
// ---------------------------------------------------------------------------
//
// Every case above builds a plan holding a single split-folder entry, so
// `pending` is empty every time folderContentsAfterPlan runs and its filter
// loop, the one that drops a child an earlier operation carries OUT of the
// destination, never has anything to drop. These two combine a pathMoves
// entry (rank 1) with the splitFolders entry (rank 3) so the move is a
// preceding operation the split can see, and pin both directions the loop
// has to get right.

{
  const root = splitFixture();
  writeAt(root, "settings/rolara/locations/north/Emberwatch.md", "---\ntype: Location\n---\n\nBody.\n");
  writeAt(root, "settings/rolara/locations/north/Frosthollow.md", "---\ntype: Location\n---\n\nBody.\n");
  const r = scoped(
    {
      pathMoves: [
        {
          from: "settings/rolara/locations/north/Emberwatch.md",
          to: "settings/rolara/notes/Emberwatch.md",
          reason: "x",
        },
      ],
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  check("a preceding move carrying a file out of the bucket destination drops it from existing",
    obj(list(find(r.operations, "split-folder").buckets)[0]).existing,
    ["Frosthollow.md"]);
  rmSync(root, { recursive: true, force: true });
}

{
  // The other direction: an earlier move carries the WHOLE bucket destination
  // folder in from somewhere else. The folder never physically exists at
  // settings/rolara/locations/north on disk here, only at its pre-move name,
  // so this pins that the enumeration rewinds through the move to find it
  // rather than reading nothing.
  const root = splitFixture();
  writeAt(root, "settings/rolara/oldnorth/Silvermere.md", "---\ntype: Location\n---\n\nBody.\n");
  const r = scoped(
    {
      pathMoves: [
        { from: "settings/rolara/oldnorth", to: "settings/rolara/locations/north", reason: "x" },
      ],
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  check("a preceding move carrying the bucket destination in reads its pre-move contents",
    obj(list(find(r.operations, "split-folder").buckets)[0]).existing,
    ["Silvermere.md"]);
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
