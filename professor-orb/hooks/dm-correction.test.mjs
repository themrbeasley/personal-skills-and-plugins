#!/usr/bin/env node
// Regression suite for the correction-detection hook.
//
// Drives the real hook as a child process the way Claude Code invokes it:
// UserPromptSubmit JSON on stdin, stdout injected into the turn as context.
// Node built-ins only, no test framework.
//
// The must-NOT-fire column matters as much as the must-fire column. This hook
// runs on every DM message, so a pattern list wide enough to catch ordinary
// conversation turns every turn into a lane grep.
//
// Run: node professor-orb/hooks/dm-correction.test.mjs

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "dm-correction.mjs");
const MARKER = "reads as a correction";

let passed = 0;
const failures = [];

function runHook(prompt, cwd) {
  try {
    return execFileSync("node", [HOOK], {
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: cwd || process.cwd(), session_id: "s1" }),
      encoding: "utf8",
    });
  } catch (err) {
    // A non-zero exit is itself a failure of the fail-silent contract; surface
    // the output so the assertion below reports something legible.
    return `HOOK EXITED NON-ZERO: ${err.stdout || ""}${err.stderr || ""}`;
  }
}

function checkFires(prompt, shouldFire) {
  const out = runHook(prompt);
  const fired = out.includes(MARKER);
  if (fired === shouldFire) {
    passed++;
    console.log(`  [PASS] ${shouldFire ? "fires" : "silent"}: ${JSON.stringify(prompt)}`);
  } else {
    failures.push(prompt);
    console.log(`  [FAIL] expected ${shouldFire ? "fire" : "silence"}: ${JSON.stringify(prompt)}`);
    console.log(`         actual output: ${JSON.stringify(out)}`);
  }
}

console.log("must fire:");
[
  "This NEVER fucking happened",
  "that never happened",
  "the reporter thing didn't happen",
  "no that's wrong, the clan name came later",
  "that is incorrect",
  "that's not what I said",
  "I already told you they use they/them",
  "no, it was Pemberton who warned them",
  "you used the wrong pronouns for Psyche again",
].forEach((p) => checkFires(p, true));

console.log("must stay silent:");
[
  "what happened next?",
  "that's right, keep going",
  "I said yes to the first option",
  "never mind, let's move on",
  "write the recap",
  "the party never found the ledger, so they moved on",
  "was that wrong of them in character?",
  "",
].forEach((p) => checkFires(p, false));

console.log("fail-silent contract:");
(function () {
  const out = (() => {
    try {
      return execFileSync("node", [HOOK], { input: "not json at all", encoding: "utf8" });
    } catch (err) {
      return `HOOK EXITED NON-ZERO: ${err.stdout || ""}${err.stderr || ""}`;
    }
  })();
  if (out === "") {
    passed++;
    console.log("  [PASS] malformed stdin exits 0 with no output");
  } else {
    failures.push("malformed stdin");
    console.log(`  [FAIL] malformed stdin produced: ${JSON.stringify(out)}`);
  }
})();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
