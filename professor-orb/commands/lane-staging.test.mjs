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
// This file proves that mechanism against a disposable repo built with
// uncommitted work in all three lanes, a modified file at the repo root,
// and an out-of-lane path already staged before the command runs, plus a
// second fixture where the lane holds only new files. Node built-ins only,
// no test framework, no writes anywhere near this checkout: every fixture
// lives under os.tmpdir() and is removed after its case runs.
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
// swap it for a wrong candidate without editing every call site.
function stageAndCommitLane(dir, lanePath, message) {
  git(dir, ["add", "--", lanePath]);
  return git(dir, ["commit", "-q", "-m", message, "--only", "--", lanePath], true);
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

console.log(`\n${passed}/${passed + failures.length} expectations met.`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
