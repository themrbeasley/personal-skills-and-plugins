#!/usr/bin/env node
// PreToolUse hook (matcher: Read|Edit|Write|NotebookEdit): refuses a tool call
// whose target article carries a tag the project has excluded.
//
// This is the tag-based half of content exclusion. Its sibling, the
// path-scoped permission deny rule setup writes into .claude/settings.json,
// covers a whole folder and is enforced by the harness itself; that one is
// stronger but can only name PATHS. Until a project's excluded articles have
// been relocated under the folder that rule names, the only thing that can
// recognize them is their frontmatter, which is what this hook reads.
//
// WHY IT MUST NOT HARDCODE ANYTHING. An earlier hand-written hook in one
// consumer project scoped itself to paths containing a literal folder name.
// That project's knowledge base was later migrated to professor-orb's
// canonical layout, the literal stopped matching any path in the project, and
// the hook silently allowed every excluded article for over a month while
// still appearing installed and healthy. Nothing announced it. So this hook
// derives BOTH the prong roots and the tag vocabulary from
// .professor-orb/conventions.json, the same file every other component reads,
// and a layout change moves it automatically.
//
// FAIL-CLOSED WHERE IT COUNTS. A missing or unparseable conventions.json does
// not disable the hook; it widens it, and every markdown file under the
// project is checked against the default vocabulary instead. Silently
// narrowing protection on a config error is precisely the failure above. The
// only path that exits 0 unconditionally is the outermost catch, so a genuine
// defect in this file cannot wedge the DM's editing.
//
// IT NEVER READS A BODY. Only the frontmatter block at the head of the file is
// parsed, and only enough lines of it to find the closing fence. An excluded
// article's prose is never loaded into this process, so it can never reach a
// transcript through this hook, not even in a diagnostic.
//
// Contract:
//   stdin  : the PreToolUse JSON payload
//   exit 2 : deny the tool call; stderr is fed back as the reason
//   exit 0 : allow
//
// Node.js built-ins only.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// Used only when conventions.json cannot be read or names no vocabulary of its
// own. Deliberately non-empty: a project that installed this hook wants
// something excluded, and guessing nothing would reproduce the silent-allow
// failure this file exists to prevent.
const FALLBACK_TAGS = ["NSFW"];

// The frontmatter fence sits at the top of the file. Reading a bounded number
// of lines keeps an article body out of memory even when a file has no closing
// fence at all.
const MAX_FRONTMATTER_LINES = 80;

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// Every string value in a rule's tag list, from every tagImpliesPath rule in
// every setting. Enforcement is deliberately NOT consulted: the level governs
// whether a misplaced article is reported by the write-time validator, while
// this hook governs whether the article is opened at all, and a DM who set the
// rule to "off" turned off placement reporting, not the wall.
function excludedTagsFrom(conventions) {
  const settings = Array.isArray(conventions.settings)
    ? conventions.settings
    : conventions.rules
      ? [conventions]
      : [];

  const tags = new Set();
  for (const setting of settings) {
    const rules = setting && setting.rules;
    if (!rules || typeof rules !== "object") continue;
    for (const ruleId of Object.keys(rules)) {
      const rule = rules[ruleId];
      if (!rule || rule.check !== "tagImpliesPath") continue;
      const params = rule.params || {};
      if (!Array.isArray(params.tags)) continue;
      for (const t of params.tags) {
        if (typeof t === "string" && t.trim() !== "") tags.add(t.trim());
      }
    }
  }
  return Array.from(tags);
}

// Absolute prong roots across every setting. An empty result means "scope
// unknown", which callers treat as "check everything" rather than "check
// nothing", for the same fail-closed reason as above.
function prongRootsFrom(conventions, projectRoot) {
  const settings = Array.isArray(conventions.settings)
    ? conventions.settings
    : conventions.kbRoot
      ? [conventions]
      : [];

  const roots = [];
  for (const setting of settings) {
    if (!setting || typeof setting !== "object") continue;
    for (const key of ["kbRoot", "homebrewRoot", "sessionReportsRoot"]) {
      const value = setting[key];
      if (typeof value === "string" && value.trim() !== "") {
        roots.push(path.resolve(projectRoot, value));
      }
    }
  }
  return roots;
}

function isInsideAnyRoot(absFilePath, roots) {
  for (const root of roots) {
    const rel = path.relative(root, absFilePath);
    if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) return true;
  }
  return false;
}

// Returns the raw frontmatter block, or null when the file does not open with
// a fence. Reads the head of the file only.
function frontmatterBlockOf(absFilePath) {
  let raw;
  try {
    raw = readFileSync(absFilePath, "utf8");
  } catch {
    return null;
  }

  const lines = raw.replace(/\r\n/g, "\n").split("\n", MAX_FRONTMATTER_LINES + 1);
  if (lines.length === 0 || lines[0].trim() !== "---") return null;

  const collected = [];
  for (let i = 1; i < lines.length && i <= MAX_FRONTMATTER_LINES; i++) {
    if (lines[i].trim() === "---") return collected.join("\n");
    collected.push(lines[i]);
  }
  // No closing fence within the bound. Return what was collected rather than
  // null: a malformed file that happens to carry an excluded tag in its opening
  // lines should still be caught.
  return collected.join("\n");
}

// Whole-token match, case-insensitive, scoped to the frontmatter block. Whole
// token so a tag named "Private" does not fire on the word "Privateer", and
// case-insensitive because the DM types these by hand.
function matchedTag(frontmatter, tags) {
  for (const tag of tags) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^A-Za-z0-9_-])${escaped}([^A-Za-z0-9_-]|$)`, "i").test(frontmatter)) {
      return tag;
    }
  }
  return null;
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    process.exit(0);
  }
  if (!input || typeof input !== "object") process.exit(0);

  const toolInput = input.tool_input || {};
  // NotebookEdit carries notebook_path; the file tools carry file_path.
  const target =
    typeof toolInput.file_path === "string" && toolInput.file_path
      ? toolInput.file_path
      : typeof toolInput.notebook_path === "string"
        ? toolInput.notebook_path
        : "";
  if (!target) process.exit(0);
  if (!target.toLowerCase().endsWith(".md")) process.exit(0);

  const projectRoot =
    typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : process.cwd();
  const absFilePath = path.resolve(projectRoot, target);

  let tags = FALLBACK_TAGS;
  let roots = [];

  const conventionsPath = path.resolve(projectRoot, ".professor-orb", "conventions.json");
  if (existsSync(conventionsPath)) {
    try {
      const conventions = JSON.parse(readFileSync(conventionsPath, "utf8"));
      if (conventions && typeof conventions === "object") {
        const found = excludedTagsFrom(conventions);
        if (found.length > 0) tags = found;
        roots = prongRootsFrom(conventions, projectRoot);
      }
    } catch {
      // Unreadable or malformed: keep the widened defaults set above.
    }
  }

  // With roots resolved, restrict to them. With none resolved, check every
  // markdown file rather than none.
  if (roots.length > 0 && !isInsideAnyRoot(absFilePath, roots)) process.exit(0);

  // A file that does not exist yet (a Write creating a new article) has no
  // frontmatter to inspect and nothing to leak.
  if (!existsSync(absFilePath)) process.exit(0);

  const frontmatter = frontmatterBlockOf(absFilePath);
  if (frontmatter === null) process.exit(0);

  const hit = matchedTag(frontmatter, tags);
  if (hit === null) process.exit(0);

  // Names the tag and the path, never anything from the file. The instruction
  // not to route around it is stated here as well as in SHARED-PRINCIPLES
  // Principle 13, because a subagent that never read the principles still sees
  // this string.
  process.stderr.write(
    `Blocked: this article carries the excluded tag "${hit}", which the project has placed out of scope for Claude.\n` +
      `  file: ${path.relative(projectRoot, absFilePath)}\n` +
      "This denial is final. Do not retry with another tool, do not read it through Bash, do not run a script that opens it, " +
      "and do not reconstruct its contents from indexes or other articles. Report the file as excluded and continue with the rest of the task.\n"
  );
  process.exit(2);
}

main();
