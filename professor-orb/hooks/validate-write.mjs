#!/usr/bin/env node
// PostToolUse hook (matcher: Write|Edit): validates a just-written KB article
// against .professor-orb/conventions.json.
//
// Graceful degradation: if conventions.json does not exist, or the written
// file is not a KB article, this script exits 0 silently. Unknown check
// kinds are skipped for forward compatibility. Node.js built-ins only.

import { readFileSync, existsSync, readdirSync } from "node:fs";
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
  // accepted until the deferred parity migration lands.
  if (ctx.toolName === "Edit") return true;

  const dir = path.dirname(ctx.absFilePath);
  const entries = safeReaddir(dir);
  if (!entries) return null;

  // Only block writes that worsen parity; ordinary article writes never fail this check.
  const isIndexWrite = baseNameNoExt(ctx.fileName).endsWith(indexSuffix);
  if (!isIndexWrite) return true;

  // File being written is an index file. Block only if a different index already exists.
  const existingIndexFiles = entries.filter((f) => baseNameNoExt(f).endsWith(indexSuffix));
  const conflicts = existingIndexFiles.filter((f) => f !== ctx.fileName);
  if (conflicts.length > 0) {
    const folderLabel = path.dirname(ctx.relPath) || ".";
    return `Folder "${folderLabel}" already has an index file; writing a second would break parity.`;
  }
  return true;
}

function checkSingleOwnership() {
  // KB-wide check; only the validation sweep has enough context to run it.
  return null;
}

function checkSplitThreshold(params, ctx) {
  const { minEntries } = params;
  if (typeof minEntries !== "number") return null;

  const dir = path.dirname(ctx.absFilePath);
  const entries = safeReaddir(dir);
  if (!entries) return null;

  const count = entries.filter((f) => !f.startsWith(".")).length;
  if (count >= minEntries) {
    const folderLabel = path.dirname(ctx.relPath) || ".";
    return `Folder "${folderLabel}" has ${count} entries (at least ${minEntries}); consider splitting into a sub-index.`;
  }
  return true;
}

function checkAbsorbThreshold(params, ctx) {
  const { maxEntries } = params;
  if (typeof maxEntries !== "number") return null;

  const dir = path.dirname(ctx.absFilePath);
  const entries = safeReaddir(dir);
  if (!entries) return null;

  const count = entries.filter((f) => !f.startsWith(".")).length;
  if (count <= maxEntries) {
    const folderLabel = path.dirname(ctx.relPath) || ".";
    return `Folder "${folderLabel}" has ${count} entries (at most ${maxEntries}); consider absorbing it into its parent.`;
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

function wikilinkTargetExists(kbRootAbs, target) {
  const candidates = [`${target}.md`, target];
  return searchForFileStat(kbRootAbs, candidates, 0);
}

function checkWikilinkPolicy(params, ctx) {
  const requireExistingTarget = Boolean(params.requireExistingTarget);
  const body = ctx.body || "";
  const re = /\[\[([^[\]]*)\]\]/g;

  const badLinks = [];
  const missingTargets = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    const inner = m[1];
    // Inside a Markdown table a wikilink escapes its pipe ([[Target\|Display]])
    // so the cell is not split; treat "\|" and "|" as the same separator.
    const target = inner ? inner.split(/\\?\|/)[0].trim() : "";
    if (!target) {
      badLinks.push(m[0]);
      continue;
    }
    if (requireExistingTarget && !wikilinkTargetExists(ctx.kbRootAbs, target)) {
      missingTargets.push(target);
    }
  }

  const problems = [];
  if (badLinks.length > 0) {
    problems.push(`Malformed wikilink(s): ${badLinks.join(", ")}.`);
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
    ctx.conventions.tagRegistryPath || path.join(".professor-orb", "tag-registry.json")
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
};

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

  if (!conventions || typeof conventions !== "object" || !conventions.kbRoot || !conventions.rules) {
    process.exit(0);
  }

  const kbRootAbs = path.resolve(projectRoot, conventions.kbRoot);
  const absFilePath = path.resolve(projectRoot, filePath);

  const relToKb = path.relative(kbRootAbs, absFilePath);
  const isInsideKb =
    relToKb !== "" && !relToKb.startsWith("..") && !path.isAbsolute(relToKb);
  if (!isInsideKb) {
    process.exit(0);
  }

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
    kbRootAbs,
    absFilePath,
    relPath: relToKb,
    fileName: path.basename(absFilePath),
    frontmatter: parsed.data,
    frontmatterOrder: parsed.order,
    body: parsed.body,
    conventions,
  };

  const blockViolations = [];
  const warnings = [];

  for (const ruleId of Object.keys(conventions.rules)) {
    const rule = conventions.rules[ruleId];
    if (!rule || rule.enforcement === "off") continue;

    const checkFn = CHECKS[rule.check];
    if (!checkFn) continue; // unrecognized check kind: forward-compatible skip

    let result;
    try {
      result = checkFn(rule.params || {}, ctx);
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
  }

  if (blockViolations.length > 0) {
    process.stderr.write(blockViolations.join("\n") + "\n");
    process.exit(2);
  }

  if (warnings.length > 0) {
    process.stdout.write(warnings.join("\n") + "\n");
  }

  process.exit(0);
}

main();
