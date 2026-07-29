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
    const out = execFileSync("node", [HOOK], { input: payload, encoding: "utf8" });
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

report();
