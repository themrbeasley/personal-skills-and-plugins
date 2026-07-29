#!/usr/bin/env node
// Regression suite for the migration executor's APPLY phase.
//
// This is the only component in professor-orb that can destroy a DM's work, so
// every case here runs against a DISPOSABLE git repository built in the OS temp
// directory and removed afterward. Nothing in this file touches the worktree it
// lives in, and nothing touches a real campaign project.
//
// Node built-ins only, no test framework.
//
// Run: node professor-orb/workflows/migrate.apply.test.mjs

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import {
  applyPlan,
  applyOperation,
  gitMove,
  assertLinkIntegrity,
  rewriteWikilinks,
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

// ---------------------------------------------------------------------------
// Disposable fixtures
// ---------------------------------------------------------------------------

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
];

const article = (frontmatter, body) => `---\n${frontmatter}\n---\n\n${body}\n`;

// base-rules.json documents no `default` check at all, so a case driven with it
// would show no publish field whether the apply phase strips publish or simply
// cannot resolve a value for it. This copy DOES document a default for publish,
// so only the explicit refusal keeps it out of the file. `tags` gets one too, so
// the case cannot pass merely because insertion is broken outright.
const BASE_RULES_WITH_DEFAULTS = {
  ...BASE_RULES,
  rules: {
    ...BASE_RULES.rules,
    frontmatterPublishDefault: {
      category: "frontmatter",
      check: "default",
      enforcement: "warn",
      description: "publish defaults to false.",
      params: { field: "publish", value: false },
    },
    frontmatterTagsDefault: {
      category: "frontmatter",
      check: "default",
      enforcement: "warn",
      description: "tags defaults to the empty list.",
      params: { field: "tags", value: [] },
    },
  },
};

// base-rules.json maps the -INDEX suffix to the type "Index", which is
// byte-identical to the hardcoded fallback in the executor. Asserting "Index"
// would therefore pass whether the suffix mapping was read or never opened. This
// copy pins a type unlike the fallback, so only an actual read produces it.
const BASE_RULES_DISTINCT_INDEX_TYPE = {
  ...BASE_RULES,
  rules: {
    ...BASE_RULES.rules,
    filenameSuffixByType: {
      ...BASE_RULES.rules.filenameSuffixByType,
      params: {
        mapping: [
          { type: "Folder Index", suffix: "-INDEX" },
          { type: "Session Report", suffix: "-REPORT" },
        ],
      },
    },
  },
};

function writeInto(root, rel, body) {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  return abs;
}

function git(root, argv) {
  return execFileSync("git", argv, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function initRepo(root) {
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Apply Test"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "snapshot"]);
}

// A repository whose working tree is clean and whose HEAD is the snapshot: the
// exact precondition the apply phase requires before it mutates anything.
function withRepo(files, fn) {
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-migrate-apply-"));
  try {
    for (const rel of Object.keys(files)) writeInto(root, rel, files[rel]);
    initRepo(root);
    return fn(root);
  } finally {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      /* Windows keeps handles on .git objects; a leftover temp dir is not a failure. */
    }
  }
}

// A directory with no repository at all, for the undetermined-ignored case.
function withBareDir(files, fn) {
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-migrate-apply-norepo-"));
  try {
    for (const rel of Object.keys(files)) writeInto(root, rel, files[rel]);
    return fn(root);
  } finally {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      /* Same handle caveat. */
    }
  }
}

const porcelain = (root) =>
  git(root, ["status", "--porcelain"]).split("\n").map((l) => l.trimEnd()).filter(Boolean).sort();
const lsFiles = (root) => git(root, ["ls-files"]).split("\n").filter(Boolean).sort();
const head = (root) => git(root, ["rev-parse", "HEAD"]).trim();
const has = (root, rel) => existsSync(path.join(root, rel));

// Every reach into a result or a produced file goes through these. A broken
// implementation must make a case go RED, not throw and take every later case
// down with it: an exception here would hide exactly the red set that proves
// the suite can fail.
const read = (root, rel) => {
  try {
    return readFileSync(path.join(root, rel), "utf8");
  } catch {
    return "";
  }
};
const first = (xs) => (Array.isArray(xs) && xs.length > 0 ? xs[0] : {});
const links = (r) => r.linkIntegrity || { ok: null, dead: [], filesChecked: -1, linksChecked: -1 };
const parsed = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

// Everything a mutation would disturb, plus git's own view of it. Compared
// across a refused applyPlan call: a refusal must leave the project untouched.
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
        out.push(`f ${rel} ${st.size} ${readFileSync(abs, "utf8").length}`);
      }
    }
  };
  walk(root);
  try {
    out.push("git " + git(root, ["status", "--porcelain", "--ignored"]));
  } catch {
    out.push("git (not a repository)");
  }
  return out.join("\n");
}

const apply = (root, operations, extra) =>
  applyPlan(
    { operations },
    Object.assign({ cwd: root, settings: SETTINGS, baseRules: BASE_RULES, commit: false }, extra)
  );

const bucketTotal = (r) =>
  r.applied.length + r.failed.length + r.dropped.length + r.skipped.length;

// ---------------------------------------------------------------------------
// Every relocation goes through git mv
// ---------------------------------------------------------------------------

console.log("\nEvery relocation goes through git mv");

withRepo(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "- [[Sword]]"),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/items/Sword.md",
        to: "settings/rolara/items/Sword-of-Dawn.md",
        links: ["settings/rolara/items/Items-INDEX.md"],
        reason: "suffix",
      },
    ]);

    const status = porcelain(root);
    check(
      "the move is recorded as one staged rename",
      status.filter((l) => l.startsWith("R ")),
      ["R  settings/rolara/items/Sword.md -> settings/rolara/items/Sword-of-Dawn.md"]
    );
    check(
      "and not as a delete plus an untracked pair",
      status.filter((l) => l.startsWith("D ") || l.startsWith("?? ")),
      []
    );
    check("the original path is gone from the working tree", has(root, "settings/rolara/items/Sword.md"), false);
    check("the destination is on disk", has(root, "settings/rolara/items/Sword-of-Dawn.md"), true);
    check(
      "the old path is no longer tracked, so no two files claim one article",
      lsFiles(root).includes("settings/rolara/items/Sword.md"),
      false
    );
    check("the relocation is reported applied", r.applied.length, 1);
  }
);

console.log("\nA rename and its link rewrite are one unit of work");

withRepo(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "settings/rolara/items/Items-INDEX.md": article(
      "publish: false\ntype: Index",
      "| Item | Note |\n| --- | --- |\n| [[Sword\\|The Sword]] | main |\n\n- [[Sword]]\n- [[Sword#Origins]]"
    ),
    "settings/rolara/lore/Origins.md": article("publish: false\ntype: Concept", "See [[items/Sword|the blade]]."),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/items/Sword.md",
        to: "settings/rolara/items/Sword-of-Dawn.md",
        links: ["settings/rolara/items/Items-INDEX.md", "settings/rolara/lore/Origins.md"],
        reason: "suffix",
      },
    ]);

    check("the rename and its rewrite produce exactly ONE accounting entry", bucketTotal(r), 1);
    check("that entry is applied", r.applied.length, 1);
    check("it reports every wikilink it rewrote", first(r.applied).linksRewritten, 4);

    const index = read(root, "settings/rolara/items/Items-INDEX.md");
    check("the table-escaped wikilink is rewritten and stays escaped",
      index.includes("[[Sword-of-Dawn\\|The Sword]]"), true);
    check("the plain wikilink is rewritten", index.includes("- [[Sword-of-Dawn]]"), true);
    check("the anchor survives the rewrite", index.includes("[[Sword-of-Dawn#Origins]]"), true);
    // Counted, not tested for absence with a broad negative lookahead: the
    // lookahead form matched nothing at all even when NO rewrite had happened,
    // so the case passed whether or not the code worked. This counts wikilinks
    // whose target is exactly "Sword", in every separator form.
    check("no reference to the old name survives in the index",
      (index.match(/\[\[Sword(?=[\]|#\\])/g) || []).length, 0);

    const lore = read(root, "settings/rolara/lore/Origins.md");
    check("a path-qualified wikilink keeps its path and display text",
      lore.includes("[[items/Sword-of-Dawn|the blade]]"), true);
  }
);

withRepo(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "- [[Sword]]"),
    "settings/rolara/lore/Silent.md": article("publish: false\ntype: Concept", "No link here."),
  },
  (root) => {
    // The plan names a file that carries no matching wikilink. The rewrite half
    // did not complete, so the ONE entry reports applied false even though the
    // file moved: two batched passes would have reported the move as done.
    const r = apply(root, [
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/items/Sword.md",
        to: "settings/rolara/items/Sword-of-Dawn.md",
        links: ["settings/rolara/items/Items-INDEX.md", "settings/rolara/lore/Silent.md"],
        reason: "suffix",
      },
    ]);
    check("a rename whose rewrite half is incomplete is not reported applied", r.applied.length, 0);
    check("it lands in failed, still as one entry", r.failed.length, 1);
    check("the failure names the file whose rewrite did not land",
      /Silent\.md/.test(first(r.failed).detail || ""), true);
  }
);

console.log("\nCase-only renames");

withRepo(
  {
    "settings/rolara/items/items-index.md": article("publish: false\ntype: Index", "- [[Blade]]"),
    // Spelled with different casing than the file it points at, which Obsidian
    // still resolves. It has to travel with the rename or it dies silently.
    "settings/rolara/items/Blade.md": article("publish: false\ntype: Item", "Listed in [[Items-Index]]."),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/items/items-index.md",
        to: "settings/rolara/items/items-INDEX.md",
        links: ["settings/rolara/items/Blade.md"],
        reason: "suffix",
      },
    ]);
    check("a case-only rename is applied", r.applied.length, 1);
    check("its referring link is rewritten in the same unit of work",
      read(root, "settings/rolara/items/Blade.md").includes("[[items-INDEX]]"), true);
    check("git mv handles it in one step on this filesystem", first(r.applied).mode, "direct");
    check("the corrected casing is what git tracks",
      lsFiles(root).includes("settings/rolara/items/items-INDEX.md"), true);
    check("and the old casing is not",
      lsFiles(root).includes("settings/rolara/items/items-index.md"), false);
  }
);

withRepo(
  {
    "settings/rolara/items/items-index.md": article("publish: false\ntype: Index", "- [[Blade]]"),
    "settings/rolara/items/Blade.md": article("publish: false\ntype: Item", "A blade."),
  },
  (root) => {
    // The two-step is a FALLBACK, not the default path, so it only runs when
    // git mv reports an error. This filesystem is case-insensitive and git mv
    // succeeds directly here, so the fallback is exercised by handing gitMove a
    // git runner that fails exactly the direct case-only move and passes
    // everything else through to the real one.
    const calls = [];
    let failedOnce = false;
    const realGit = (argv) => {
      try {
        return { ok: true, stdout: git(root, argv), stderr: "" };
      } catch (err) {
        return { ok: false, stdout: "", stderr: String((err && err.stderr) || err.message) };
      }
    };
    const fussyGit = (argv) => {
      calls.push(argv.join(" "));
      if (!failedOnce && argv[0] === "mv" && argv[3] === "settings/rolara/items/items-INDEX.md") {
        failedOnce = true;
        return { ok: false, stdout: "", stderr: "fatal: destination exists (simulated)" };
      }
      return realGit(argv);
    };
    const moved = gitMove(
      { cwd: root, git: fussyGit },
      "settings/rolara/items/items-index.md",
      "settings/rolara/items/items-INDEX.md"
    );
    check("git mv is attempted directly first, with no staging name",
      calls[0], "mv -- settings/rolara/items/items-index.md settings/rolara/items/items-INDEX.md");
    check("the fallback runs only after that direct attempt reported an error",
      failedOnce && calls.length > 1, true);
    check("the two-step fallback succeeds", moved.ok, true);
    check("and reports which path it took", moved.mode, "two-step");
    check("the corrected casing is tracked after the fallback",
      lsFiles(root).includes("settings/rolara/items/items-INDEX.md"), true);
    check("no temporary staging path is left behind",
      lsFiles(root).some((f) => f.includes("orb-migrate-tmp")), false);
  }
);

console.log("\nA prong relocated into its own child");

withRepo(
  {
    "homebrew/Dragon-Materials.md": article("publish: false\ntype: Item", "Scales."),
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "Nothing linked."),
  },
  (root) => {
    // git refuses to move a directory into itself, so a nested destination is
    // staged through a temporary sibling.
    const r = apply(root, [
      { op: "relocate-prong", from: "homebrew", to: "homebrew/rolara", reason: "canonical layout" },
    ]);
    check("a folder moved into its own child is applied", r.applied.length, 1);
    check("and reports that it was staged through a temporary sibling", first(r.applied).mode, "staged");
    check("the content lands under the nested destination",
      lsFiles(root).includes("homebrew/rolara/Dragon-Materials.md"), true);
    check("nothing is left at the old path",
      lsFiles(root).includes("homebrew/Dragon-Materials.md"), false);
    check("no temporary staging path survives",
      lsFiles(root).some((f) => f.includes("orb-migrate-tmp")), false);
  }
);

console.log("\nAn index merge is lossless");

withRepo(
  {
    "settings/rolara/items/Items-INDEX.md": article(
      "publish: false\ntype: Index",
      "## Weapons\n\nThe armoury holds these.\n\n- [[Blade]]"
    ),
    "settings/rolara/items/Artifacts-INDEX.md": article(
      "publish: false\ntype: Index",
      "## Artifacts\n\nRelics of the first crown.\n\n- [[Crown]]"
    ),
    "settings/rolara/items/Materials-INDEX.md": article(
      "publish: false\ntype: Index",
      "## Materials\n\nDragon scale and star iron.\n\n- [[Scale]]"
    ),
    "settings/rolara/items/Blade.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/items/Crown.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/items/Scale.md": article("publish: false\ntype: Item", "x"),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "merge-index",
        to: "settings/rolara/items/Items-INDEX.md",
        sources: [
          "settings/rolara/items/Artifacts-INDEX.md",
          "settings/rolara/items/Materials-INDEX.md",
        ],
        reason: "multi-index folder",
      },
    ]);
    check("the merge is applied", r.applied.length, 1);
    const survivor = read(root, "settings/rolara/items/Items-INDEX.md");
    check("the survivor's own heading survives", survivor.includes("## Weapons"), true);
    check("the survivor's own prose survives", survivor.includes("The armoury holds these."), true);
    check("the first source's heading survives", survivor.includes("## Artifacts"), true);
    check("the first source's prose survives", survivor.includes("Relics of the first crown."), true);
    check("the second source's heading survives", survivor.includes("## Materials"), true);
    check("the second source's prose survives", survivor.includes("Dragon scale and star iron."), true);
    check("every source's wikilinks survive",
      survivor.includes("[[Crown]]") && survivor.includes("[[Scale]]") && survivor.includes("[[Blade]]"), true);
    check("each source arrives under a provenance heading naming it",
      survivor.includes("Artifacts-INDEX") && survivor.includes("Materials-INDEX"), true);
    check("the merged-away sources are gone from the working tree",
      has(root, "settings/rolara/items/Artifacts-INDEX.md"), false);
    check("and gone from the index too",
      lsFiles(root).filter((f) => /Artifacts-INDEX|Materials-INDEX/.test(f)), []);
  }
);

console.log("\nA merge carries its link rewrites, the way a rename does");

withRepo(
  {
    "settings/rolara/items/Items-INDEX.md": article(
      "publish: false\ntype: Index",
      "## Sub-indexes\n\n- [[Artifacts-INDEX]]\n- [[Materials-INDEX]]"
    ),
    "settings/rolara/items/Artifacts-INDEX.md": article("publish: false\ntype: Index", "## Artifacts\n\n- [[Crown]]"),
    "settings/rolara/items/Materials-INDEX.md": article("publish: false\ntype: Index", "## Materials\n\n- [[Scale]]"),
    "settings/rolara/items/Crown.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/items/Scale.md": article("publish: false\ntype: Item", "x"),
  },
  (root) => {
    // The reference consumer's EXACT shape, and the one that blocked the
    // migration: surveyed read-only, all six inbound links to items/'s
    // merged-away sub-indexes live in the survivor itself, because the survivor
    // is precisely the index that lists them. Those referring files are text
    // inside the merged document by the time the rewrite runs, so a rewrite
    // aimed at the survivor on disk would be discarded by the merge's own write.
    const before = head(root);
    const r = applyPlan(
      {
        operations: [
          {
            op: "merge-index",
            to: "settings/rolara/items/Items-INDEX.md",
            sources: [
              "settings/rolara/items/Artifacts-INDEX.md",
              "settings/rolara/items/Materials-INDEX.md",
            ],
            sourceLinks: {
              "settings/rolara/items/Artifacts-INDEX.md": ["settings/rolara/items/Items-INDEX.md"],
              "settings/rolara/items/Materials-INDEX.md": ["settings/rolara/items/Items-INDEX.md"],
            },
            reason: "multi-index folder",
          },
        ],
      },
      { cwd: root, settings: SETTINGS, baseRules: BASE_RULES, commit: true }
    );
    const survivor = read(root, "settings/rolara/items/Items-INDEX.md");
    check("the merge is applied", r.applied.length, 1);
    check("no wikilink to a merged-away source survives",
      /\[\[(Artifacts|Materials)-INDEX/.test(survivor), false);
    check("each one points at the survivor instead",
      (survivor.match(/\[\[Items-INDEX\]\]/g) || []).length, 2);
    check("both rewrites are accounted on the merge's own entry, not a later pass",
      [first(r.applied).linksExpected, first(r.applied).linksRewritten], [2, 2]);
    check("the absorbed content still arrives under its provenance heading",
      survivor.includes("## Merged from Artifacts-INDEX.md") && survivor.includes("- [[Crown]]"), true);
    check("link integrity passes after the rewrite", links(r).ok, true);
    check("so the migration this release exists to perform reaches its commit", r.committed, true);
    check("and HEAD moved off the snapshot", head(root) !== before, true);
  }
);

withRepo(
  {
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "## Weapons\n\n- [[Blade]]"),
    "settings/rolara/items/Artifacts-INDEX.md": article("publish: false\ntype: Index", "## Artifacts\n\n- [[Crown]]"),
    "settings/rolara/items/Blade.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/items/Crown.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/lore/Compendium.md": article(
      "publish: false\ntype: Concept",
      "See [[Artifacts-INDEX|the relic list]] and ![[Artifacts-INDEX#Artifacts]]."
    ),
  },
  (root) => {
    // A referring file OUTSIDE the merge, rewritten on disk. Only the wikilink
    // target moves: display text, anchor, and the embed marker are the DM's
    // prose and are carried across byte for byte.
    const r = apply(root, [
      {
        op: "merge-index",
        to: "settings/rolara/items/Items-INDEX.md",
        sources: ["settings/rolara/items/Artifacts-INDEX.md"],
        sourceLinks: {
          "settings/rolara/items/Artifacts-INDEX.md": ["settings/rolara/lore/Compendium.md"],
        },
        reason: "multi-index folder",
      },
    ]);
    const compendium = read(root, "settings/rolara/lore/Compendium.md");
    check("a referring article outside the merge is rewritten too", r.applied.length, 1);
    check("its link now names the survivor, keeping display text and anchor",
      compendium.includes("[[Items-INDEX|the relic list]]") && compendium.includes("![[Items-INDEX#Artifacts]]"),
      true);
    check("and nothing still names the merged-away source",
      compendium.includes("Artifacts-INDEX"), false);
    check("two wikilinks in one named file count as two rewrites over one pair",
      [first(r.applied).linksExpected, first(r.applied).linksRewritten], [1, 2]);
    check("the rest of the sentence is untouched",
      compendium.includes("See ") && compendium.includes(" and ") && compendium.includes("."), true);
  }
);

withRepo(
  {
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "## Weapons\n\n- [[Blade]]"),
    "settings/rolara/items/Artifacts-INDEX.md": article("publish: false\ntype: Index", "## Artifacts\n\n- [[Crown]]"),
    "settings/rolara/items/Materials-INDEX.md": article("publish: false\ntype: Index", "## Materials\n\n- [[Scale]]"),
    "settings/rolara/items/Blade.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/items/Crown.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/items/Scale.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/lore/Compendium.md": article(
      "publish: false\ntype: Concept",
      "Both [[Artifacts-INDEX]] and [[Materials-INDEX]]."
    ),
    "settings/rolara/lore/Almanac.md": article("publish: false\ntype: Concept", "Only [[Artifacts-INDEX]]."),
  },
  (root) => {
    // The accounted unit is the PAIR, not the file: one article referring to two
    // merged-away sources is two rewrites, because either one going missing is
    // one dead wikilink. Three pairs here across two files and two sources.
    const r = apply(root, [
      {
        op: "merge-index",
        to: "settings/rolara/items/Items-INDEX.md",
        sources: [
          "settings/rolara/items/Artifacts-INDEX.md",
          "settings/rolara/items/Materials-INDEX.md",
        ],
        sourceLinks: {
          "settings/rolara/items/Artifacts-INDEX.md": [
            "settings/rolara/lore/Compendium.md",
            "settings/rolara/lore/Almanac.md",
          ],
          "settings/rolara/items/Materials-INDEX.md": ["settings/rolara/lore/Compendium.md"],
        },
        reason: "multi-index folder",
      },
    ]);
    check("a file referring to two merged-away sources counts as two pairs",
      [first(r.applied).linksExpected, first(r.applied).linksRewritten], [3, 3]);
    check("both of that file's links point at the survivor",
      (read(root, "settings/rolara/lore/Compendium.md").match(/\[\[Items-INDEX\]\]/g) || []).length, 2);
    check("and the second file naming the same source is rewritten as well",
      read(root, "settings/rolara/lore/Almanac.md").includes("[[Items-INDEX]]"), true);
    check("every link in the project resolves afterward", links(r).ok, true);
  }
);

withRepo(
  {
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "## Weapons\n\n- [[Blade]]"),
    "settings/rolara/items/Artifacts-INDEX.md": article("publish: false\ntype: Index", "## Artifacts\n\n- [[Crown]]"),
    "settings/rolara/items/Blade.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/items/Crown.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/lore/Bystander.md": article("publish: false\ntype: Concept", "Mentions nothing."),
  },
  (root) => {
    // A stale plan, the merge's version of the rename case: the named file
    // carries no such wikilink. The merge and its rewrites are one unit, so the
    // entry reports applied false rather than counting the merge as done.
    const r = apply(root, [
      {
        op: "merge-index",
        to: "settings/rolara/items/Items-INDEX.md",
        sources: ["settings/rolara/items/Artifacts-INDEX.md"],
        sourceLinks: {
          "settings/rolara/items/Artifacts-INDEX.md": ["settings/rolara/lore/Bystander.md"],
        },
        reason: "multi-index folder",
      },
    ]);
    check("a named referring file carrying no such wikilink fails the whole unit",
      [r.applied.length, r.failed.length], [0, 1]);
    check("and the entry names the file whose rewrite did not land",
      /Bystander\.md \(no wikilink to Artifacts-INDEX found\)/.test(first(r.failed).detail || ""), true);
    check("so the run is not reported ok", r.ok, false);
  }
);

console.log("\nThe link-integrity rail still blocks a dropped rewrite");

withRepo(
  {
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "## Weapons\n\n- [[Artifacts-INDEX]]"),
    "settings/rolara/items/Artifacts-INDEX.md": article("publish: false\ntype: Index", "## Artifacts\n\n- [[Crown]]"),
    "settings/rolara/items/Crown.md": article("publish: false\ntype: Item", "x"),
  },
  (root) => {
    // A plan that names no referrers for a source that HAS one. The rewrite half
    // has nothing to do, the removal orphans the link, and the rail is what
    // makes that loud rather than silent.
    const before = head(root);
    const r = applyPlan(
      {
        operations: [
          {
            op: "merge-index",
            to: "settings/rolara/items/Items-INDEX.md",
            sources: ["settings/rolara/items/Artifacts-INDEX.md"],
            reason: "multi-index folder",
          },
        ],
      },
      { cwd: root, settings: SETTINGS, baseRules: BASE_RULES, commit: true }
    );
    check("a merge that orphans a wikilink is caught by the rail",
      links(r).dead.map((d) => d.target), ["Artifacts-INDEX"]);
    check("and that run does not commit either", r.committed, false);
    check("with HEAD still at the snapshot", head(root), before);
  }
);

withRepo(
  {
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "## Weapons\n\n- [[Blade]]"),
    "settings/rolara/items/Artifacts-INDEX.md": article("publish: false\ntype: Index", "## Artifacts\n\n- [[Crown]]"),
    "settings/rolara/items/Blade.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/items/Crown.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/lore/Compendium.md": article("publish: false\ntype: Concept", "See [[Artifacts-INDEX]]."),
  },
  (root) => {
    // The plan DOES carry the rewrite and a worker drops it anyway. This is the
    // case the rail exists for, and adding the rewrite must not disarm it: the
    // assertion has to still block the commit when the rewrite goes missing.
    const before = head(root);
    const strippingWorker = (op, ctx) =>
      applyOperation(op.op === "merge-index" ? Object.assign({}, op, { sourceLinks: undefined }) : op, ctx);
    const r = applyPlan(
      {
        operations: [
          {
            op: "merge-index",
            to: "settings/rolara/items/Items-INDEX.md",
            sources: ["settings/rolara/items/Artifacts-INDEX.md"],
            sourceLinks: {
              "settings/rolara/items/Artifacts-INDEX.md": ["settings/rolara/lore/Compendium.md"],
            },
            reason: "multi-index folder",
          },
        ],
      },
      { cwd: root, settings: SETTINGS, baseRules: BASE_RULES, commit: true, worker: strippingWorker }
    );
    check("a rewrite the plan carried but the worker dropped still leaves the link dead",
      links(r).dead.map((d) => `${d.file} -> ${d.target}`),
      ["settings/rolara/lore/Compendium.md -> Artifacts-INDEX"]);
    check("the rail still blocks the commit", [links(r).ok, r.committed], [false, false]);
    check("and HEAD is still the snapshot to restore to", head(root), before);
  }
);

console.log("\nFrontmatter repair is a line move on raw text");

withRepo(
  {
    "settings/rolara/locations/Tavern.md":
      "---\n" +
      "# DM note: keep this one dark until session 40\n" +
      'type: "Location"\n' +
      "tags: [city, tavern]\n" +
      "nested:\n" +
      "  owner: Brand\n" +
      '  sealed: "false"\n' +
      'publish: "false"\n' +
      "---\n" +
      "\nA tavern.\n",
  },
  (root) => {
    const r = apply(root, [
      {
        op: "repair-frontmatter",
        from: "settings/rolara/locations/Tavern.md",
        insert: [],
        reorder: true,
        reason: "canonical order",
      },
    ]);
    check("the reorder is applied", r.applied.length, 1);
    const text = read(root, "settings/rolara/locations/Tavern.md");
    const fm = text.split("---")[1].split("\n").filter(Boolean);
    check("the YAML comment survives",
      fm.includes("# DM note: keep this one dark until session 40"), true);
    check('a quoted "false" keeps its quotes', text.includes('publish: "false"'), true);
    check('a quoted "false" inside a nested map keeps its quotes too',
      text.includes('  sealed: "false"'), true);
    check("the nested map survives whole",
      text.includes("nested:\n  owner: Brand\n"), true);
    check("the canonical fields end up in canonical order",
      fm.filter((l) => /^(publish|type|tags):/.test(l)).map((l) => l.split(":")[0]),
      ["publish", "type", "tags"]);
    check("quoting on a moved field is untouched", text.includes('type: "Location"'), true);
    check("the body is untouched", text.endsWith("\nA tavern.\n"), true);
  }
);

console.log("\npublish is never inserted, even by a hand-edited plan");

withRepo(
  {
    "settings/rolara/locations/Tavern.md": "---\ntype: Location\n---\n\nA tavern.\n",
  },
  (root) => {
    // The plan phase strips publish out of `insert`. The DM can edit the plan
    // between phases, so the apply phase strips it again rather than trusting
    // the file it was handed. Driven with a rules layer that DOES document a
    // default for publish, so the field's absence proves the refusal rather
    // than proving the value could not be resolved.
    const r = apply(
      root,
      [
        {
          op: "repair-frontmatter",
          from: "settings/rolara/locations/Tavern.md",
          insert: ["publish", "tags"],
          reorder: true,
          reason: "hand-edited",
        },
      ],
      { baseRules: BASE_RULES_WITH_DEFAULTS }
    );
    const text = read(root, "settings/rolara/locations/Tavern.md");
    check("the repair is applied", r.applied.length, 1);
    check("a non-publish field with a documented default IS inserted",
      /^tags: \[\]$/m.test(text), true);
    check("no publish field is written, even though a default exists for it",
      /^publish\s*:/m.test(text), false);
    check("the refusal to write publish is reported",
      /Declined to insert publish/.test((first(r.applied).detail || first(r.failed).detail || "")), true);
  }
);

console.log("\nAn operation whose source is git-ignored is skipped");

withRepo(
  {
    ".gitignore": "settings/rolara/editor-state/\n",
    "settings/rolara/editor-state/scratch.md": article("publish: false\ntype: Concept", "Scratch."),
    "settings/rolara/Ashfall.md": article("publish: false\ntype: Organization", "A compact."),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/editor-state/scratch.md",
        to: "settings/rolara/editor-state/Scratch-CONCEPT.md",
        reason: "suffix",
      },
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/Ashfall.md",
        to: "settings/rolara/Ashfall-ORG.md",
        reason: "suffix",
      },
    ]);
    check("the ignored-source operation is skipped, not applied",
      r.skipped.map((s) => s.from), ["settings/rolara/editor-state/scratch.md"]);
    check("its file is still exactly where it was",
      has(root, "settings/rolara/editor-state/scratch.md"), true);
    check("and its destination was never created",
      has(root, "settings/rolara/editor-state/Scratch-CONCEPT.md"), false);
    check("the tracked operation beside it still runs",
      lsFiles(root).includes("settings/rolara/Ashfall-ORG.md"), true);
    check("a skipped operation still gets exactly one accounting entry", bucketTotal(r), 2);
    check("and the skip states why", /ignored/.test(first(r.skipped).detail || ""), true);
  }
);

console.log("\nThe link-integrity assertion gates the commit");

withRepo(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "- [[Sword]]"),
  },
  (root) => {
    const before = head(root);
    // A worker that moves the file and reports success while dropping the link
    // rewrite half. The accounting believes it; only the assertion catches it.
    const lyingWorker = (op, ctx) => {
      if (op.op !== "rename-with-link-rewrite") return applyOperation(op, ctx);
      const moved = gitMove(ctx, op.from, op.to);
      return { op: op.op, from: op.from, to: op.to, applied: moved.ok, detail: "moved only" };
    };
    const r = applyPlan(
      {
        operations: [
          {
            op: "rename-with-link-rewrite",
            from: "settings/rolara/items/Sword.md",
            to: "settings/rolara/items/Sword-of-Dawn.md",
            links: ["settings/rolara/items/Items-INDEX.md"],
            reason: "suffix",
          },
        ],
      },
      { cwd: root, settings: SETTINGS, baseRules: BASE_RULES, commit: true, worker: lyingWorker }
    );

    check("the accounting reports the dropped rewrite as applied", r.applied.length, 1);
    check("the link-integrity assertion fails anyway", links(r).ok, false);
    check("it names the dead target", links(r).dead.map((d) => d.target), ["Sword"]);
    check("and the file that carries it",
      links(r).dead.map((d) => d.file), ["settings/rolara/items/Items-INDEX.md"]);
    check("the migration is NOT committed", r.committed, false);
    check("HEAD is still the snapshot", head(root), before);
    check("the run points at the snapshot for restoration", r.snapshot, before);
    check("and the whole run is reported not ok", r.ok, false);
  }
);

withRepo(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "- [[Sword]]"),
  },
  (root) => {
    const before = head(root);
    const r = applyPlan(
      {
        operations: [
          {
            op: "rename-with-link-rewrite",
            from: "settings/rolara/items/Sword.md",
            to: "settings/rolara/items/Sword-of-Dawn.md",
            links: ["settings/rolara/items/Items-INDEX.md"],
            reason: "suffix",
          },
        ],
      },
      { cwd: root, settings: SETTINGS, baseRules: BASE_RULES, commit: true }
    );
    check("a healthy run passes the assertion", links(r).ok, true);
    check("and commits", r.committed, true);
    check("the migration commit is a new commit", r.migration !== before, true);
    check("the snapshot hash recorded is the pre-run HEAD", r.snapshot, before);
    check("the working tree is clean afterward", porcelain(root), []);
  }
);

console.log("\nThe link-integrity assertion on its own");

withRepo(
  {
    "settings/rolara/a/Alpha.md": article("publish: false\ntype: Concept", "See [[Beta]] and [[Gamma]]."),
    "settings/rolara/b/Beta.md": article("publish: false\ntype: Concept", "Back to [[Alpha#Top]]."),
    "session-reports/rolara/S1-REPORT.md": article("publish: false\ntype: Session Report", "See [[S2-REPORT]] and [[Alpha]]."),
    "session-reports/rolara/S2-REPORT.md": article("publish: false\ntype: Session Report", "Earlier: [[S1-REPORT]]."),
  },
  (root) => {
    const bad = assertLinkIntegrity({ cwd: root, settings: SETTINGS });
    check("an unresolved target is reported", bad.dead.map((d) => d.target), ["Gamma"]);
    check("with the file that carries it",
      bad.dead.map((d) => d.file), ["settings/rolara/a/Alpha.md"]);
    check("and the verdict is not ok", bad.ok, false);

    writeInto(root, "settings/rolara/a/Gamma.md", article("publish: false\ntype: Concept", "x"));
    const good = assertLinkIntegrity({ cwd: root, settings: SETTINGS });
    check("resolution is filename-based, not path-based: a link across folders resolves",
      good.ok, true);
    check("report-to-report and report-to-article links are both walked",
      good.filesChecked, 5);
  }
);

withRepo(
  {
    "settings/rolara/a/Alpha.md": article(
      "publish: false\ntype: Concept",
      "Code: `[[NotALink]]`\n\n```\n[[AlsoNotALink]]\n```\n\nReal: [[Beta]] and an image ![[map.png]] and a self link [[#Top]]."
    ),
    "settings/rolara/b/Beta.md": article("publish: false\ntype: Concept", "x"),
  },
  (root) => {
    const r = assertLinkIntegrity({ cwd: root, settings: SETTINGS });
    check("a wikilink inside a code span is not asserted", r.ok, true);
    check("and neither is one inside a fenced block, an attachment, or a bare anchor",
      r.dead, []);
  }
);

console.log("\nThe snapshot precedes every mutation");

withRepo(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
  },
  (root) => {
    // A dirty tree means the snapshot commit does not contain the current state,
    // so there is nothing to restore to. Refuse before touching anything.
    writeInto(root, "settings/rolara/items/Sword.md", article("publish: false\ntype: Item", "Edited."));
    const before = snapshotTree(root);
    const r = apply(root, [
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/items/Sword.md",
        to: "settings/rolara/items/Sword-of-Dawn.md",
        reason: "suffix",
      },
    ]);
    check("a dirty working tree refuses the run", r.refused && r.refused.reason, "dirty-tree");
    check("nothing was applied", bucketTotal(r), 0);
    check("and the project is untouched", snapshotTree(root), before);
  }
);

withBareDir(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
  },
  (root) => {
    // No repository means no snapshot, and it also means the git-ignored
    // question cannot be answered: prechecks.ignored is null, which is NOT the
    // same claim as "nothing is ignored". Refuse rather than read it as empty.
    const before = snapshotTree(root);
    const r = apply(root, [
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/items/Sword.md",
        to: "settings/rolara/items/Sword-of-Dawn.md",
        reason: "suffix",
      },
    ]);
    check("an undetermined ignored verdict refuses the run",
      r.refused && r.refused.reason, "ignored-undetermined");
    check("the refusal says the question could not be answered",
      /could not be determined/.test((r.refused || {}).detail || ""), true);
    check("nothing was applied", bucketTotal(r), 0);
    check("and the project is untouched", snapshotTree(root), before);
  }
);

console.log("\nA plan the apply phase will not execute");

withRepo(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "settings/rolara/items/Sword of Dawn.md": article("publish: false\ntype: Item", "Another blade."),
  },
  (root) => {
    const before = snapshotTree(root);
    const r = apply(root, [
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/items/Sword.md",
        to: "settings/rolara/items/Sword-of-Dawn.md",
        reason: "charset",
      },
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/items/Sword of Dawn.md",
        to: "settings/rolara/items/Sword-of-Dawn.md",
        reason: "charset",
      },
    ]);
    check("a collision refuses the run", r.refused && r.refused.reason, "collisions");
    check("nothing was applied", bucketTotal(r), 0);
    check("and the project is untouched", snapshotTree(root), before);
  }
);

withRepo(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
  },
  (root) => {
    const before = snapshotTree(root);
    // from and to are both present, so a lenient executor that fell back to a
    // move for an unrecognized kind would really move the file. Without them the
    // untouched assertion would hold no matter what the guard did.
    const unknown = apply(root, [
      {
        op: "obliterate",
        from: "settings/rolara/items/Sword.md",
        to: "settings/rolara/items/Gone.md",
        reason: "hand-edited into the plan",
      },
    ]);
    check("an operation kind the executor does not know refuses the run",
      unknown.refused && unknown.refused.reason, "unknown-operation");
    check("the refusal names the kind", /obliterate/.test((unknown.refused || {}).detail || ""), true);
    check("and the project is untouched", snapshotTree(root), before);

    // split and absorb are structural judgments about the DM's own material.
    // The plan phase puts them in `declined`; a hand-edited plan that promotes
    // one into `operations` is still refused here.
    const deferred = apply(root, [
      {
        op: "split",
        target: "settings/rolara/items",
        from: "settings/rolara/items",
        to: "settings/rolara/blades",
        reason: "hand-edited into the plan",
      },
    ]);
    check("a deferred operation promoted into the plan refuses the run",
      deferred.refused && deferred.refused.reason, "deferred-operation");
    check("the deferred refusal names the kind", /split/.test((deferred.refused || {}).detail || ""), true);
    check("and the project is still untouched", snapshotTree(root), before);
  }
);

withRepo(
  {
    "settings/rolara/history/First-Age.md": article("publish: false\ntype: chronology", "Long ago."),
  },
  (root) => {
    const before = snapshotTree(root);
    // A rename before its type normalization computes the suffix from a stale
    // type value. The declared order is the dependency order, so a plan handed
    // back out of order is refused rather than half-run.
    const r = apply(root, [
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/history/First-Age.md",
        to: "settings/rolara/history/First-Age-CHRONOLOGY.md",
        reason: "suffix",
      },
      {
        op: "normalize-type",
        from: "settings/rolara/history/First-Age.md",
        typeFrom: "chronology",
        typeTo: "Chronology",
        reason: "enum",
      },
    ]);
    check("a plan whose operations are out of the declared order refuses the run",
      r.refused && r.refused.reason, "out-of-order");
    check("and the project is untouched", snapshotTree(root), before);
  }
);

console.log("\nNormalize type edits the value and nothing else");

withRepo(
  {
    "settings/rolara/history/First-Age.md":
      '---\npublish: false\ntype: "chronology"  # legacy lowercase\ntags: [era]\n---\n\nLong ago.\n',
  },
  (root) => {
    const r = apply(root, [
      {
        op: "normalize-type",
        from: "settings/rolara/history/First-Age.md",
        typeFrom: "chronology",
        typeTo: "Chronology",
        reason: "enum",
      },
    ]);
    check("the normalization is applied", r.applied.length, 1);
    const text = read(root, "settings/rolara/history/First-Age.md");
    check("the corrected value keeps the original quoting",
      text.includes('type: "Chronology"'), true);
    check("the inline comment survives", text.includes("# legacy lowercase"), true);
    check("no other field moved",
      text.split("\n").slice(1, 4), ["publish: false", 'type: "Chronology"  # legacy lowercase', "tags: [era]"]);
  }
);

withRepo(
  {
    "settings/rolara/history/First-Age.md": article("publish: false\ntype: Chronology", "Long ago."),
  },
  (root) => {
    // The plan carries typeFrom so the apply phase can match on it. A file that
    // no longer holds that value is a stale plan, and guessing is worse than
    // reporting.
    const r = apply(root, [
      {
        op: "normalize-type",
        from: "settings/rolara/history/First-Age.md",
        typeFrom: "chronology",
        typeTo: "Something-Else",
        reason: "enum",
      },
    ]);
    check("a type that no longer matches typeFrom is not rewritten", r.failed.length, 1);
    check("and the file is left exactly as it was",
      read(root, "settings/rolara/history/First-Age.md").includes("type: Chronology"), true);
  }
);

console.log("\nIndex creation and the tag registry");

withRepo(
  {
    "settings/rolara/culture/Feasts.md": article("publish: false\ntype: Concept", "x"),
    "settings/rolara/culture/Rites.md": article("publish: false\ntype: Concept", "x"),
  },
  (root) => {
    const r = apply(
      root,
      [
        {
          op: "create-index",
          to: "settings/rolara/culture/Culture-INDEX.md",
          reason: "folder holds content but no index",
        },
      ],
      { baseRules: BASE_RULES_DISTINCT_INDEX_TYPE }
    );
    check("the index is created", r.applied.length, 1);
    const text = read(root, "settings/rolara/culture/Culture-INDEX.md");
    check("its type comes from the suffix mapping the filename satisfies, not a hardcoded fallback",
      /^type: Folder Index$/m.test(text), true);
    check("it carries no publish field", /^publish\s*:/m.test(text), false);
    check("it lists every article in the folder",
      text.includes("[[Feasts]]") && text.includes("[[Rites]]"), true);
    check("and the links it writes all resolve",
      assertLinkIntegrity({ cwd: root, settings: SETTINGS }).ok, true);
  }
);

withRepo(
  {
    "settings/rolara/a/Alpha.md": article("publish: false\ntype: Concept\ntags: [faction, politics]", "x"),
    "settings/rolara/b/Beta.md": article("publish: false\ntype: Concept\ntags:\n  - faction\n  - trade", "x"),
    ".professor-orb/tag-registry.rolara.json": "{}\n",
  },
  (root) => {
    const r = apply(root, [
      {
        op: "tag-registry",
        to: ".professor-orb/tag-registry.rolara.json",
        reason: "regenerate",
      },
    ]);
    check("the registry is regenerated", r.applied.length, 1);
    check("counting both the inline and the block tag forms",
      parsed(read(root, ".professor-orb/tag-registry.rolara.json")),
      { faction: 2, politics: 1, trade: 1 });
  }
);

console.log("\nThe vault boundary");

withRepo(
  {
    "settings/rolara/a/Alpha.md": article("publish: false\ntype: Concept", "x"),
  },
  (root) => {
    const r = apply(root, [
      { op: "vault", to: "settings/rolara/.obsidian", reason: "one vault per setting" },
    ]);
    check("a vault is created", r.applied.length, 1);
    check("as a real directory Obsidian will recognize",
      has(root, "settings/rolara/.obsidian/app.json"), true);
  }
);

withRepo(
  {
    "settings/rolara/a/Alpha.md": article("publish: false\ntype: Concept", "x"),
    "settings/rolara/.obsidian/app.json": '{"theme":"obsidian"}\n',
  },
  (root) => {
    // A resync against a project whose vault is already there. This is the
    // ordinary second run, and the reference consumer is already in that state,
    // so the create shape has to be idempotent rather than destructive: the
    // marker is written only when absent, so the DM's own Obsidian settings
    // survive untouched.
    const r = apply(root, [
      { op: "vault", to: "settings/rolara/.obsidian", reason: "one vault per setting" },
    ]);
    check("a resync over an existing vault is not refused", r.refused, null);
    check("and applies as a no-op rather than failing", r.applied.length, 1);
    check("without overwriting the DM's own Obsidian settings",
      read(root, "settings/rolara/.obsidian/app.json"), '{"theme":"obsidian"}\n');
  }
);

withRepo(
  {
    "settings/rolara/a/Alpha.md": article("publish: false\ntype: Concept", "x"),
    "settings/rolara/.obsidian/app.json": "{}\n",
    "settings/karsk/.obsidian/app.json": '{"theme":"obsidian"}\n',
  },
  (root) => {
    // The MEASUREMENT behind keeping the vault MOVE shape checked in the plan
    // phase, driven through applyOperation so the plan-phase abort does not
    // stand in front of it. git mv onto a destination that is already a
    // directory does NOT fail: it reports success and moves the source INSIDE
    // the destination. That is why the destination-may-exist exemption covers
    // the create shape only; exempting the kind wholesale would let this land
    // silently and leave the setting with no vault where Obsidian looks.
    const entry = applyOperation(
      {
        op: "vault",
        from: "settings/rolara/.obsidian",
        to: "settings/karsk/.obsidian",
        reason: "move the vault",
      },
      {
        cwd: root,
        git: (argv) => {
          try {
            return { ok: true, stdout: git(root, argv), stderr: "" };
          } catch (err) {
            return { ok: false, stdout: "", stderr: String((err && (err.stderr || err.message)) || err) };
          }
        },
        settings: SETTINGS,
        baseRules: BASE_RULES,
        ruleSources: [BASE_RULES],
        settingForPath: () => SETTINGS[0],
      }
    );
    check("git mv onto an existing directory reports success rather than failing",
      entry.applied, true);
    check("while actually nesting the source inside the destination",
      has(root, "settings/karsk/.obsidian/.obsidian/app.json"), true);
    check("so the destination the setting needs is not the vault that moved",
      read(root, "settings/karsk/.obsidian/app.json"), '{"theme":"obsidian"}\n');
  }
);

console.log("\nEvery operation lands in exactly one bucket");

withRepo(
  {
    ".gitignore": "settings/rolara/editor-state/\n",
    "settings/rolara/editor-state/scratch.md": article("publish: false\ntype: Concept", "x"),
    "settings/rolara/history/First-Age.md": article("publish: false\ntype: chronology", "Long ago."),
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "- [[Sword]]"),
    "settings/rolara/locations/Tavern.md": "---\ntype: Location\ntags: [city]\n---\n\nA tavern.\n",
  },
  (root) => {
    const operations = [
      {
        op: "normalize-type",
        from: "settings/rolara/history/First-Age.md",
        typeFrom: "chronology",
        typeTo: "Chronology",
        reason: "enum",
      },
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/editor-state/scratch.md",
        to: "settings/rolara/editor-state/Scratch-CONCEPT.md",
        reason: "suffix",
      },
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/items/Sword.md",
        to: "settings/rolara/items/Sword-of-Dawn.md",
        links: ["settings/rolara/items/Items-INDEX.md"],
        reason: "suffix",
      },
      {
        op: "repair-frontmatter",
        from: "settings/rolara/locations/Tavern.md",
        insert: [],
        reorder: true,
        reason: "canonical order",
      },
    ];
    // One worker returns nothing at all, the shape validation-sweep's dropped
    // accounting exists for: a half-applied run must never read as complete.
    const droppingWorker = (op, ctx) => (op.op === "repair-frontmatter" ? null : applyOperation(op, ctx));
    const r = applyPlan(
      { operations },
      { cwd: root, settings: SETTINGS, baseRules: BASE_RULES, commit: false, worker: droppingWorker }
    );
    check("every operation is accounted for exactly once", bucketTotal(r), operations.length);
    check("the worker that returned nothing is counted as dropped, not as done",
      r.dropped.map((d) => d.op), ["repair-frontmatter"]);
    check("the ignored source is skipped", r.skipped.length, 1);
    check("the rest are applied", r.applied.length, 2);
    check("and the run is not reported ok while work was dropped", r.ok, false);
  }
);

withRepo(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "- [[Sword]]"),
    "settings/rolara/locations/Tavern.md": "---\ntype: Location\ntags: [city]\n---\n\nA tavern.\n",
  },
  (root) => {
    // A worker that throws must not escape mid-run: that would abandon the rest
    // of the plan, skip the link-integrity assertion, and return nothing at all
    // about a repository that has already been half-migrated.
    const throwingWorker = (op, ctx) => {
      if (op.op === "rename-with-link-rewrite") throw new Error("worker exploded");
      return applyOperation(op, ctx);
    };
    let raw = null;
    let escaped = null;
    try {
      raw = applyPlan(
        {
          operations: [
            {
              op: "rename-with-link-rewrite",
              from: "settings/rolara/items/Sword.md",
              to: "settings/rolara/items/Sword-of-Dawn.md",
              links: ["settings/rolara/items/Items-INDEX.md"],
              reason: "suffix",
            },
            {
              op: "repair-frontmatter",
              from: "settings/rolara/locations/Tavern.md",
              insert: [],
              reorder: true,
              reason: "canonical order",
            },
          ],
        },
        { cwd: root, settings: SETTINGS, baseRules: BASE_RULES, commit: false, worker: throwingWorker }
      );
    } catch (err) {
      escaped = err;
    }
    check("the throw does not escape applyPlan", escaped === null, true);
    const r = raw || { applied: [], failed: [], dropped: [], skipped: [], messages: [], linkIntegrity: null };
    check("a worker that throws is counted as a drop, not an escape",
      r.dropped.map((d) => d.op), ["rename-with-link-rewrite"]);
    check("the operations after it still run", r.applied.length, 1);
    check("the throw is reported",
      r.messages.some((m) => /worker exploded/.test(m)), true);
    check("and the link-integrity assertion still ran", links(r).ok, true);
  }
);

console.log("\nWikilink rewriting in isolation");

{
  const cases = [
    ["[[Sword]]", "[[Blade]]"],
    ["[[Sword|the sword]]", "[[Blade|the sword]]"],
    ["[[Sword\\|the sword]]", "[[Blade\\|the sword]]"],
    ["[[Sword#Origins]]", "[[Blade#Origins]]"],
    ["[[items/Sword]]", "[[items/Blade]]"],
    ["[[Sword.md]]", "[[Blade.md]]"],
    ["![[Sword]]", "![[Blade]]"],
    ["[[Swordfish]]", "[[Swordfish]]"],
    ["[[Sword of Dawn]]", "[[Sword of Dawn]]"],
  ];
  for (const [input, expected] of cases) {
    check(`rewrite ${input}`, rewriteWikilinks(input, "Sword", "Blade").text, expected);
  }
  check("a case-only rename rewrites the referring links too",
    rewriteWikilinks("[[items-index]]", "items-index", "items-INDEX").text, "[[items-INDEX]]");
  // Obsidian resolves wikilinks case-insensitively, so [[Items-Index]] is a
  // LIVE link to items-index.md and has to travel with the rename. The exact
  // spelling above matches whether or not the comparison folds case, so on its
  // own it proved nothing about the folding.
  check("and matching folds case, the way Obsidian resolves",
    rewriteWikilinks("[[Items-Index]]", "items-index", "items-INDEX").text, "[[items-INDEX]]");
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
