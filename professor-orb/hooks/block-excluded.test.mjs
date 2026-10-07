#!/usr/bin/env node
// Regression suite for the PreToolUse excluded-tag hook.
//
// Drives the real hook with real PreToolUse payloads against a disposable
// fixture project. Node built-ins only, no test framework.
//
// Every fixture article below is synthetic. No fixture reproduces, paraphrases,
// or names content from any real knowledge base: an excluded-content guard
// whose own tests carried excluded content would defeat itself.
//
// Run: node professor-orb/hooks/block-excluded.test.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "block-excluded.mjs");

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

function hashOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// conventions may be null (write no file) or a raw string (write it verbatim,
// so a malformed file can be exercised).
function runHook({ conventions, files, targetRel, toolName = "Read", pathKey = "file_path", cwdRel = "" }) {
  const dir = path.join(os.tmpdir(), `orb-excl-${process.pid}-${Math.abs(hashOf(targetRel + toolName))}`);
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
    writeFileSync(abs, typeof conventions === "string" ? conventions : JSON.stringify(conventions, null, 2), "utf8");
  }

  const payload = JSON.stringify({
    cwd: cwdRel ? path.join(dir, cwdRel) : dir,
    tool_name: toolName,
    tool_input: { [pathKey]: path.join(dir, targetRel) },
  });

  try {
    const out = execFileSync("node", [HOOK], { input: payload, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "").trim(), err: (e.stderr || "").trim() };
  }
}

const CONVENTIONS = {
  version: 3,
  settings: [
    {
      name: "w",
      kbRoot: "settings/w",
      homebrewRoot: "homebrew/w",
      sessionReportsRoot: "session-reports/w",
      rules: {
        frontmatterExcludedTagLocation: {
          check: "tagImpliesPath",
          enforcement: "block",
          params: { tags: ["Excluded"], requiredSegment: "walled" },
        },
      },
    },
  ],
};

const tagged = (tag) => `---\ntype: Person\ntags: [${tag}]\n---\n\nplaceholder fixture body.\n`;
const plain = "---\ntype: Person\ntags: [Ordinary]\n---\n\nplaceholder fixture body.\n";

console.log("=== core behavior ===");

{
  const r = runHook({
    conventions: CONVENTIONS,
    files: { "settings/w/people/A.md": tagged("Excluded") },
    targetRel: "settings/w/people/A.md",
  });
  check("an excluded-tag article is denied", r.code, 2);
  check("the denial names the tag", r.err.includes("Excluded"), true);
  check("the denial states it is final", r.err.includes("final"), true);
  check("the denial leaks no body text", r.err.includes("placeholder fixture body"), false);
}

{
  const r = runHook({
    conventions: CONVENTIONS,
    files: { "settings/w/people/B.md": plain },
    targetRel: "settings/w/people/B.md",
  });
  check("an ordinary article is allowed", r.code, 0);
}

{
  const r = runHook({
    conventions: CONVENTIONS,
    files: { "settings/w/people/C.md": "---\ntype: Person\n---\n\nbody.\n" },
    targetRel: "settings/w/people/C.md",
  });
  check("an article with no tags field is allowed", r.code, 0);
}

console.log("\n=== the failure that motivated this hook ===");

{
  // The predecessor scoped itself to a hardcoded folder literal and went blind
  // when the project was migrated. Deriving roots from conventions.json is what
  // makes a layout change a non-event, so a moved root must still be covered.
  const moved = JSON.parse(JSON.stringify(CONVENTIONS));
  moved.settings[0].kbRoot = "somewhere/else/entirely";
  const r = runHook({
    conventions: moved,
    files: { "somewhere/else/entirely/people/A.md": tagged("Excluded") },
    targetRel: "somewhere/else/entirely/people/A.md",
  });
  check("a relocated kbRoot is still covered", r.code, 2);
}

{
  // Silently narrowing protection on a config error is the exact shape of the
  // month-long outage. A broken file must widen, never disable.
  const r = runHook({
    conventions: "{ this is not json",
    files: { "anywhere/A.md": tagged("NSFW") },
    targetRel: "anywhere/A.md",
  });
  check("a malformed conventions.json still denies, using fallback tags", r.code, 2);
}

{
  const r = runHook({
    conventions: null,
    files: { "anywhere/A.md": tagged("NSFW") },
    targetRel: "anywhere/A.md",
  });
  check("a missing conventions.json still denies, using fallback tags", r.code, 2);
}

console.log("\n=== scope ===");

{
  const r = runHook({
    conventions: CONVENTIONS,
    files: { "homebrew/w/S.md": tagged("Excluded") },
    targetRel: "homebrew/w/S.md",
  });
  check("the homebrew prong is covered", r.code, 2);
}

{
  const r = runHook({
    conventions: CONVENTIONS,
    files: { "session-reports/w/R.md": tagged("Excluded") },
    targetRel: "session-reports/w/R.md",
  });
  check("the session-reports prong is covered", r.code, 2);
}

{
  const r = runHook({
    conventions: CONVENTIONS,
    files: { "notes/Scratch.md": tagged("Excluded") },
    targetRel: "notes/Scratch.md",
  });
  check("a file outside every prong root is out of scope", r.code, 0);
}

{
  const r = runHook({
    conventions: CONVENTIONS,
    files: { "settings/w/people/A.txt": tagged("Excluded") },
    targetRel: "settings/w/people/A.txt",
  });
  check("a non-markdown file is ignored", r.code, 0);
}

{
  const r = runHook({
    conventions: CONVENTIONS,
    files: {},
    targetRel: "settings/w/people/New.md",
  });
  check("a file that does not exist yet is allowed", r.code, 0);
}

console.log("\n=== tools and payload shapes ===");

for (const tool of ["Read", "Edit", "Write", "NotebookEdit"]) {
  const r = runHook({
    conventions: CONVENTIONS,
    files: { "settings/w/people/A.md": tagged("Excluded") },
    targetRel: "settings/w/people/A.md",
    toolName: tool,
  });
  check(`${tool} is denied`, r.code, 2);
}

{
  const r = runHook({
    conventions: CONVENTIONS,
    files: { "settings/w/nb/N.md": tagged("Excluded") },
    targetRel: "settings/w/nb/N.md",
    toolName: "NotebookEdit",
    pathKey: "notebook_path",
  });
  check("notebook_path is read as the target", r.code, 2);
}

console.log("\n=== tag matching ===");

{
  const r = runHook({
    conventions: CONVENTIONS,
    files: { "settings/w/people/A.md": tagged("excluded") },
    targetRel: "settings/w/people/A.md",
  });
  check("tag matching is case-insensitive", r.code, 2);
}

{
  const r = runHook({
    conventions: CONVENTIONS,
    files: { "settings/w/people/A.md": "---\ntype: Person\ntags:\n  - Ordinary\n  - Excluded\n---\n\nbody.\n" },
    targetRel: "settings/w/people/A.md",
  });
  check("block-sequence tag lists are matched", r.code, 2);
}

{
  // Whole-token matching: a longer tag that merely contains the excluded one is
  // a different tag, and denying it would be a false positive the DM cannot
  // turn off without renaming their own vocabulary.
  const r = runHook({
    conventions: CONVENTIONS,
    files: { "settings/w/people/A.md": tagged("Excluded-Draft") },
    targetRel: "settings/w/people/A.md",
  });
  check("a longer tag containing the excluded one does not fire", r.code, 0);
}

{
  // The body is never read, so a mention below the fence cannot deny.
  const r = runHook({
    conventions: CONVENTIONS,
    files: {
      "settings/w/people/A.md": "---\ntype: Person\ntags: [Ordinary]\n---\n\nThis article discusses Excluded as a topic.\n",
    },
    targetRel: "settings/w/people/A.md",
  });
  check("a body mention of the tag does not deny", r.code, 0);
}

{
  const r = runHook({
    conventions: CONVENTIONS,
    files: { "settings/w/people/A.md": "no frontmatter at all\n\ntags: [Excluded]\n" },
    targetRel: "settings/w/people/A.md",
  });
  check("a file with no frontmatter fence is allowed", r.code, 0);
}

{
  // Several settings, each with its own vocabulary: the union applies, so one
  // world's exclusions are not silently dropped because another world was
  // checked first.
  const multi = JSON.parse(JSON.stringify(CONVENTIONS));
  multi.settings.push({
    name: "v",
    kbRoot: "settings/v",
    rules: {
      other: { check: "tagImpliesPath", params: { tags: ["Sealed"], requiredSegment: "sealed" } },
    },
  });
  const r = runHook({
    conventions: multi,
    files: { "settings/v/people/A.md": tagged("Sealed") },
    targetRel: "settings/v/people/A.md",
  });
  check("a second setting's vocabulary also denies", r.code, 2);
}

console.log("\n=== Grep content gate ===");

// A Grep over a folder names no single file, so the per-article tag check
// cannot apply. What it can do is refuse the output modes that return body
// text at all. A Grep whose path is one file gets the per-article check.
function runGrep({ conventions, files, toolInput, targetRel, cwdRel = "" }) {
  const dir = path.join(os.tmpdir(), `orb-excl-grep-${process.pid}-${Math.abs(hashOf(targetRel))}`);
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
  // With cwdRel set, a relative path stays relative, as Grep receives it.
  const resolved = { ...toolInput };
  if (typeof resolved.path === "string" && !cwdRel) resolved.path = path.join(dir, resolved.path);
  const cwd = cwdRel ? path.join(dir, cwdRel) : dir;
  const payload = JSON.stringify({ cwd, tool_name: "Grep", tool_input: resolved });
  try {
    const out = execFileSync("node", [HOOK], { input: payload, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "").trim(), err: (e.stderr || "").trim() };
  }
}

{
  const r = runGrep({
    conventions: CONVENTIONS,
    files: { "settings/w/people/A.md": plain },
    toolInput: { pattern: "x", path: "settings/w", output_mode: "content" },
    targetRel: "grep-content-in-scope",
  });
  check("content-mode grep inside a prong root is denied", r.code, 2);
  check("the grep denial explains the supported route", r.err.includes("files_with_matches"), true);
}

{
  // 2026-09-29: a Grep whose path is one file names that file, so it gets the
  // same per-article check a Read does instead of the folder-wide refusal.
  const r = runGrep({
    conventions: CONVENTIONS,
    files: { "settings/w/people/A.md": plain },
    toolInput: { pattern: "x", path: "settings/w/people/A.md", output_mode: "content" },
    targetRel: "grep-content-one-plain-file",
  });
  check("content-mode grep of one ordinary file is allowed", r.code, 0);
}

{
  const r = runGrep({
    conventions: CONVENTIONS,
    files: { "settings/w/people/A.md": tagged("Excluded") },
    toolInput: { pattern: "x", path: "settings/w/people/A.md", output_mode: "content" },
    targetRel: "grep-content-one-excluded-file",
  });
  check("content-mode grep of one excluded file is denied", r.code, 2);
  check("that denial names the tag, as a Read's would", r.err.includes('"Excluded"'), true);
}

{
  const r = runGrep({
    conventions: CONVENTIONS,
    files: { "settings/w/people/A.md": plain },
    toolInput: { pattern: "x", path: "settings/w", output_mode: "files_with_matches" },
    targetRel: "grep-fwm-in-scope",
  });
  check("files_with_matches grep is allowed", r.code, 0);
}

{
  const r = runGrep({
    conventions: CONVENTIONS,
    files: { "settings/w/people/A.md": plain },
    toolInput: { pattern: "x", path: "settings/w", output_mode: "count" },
    targetRel: "grep-count-in-scope",
  });
  check("count-mode grep is allowed", r.code, 0);
}

{
  // The default when output_mode is omitted is files_with_matches, which is
  // path-only and therefore safe.
  const r = runGrep({
    conventions: CONVENTIONS,
    files: { "settings/w/people/A.md": plain },
    toolInput: { pattern: "x", path: "settings/w" },
    targetRel: "grep-default-mode",
  });
  check("grep with no output_mode is allowed", r.code, 0);
}

{
  // -o returns the matched substrings themselves, which is body text even
  // though the mode is not "content".
  const r = runGrep({
    conventions: CONVENTIONS,
    files: { "settings/w/people/A.md": plain },
    toolInput: { pattern: "x", path: "settings/w", output_mode: "files_with_matches", "-o": true },
    targetRel: "grep-dash-o",
  });
  check("grep with -o is denied even outside content mode", r.code, 2);
}

{
  const r = runGrep({
    conventions: CONVENTIONS,
    files: { "notes/A.md": plain },
    toolInput: { pattern: "x", path: "notes", output_mode: "content" },
    targetRel: "grep-content-out-of-scope",
  });
  check("content-mode grep entirely outside every prong root is allowed", r.code, 0);
}

{
  // A search rooted above a prong descends into it, so it reaches the same
  // content and must be treated the same way.
  const r = runGrep({
    conventions: CONVENTIONS,
    files: { "settings/w/people/A.md": plain },
    toolInput: { pattern: "x", output_mode: "content" },
    targetRel: "grep-content-no-path",
  });
  check("content-mode grep with no path (project root) is denied", r.code, 2);
}

{
  // A project that configured no excluded tags gets no gate at all: professor-orb
  // imposes structure, never content policy.
  const noTags = JSON.parse(JSON.stringify(CONVENTIONS));
  noTags.settings[0].rules.frontmatterExcludedTagLocation.params.tags = [];
  const r = runGrep({
    conventions: noTags,
    files: { "settings/w/people/A.md": plain },
    toolInput: { pattern: "x", path: "settings/w", output_mode: "content" },
    targetRel: "grep-no-exclusions-configured",
  });
  check("with no excluded tags configured, content-mode grep is allowed", r.code, 0);
}

{
  // Same fail-closed posture as the per-file path: a broken config widens.
  const r = runGrep({
    conventions: null,
    files: { "settings/w/people/A.md": plain },
    toolInput: { pattern: "x", path: "settings/w", output_mode: "content" },
    targetRel: "grep-no-conventions",
  });
  check("with no conventions.json, content-mode grep is denied", r.code, 2);
}

console.log("=== from a subfolder ===");

{
  // 2026-10-07: from a subfolder the hook found no conventions.json and fell
  // back to its built-in tag, so a project's own tag went unchecked.
  const r = runHook({
    conventions: CONVENTIONS,
    files: { "settings/w/people/A.md": tagged("Excluded") },
    targetRel: "settings/w/people/A.md",
    cwdRel: "settings/w",
  });
  check("an article with the project's own tag is denied from a subfolder", r.code, 2);
}

{
  // A relative Grep path resolves from the working folder, as Grep resolves it.
  const r = runGrep({
    conventions: CONVENTIONS,
    files: { "session-reports/w/c/A.md": plain },
    toolInput: { pattern: "x", path: "w", output_mode: "content" },
    targetRel: "grep-relative-from-subfolder",
    cwdRel: "session-reports",
  });
  check("a content grep given a relative prong path from a subfolder is denied", r.code, 2);
}

{
  // With no path, Grep searches the working folder. The hook measures from the
  // project root instead, which can only over-block, never under-block.
  const r = runGrep({
    conventions: CONVENTIONS,
    files: { "settings/w/people/A.md": plain, "docs/notes.md": "notes\n" },
    toolInput: { pattern: "x", output_mode: "content" },
    targetRel: "grep-no-path-from-docs",
    cwdRel: "docs",
  });
  check("a content grep with no path from a folder outside every prong is still denied", r.code, 2);
}

console.log(`\n${passed}/${passed + failures.length} expectations met.`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
