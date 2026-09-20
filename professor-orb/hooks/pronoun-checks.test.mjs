#!/usr/bin/env node
// Regression suite for the two pronoun checks.
//
// pronounDeclaration is the root fix: an article listing three pronoun sets
// with none named for writing reads as a choice, and party/Psyche.md read
// exactly that way while every other source used they throughout.
//
// pronounConsistency is the backstop and is deliberately narrow. It fires only
// when an article names ONE set for writing AND lists others, and the body uses
// one of the others. With no other set listed there is nothing to confuse, so
// there is nothing to flag, and a narrow check is worth more than a noisy one.
//
// Run: node professor-orb/hooks/pronoun-checks.test.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(HERE, "validate-write.mjs");
const RULES = path.join(HERE, "..", "references", "base-rules.json");

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  if (actual === expected) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failures.push(name);
    console.log(`  [FAIL] ${name}: expected ${expected}, got ${actual}`);
  }
}

// Writes a fixture project whose kbRoot holds the given articles, then returns
// the absolute path of the one to validate.
function fixture(name, articles, targetRel) {
  const dir = path.join(os.tmpdir(), `orb-pron-${name}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, ".professor-orb"), { recursive: true });
  const base = JSON.parse(readFileSync(RULES, "utf8"));
  writeFileSync(
    path.join(dir, ".professor-orb", "conventions.json"),
    JSON.stringify({
      schemaVersion: 3,
      settings: [{ name: "adjustice", kbRoot: "kb", sessionReportsRoot: "session-reports", rules: base.rules }],
    })
  );
  for (const [rel, content] of Object.entries(articles)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return { dir, file: path.join(dir, targetRel) };
}

// Returns the validator's combined output. warn rules arrive on stdout inside
// hookSpecificOutput.additionalContext; block rules arrive on stderr with exit 2.
function runValidator(dir, file) {
  try {
    const out = execFileSync("node", [HOOK], {
      cwd: dir,
      input: JSON.stringify({
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        cwd: dir,
        tool_input: { file_path: file },
      }),
      encoding: "utf8",
    });
    return out;
  } catch (err) {
    return `${err.stdout || ""}${err.stderr || ""}`;
  }
}

const PSYCHE_AMBIGUOUS = ["---", "type: Person", "---", "", "*Pronouns: she, they, and he.*", "", "Nika leads the team.", ""].join("\n");
const PSYCHE_NAMED = ["---", "type: Person", "---", "", "*Pronouns: they/them in writing; she/her and he/him also accepted.*", "", "Nika leads the team.", ""].join("\n");
const PSYCHE_SINGLE = ["---", "type: Person", "---", "", "*Pronouns: they/them.*", "", "Nika leads the team.", ""].join("\n");

console.log("pronounDeclaration:");
(function () {
  let f = fixture("ambiguous", { "kb/party/Psyche.md": PSYCHE_AMBIGUOUS }, "kb/party/Psyche.md");
  check("three sets with none named for writing warns", runValidator(f.dir, f.file).includes("contentPronounDeclaration"), true);
  rmSync(f.dir, { recursive: true, force: true });

  f = fixture("named", { "kb/party/Psyche.md": PSYCHE_NAMED }, "kb/party/Psyche.md");
  check("a named writing pronoun passes", runValidator(f.dir, f.file).includes("contentPronounDeclaration"), false);
  rmSync(f.dir, { recursive: true, force: true });

  f = fixture("single", { "kb/party/Psyche.md": PSYCHE_SINGLE }, "kb/party/Psyche.md");
  check("one set alone passes", runValidator(f.dir, f.file).includes("contentPronounDeclaration"), false);
  rmSync(f.dir, { recursive: true, force: true });
})();

console.log("pronounConsistency:");
(function () {
  const recapWrong = ["---", "type: Session Report", "---", "", "Psyche stepped through the gate. She had seen this before.", ""].join("\n");
  const recapRight = ["---", "type: Session Report", "---", "", "Psyche stepped through the gate. They had seen this before.", ""].join("\n");

  let f = fixture("wrong", { "kb/party/Psyche.md": PSYCHE_NAMED, "session-reports/r.md": recapWrong }, "session-reports/r.md");
  check("a draft using a non-writing set warns", runValidator(f.dir, f.file).includes("contentPronounConsistency"), true);
  rmSync(f.dir, { recursive: true, force: true });

  f = fixture("right", { "kb/party/Psyche.md": PSYCHE_NAMED, "session-reports/r.md": recapRight }, "session-reports/r.md");
  check("a draft using the writing set passes", runValidator(f.dir, f.file).includes("contentPronounConsistency"), false);
  rmSync(f.dir, { recursive: true, force: true });

  f = fixture("single-src", { "kb/party/Psyche.md": PSYCHE_SINGLE, "session-reports/r.md": recapWrong }, "session-reports/r.md");
  check("no other set listed means nothing to confuse, so no warning", runValidator(f.dir, f.file).includes("contentPronounConsistency"), false);
  rmSync(f.dir, { recursive: true, force: true });

  f = fixture("absent", { "session-reports/r.md": recapWrong }, "session-reports/r.md");
  check("no article for the name passes", runValidator(f.dir, f.file).includes("contentPronounConsistency"), false);
  rmSync(f.dir, { recursive: true, force: true });
})();

console.log("pronounConsistency does not fire on a stray pronoun for a different character:");
(function () {
  // The exact shape the final review reproduced: Psyche is used CORRECTLY
  // ("they"), and a second, unrelated character is described with "she".
  // Before the fix this warned anyway, because the check tested "she" against
  // the whole document rather than against Psyche specifically.
  const recapMixed = [
    "---", "type: Session Report", "---", "",
    "Psyche opened the warehouse door and they went in first.",
    "Detective Ramos met the party at the gate. She had been waiting an hour.",
    "",
  ].join("\n");
  const f = fixture("mixed-characters", { "kb/party/Psyche.md": PSYCHE_NAMED, "session-reports/r.md": recapMixed }, "session-reports/r.md");
  check(
    "a stray pronoun for someone else does not warn when the writing pronoun also appears",
    runValidator(f.dir, f.file).includes("contentPronounConsistency"),
    false
  );
  rmSync(f.dir, { recursive: true, force: true });
})();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
