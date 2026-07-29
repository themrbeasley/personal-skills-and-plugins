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

import { buildPlan, runPrechecks, OPERATION_ORDER, DEFERRED_OPERATIONS } from "./migrate.mjs";

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

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
