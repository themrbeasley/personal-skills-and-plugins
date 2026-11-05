#!/usr/bin/env node
// Regression suite for the note file (SHARED-PRINCIPLES Principle 8).
//
// debrief has promised the DM "I'll take notes" since its first commit, while
// Principle 8 and its own never-do list barred any file to take them in. On
// 2026-11-05 Claude put a DM's partial session notes in a project memory for
// want of anywhere else, then told the DM the plugin barred the obvious place.
//
// Two halves. The hook half proves the reasons Principle 8 gives for the file's
// location, against the real hooks, each with a control showing the hook is
// live. The text half keeps the old ban from coming back in other words.
//
// Run: node professor-orb/skills/note-file.test.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.dirname(SKILLS);
const NOTE = ".professor-orb/proposals/notes-debrief-wednesday.md";

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

function run(command, args, options) {
  try {
    const out = execFileSync(command, args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...options });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "").trim(), err: (e.stderr || "").trim() };
  }
}

const hook = (name, payload) =>
  run("node", [path.join(PLUGIN, "hooks", name)], { input: JSON.stringify(payload) });

const read = (rel) => readFileSync(path.join(PLUGIN, rel), "utf8");

// --- Hook half ---------------------------------------------------------------

const root = mkdtempSync(path.join(os.tmpdir(), "orb-note-"));
const put = (rel, body) => {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body, "utf8");
};

put(
  ".professor-orb/conventions.json",
  JSON.stringify({
    schemaVersion: 3,
    settings: [
      {
        name: "w",
        kbRoot: "settings/w",
        homebrewRoot: "homebrew/w",
        sessionReportsRoot: "session-reports/w",
        rules: {
          frontmatterTypeEnum: {
            category: "frontmatter",
            check: "enum",
            enforcement: "block",
            params: { field: "type", values: ["Person"] },
          },
          frontmatterExcludedTagLocation: {
            check: "tagImpliesPath",
            enforcement: "block",
            params: { tags: ["Excluded"], requiredSegment: "walled" },
          },
        },
      },
    ],
  })
);

const offending = "---\ntype: Nope\ntags: [Excluded]\n---\n\nThe reporter asked what the team was called, and they answered on camera.\n";
const inProng = "session-reports/w/wednesday/Bad.md";
const inKb = "settings/w/Bad.md";
put(inProng, offending);
put(inKb, offending);
put(NOTE, offending);

const written = (rel) => ({ cwd: root, tool_name: "Write", tool_input: { file_path: path.join(root, rel) } });
const opened = (rel) => ({ cwd: root, tool_name: "Read", tool_input: { file_path: path.join(root, rel) } });

console.log("the write-time validator passes over the note file:");
check("control: the same content in a prong is blocked", hook("validate-write.mjs", written(inProng)).code, 2);
{
  const r = hook("validate-write.mjs", written(NOTE));
  check("at the note path it is silent", [r.code, r.out, r.err], [0, "", ""]);
}

console.log("the exclusion wall passes over the note file:");
check("control: the same content in the KB is refused", hook("block-excluded.mjs", opened(inKb)).code, 2);
check("at the note path it is readable", hook("block-excluded.mjs", opened(NOTE)).code, 0);

console.log("a correction reaches the note file:");
{
  // No frontmatter, as Principle 8 specifies. The hook rightly refuses to print
  // the tagged fixture above, so this case needs a note shaped like a real one.
  put(NOTE, "# Debrief notes: wednesday\n\n## Heard\n- The reporter asked what the team was called, and they answered on camera.\n");
  const r = hook("dm-correction.mjs", {
    hook_event_name: "UserPromptSubmit",
    prompt: "That NEVER happened, the reporter never asked what the team was called",
    cwd: root,
    session_id: "s1",
  });
  check("the hook names it among the copies", r.out.includes("notes-debrief-wednesday.md"), true);
}

console.log("no commit can carry the note file:");
{
  // Built from setup's own policy line, so this fails if setup stops ignoring it.
  const policy = read("skills/setup/SKILL.md").split("\n").find((l) => l.startsWith("Ignored, as derived or transient:")) || "";
  const patterns = [...policy.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  check("setup's policy line ignores the folder", patterns.includes(".professor-orb/proposals/"), true);
  put(".gitignore", patterns.join("\n") + "\n");
  run("git", ["init", "-q"], { cwd: root });
  check("git ignores the note", run("git", ["check-ignore", "-q", NOTE], { cwd: root }).code, 0);
}

rmSync(root, { recursive: true, force: true });

// --- Text half ---------------------------------------------------------------

function markdownUnder(dir) {
  return readdirSync(path.join(PLUGIN, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownUnder(rel);
    return entry.name.endsWith(".md") ? [rel] : [];
  });
}

console.log("the ban stays gone, in every wording it used:");
const shipped = ["skills", "agents", "commands"].flatMap(markdownUnder);
for (const phrase of [
  /no scratch file/i,
  /do not create scratch/i,
  /never create unnecessary auxiliary/i,
  /do not write any files/i,
  /nothing goes to disk/i,
  /never write files without approval/i,
]) {
  check(`nothing says ${phrase}`, shipped.filter((rel) => phrase.test(read(rel))), []);
}

console.log("the principles define the note file:");
{
  const principles = read("skills/SHARED-PRINCIPLES.md");
  const section = (n) => principles.slice(principles.indexOf(`## ${n}. `), principles.indexOf(`## ${n + 1}. `));
  check("Principle 8 names the path", section(8).includes(".professor-orb/proposals/notes-<skill>-<campaign>.md"), true);
  check("Principle 8 names the fallback", section(8).includes("professor-orb-notes/"), true);
  check("Principle 8 offers an earlier run's notes back", section(8).includes("Pick up from these notes"), true);
  check("Principle 2 puts the note file outside its gate", section(2).includes("note file"), true);
}

console.log("the skills open it, then delete it, then finish:");
for (const skill of ["debrief", "prep"]) {
  const text = read(`skills/${skill}/SKILL.md`);
  const opens = text.indexOf(`notes-${skill}-<campaign>.md`);
  const deletes = text.indexOf("Delete the note file");
  const finishes = text.indexOf("## Final act");
  check(`${skill} opens it`, opens !== -1, true);
  check(`${skill} deletes it after opening`, deletes > opens, true);
  check(`${skill} deletes it before the final act`, deletes !== -1 && deletes < finishes, true);
}

console.log(`\n${passed}/${passed + failures.length} expectations met.`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
