#!/usr/bin/env node
// PreToolUse hook (matcher: Read|Edit|Write|NotebookEdit|Grep): refuses a tool
// call that would surface an article the project has excluded by frontmatter
// tag. For the file tools that means checking the target article's own tags.
// For Grep, which names no single file, it means refusing the output modes
// that return text from inside files at all.
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

// Which Grep output modes return article prose. "content" returns matching
// lines; "-o" returns the matched substrings themselves. Both are body text
// leaving the knowledge base without any per-file gate having seen it.
// "files_with_matches" and "count" return paths and numbers, so they stay
// allowed: the agent can still locate candidate files and then Read them one
// at a time, and each of those Reads passes back through this same hook.
//
// Returns the offending mode, or null when the call is allowed.
//
// This gate is blunt on purpose. A Grep call names no single file, so the hook
// cannot check any one article's frontmatter the way the Read path does.
// Deciding whether an excluded article actually sits under the search path
// would mean opening every markdown file beneath it inside a 10 second hook
// timeout, and a hook that times out is a hook that silently allows, which is
// the failure this whole feature exists to prevent. Over-blocking costs one
// extra step; under-blocking costs the thing being protected.
function grepLeakMode(toolInput, projectRoot, roots) {
  const mode =
    typeof toolInput.output_mode === "string" && toolInput.output_mode
      ? toolInput.output_mode
      : "files_with_matches";
  const onlyMatching = toolInput["-o"] === true;
  if (mode !== "content" && !onlyMatching) return null;

  // Grep defaults to the current working directory when path is omitted, which
  // is the project root and therefore contains every prong.
  const searchPath =
    typeof toolInput.path === "string" && toolInput.path
      ? path.resolve(projectRoot, toolInput.path)
      : projectRoot;

  // With no roots resolved, scope is unknown and the same fail-closed rule
  // applies as everywhere else in this file: treat it as overlapping.
  if (roots.length === 0) return onlyMatching && mode !== "content" ? "-o" : mode;

  // Overlap in either direction. A search inside a prong root reaches its
  // articles; a search ABOVE one descends into it and reaches the same
  // articles, so both count.
  const overlaps = roots.some((root) => {
    const intoRoot = path.relative(root, searchPath);
    const inside = intoRoot === "" || (!intoRoot.startsWith("..") && !path.isAbsolute(intoRoot));
    const intoSearch = path.relative(searchPath, root);
    const above = intoSearch === "" || (!intoSearch.startsWith("..") && !path.isAbsolute(intoSearch));
    return inside || above;
  });
  if (!overlaps) return null;

  return onlyMatching && mode !== "content" ? "-o" : mode;
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
  const toolName = typeof input.tool_name === "string" ? input.tool_name : "";

  const projectRoot =
    typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : process.cwd();

  let tags = FALLBACK_TAGS;
  let roots = [];
  // Whether the project named a vocabulary of its own. The per-file path below
  // always checks (using FALLBACK_TAGS when nothing is configured, so a broken
  // config still guards). The Grep path uses this to stay entirely silent for a
  // project that deliberately configured no exclusions, because denying a whole
  // output mode is a workflow cost no such project agreed to pay.
  let configuredExclusions = false;

  const conventionsPath = path.resolve(projectRoot, ".professor-orb", "conventions.json");
  let conventionsReadable = false;
  if (existsSync(conventionsPath)) {
    try {
      const conventions = JSON.parse(readFileSync(conventionsPath, "utf8"));
      if (conventions && typeof conventions === "object") {
        conventionsReadable = true;
        const found = excludedTagsFrom(conventions);
        if (found.length > 0) {
          tags = found;
          configuredExclusions = true;
        }
        roots = prongRootsFrom(conventions, projectRoot);
      }
    } catch {
      // Unreadable or malformed: keep the widened defaults set above.
    }
  }

  if (toolName === "Grep") {
    // A readable conventions.json that names no excluded tags is a project
    // that opted out; anything else (missing, malformed, or configured) gates.
    if (conventionsReadable && !configuredExclusions) process.exit(0);
    const leak = grepLeakMode(toolInput, projectRoot, roots);
    if (leak === null) process.exit(0);
    process.stderr.write(
      `Blocked: this project excludes some articles from Claude by frontmatter tag, and a Grep in ${leak === "-o" ? '"-o" mode' : '"content" mode'} returns text from inside files.\n` +
        "A Grep names no single file, so this hook cannot check any one article's tags the way it can for Read.\n" +
        'Use output_mode "files_with_matches" (or "count") to find candidates, then Read each file you need. Each of those Reads is checked individually, and an excluded one is refused by name.\n' +
        "This denial is final. Do not route around it with Bash, ripgrep, or a script.\n"
    );
    process.exit(2);
  }

  // NotebookEdit carries notebook_path; the file tools carry file_path.
  const target =
    typeof toolInput.file_path === "string" && toolInput.file_path
      ? toolInput.file_path
      : typeof toolInput.notebook_path === "string"
        ? toolInput.notebook_path
        : "";
  if (!target) process.exit(0);
  if (!target.toLowerCase().endsWith(".md")) process.exit(0);

  const absFilePath = path.resolve(projectRoot, target);

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
