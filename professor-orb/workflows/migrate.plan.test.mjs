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

import { buildPlan, runPrechecks, OPERATION_ORDER, DEFERRED_OPERATIONS, buildScopedPlan, APPLY_ORDER } from "./migrate.mjs";

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
  const r = scoped({
    rebuildIndexes: [{ index: "settings/rolara/items/Items-INDEX.md" }],
    pathMoves: [{ from: "settings/rolara/misc/A.md", to: "settings/rolara/items/A.md", reason: "x" }],
  });
  // The move has to land before the rebuild reads the folder, or the rebuild
  // lists yesterday's membership. This is APPLY_ORDER doing its job, asserted
  // here because a planner added to SCOPED_PLANNERS in the wrong slot is the
  // easy mistake and applyPlan would refuse the whole run rather than explain it.
  check("moves are ordered before rebuilds", kindsOf(r.operations), ["relocate-path", "rebuild-index"]);
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
  // the ignored precheck is what makes it skippable AND what withholds vacate
  // credit from it: `git mv` on an ignored file hard-fails with "not under
  // version control", so it never leaves the path a later operation is aiming
  // at, and a git-ignored file has no snapshot to restore either.
  check("a git-ignored file inside an absorbed folder reaches the ignored precheck",
    list(r.prechecks.ignored).map((i) => [i.op, i.source, i.from, i.to]),
    [["absorb-folder", "settings/rolara/misc/Hidden.md",
      "settings/rolara/misc/Hidden.md", "settings/rolara/Hidden.md"]]);
  check("so nothing is credited with vacating a path it will never leave",
    [r.prechecks.ok, list(r.prechecks.collisions).map((c) => [c.kind, c.op, c.to])],
    [false, [["on-disk", "relocate-path", "settings/rolara/misc/Hidden.md"]]]);
  // ignoredBeneath's reason says `git mv` carries the ignored paths to the new
  // path, which is true of a directory move and false of this kind. The
  // accurate disclosure is the ignored SOURCE above, which says the operation
  // is skipped.
  check("and the folder is not disclosed as a directory move that carries them along",
    list(r.prechecks.ignoredBeneath).map((b) => b.op), []);
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
  check("a bucket whose folder already exists is declined",
    [r.operations.length, r.declined.length], [0, 1]);
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
// within one. The fixture drops the folder's index deliberately: with it present
// the two entries emit the same rebuild-index twice, and that in-plan collision
// refuses the run before the double claim can do any harm, which masks the hazard
// without fixing it. A folder with no index yet is an ordinary split candidate,
// since "content with no index" is one of the things the sweep flags, and there
// nothing masks it. Measured with the claim ledger scoped per entry: the plan
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
  // those articles. Reaching this precheck is what makes the split skippable AND
  // what withholds vacate credit from the ignored article: `git mv` on it
  // hard-fails with "not under version control", so it never leaves the path the
  // relocate-path below is aiming at, and it has no snapshot to be restored from
  // either.
  check("a git-ignored article inside a bucket reaches the ignored precheck",
    list(r.prechecks.ignored).map((i) => [i.op, i.source, i.from, i.to]),
    [["split-folder", "settings/rolara/locations/Karsk.md",
      "settings/rolara/locations/Karsk.md", "settings/rolara/locations/south/Karsk.md"]]);
  check("so nothing is credited with vacating a path the split will never empty",
    [r.prechecks.ok, list(r.prechecks.collisions).map((c) => [c.kind, c.op, c.to])],
    [false, [["on-disk", "relocate-path", "settings/rolara/locations/Karsk.md"]]]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
