#!/usr/bin/env node
// Regression test for the /scribe and /log staging mechanism.
//
// Both commands commit exactly one lane of a shared repository (the setting
// KB for /scribe, the session-reports/campaign folder for /log). Two obvious
// implementations of "commit only this lane" are wrong in opposite
// directions, verified against real git rather than reasoned about:
//
//   - `git commit --only -- <lane>` with no prior `git add` silently omits
//     new files whenever a modified tracked file is also present in the
//     lane (there is something else to commit, so the command succeeds and
//     simply drops the new file with no error). When the lane holds ONLY
//     new files, there is nothing else for --only to fall back to, so the
//     command fails outright with "nothing added to commit" instead: a
//     different failure shape, not silence, but still a failure to capture
//     the lane's primary artifact.
//   - `git add -- <lane>` then a BARE `git commit` (no pathspec) commits the
//     entire index, sweeping in anything the DM staged from another lane.
//
// The verified mechanism is both steps, in order, with the same pathspec:
//   git add -- <lane paths>
//   git commit --only -- <lane paths>
//
// A third failure mode lives one level down, inside the pathspec itself: a
// bare pathspec is not a literal path. `--` stops OPTION parsing, but git
// still reads `*`, `?`, and `[` inside the pathspec that follows as
// wildcards. Measured against real git (case 3 below): a lane directory
// named `settings/zi[st]` sitting next to an unrelated file `settings/zis`
// causes a bare `git add -- settings/zi[st]` to stage `settings/zis` too,
// and that unrelated file rides along into the commit. A setting or
// campaign name is DM-chosen and can plausibly contain any of those
// characters. Wrapping the pathspec in git's literal pathspec magic,
// `:(literal)`, closes this: `--` and `:(literal)` fix different halves of
// the same line, so both stay in the mechanism.
//
// This file proves that mechanism against a disposable repo built with
// uncommitted work in all three lanes, a modified file at the repo root,
// and an out-of-lane path already staged before the command runs, plus a
// second fixture where the lane holds only new files, plus a third fixture
// with a glob-charactered lane name next to a sibling the glob would
// otherwise match. Node built-ins only, no test framework, no writes
// anywhere near this checkout: every fixture lives under os.tmpdir() and is
// removed after its case runs.
//
// Run: node professor-orb/commands/lane-staging.test.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

let passed = 0;
const failures = [];

function check(name, actual, expected, note) {
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
  if (note) console.log(`         note: ${note}`);
}

function git(cwd, args, allowFail = false) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (e) {
    if (allowFail) {
      return { failed: true, status: e.status, stderr: (e.stderr || "").trim() };
    }
    throw e;
  }
}

function freshRepo(label) {
  const dir = path.join(os.tmpdir(), `orb-lane-staging-${label}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "proto@example.invalid"]);
  git(dir, ["config", "user.name", "proto"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}

function write(dir, rel, content) {
  const abs = path.join(dir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  return abs;
}

function filesInHead(dir) {
  return git(dir, ["show", "--pretty=", "--name-only", "HEAD"])
    .split("\n")
    .filter(Boolean)
    .sort();
}

function stagedPaths(dir) {
  return git(dir, ["diff", "--cached", "--name-only"])
    .split("\n")
    .filter(Boolean)
    .sort();
}

function statusLines(dir) {
  // Deliberately does not reuse the shared git() helper: that helper calls
  // .trim() on the whole multi-line blob, which strips the leading space off
  // porcelain's FIRST line whenever that line reads clean-index/dirty-worktree
  // (" M path") and happens to sort first (an uppercase-leading path like
  // README.md sorts before lowercase folder names in git's own path order).
  // That corruption silently turned " M README.md" into "M README.md" here,
  // a false failure in the test, not in the mechanism under test. Right-trim
  // only the trailing newline so every line's leading two status columns
  // survive intact.
  const raw = execFileSync("git", ["status", "--porcelain"], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return raw
    .replace(/[\r\n]+$/, "")
    .split("\n")
    .filter(Boolean)
    .sort();
}

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

console.log(
  "=== case 1: mixed lane (new + modified), foreign pre-staged path, other lanes and root dirty ==="
);
{
  const dir = freshRepo("mixed");
  const LANE = "settings/rolara";

  // Baseline: tracked content in all three lanes plus the repo root.
  write(dir, "settings/rolara/Thoric.md", "old\n");
  write(dir, "homebrew/rolara/Bond.md", "old\n");
  write(dir, "session-reports/rolara/ashes/R1-REPORT.md", "old\n");
  write(dir, "README.md", "old\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "baseline"]);

  // A new file and a modified file inside the lane; churn in both other
  // lanes and at the root; and a foreign path the DM already staged
  // themselves, before the lane command ever ran.
  write(dir, "settings/rolara/NewArticle.md", "new\n");
  write(dir, "settings/rolara/Thoric.md", "modified\n");
  write(dir, "homebrew/rolara/NewEntry.md", "new\n");
  write(dir, "session-reports/rolara/ashes/R1-REPORT.md", "mod\n");
  write(dir, "README.md", "modified\n");
  git(dir, ["add", "--", "homebrew/rolara/NewEntry.md"]); // pre-staged foreign path

  const preStaged = stagedPaths(dir);
  check(
    "setup: exactly the foreign path is staged before the lane command runs",
    preStaged,
    ["homebrew/rolara/NewEntry.md"]
  );

  const result = stageAndCommitLane(dir, LANE, "kb(rolara): add Thoric article, update Person-INDEX");
  check("git add -- <lane> then git commit --only -- <lane> succeeds", !(result && result.failed), true, result && result.failed ? result.stderr : undefined);

  check(
    "commits exactly the lane's new and modified files, nothing from another lane or the root",
    filesInHead(dir),
    ["settings/rolara/NewArticle.md", "settings/rolara/Thoric.md"]
  );

  check(
    "the pre-staged foreign path is neither committed nor unstaged: still staged, untouched",
    stagedPaths(dir),
    ["homebrew/rolara/NewEntry.md"]
  );

  check(
    "other lanes and the root stay dirty: exactly the expected status lines remain",
    statusLines(dir),
    [" M README.md", " M session-reports/rolara/ashes/R1-REPORT.md", "A  homebrew/rolara/NewEntry.md"]
  );
}

console.log("\n=== case 2: the lane holds only new files ===");
{
  const dir = freshRepo("only-new");
  const LANE = "settings/rolara";

  write(dir, "settings/rolara/Existing.md", "old\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "baseline"]);

  const before = git(dir, ["rev-parse", "HEAD"]);

  write(dir, "settings/rolara/BrandNew.md", "new\n"); // untracked, no modified file alongside it

  // Control: the trap candidate (commit --only, no prior add) against a lane
  // holding only new files. Distinct failure shape from the mixed case
  // above: there is no modified tracked file for --only to fall back to, so
  // it fails outright rather than silently dropping the new file.
  const trap = git(dir, ["commit", "-q", "--only", "-m", "wrong mechanism", "--", LANE], true);
  check(
    "control: `git commit --only -- <lane>` alone fails outright when the lane has only new files",
    !!(trap && trap.failed),
    true,
    trap && trap.failed ? `failed as expected: ${trap.stderr.split("\n")[0]}` : "did not fail: the trap did not reproduce"
  );
  check("control: HEAD did not move from the failed attempt", git(dir, ["rev-parse", "HEAD"]), before);

  const result = stageAndCommitLane(dir, LANE, "kb(rolara): add BrandNew article");
  check("git add -- <lane> then git commit --only -- <lane> succeeds for a new-files-only lane", !(result && result.failed), true, result && result.failed ? result.stderr : undefined);

  const after = git(dir, ["rev-parse", "HEAD"]);
  check("a real commit results: HEAD actually advances", after !== before, true);
  check("the commit contains exactly the new file", filesInHead(dir), ["settings/rolara/BrandNew.md"]);
  check("nothing is left dirty or staged after committing a clean new-files-only lane", statusLines(dir), []);
}

console.log(
  "\n=== case 3: a lane name with glob characters must not escape into a sibling ==="
);
{
  // `[st]` is git pathspec magic for "one character from the set s, t"
  // unless the pathspec carries :(literal). Windows forbids literal * and ?
  // in filenames, so this fixture exercises the bracket character only; see
  // the task report for which characters could and could not be built as
  // real directory/file names on this filesystem. The fix itself (wrapping
  // the whole pathspec in :(literal)) disables wildcard interpretation
  // uniformly, not per-character, so proving it neutralizes bracket
  // matching is evidence it neutralizes the same code path for * and ? too.
  const dir = freshRepo("glob-escape");
  const LANE = "settings/zi[st]";
  // SIBLING is deliberately a plain FILE, not a directory, sitting beside
  // the lane. Verified against real git: a sibling that is itself a
  // directory (e.g. settings/zis/Sibling.md) does NOT reproduce the escape
  // on this git version for a bare, non-glob-suffixed directory pathspec
  // like the commands use; a sibling file at exactly the matched path does.
  const SIBLING = "settings/zis";

  write(dir, `${LANE}/Existing.md`, "old\n");
  write(dir, SIBLING, "sibling old\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "baseline"]);

  const before = git(dir, ["rev-parse", "HEAD"]);

  function dirtyTheFixture() {
    write(dir, `${LANE}/Existing.md`, "modified\n");
    write(dir, `${LANE}/NewArticle.md`, "new\n");
    write(dir, SIBLING, "sibling modified - must stay out of the lane commit\n");
  }

  dirtyTheFixture();

  // Control: the rejected candidate, the exact mechanism the commands used
  // before the :(literal) fix. Proves the case can fail: a bare pathspec
  // built from a bracketed lane name sweeps the sibling file in. Inlined
  // (rather than a one-shot helper like stageAndCommitLane) so the staged
  // set can be inspected between the add and the commit --only: by the time
  // both steps finish, the index is clean again either way.
  git(dir, ["add", "--", LANE]);
  check(
    "control: bare (non-literal) `git add -- <lane>` stages the sibling file too",
    stagedPaths(dir).includes(SIBLING),
    true,
    "reproduces the escape: git add -- settings/zi[st] (no :(literal)) also matched settings/zis"
  );
  const trapResult = git(
    dir,
    ["commit", "-q", "-m", "kb(zi[st]): bare pathspec control, expected to leak", "--only", "--", LANE],
    true
  );
  check(
    "control: the resulting commit contains the sibling file, not just the lane, this is the red case",
    filesInHead(dir).includes(SIBLING),
    true,
    trapResult && trapResult.failed ? `unexpected failure: ${trapResult.stderr}` : "goes red exactly as expected"
  );

  // Roll the control commit and its worktree churn back, then rebuild the
  // identical dirty state for the verified mechanism below.
  git(dir, ["reset", "-q", "--hard", before]);
  git(dir, ["clean", "-qfd"]);
  dirtyTheFixture();

  const result = stageAndCommitLane(dir, LANE, "kb(zi[st]): add NewArticle, update Existing");
  check(
    "git add -- :(literal)<lane> then git commit --only -- :(literal)<lane> succeeds",
    !(result && result.failed),
    true,
    result && result.failed ? result.stderr : undefined
  );

  check(
    "commits exactly the lane's files, nothing from the sibling the bare glob would otherwise match",
    filesInHead(dir),
    [`${LANE}/Existing.md`, `${LANE}/NewArticle.md`].sort()
  );

  check(
    "the sibling file is left dirty and untouched: not staged, not committed",
    statusLines(dir),
    [` M ${SIBLING}`]
  );
}

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

console.log(`\n${passed}/${passed + failures.length} expectations met.`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
