#!/usr/bin/env node
// Regression suite for the AskUserQuestion option recorder.
//
// The recorder stores EVERY option offered, not only those selected. That is
// deliberate and it is what makes the optionEcho check cover the 2026-09-18
// case as the DM describes it: they state the option was never selected on
// their screen. Matching against the full offered set catches a phantom
// selection and a real one alike, and removes any dependence on the shape of
// tool_response.
//
// Run: node professor-orb/hooks/record-options.test.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "record-options.mjs");

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failures.push(name);
    console.log(`  [FAIL] ${name}`);
    console.log(`         expected: ${JSON.stringify(expected)}`);
    console.log(`         actual:   ${JSON.stringify(actual)}`);
  }
}

function fixture(name) {
  const dir = path.join(os.tmpdir(), `orb-rec-${name}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, ".professor-orb"), { recursive: true });
  return dir;
}

function run(dir, sessionId, questions) {
  execFileSync("node", [HOOK], {
    input: JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "AskUserQuestion",
      session_id: sessionId,
      cwd: dir,
      tool_input: { questions },
    }),
    encoding: "utf8",
  });
}

function state(dir) {
  const p = path.join(dir, ".professor-orb", "asked-options.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

const ASKED = [
  {
    question: "What happened in the aftermath?",
    header: "Aftermath",
    multiSelect: true,
    options: [
      { label: "Reporter asked the name", description: "The team answered on camera as the Neighborhood Watch Association" },
      { label: "Nothing on camera", description: "The crash site cleared without press" },
    ],
  },
];

console.log("recording:");
(function () {
  const dir = fixture("basic");
  run(dir, "s1", ASKED);
  const s = state(dir);
  check("session id recorded", s.sessionId, "s1");
  check("both options recorded, selected or not", s.options.length, 2);
  check(
    "label and description joined",
    s.options[0],
    "Reporter asked the name. The team answered on camera as the Neighborhood Watch Association"
  );
  rmSync(dir, { recursive: true, force: true });
})();

console.log("appending and session rollover:");
(function () {
  const dir = fixture("append");
  run(dir, "s1", ASKED);
  run(dir, "s1", ASKED);
  check("same session appends", state(dir).options.length, 4);
  run(dir, "s2", ASKED);
  const s = state(dir);
  check("new session resets", s.options.length, 2);
  check("new session id stored", s.sessionId, "s2");
  rmSync(dir, { recursive: true, force: true });
})();

console.log("fail-silent contract:");
(function () {
  const dir = fixture("silent");
  // No .professor-orb directory: setup never ran, so the recorder writes nothing.
  const bare = path.join(os.tmpdir(), `orb-rec-bare-${process.pid}`);
  rmSync(bare, { recursive: true, force: true });
  mkdirSync(bare, { recursive: true });
  run(bare, "s1", ASKED);
  check("no .professor-orb means no state file", state(bare), null);
  rmSync(bare, { recursive: true, force: true });

  let threw = false;
  try {
    execFileSync("node", [HOOK], { input: "not json", encoding: "utf8" });
  } catch {
    threw = true;
  }
  check("malformed stdin exits 0", threw, false);

  run(dir, "s1", [{ question: "q", header: "h", multiSelect: false, options: "not an array" }]);
  check("malformed questions writes nothing", state(dir), null);
  rmSync(dir, { recursive: true, force: true });
})();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
