#!/usr/bin/env node
// Regression suite for the PostToolUse write-time validator.
//
// Drives the real hook with real PostToolUse payloads against a disposable
// fixture project. Node built-ins only, no test framework.
//
// Run: node professor-orb/hooks/validate-write.test.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "validate-write.mjs");

let passed = 0;
const failures = [];

export function check(name, actual, expected) {
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

// Builds a disposable project, writes the given files and conventions, then
// fires the hook at targetRel as though a Write had just landed there.
export function runHook({ conventions, files, targetRel }) {
  const dir = path.join(os.tmpdir(), `orb-hook-${process.pid}-${Math.abs(hashOf(targetRel))}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  if (conventions !== null) {
    const abs = path.join(dir, ".professor-orb", "conventions.json");
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, JSON.stringify(conventions, null, 2), "utf8");
  }

  const payload = JSON.stringify({
    cwd: dir,
    tool_name: "Write",
    tool_input: { file_path: path.join(dir, targetRel) },
  });

  try {
    const out = execFileSync("node", [HOOK], { input: payload, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "").trim(), err: (e.stderr || "").trim() };
  }
}

// Deterministic per-target temp dir so parallel cases do not collide.
function hashOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export function report() {
  console.log(`\n${passed}/${passed + failures.length} expectations met.`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

const ENUM_RULE = {
  frontmatterTypeEnum: {
    category: "frontmatter",
    check: "enum",
    enforcement: "block",
    description: 'type must be one of the recognized article types.',
    params: { field: "type", values: ["Person", "Location"] },
  },
};

console.log("=== baseline: today's behavior ===");

{
  const r = runHook({
    conventions: null,
    files: { "kb/Bad.md": "---\ntype: Nope\n---\n\nbody\n" },
    targetRel: "kb/Bad.md",
  });
  check("no conventions.json: silent, exit 0", [r.code, r.out, r.err], [0, "", ""]);
}

{
  const r = runHook({
    conventions: { version: 1, kbRoot: "kb", rules: ENUM_RULE },
    files: { "kb/Bad.md": "---\ntype: Nope\n---\n\nbody\n" },
    targetRel: "kb/Bad.md",
  });
  check("v1 file, bad enum value: blocks with exit 2", r.code, 2);
}

console.log("\n=== base rules artifact ===");

{
  const { readFileSync } = await import("node:fs");
  const raw = readFileSync(
    new URL("../references/base-rules.json", import.meta.url),
    "utf8"
  );
  const base = JSON.parse(raw);
  const ids = Object.keys(base.rules);
  check("base-rules.json parses and carries a schemaVersion", typeof base.schemaVersion, "number");
  check("every base rule carries provenance professor-orb",
    ids.every((id) => base.rules[id].provenance === "professor-orb"), true);
  check("no base rule ships an autofix on a filename rule",
    ids.filter((id) => base.rules[id].category === "filename")
       .every((id) => base.rules[id].autofix === undefined), true);
  check("publish is not in the blocking required subset",
    base.rules.frontmatterRequiredSubset.params.requiredSubset, ["type"]);
  // The three frontmatter required-fields rules exist separately because they
  // sit at two different enforcement levels. Pin each one: a later edit that
  // folds them back together would silently promote publish to blocking.
  check("the required subset blocks",
    base.rules.frontmatterRequiredSubset.enforcement, "block");
  check("field order only warns",
    base.rules.frontmatterFieldOrder.enforcement, "warn");
  check("publish presence only warns",
    base.rules.frontmatterPublishPresence.enforcement, "warn");
  check("the type enum carries both groups",
    base.rules.frontmatterTypeEnum.params.values.includes("Person") &&
    base.rules.frontmatterTypeEnum.params.values.includes("magic-item"), true);
}

console.log("\n=== extendedBy and scope ===");

const EXTENDED_ENUM = {
  frontmatterTypeEnum: {
    provenance: "professor-orb",
    category: "frontmatter",
    check: "enum",
    enforcement: "block",
    extendedBy: ["Settlement"],
    description: "type must be recognized.",
    params: { field: "type", values: ["Person", "Location"] },
  },
};

{
  const r = runHook({
    conventions: { version: 2, kbRoot: "kb", rules: EXTENDED_ENUM },
    files: { "kb/A.md": "---\ntype: Settlement\n---\n\nbody\n" },
    targetRel: "kb/A.md",
  });
  check("extendedBy value is accepted", r.code, 0);
}

{
  const r = runHook({
    conventions: { version: 2, kbRoot: "kb", rules: EXTENDED_ENUM },
    files: { "kb/B.md": "---\ntype: Person\n---\n\nbody\n" },
    targetRel: "kb/B.md",
  });
  check("base value still accepted alongside extendedBy", r.code, 0);
}

{
  const r = runHook({
    conventions: { version: 2, kbRoot: "kb", rules: EXTENDED_ENUM },
    files: { "kb/C.md": "---\ntype: Nope\n---\n\nbody\n" },
    targetRel: "kb/C.md",
  });
  check("a value in neither list still blocks", r.code, 2);
}

console.log("\n=== v3 conventions shape ===");

const V3 = {
  version: 3,
  settings: [
    {
      name: "rolara",
      kbRoot: "settings/rolara",
      homebrewRoot: "homebrew/rolara",
      sessionReportsRoot: "session-reports/rolara",
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
  const r = runHook({
    conventions: V3,
    files: { "settings/rolara/Bad.md": "---\ntype: Nope\n---\n\nbody\n" },
    targetRel: "settings/rolara/Bad.md",
  });
  check("v3 file: hook still blocks a bad enum value", r.code, 2);
}

{
  const r = runHook({
    conventions: V3,
    files: { "settings/rolara/Good.md": "---\ntype: Person\n---\n\nbody\n" },
    targetRel: "settings/rolara/Good.md",
  });
  check("v3 file: a valid article passes", r.code, 0);
}

console.log("\n=== scope gate against a real prongKind ===");

// Until this task, ctx.prongKind did not exist, so the gate
// `rule.scope === "kb" && ctx.prongKind && ctx.prongKind !== "kb"` always
// short-circuited on the falsy prongKind and could not be exercised. These
// three cases pin both sides of it plus a control.
function scopedV3(scope) {
  const rule = {
    provenance: "professor-orb",
    category: "frontmatter",
    check: "enum",
    enforcement: "block",
    description: "type must be recognized.",
    params: { field: "type", values: ["Person", "Location"] },
  };
  if (scope) rule.scope = scope;
  return {
    version: 3,
    settings: [
      {
        name: "rolara",
        kbRoot: "settings/rolara",
        homebrewRoot: "homebrew/rolara",
        sessionReportsRoot: "session-reports/rolara",
        rules: { frontmatterTypeEnum: rule },
      },
    ],
  };
}

{
  const r = runHook({
    conventions: scopedV3("kb"),
    files: { "homebrew/rolara/ScopedOut.md": "---\ntype: Nope\n---\n\nbody\n" },
    targetRel: "homebrew/rolara/ScopedOut.md",
  });
  check('scope "kb" rule is skipped for a file in the homebrew prong', r.code, 0);
}

{
  // Control for the case above: the same homebrew file, same bad value, rule
  // carrying no scope. Without this, the exit 0 above would also be produced by
  // the homebrew prong never being recognized as owned at all.
  const r = runHook({
    conventions: scopedV3(null),
    files: { "homebrew/rolara/Unscoped.md": "---\ntype: Nope\n---\n\nbody\n" },
    targetRel: "homebrew/rolara/Unscoped.md",
  });
  check("an unscoped rule does run against that same homebrew file", r.code, 2);
}

{
  const r = runHook({
    conventions: scopedV3("kb"),
    files: { "settings/rolara/ScopedIn.md": "---\ntype: Nope\n---\n\nbody\n" },
    targetRel: "settings/rolara/ScopedIn.md",
  });
  check('scope "kb" rule does run for a file in the kb prong', r.code, 2);
}

report();
