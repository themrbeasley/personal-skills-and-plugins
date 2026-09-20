#!/usr/bin/env node
// PostToolUse hook (matcher: Write|Edit): validates a just-written KB article
// against .professor-orb/conventions.json.
//
// Graceful degradation: if conventions.json does not exist, or the written
// file is not a KB article, this script exits 0 silently. Unknown check
// kinds are skipped for forward compatibility. Node.js built-ins only.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Lightweight YAML frontmatter parser (subset: scalars, booleans, inline and
// block string arrays). Not a general YAML parser; sufficient for the shape
// of frontmatter conventions documents describe.
// ---------------------------------------------------------------------------

function parseScalar(str) {
  if (str === "") return "";
  if (str === "true") return true;
  if (str === "false") return false;
  if (str === "null" || str === "~") return null;
  if (
    (str.startsWith('"') && str.endsWith('"') && str.length >= 2) ||
    (str.startsWith("'") && str.endsWith("'") && str.length >= 2)
  ) {
    return str.slice(1, -1);
  }
  return str;
}

function splitTopLevelCommas(str) {
  return str.split(",");
}

function parseScalarOrInlineArray(str) {
  const trimmed = str.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner === "") return [];
    return splitTopLevelCommas(inner).map((s) => parseScalar(s.trim()));
  }
  return parseScalar(trimmed);
}

function parseYamlLines(lines) {
  const data = {};
  const order = [];
  let currentKey = null;

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;

    const kvMatch = rawLine.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    const arrayItemMatch = rawLine.match(/^\s*-\s+(.*)$/);

    if (kvMatch) {
      const key = kvMatch[1];
      const rest = kvMatch[2];
      if (rest.trim() === "") {
        data[key] = [];
        order.push(key);
        currentKey = key;
      } else {
        data[key] = parseScalarOrInlineArray(rest);
        order.push(key);
        currentKey = null;
      }
      continue;
    }

    if (arrayItemMatch && currentKey) {
      const val = parseScalar(arrayItemMatch[1].trim());
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(val);
    }
    // Anything else (comments, nested maps) is outside this subset; ignored.
  }

  return { data, order };
}

function parseFrontmatter(content) {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") return null;

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) return null;

  const fmLines = lines.slice(1, endIndex);
  const bodyLines = lines.slice(endIndex + 1);
  const { data, order } = parseYamlLines(fmLines);
  return { data, order, body: bodyLines.join("\n") };
}

// ---------------------------------------------------------------------------
// Small helpers shared across checks.
// ---------------------------------------------------------------------------

function baseNameNoExt(fileName) {
  const ext = path.extname(fileName);
  return ext ? fileName.slice(0, -ext.length) : fileName;
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return null;
  }
}

function levenshtein(a, b) {
  const al = a.length;
  const bl = b.length;
  const dp = [];
  for (let i = 0; i <= al; i++) {
    dp.push(new Array(bl + 1).fill(0));
    dp[i][0] = i;
  }
  for (let j = 0; j <= bl; j++) dp[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[al][bl];
}

function nearestMatch(tag, knownTags) {
  const lower = tag.toLowerCase();
  let best = null;
  let bestScore = Infinity;
  for (const known of knownTags) {
    const knownLower = known.toLowerCase();
    if (knownLower === lower) continue;
    if (knownLower.includes(lower) || lower.includes(knownLower)) {
      const score = Math.abs(knownLower.length - lower.length);
      if (score < bestScore) {
        bestScore = score;
        best = known;
      }
      continue;
    }
    const dist = levenshtein(lower, knownLower);
    if (dist < bestScore) {
      bestScore = dist;
      best = known;
    }
  }
  const threshold = Math.max(2, Math.ceil(lower.length / 2));
  return best && bestScore <= threshold ? best : null;
}

function extractKnownTags(registry) {
  if (Array.isArray(registry)) {
    return registry.filter((t) => typeof t === "string");
  }
  if (registry && Array.isArray(registry.tags)) {
    return registry.tags.filter((t) => typeof t === "string");
  }
  if (registry && typeof registry === "object") {
    return Object.keys(registry);
  }
  return [];
}

function matchesWhen(when, data) {
  for (const key of Object.keys(when)) {
    const want = when[key];
    const wantArr = Array.isArray(want) ? want : [want];
    const actual = data[key];
    if (Array.isArray(actual)) {
      if (!actual.some((v) => wantArr.includes(v))) return false;
    } else if (!wantArr.includes(actual)) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Check implementations. Each returns:
//   true            -> passed
//   false | string  -> failed (string is a specific violation message)
//   null | undefined -> not applicable / cannot be determined at write time
// ---------------------------------------------------------------------------

function checkRequiredFields(params, ctx) {
  const fields = params.fields || [];
  const requiredSubset = params.requiredSubset || [];
  const orderMatters = Boolean(params.orderMatters);
  const data = ctx.frontmatter;

  const missing = requiredSubset.filter(
    (f) => data[f] === undefined || data[f] === null
  );
  if (missing.length > 0) {
    return `Missing required frontmatter field(s): ${missing.join(", ")}.`;
  }

  if (orderMatters) {
    const order = ctx.frontmatterOrder || [];
    const presentInOrder = order.filter((k) => fields.includes(k));
    const expected = fields.filter((k) => presentInOrder.includes(k));
    for (let i = 0; i < expected.length; i++) {
      if (presentInOrder[i] !== expected[i]) {
        return `Frontmatter fields are out of order; expected order: ${fields.join(", ")}.`;
      }
    }
  }

  return true;
}

function checkEnum(params, ctx) {
  const { field, values = [] } = params;
  const val = ctx.frontmatter[field];
  if (val === undefined || val === null) return true;
  if (!values.includes(val)) {
    return `Field "${field}" has value "${val}", which is not one of: ${values.join(", ")}.`;
  }
  return true;
}

function checkDefault(params, ctx) {
  const { field, value, overrides = [] } = params;
  const data = ctx.frontmatter;
  if (data[field] !== undefined) return true;

  let expected = value;
  for (const override of overrides) {
    if (override && override.when && matchesWhen(override.when, data)) {
      expected = override.value;
      break;
    }
  }

  return `Field "${field}" is missing; it defaults to ${JSON.stringify(expected)} per convention. Consider setting it explicitly.`;
}

function checkFormat(params, ctx) {
  const { field, format, optional = true } = params;
  const val = ctx.frontmatter[field];

  if (val === undefined || val === null) {
    if (optional) return true;
    return `Field "${field}" is required but missing.`;
  }

  switch (format) {
    case "string":
      if (typeof val !== "string") return `Field "${field}" must be a string.`;
      return true;
    case "boolean":
      if (typeof val !== "boolean") return `Field "${field}" must be a boolean.`;
      return true;
    case "string-array":
      if (!Array.isArray(val) || !val.every((v) => typeof v === "string")) {
        return `Field "${field}" must be an array of strings.`;
      }
      return true;
    case "date":
      if (typeof val !== "string" || Number.isNaN(Date.parse(val))) {
        return `Field "${field}" must be a valid date string.`;
      }
      return true;
    default:
      return true; // unrecognized format kind: forward-compatible no-op
  }
}

function checkSuffixByType(params, ctx) {
  const mapping = params.mapping || [];
  const type = ctx.frontmatter.type;
  const entry = mapping.find((m) => m.type === type);
  if (!entry) return true;

  const base = baseNameNoExt(ctx.fileName);
  if (!base.endsWith(entry.suffix)) {
    return `Filename for type "${type}" must end with "${entry.suffix}" before the extension.`;
  }
  return true;
}

function checkCharset(params, ctx) {
  const { pattern } = params;
  if (!pattern) return true;

  let re;
  try {
    re = new RegExp(pattern);
  } catch {
    return true;
  }

  const base = baseNameNoExt(ctx.fileName);
  if (!re.test(base)) {
    return `Filename "${base}" does not match the allowed character set (${pattern}).`;
  }
  return true;
}

function checkIndexParity(params, ctx) {
  const { indexSuffix } = params;
  if (!indexSuffix) return null;

  // An Edit requires the file to already exist, so it can never introduce a
  // new index into a folder; only a Write can worsen parity. A Write that
  // overwrites an existing index is indistinguishable post-write from one
  // that created it, so Write still fires; that residual imprecision is
  // accepted as an inherent limit of checking from post-write disk state
  // alone.
  if (ctx.toolName === "Edit") return true;

  const dir = path.dirname(ctx.absFilePath);
  const entries = safeReaddir(dir);
  if (!entries) return null;

  // Only block writes that worsen parity; ordinary article writes never fail this check.
  // Suffix matching is case-insensitive: a mis-cased "-index" file is still
  // an index for parity purposes. filenameSuffixByType stays case-sensitive
  // because flagging the wrong casing itself is that rule's job.
  const suffixLower = indexSuffix.toLowerCase();
  const isIndexWrite = baseNameNoExt(ctx.fileName).toLowerCase().endsWith(suffixLower);
  if (!isIndexWrite) return true;

  // File being written is an index file. Block only if a different index already exists.
  // Only markdown articles count: an image or subfolder whose name happens to
  // end in the suffix is not an index.
  const existingIndexFiles = entries.filter(
    (f) =>
      path.extname(f).toLowerCase() === ".md" &&
      baseNameNoExt(f).toLowerCase().endsWith(suffixLower)
  );
  // Self-exclusion is case-insensitive too. On a case-insensitive filesystem
  // (Windows, macOS) a write whose path casing differs from the on-disk entry
  // updates that same file, and readdir keeps returning the original casing;
  // comparing exactly would count the just-written file as its own conflict.
  // The trade-off: on a case-sensitive filesystem two indexes differing only
  // by case read as one here, which the sweep is the right place to catch.
  const selfLower = ctx.fileName.toLowerCase();
  const conflicts = existingIndexFiles.filter((f) => f.toLowerCase() !== selfLower);
  if (conflicts.length > 0) {
    const folderLabel = path.dirname(ctx.relPath) || ".";
    return `Folder "${folderLabel}" now holds more than one index file, which breaks parity. This hook runs after the write, so the file is already on disk; move or revert so the folder keeps exactly one index.`;
  }
  return true;
}

function checkSingleOwnership() {
  // KB-wide check; only the validation sweep has enough context to run it.
  return null;
}

// Articles only. The raw directory listing includes subfolders, images, and
// the folder's own index, so a folder of 3 articles plus 3 subfolders would
// otherwise read as 6 and wrongly earn a split. Shared by both threshold
// checks: they ask the same question of the same directory and must never
// answer it differently.
function countArticles(dirAbs, entries, params) {
  const indexSuffix = typeof params.indexSuffix === "string" ? params.indexSuffix.toLowerCase() : null;
  return entries.filter((f) => {
    if (f.startsWith(".")) return false;
    if (!f.toLowerCase().endsWith(".md")) return false;
    const base = f.slice(0, -3).toLowerCase();
    if (indexSuffix && base.endsWith(indexSuffix)) return false;
    let isDir = false;
    try {
      isDir = statSync(path.join(dirAbs, f)).isDirectory();
    } catch {
      isDir = false;
    }
    return !isDir;
  }).length;
}

function checkSplitThreshold(params, ctx) {
  const { minEntries } = params;
  if (typeof minEntries !== "number") return null;

  const dir = path.dirname(ctx.absFilePath);
  const entries = safeReaddir(dir);
  if (!entries) return null;

  const count = countArticles(dir, entries, params);
  if (count >= minEntries) {
    const folderLabel = path.dirname(ctx.relPath) || ".";
    return `Folder "${folderLabel}" has ${count} articles (at least ${minEntries}); consider splitting into a sub-index.`;
  }
  return true;
}

function checkAbsorbThreshold(params, ctx) {
  const { maxEntries } = params;
  if (typeof maxEntries !== "number") return null;

  const dir = path.dirname(ctx.absFilePath);
  const entries = safeReaddir(dir);
  if (!entries) return null;

  const count = countArticles(dir, entries, params);
  if (count < maxEntries) {
    const folderLabel = path.dirname(ctx.relPath) || ".";
    return `Folder "${folderLabel}" has ${count} articles (fewer than ${maxEntries}); consider absorbing it into its parent.`;
  }
  return true;
}

function searchForFileStat(dir, candidateNames, depth) {
  if (depth > 12) return false;
  const entries = safeReaddir(dir);
  if (!entries) return false;

  for (const name of entries) {
    if (name.startsWith(".")) continue;
    if (candidateNames.includes(name)) return true;
  }

  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const nested = safeReaddir(full);
    if (nested !== null) {
      if (searchForFileStat(full, candidateNames, depth + 1)) return true;
    }
  }

  return false;
}

function wikilinkTargetExists(searchRoots, target) {
  const candidates = [`${target}.md`, target];
  return searchRoots.some((root) => searchForFileStat(root, candidates, 0));
}

function checkWikilinkPolicy(params, ctx) {
  const requireExistingTarget = Boolean(params.requireExistingTarget);
  const requireDisplayText = Boolean(params.requireDisplayText);
  const body = ctx.body || "";
  const re = /\[\[([^[\]]*)\]\]/g;

  const badLinks = [];
  const bareLinks = [];
  const missingTargets = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    const inner = m[1];
    // Inside a Markdown table a wikilink escapes its pipe ([[Target\|Display]])
    // so the cell is not split; treat "\|" and "|" as the same separator.
    const parts = inner ? inner.split(/\\?\|/) : [];
    const target = parts.length > 0 ? parts[0].trim() : "";
    if (!target) {
      badLinks.push(m[0]);
      continue;
    }
    // A link with no separator at all (piped or escaped-piped) has no display
    // text, e.g. [[Target]]. Piped ([[Target|Display]]) and table-escaped
    // ([[Target\|Display]]) forms both split into two or more parts above and
    // are not flagged here.
    if (requireDisplayText && parts.length < 2) {
      bareLinks.push(m[0]);
    }
    if (requireExistingTarget && !wikilinkTargetExists(ctx.searchRoots, target)) {
      missingTargets.push(target);
    }
  }

  const problems = [];
  if (badLinks.length > 0) {
    problems.push(`Malformed wikilink(s): ${badLinks.join(", ")}.`);
  }
  if (bareLinks.length > 0) {
    problems.push(
      `Wikilink(s) missing display text (use [[Target|Display]]): ${bareLinks.join(", ")}.`
    );
  }
  if (missingTargets.length > 0) {
    problems.push(`Wikilink target(s) not found in KB: ${missingTargets.join(", ")}.`);
  }

  return problems.length > 0 ? problems.join(" ") : true;
}

function checkTagVocabulary(params, ctx) {
  const tags = ctx.frontmatter.tags;
  if (!Array.isArray(tags) || tags.length === 0) return true;

  const registryPath = path.resolve(
    ctx.projectRoot,
    ctx.tagRegistryPath || path.join(".professor-orb", "tag-registry.json")
  );

  if (!existsSync(registryPath)) return null;

  let registry;
  try {
    registry = JSON.parse(readFileSync(registryPath, "utf8"));
  } catch {
    return null;
  }

  const knownTags = extractKnownTags(registry);
  if (knownTags.length === 0) return null;

  const unknown = tags.filter((t) => typeof t === "string" && !knownTags.includes(t));
  if (unknown.length === 0) return true;

  const parts = unknown.map((t) => {
    const suggestion = nearestMatch(t, knownTags);
    return suggestion ? `"${t}" (did you mean "${suggestion}"?)` : `"${t}"`;
  });

  return `Unrecognized tag(s): ${parts.join(", ")}. Prefer reusing an existing tag.`;
}

function checkProhibitedPattern(params, ctx) {
  const { pattern, appliesTo = "body", excludeTableDelimiters = false, flags = "u" } = params;
  if (!pattern) return true;

  // JavaScript regex has no inline flag groups (e.g. "(?im)..."); a rule that
  // needs case-insensitive or multiline matching sets the "flags" param instead
  // (e.g. "im"). Defaults to "u" to preserve the historical behavior of rules
  // that omit it.
  let re;
  try {
    re = new RegExp(pattern, flags);
  } catch {
    try {
      re = new RegExp(pattern);
    } catch {
      return true;
    }
  }

  let text = appliesTo === "frontmatter" ? JSON.stringify(ctx.frontmatter) : ctx.body || "";

  if (appliesTo !== "frontmatter" && excludeTableDelimiters) {
    // Markdown table delimiter rows (|---|, | :--- | ---: |) and horizontal
    // rules (---) are made only of hyphens, pipes, colons, and whitespace, so
    // the "--" half of an em-dash rule matches them even though they are not
    // em-dash substitutes. Drop such lines before testing. Prose that uses "--"
    // (word--word, word -- word) contains other characters and is still caught;
    // a line carrying a real em dash also survives this filter (U+2014 is not in
    // the class) and is still caught.
    text = text
      .split("\n")
      .filter((line) => !/^[\s|:-]*-[\s|:-]*$/.test(line))
      .join("\n");
  }

  if (re.test(text)) {
    return `Prohibited pattern (${pattern}) found in ${appliesTo}.`;
  }
  return true;
}

// Shared by checkBodyImpliesFrontmatter and checkFrontmatterImpliesFrontmatter:
// once each check's own trigger has matched (a body pattern, or a frontmatter
// "when" match), both require the same set of frontmatter fields to carry
// specific values and report failures the same way.
function requireFrontmatterFailures(requireFrontmatter, frontmatter) {
  const failures = [];
  for (const field of Object.keys(requireFrontmatter)) {
    const want = requireFrontmatter[field];
    const actual = frontmatter[field];
    // The frontmatter parser reads every unquoted number as a string, so a
    // numeric requirement is compared against its string form; booleans and
    // strings stay strict, keeping a quoted "false" distinct from false.
    const satisfied =
      actual === want || (typeof want === "number" && actual === String(want));
    if (!satisfied) {
      const found = actual === undefined ? "missing" : JSON.stringify(actual);
      failures.push(`"${field}" must be ${JSON.stringify(want)} (currently ${found})`);
    }
  }
  return failures;
}

function checkBodyImpliesFrontmatter(params, ctx) {
  const { bodyPattern, flags = "u", requireFrontmatter } = params;
  if (
    !bodyPattern ||
    !requireFrontmatter ||
    typeof requireFrontmatter !== "object" ||
    Array.isArray(requireFrontmatter)
  ) {
    return null;
  }

  // Retry without flags when the pattern is valid only outside unicode mode
  // (a lone "]" or an escaped hyphen, say). This mirrors prohibitedPattern:
  // failing to compile would silently switch a leak-prevention rule off, and
  // failing closed on a pattern the author reasonably wrote is worse than
  // matching it with default flags.
  let re;
  try {
    re = new RegExp(bodyPattern, flags);
  } catch {
    try {
      re = new RegExp(bodyPattern);
    } catch {
      return null;
    }
  }

  if (!re.test(ctx.body || "")) return true;

  const failures = requireFrontmatterFailures(requireFrontmatter, ctx.frontmatter);
  if (failures.length === 0) return true;
  return `Body matches /${bodyPattern}/, so frontmatter ${failures.join("; ")}.`;
}

function checkFrontmatterImpliesFrontmatter(params, ctx) {
  const { when, requireFrontmatter } = params;
  if (
    !when ||
    typeof when !== "object" ||
    Array.isArray(when) ||
    Object.keys(when).length === 0 ||
    !requireFrontmatter ||
    typeof requireFrontmatter !== "object" ||
    Array.isArray(requireFrontmatter)
  ) {
    return null;
  }

  if (!matchesWhen(when, ctx.frontmatter)) return true;

  const failures = requireFrontmatterFailures(requireFrontmatter, ctx.frontmatter);
  if (failures.length === 0) return true;
  return `Frontmatter matches ${JSON.stringify(when)}, so ${failures.join("; ")}.`;
}

// An article carrying an excluded tag must physically sit under a folder of the
// required name. The wall around excluded content is a path-scoped permission
// deny rule in .claude/settings.json, and permission rules match PATHS, never
// file contents: there is no rule that can say "deny anything tagged NSFW".
// Containment in a named folder is therefore the only thing that makes the block
// expressible at all, and this check is what notices an article that is not
// contained. It is deliberately the one violation the deny rule itself cannot
// report, because an article outside the protected path is, by definition,
// outside what the deny rule can see.
function checkTagImpliesPath(params, ctx) {
  const excluded = Array.isArray(params.tags)
    ? params.tags.filter((t) => typeof t === "string" && t.trim() !== "")
    : [];
  const segment = typeof params.requiredSegment === "string" ? params.requiredSegment.trim() : "";
  // Guarded here rather than left to the check loop's swallow-and-continue
  // catch: a half-configured rule must be inert, and an inert rule and a
  // crashed one are indistinguishable from outside if the catch handles both.
  if (excluded.length === 0 || segment === "") return null;

  const tags = ctx.frontmatter.tags;
  if (!Array.isArray(tags) || tags.length === 0) return true;

  // Case-insensitive on the tag because the DM types it by hand in Obsidian,
  // so its spelling is not guaranteed, and a tag that misses here is an article
  // that never gets contained.
  const lowerExcluded = excluded.map((t) => t.toLowerCase());
  const matched = tags.find(
    (t) => typeof t === "string" && lowerExcluded.includes(t.toLowerCase())
  );
  if (matched === undefined) return true;

  // relPath comes from path.relative, so it carries the platform separator;
  // split on both rather than assuming posix. Anchoring on relPath (prong-root
  // relative) rather than relProjectPath matters: a prong root that itself
  // contained a segment of this name would otherwise pass every article inside
  // it, silently disabling the rule for that whole setting.
  const dir = path.dirname(ctx.relPath);
  const segments = dir === "." ? [] : dir.split(/[\\/]/).filter(Boolean);
  const wanted = segment.toLowerCase();

  // Whole-segment comparison, never a substring test on the path. A folder
  // named "nsfw-rumors" or a file named "Nsfw-Rumors.md" is not the protected
  // folder, and the **/nsfw/** deny rule does not cover either, so counting
  // them as contained would report a leak as safe. Folder casing is folded for
  // the opposite reason: Windows and macOS filesystems are case-insensitive, so
  // an "NSFW" folder genuinely IS the "nsfw" folder and the deny rule covers it.
  if (segments.some((s) => s.toLowerCase() === wanted)) return true;

  return `Article carries the excluded tag "${matched}" but does not sit under a "${segment}" folder. Excluded content has to live inside one for the path-scoped permission deny rule to cover it; a tag alone cannot be denied. Move this file into the nearest "${segment}" folder.`;
}

// ---------------------------------------------------------------------------
// Option echo
// ---------------------------------------------------------------------------

// Words carrying no distinguishing signal when comparing a report sentence
// against a question's option text. Kept short: the four-character floor below
// already removes most function words, and a long list starts removing the
// nouns that make two sentences the same claim.
const ECHO_STOPWORDS = new Set([
  "the", "and", "that", "this", "with", "from", "have", "they", "them", "their",
  "what", "when", "where", "which", "were", "was", "for", "not", "then", "than",
  "also", "into", "onto", "about", "after", "before", "would", "could", "should",
  "did", "does", "done", "been", "being", "there", "here", "your", "yours",
]);

function contentWords(text) {
  const out = new Set();
  for (const raw of String(text).toLowerCase().split(/[^a-z0-9']+/)) {
    const word = raw.replace(/'/g, "");
    if (word.length < 4) continue;
    if (ECHO_STOPWORDS.has(word)) continue;
    out.add(word);
  }
  return out;
}

// Jaccard: shared words over the union. Edit distance cannot do this job at all,
// because the 2026-09-18 report sentence paraphrases its option and merges the
// option's label into its description, so the strings are far apart while the
// claim is identical.
//
// The denominator is the union and NOT Math.min(a.size, b.size), which was
// measured and rejected. Dividing by the smaller set scores any short sentence
// whose few content words happen to sit inside a long option at up to 1.0: the
// innocent sentence "The reporter and the team were on camera together at the
// scene" scores exactly 0.60 against the 09-18 option and would block at any
// threshold low enough to catch the real one (0.83). Under Jaccard the same
// pair scores 0.27 against the real sentence's 0.50, which is a margin wide
// enough to sit a threshold in.
function overlapRatio(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / (a.size + b.size - shared);
}

// Sentences of the body, frontmatter already stripped by parseFrontmatter.
function bodySentences(body) {
  return String(body)
    .replace(/^#+.*$/gm, " ")       // headings assert nothing
    .replace(/^\s*[-*]\s*\[[ x]\]/gm, " ") // checkbox markers, not prose
    .split(/(?<=[.!?])\s+|\r?\n/)
    .map((s) => s.replace(/^\s*[-*]\s*/, "").trim())
    .filter((s) => s.length > 0);
}

// Length ceiling for a single "DM message". The DM types sentences and
// paragraphs; a harness-injected system-reminder, skill body, or subagent
// dispatch brief runs from several KB to tens of KB. 4000 characters admits a
// long bulk-memory narration from debrief Phase 1 while excluding the kind of
// injected block that supplies unrelated content words wholesale.
// ponytail: a fixed character ceiling, not a real message-boundary detector;
// replace with a harness-version-aware parser if a genuine DM narration this
// long is ever seen truncated by it.
const MAX_DM_MESSAGE_CHARS = 4000;

// Harness-injected content opens with a tag like <system-reminder>,
// <user-prompt-submit-hook>, or <local-command-caveat>. The DM never types
// these; accepting them as "the DM's prose" would let an unrelated injected
// block, or this very correction hook's own stdout if it ever lands in the
// transcript, silently supply the content words checkOptionEcho's escape
// hatch is trying to verify came from the DM.
const HARNESS_TAG_PATTERN = /^\s*<[a-zA-Z][\w-]*>/;

// Returns ONE ENTRY PER DM MESSAGE, never a single joined blob. Both
// properties below were measured against a realistic debrief transcript and
// both are load-bearing.
//
// Per message, not pooled. A real debrief transcript is a bulk-memory dump
// plus dozens of short answers, and between them those messages use nearly
// every word in the campaign. Pooling them and asking "did the DM use these
// words" scores a laundered sentence at 1.00 against a transcript that never
// states it, which would suppress every block while looking alive. The same
// sentence scores far lower as a maximum over individual messages. The
// question has to be "did the DM say this thing", not "did the DM ever use
// these words".
//
// Text parts only. An AskUserQuestion selection comes back through the
// transcript as a user-role event carrying a tool_result, so accepting every
// part of every user event would feed the option's own text back in as the
// DM's prose and suppress exactly the blocks this rule exists for.
function dmMessages(transcriptPath) {
  if (typeof transcriptPath !== "string" || transcriptPath.length === 0) return null;
  let raw;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch {
    return null;
  }
  const said = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    // Shape varies by harness version, so read defensively.
    const role = event && (event.role || (event.message && event.message.role) || event.type);
    if (role !== "user") continue;
    // isMeta / isSidechain mark a transcript entry the harness generated
    // around the DM's turn (caveats, subagent dispatch briefs) rather than
    // something the DM typed. Checked on both the bare event and the nested
    // message object, matching the role lookup's own defensive shape above.
    if (event.isMeta === true || (event.message && event.message.isMeta === true)) continue;
    if (event.isSidechain === true || (event.message && event.message.isSidechain === true)) continue;
    const content = event.content || (event.message && event.message.content);
    const collect = (text) => {
      if (typeof text !== "string") return;
      if (text.length === 0 || text.length > MAX_DM_MESSAGE_CHARS) return;
      if (HARNESS_TAG_PATTERN.test(text)) return;
      said.push(text);
    };
    if (typeof content === "string") {
      collect(content);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || part.type !== "text") continue;
        collect(part.text);
      }
    }
  }
  return said.length > 0 ? said : null;
}

// Refuses a body sentence that restates an option this session offered AND that
// the DM never put in prose themselves. The signature of the 2026-09-18 bug: a
// sentence in the report that the pipeline wrote rather than the DM.
//
// Fail-silent on an absent or unreadable state file, and equally on an
// unreadable transcript: with no record of what the DM typed, the check cannot
// tell a laundered sentence from a confirmed one, and a block on no evidence is
// worse than no block. A session in which the recorder never ran behaves
// exactly as before.
//
// Known limitation: containment has no concept of negation. A DM correcting
// the exact laundered claim in their own words ("that never happened, the
// reporter never asked...") shares nearly all of its content words with the
// sentence it denies, so it clears proseThreshold and this check goes quiet
// for that sentence at the exact moment the DM is correcting it. This is not
// a gap this check can close on its own: the dm-correction hook is what
// catches a correction, and SHARED-PRINCIPLES' propagation paragraph is what
// covers the DM's own prose case. This check's job stops at "the DM
// substantially wrote this", not "the DM endorsed this".
function checkOptionEcho(params, ctx) {
  const minWords = typeof params.minContentWords === "number" ? params.minContentWords : 4;
  const threshold = typeof params.overlapThreshold === "number" ? params.overlapThreshold : 0.4;
  const proseThreshold = typeof params.proseThreshold === "number" ? params.proseThreshold : 0.5;

  let offered;
  try {
    const statePath = path.resolve(ctx.projectRoot, ".professor-orb", "asked-options.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    offered = Array.isArray(state.options) ? state.options : [];
  } catch {
    return true;
  }
  if (offered.length === 0) return true;

  const messages = dmMessages(ctx.transcriptPath);
  if (messages === null) return true;
  const messageWords = messages.map((m) => contentWords(m));

  const offeredSets = offered.map((text) => ({ text, words: contentWords(text) }));

  for (const sentence of bodySentences(ctx.body)) {
    const words = contentWords(sentence);
    // A sentence with few content words cannot be distinguished from an option
    // by overlap alone, and flagging it would be noise on every index line.
    if (words.size < minWords) continue;

    // Containment against the single best DM message: how much of THIS sentence
    // appears in one thing the DM actually typed. Measured over pooled messages
    // instead, this is 1.00 for a transcript that never states the claim, which
    // is why dmMessages returns them separately.
    let bestContainment = 0;
    for (const msg of messageWords) {
      let shared = 0;
      for (const word of words) if (msg.has(word)) shared++;
      const containment = shared / words.size;
      if (containment > bestContainment) bestContainment = containment;
    }
    if (bestContainment >= proseThreshold) continue;

    for (const option of offeredSets) {
      if (overlapRatio(words, option.words) >= threshold) {
        return [
          `This sentence restates a question option from this session, and the DM never wrote it in prose: "${sentence}"`,
          `  the option offered: "${option.text}"`,
          "  Confirm it with the DM in their own words, or cut it. An option points at a topic; what happened comes back in the DM's own words.",
        ].join("\n");
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Pronouns
// ---------------------------------------------------------------------------

// The recognized sets, each as its subject form plus the object and possessive
// forms that identify it in prose. A set is "used" when any of its forms
// appears as a whole word.
const PRONOUN_SETS = {
  __proto__: null,
  "they/them": ["they", "them", "their", "theirs", "themself", "themselves"],
  "she/her": ["she", "her", "hers", "herself"],
  "he/him": ["he", "him", "his", "himself"],
  "it/its": ["it", "its", "itself"],
  "xe/xem": ["xe", "xem", "xyr", "xyrs"],
  "ze/hir": ["ze", "hir", "hirs", "zir", "zirs"],
};

// The article's pronoun line: the first line naming pronouns at all. Returns
// { line, sets, writing } where writing is the set the line names for prose, or
// null when it names none.
function pronounLine(body) {
  for (const raw of String(body).split(/\r?\n/)) {
    if (!/pronouns?\s*[:\-]/i.test(raw)) continue;
    const line = raw.trim();
    const lower = line.toLowerCase();
    const sets = [];
    for (const name of Object.keys(PRONOUN_SETS)) {
      const subject = name.split("/")[0];
      if (new RegExp(`\\b${subject}\\b`, "i").test(lower)) sets.push(name);
    }
    if (sets.length === 0) continue;
    // "in writing", "for prose", "in prose", "written as": the phrases that
    // name one set as the one to use. The set named is the one nearest before
    // the phrase, which is how the sentence reads in English.
    let writing = null;
    const marker = lower.search(/\b(?:in writing|for prose|in prose|written as|use)\b/);
    if (marker !== -1) {
      const before = lower.slice(0, marker);
      for (const name of sets) {
        const subject = name.split("/")[0];
        if (new RegExp(`\\b${subject}\\b`, "i").test(before)) writing = name;
      }
    }
    if (writing === null && sets.length === 1) writing = sets[0];
    return { line, sets, writing };
  }
  return null;
}

// An article listing more than one set must name the one prose uses. A
// declaration offering three reads as a choice, which is how party/Psyche.md
// produced four drafts in the wrong pronoun while every other source used one.
// Warn, not block: which set to write is the DM's call about their own
// character, so there is no unambiguous mechanical fix.
function checkPronounDeclaration(params, ctx) {
  const types = Array.isArray(params.appliesToTypes) ? params.appliesToTypes : ["Person"];
  if (!types.includes(ctx.frontmatter.type)) return true;

  const found = pronounLine(ctx.body);
  if (!found) return true;
  if (found.sets.length <= 1) return true;
  if (found.writing !== null) return true;

  return [
    `This article lists ${found.sets.length} pronoun sets (${found.sets.join(", ")}) without naming the one prose uses: "${found.line}"`,
    '  Name it, for example "they/them in writing; she/her and he/him also accepted", so nothing downstream has to choose.',
  ].join("\n");
}

// Flags a body using a pronoun set that a referenced character's article lists
// as accepted but does not name for writing. Deliberately narrow: it fires only
// when the article names one set AND lists others. With no other set listed
// there is nothing to confuse, and a check that guessed would be noise on every
// article with more than one character in it.
function checkPronounConsistency(params, ctx) {
  const types = Array.isArray(params.sourceTypes) ? params.sourceTypes : ["Person"];
  const articles = [];
  for (const root of ctx.searchRoots || []) {
    collectArticles(root, articles, 0);
  }

  // Filter by FILENAME before reading anything. collectArticles walks
  // directories, which costs one readdir per folder; reading and parsing every
  // article it finds would cost up to 1500 readFileSync plus 1500 frontmatter
  // parses on EVERY write, against this hook's timeout. A draft names a handful
  // of characters, so the name test cuts the read set to those few. The test is
  // the same one used below, hoisted, so it cannot drift from it.
  const nameMatches = (abs) => {
    const name = baseNameNoExt(path.basename(abs));
    if (name.length < 3) return false;
    return new RegExp(`\\b${name.replace(/[-_]/g, "[ -_]")}\\b`, "i").test(ctx.body);
  };

  for (const abs of articles) {
    if (abs === ctx.absFilePath) continue;
    if (!nameMatches(abs)) continue;

    let parsed;
    try {
      parsed = parseFrontmatter(readFileSync(abs, "utf8"));
    } catch {
      continue;
    }
    if (!parsed || !types.includes(parsed.data.type)) continue;

    const found = pronounLine(parsed.body);
    if (!found || found.writing === null || found.sets.length <= 1) continue;

    // If the draft already uses the writing set's own forms anywhere, it is
    // demonstrably capable of using the right pronoun, and a stray
    // non-writing-set pronoun elsewhere in a multi-character report is far
    // more likely to be about a different character than a slip on this one.
    // This is a coarse guard, not name-proximity scoping: it silences the
    // check on any draft that ALSO uses the writing set correctly at least
    // once, rather than checking each pronoun's nearest antecedent.
    // ponytail: whole-document heuristic; a windowed check scoping each
    // pronoun to its nearest preceding name is the real fix if a false
    // negative from this trade-off turns out to matter in practice.
    const writingFormsPresent = PRONOUN_SETS[found.writing].some((form) =>
      new RegExp(`\\b${form}\\b`, "i").test(ctx.body)
    );
    if (writingFormsPresent) continue;

    const name = baseNameNoExt(path.basename(abs));
    for (const set of found.sets) {
      if (set === found.writing) continue;
      for (const form of PRONOUN_SETS[set]) {
        if (new RegExp(`\\b${form}\\b`, "i").test(ctx.body)) {
          return [
            `This draft uses ${set} while ${name}'s article names ${found.writing} as the pronoun prose uses: "${found.line}"`,
            `  Rewrite the draft in ${found.writing}, or change the article if the DM says the article is stale (Principle 1).`,
          ].join("\n");
        }
      }
    }
  }
  return true;
}

// Bounded recursive collection of markdown files, matching searchForFileStat's
// depth discipline so a deep knowledge base cannot stall a write.
//
// Does NOT use this file's safeReaddir: that helper returns bare filename
// strings and null on failure, so entry.isDirectory() would throw, the
// check-crash guard at the rule loop would swallow it, and this check would
// silently never fire. withFileTypes avoids a statSync per entry as well.
function collectArticles(dir, out, depth) {
  if (depth > 6 || out.length > 1500) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      collectArticles(path.join(dir, entry.name), out, depth + 1);
    } else if (entry.name.toLowerCase().endsWith(".md")) {
      out.push(path.join(dir, entry.name));
    }
  }
}

// Check semantics are duplicated four ways: skills/setup/references/conventions-schema.md's
// check catalog (normative), this CHECKS table, the checkerPrompt in
// workflows/validation-sweep.mjs, and agents/kb-validator.md Step 4. The base rule data
// is single-sourced at references/base-rules.json; the semantics are not. Changing one
// requires changing the other three.
const CHECKS = {
  requiredFields: checkRequiredFields,
  enum: checkEnum,
  default: checkDefault,
  format: checkFormat,
  suffixByType: checkSuffixByType,
  charset: checkCharset,
  indexParity: checkIndexParity,
  singleOwnership: checkSingleOwnership,
  splitThreshold: checkSplitThreshold,
  absorbThreshold: checkAbsorbThreshold,
  wikilinkPolicy: checkWikilinkPolicy,
  tagVocabulary: checkTagVocabulary,
  prohibitedPattern: checkProhibitedPattern,
  bodyImpliesFrontmatter: checkBodyImpliesFrontmatter,
  frontmatterImpliesFrontmatter: checkFrontmatterImpliesFrontmatter,
  tagImpliesPath: checkTagImpliesPath,
  optionEcho: checkOptionEcho,
  pronounDeclaration: checkPronounDeclaration,
  pronounConsistency: checkPronounConsistency,
};

// ---------------------------------------------------------------------------
// Autofix requests
// ---------------------------------------------------------------------------

// The agent the hook asks the main session to dispatch. A hook cannot dispatch
// it directly: a hook is a subprocess handed JSON on stdin, with no channel to
// the Agent tool. It can only leave the request in output Claude reads, so this
// is an instruction the main session follows, not a forced call.
const FIXER_AGENT = "rule-fixer";

function formatAutofixRequest(ruleId, guidance, ctx) {
  return [
    `AUTOFIX AVAILABLE for [${ruleId}]. Dispatch the professor-orb ${FIXER_AGENT} agent now, once for this file, and do not fix this yourself.`,
    `  file: ${ctx.relProjectPath}`,
    `  rule: ${ruleId}`,
    `  guidance: ${guidance}`,
    "This fix class is pre-approved, by the DM authoring the rule or by the enforcement level they confirmed at setup, so apply it without asking.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Settings resolution
// ---------------------------------------------------------------------------

// Normalizes v1, v2, and v3 conventions files to one shape. A v1 or v2 file
// has a bare kbRoot and a top-level rules object; it reads as a single unnamed
// setting whose other prong roots are unknown. That is enough for validation
// and deliberately not enough for lane resolution, which refuses this shape.
function resolveSettings(conventions) {
  if (Array.isArray(conventions.settings) && conventions.settings.length > 0) {
    return conventions.settings.filter((s) => s && typeof s.kbRoot === "string");
  }
  if (typeof conventions.kbRoot === "string" && conventions.rules) {
    return [
      {
        name: null,
        kbRoot: conventions.kbRoot,
        homebrewRoot: null,
        sessionReportsRoot: null,
        rules: conventions.rules,
        tagRegistryPath: conventions.tagRegistryPath,
      },
    ];
  }
  return [];
}

// Which prong of a setting contains this path, if any. Returns "kb",
// "homebrew", "session-reports", or null.
function prongContaining(projectRoot, setting, absFilePath) {
  const prongs = [
    ["kb", setting.kbRoot],
    ["homebrew", setting.homebrewRoot],
    ["session-reports", setting.sessionReportsRoot],
  ];
  for (const [kind, root] of prongs) {
    if (typeof root !== "string" || root.length === 0) continue;
    const rootAbs = path.resolve(projectRoot, root);
    const rel = path.relative(rootAbs, absFilePath);
    if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) return kind;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const stdinRaw = readStdin();

  let input;
  try {
    input = JSON.parse(stdinRaw);
  } catch {
    process.exit(0);
  }

  if (!input || typeof input !== "object") process.exit(0);

  const toolName = input.tool_name;

  // Present only when the hook fires inside a subagent. Used to stop the fixer
  // being asked to dispatch itself.
  const agentType = input.agent_type;

  // Carried for optionEcho, which must distinguish a sentence the DM wrote from
  // one only a question option ever said. Absent in older harness versions, and
  // that absence is handled by the check rather than here.
  const transcriptPath = typeof input.transcript_path === "string" ? input.transcript_path : "";
  if (toolName && toolName !== "Write" && toolName !== "Edit") {
    process.exit(0);
  }

  const toolInput = input.tool_input || {};
  const filePath = toolInput.file_path;
  if (typeof filePath !== "string" || filePath.length === 0) {
    process.exit(0);
  }

  const projectRoot =
    typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : process.cwd();

  const conventionsPath = path.resolve(projectRoot, ".professor-orb", "conventions.json");
  if (!existsSync(conventionsPath)) {
    process.exit(0);
  }

  let conventions;
  try {
    conventions = JSON.parse(readFileSync(conventionsPath, "utf8"));
  } catch {
    process.exit(0);
  }

  if (!conventions || typeof conventions !== "object") {
    process.exit(0);
  }

  // v3 carries a settings array; v1 and v2 carry a bare kbRoot. Both shapes
  // must resolve, because a consumer's file is only rewritten when setup next
  // runs. A v3 file reaching the old guard exited 0 and silently disabled all
  // validation, which is why this accepts either shape explicitly.
  const settings = resolveSettings(conventions);
  if (settings.length === 0) {
    process.exit(0);
  }

  const absFilePath = path.resolve(projectRoot, filePath);

  // The owning setting is the one whose prong roots contain this file. Rules
  // are per setting, so the wrong owner means the wrong rule set.
  let owner = null;
  let prongKind = null;
  for (const s of settings) {
    const kind = prongContaining(projectRoot, s, absFilePath);
    if (kind) {
      owner = s;
      prongKind = kind;
      break;
    }
  }
  if (!owner || !owner.rules) {
    process.exit(0);
  }

  // The deleted block was the only definition of relToKb, and the ctx literal
  // still reads it as relPath. It must be reintroduced here or main() throws an
  // uncaught ReferenceError on every write: main() is invoked bare at the bottom
  // of the file, and the only try/catch in the check loop wraps individual check
  // functions, not this.
  //
  // Anchor it to the prong root that owns the file rather than to kbRoot.
  // relPath feeds only the human-readable folder label in the three structural
  // checks, and a homebrew or session-reports file measured from kbRoot would
  // render as a "../" label.
  const prongRoots = {
    kb: owner.kbRoot,
    homebrew: owner.homebrewRoot,
    "session-reports": owner.sessionReportsRoot,
  };
  const prongRootAbs = path.resolve(projectRoot, prongRoots[prongKind] || owner.kbRoot);
  const relToProng = path.relative(prongRootAbs, absFilePath);

  // Wikilink resolution searches the union of the owning setting's prong
  // roots, not kbRoot alone, so a session report can link to a KB article
  // (or vice versa) without the target reading as dead.
  const searchRoots = ["kbRoot", "homebrewRoot", "sessionReportsRoot"]
    .map((k) => owner[k])
    .filter((r) => typeof r === "string" && r.length > 0)
    .map((r) => path.resolve(projectRoot, r));

  let fileContent;
  try {
    fileContent = readFileSync(absFilePath, "utf8");
  } catch {
    process.exit(0);
  }

  const parsed = parseFrontmatter(fileContent);
  if (!parsed || parsed.data.type === undefined || parsed.data.type === null) {
    process.exit(0);
  }

  const ctx = {
    projectRoot,
    toolName,
    prongKind,
    searchRoots,
    absFilePath,
    relPath: relToProng,
    relProjectPath: path.relative(projectRoot, absFilePath),
    fileName: path.basename(absFilePath),
    frontmatter: parsed.data,
    frontmatterOrder: parsed.order,
    body: parsed.body,
    // A v3 setting carries its own tag vocabulary, so the owning setting's
    // registry wins over any top-level one a v1 or v2 file supplied.
    tagRegistryPath: owner.tagRegistryPath || conventions.tagRegistryPath,
    conventions,
    transcriptPath,
  };

  const blockViolations = [];
  const warnings = [];
  const autofixRequests = [];

  for (const ruleId of Object.keys(owner.rules)) {
    const rule = owner.rules[ruleId];
    if (!rule || rule.enforcement === "off") continue;

    const checkFn = CHECKS[rule.check];
    if (!checkFn) continue; // unrecognized check kind: forward-compatible skip

    // A base rule may be extended by the project: extra permitted enum values
    // live in rule.extendedBy, unioned into the rule's enum values only, so
    // the project never needs a second rule of the same check kind on the
    // same field, which would fail every article against one of the two.
    // Mapping-based rules (suffixByType) are deliberately not extended here:
    // params.mapping holds {type, suffix} objects, matched by
    // mapping.find((m) => m.type === type), so splicing a bare string from
    // extendedBy in would create an entry that can never match, silently
    // disabling the rule for the extended type instead of enforcing it.
    let effectiveParams = rule.params || {};
    if (Array.isArray(rule.extendedBy) && rule.extendedBy.length > 0) {
      if (Array.isArray(effectiveParams.values)) {
        effectiveParams = {
          ...effectiveParams,
          values: [...effectiveParams.values, ...rule.extendedBy],
        };
      }
    }

    // scope "kb" restricts a rule to the setting knowledge base. ctx.prongKind
    // now carries the prong that owns the file, so a homebrew or
    // session-reports write skips the rule instead of being measured by it.
    if (rule.scope === "kb" && ctx.prongKind && ctx.prongKind !== "kb") continue;

    let result;
    try {
      result = checkFn(effectiveParams, ctx);
    } catch {
      // A check must never crash a write; treat as inconclusive.
      continue;
    }

    if (result === true || result === null || result === undefined) continue;

    const message = typeof result === "string" ? result : rule.description || `Rule "${ruleId}" failed.`;

    if (rule.enforcement === "block") {
      blockViolations.push(`[${ruleId}] ${message}`);
    } else if (rule.enforcement === "warn") {
      warnings.push(`[${ruleId}] ${message}`);
    }

    // Only a rule that actually failed reaches here, and only one whose
    // enforcement is a recognized level that produced a violation entry above.
    // A malformed autofix value, or an unrecognized enforcement value, is
    // treated as absent: it never emits a request and never changes enforcement.
    if (
      (rule.enforcement === "block" || rule.enforcement === "warn") &&
      typeof rule.autofix === "string" &&
      rule.autofix.trim() !== "" &&
      agentType !== FIXER_AGENT
    ) {
      autofixRequests.push(formatAutofixRequest(ruleId, rule.autofix.trim(), ctx));
    }
  }

  // Exit 2 is the only channel that reaches Claude with a non-zero status, and
  // a JSON body is parsed only on exit 0, so the two are mutually exclusive. A
  // blocking write therefore carries its warnings on stderr as well; before
  // this they were discarded whenever anything blocked.
  if (blockViolations.length > 0) {
    process.stderr.write([...blockViolations, ...warnings, ...autofixRequests].join("\n") + "\n");
    process.exit(2);
  }

  // PostToolUse stdout goes to the debug log, not to Claude and not to the
  // transcript: only UserPromptSubmit, UserPromptExpansion, and SessionStart
  // treat it as context. additionalContext in a JSON body is the supported way
  // for this event to reach the model, so warn rules use it. Printing bare text
  // here, as earlier versions did, meant no warn rule was ever seen by anyone.
  if (warnings.length > 0 || autofixRequests.length > 0) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: [...warnings, ...autofixRequests].join("\n"),
        },
      })
    );
  }

  process.exit(0);
}

main();
