#!/usr/bin/env node
// UserPromptSubmit hook: catches a DM correction and searches the
// project for every copy of what they corrected.
//
// Six principles in SHARED-PRINCIPLES already state that the DM's word is law.
// All six held on 2026-09-18 and none fired: a false sentence entered a report
// and spread to its NPC line, its faction line, the Reports-INDEX summary, and
// three commits before the DM caught it two days later. This hook exists
// because a seventh statement would have done the same nothing. It fires in the
// harness, before the model acts, and its output is a list of places rather
// than an instruction to go looking.
//
// Fail-silent for a non-match or malformed stdin: exits 0 with no output, and
// a non-match is indistinguishable from this hook not existing. A missing
// conventions file is different: once a correction is detected, the hook
// still speaks (see main()'s output block) even though laneRoots() finds
// nothing to search. Silence there would read as "nothing to fix," which is
// the failure this hook exists to prevent.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { projectRootFrom } from "./project-root.mjs";

// Correction-shaped language. Deliberately narrow: this hook runs on every DM
// message, so each pattern added here is a lane grep added to some ordinary
// turn. Every pattern requires an explicit wrongness marker ("wrong",
// "incorrect", "not what I said") or the verb "happen" under a negation.
// "never" alone is NOT enough: "the party never found the ledger" is the DM
// narrating, not correcting, and the test pins that case as silent.
// "Not what I asked" and "not what I meant" are excluded for the same reason:
// they correct the assistant's reading of a request and name no claim to trace.
// On 2026-09-29 "meant" fired on exactly that and flooded a turn with 13 KB of
// lines that shared nothing but common words.
const CORRECTION_PATTERNS = [
  /\bnever\s+(?:\w+\s+){0,2}happen(?:ed)?\b/i,
  /\b(?:did\s*n[o']?t|didnt|does\s*n[o']?t)\s+(?:\w+\s+){0,2}happen(?:ed)?\b/i,
  /\b(?:that'?s|that\s+is|this\s+is|it'?s|you'?re|thats)\s+(?:just\s+)?(?:wrong|incorrect|false|backwards)\b/i,
  /\bnot\s+what\s+i\s+(?:said|told)\b/i,
  /\bi\s+(?:already\s+)?told\s+you\b/i,
  /\bno,?\s+it\s+(?:was|wasn'?t|is|isn'?t)\b(?!\s+(?:worth|nothing|fine|okay|ok|just|what|a\s+big\s+deal))/i, // ponytail: idiom blocklist covers cases seen in review; extend if new false positives surface
  /\bwrong\s+(?:pronouns?|name|date|order|person|place)\b/i,
];

function looksLikeCorrection(text) {
  if (typeof text !== "string" || text.trim() === "") return false;
  return CORRECTION_PATTERNS.some((re) => re.test(text));
}

// Overridable via env var for testing only (see dm-correction.test.mjs); a
// real invocation never sets this. Raised from an earlier 2000: measured
// against a real ~2200-file consumer project, an uncapped walk took 938ms,
// so 6000 leaves ample headroom under this hook's 10-second timeout even on a
// slower disk, while MAX_WALK_MS below is the actual safety net against a
// pathological case (very large files, a slow filesystem) that a file count
// alone would not catch.
const MAX_FILES = Number(process.env.DM_CORRECTION_MAX_FILES) || 6000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_HITS = 20;
// Collection ceiling per file. Beyond a few lines from one document the DM
// learns nothing new, and without this one noisy file could supply every hit
// the interleave below has to work with. Trimming here sets `truncated`, so
// the DM is told the file had more.
const MAX_HITS_PER_FILE = 5;
// Wall-clock ceiling for the WHOLE search across all roots, independent of
// MAX_FILES. Belt-and-suspenders: MAX_FILES bounds the common case, this
// bounds the worst case.
const MAX_WALK_MS = 7000;
// Characters of a hit line shown, centred on the first matched term. A body
// line is often a whole paragraph, and twenty of them overflowed the inline
// output limit so the list went unseen. The file:line pointer carries the rest.
const MAX_SNIPPET_CHARS = 200;

function snippet(text, terms) {
  if (text.length <= MAX_SNIPPET_CHARS) return text;
  const lower = text.toLowerCase();
  const at = Math.min(...terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0));
  const start = Math.max(0, Math.min(at - MAX_SNIPPET_CHARS / 4, text.length - MAX_SNIPPET_CHARS));
  const end = start + MAX_SNIPPET_CHARS;
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}

// Words that carry no search signal. Short list on purpose: the length filter
// below removes most function words already, and an over-long stoplist starts
// removing the nouns a correction turns on.
const STOPWORDS = new Set([
  "that", "this", "never", "happened", "happen", "wrong", "incorrect", "said",
  "told", "about", "there", "their", "they", "them", "with", "from", "have",
  "what", "when", "where", "which", "were", "was", "and", "the", "for", "not",
  "didnt", "doesnt", "actually", "really", "just", "only", "also", "fucking",
  // Contractions, after the tokenizer strips the apostrophe. "you're wrong" is
  // one of the correction patterns, so "youre" was a search word in nearly
  // every correction, matched nothing, and only raised the bar for the rest.
  "youre", "thats", "dont", "isnt", "wasnt", "arent", "werent", "theyre",
  "theres", "cant", "wont", "hasnt", "havent",
]);

// The correction's content words, which are what the project is searched for. A
// term must be four characters or longer: shorter tokens match everywhere and
// turn every report into a hit.
function searchTerms(text) {
  const seen = new Set();
  for (const raw of text.toLowerCase().split(/[^a-z0-9']+/)) {
    // A possessive keeps its name: "aethon's" searches as "aethon". Stripping
    // the apostrophe alone left "aethons", which no line holds.
    const word = raw.replace(/'s$/, "").replace(/'/g, "");
    if (word.length < 4) continue;
    if (STOPWORDS.has(word)) continue;
    seen.add(word);
    if (seen.size >= 8) break;
  }
  return [...seen];
}

// The parsed conventions file, or null when it is absent or unreadable.
function readConventions(cwd) {
  try {
    const conventions = JSON.parse(readFileSync(path.resolve(cwd, ".professor-orb", "conventions.json"), "utf8"));
    return conventions && typeof conventions === "object" ? conventions : null;
  } catch {
    return null;
  }
}

// Every prong of every setting, plus the proposals folder. Returns absolute
// paths that exist. An absent or unreadable conventions file returns an empty
// array, and main() does NOT treat that as "say nothing": it still prints the
// correction preamble plus an explicit "could not locate it" message. An empty
// array here means the search found nothing to look in, not that the hook
// failed to run.
function laneRoots(conventions, cwd) {
  if (!conventions) return [];

  const settings = Array.isArray(conventions.settings) ? conventions.settings : [];
  const candidates = [];
  for (const setting of settings) {
    if (!setting || typeof setting !== "object") continue;
    for (const key of ["kbRoot", "homebrewRoot", "sessionReportsRoot"]) {
      if (typeof setting[key] === "string" && setting[key].length > 0) candidates.push(setting[key]);
    }
  }
  // A v1 or v2 conventions file has a bare top-level kbRoot and no settings
  // array. Reading it is enough for a search, unlike lane resolution.
  if (candidates.length === 0 && typeof conventions.kbRoot === "string") candidates.push(conventions.kbRoot);
  candidates.push(path.join(".professor-orb", "proposals"));

  const roots = [];
  for (const rel of candidates) {
    const abs = path.resolve(cwd, rel);
    try {
      if (statSync(abs).isDirectory()) roots.push(abs);
    } catch {
      // Not on disk. A configured prong the DM has not created yet is normal.
    }
  }
  return roots;
}

// Content the project has walled off, which this hook must never print. It
// reads files from disk itself, so neither the harness's path-scoped deny rule
// nor block-excluded.mjs (which guards Claude's own Read and Grep) stands
// between an excluded article and this turn's context; until 2026-10-01 a line
// from an nsfw folder could be listed here verbatim. Derived the way those two
// derive it, from every tagImpliesPath rule with enforcement ignored (an "off"
// rule stops placement checks, never the wall): folder names from
// requiredSegment, tags from the tag list, and block-excluded's default tag
// when the project names none.
const FALLBACK_TAGS = ["NSFW"];

function exclusionsFrom(conventions) {
  const segments = new Set();
  const tags = new Set();
  const settings = !conventions
    ? []
    : Array.isArray(conventions.settings)
      ? conventions.settings
      : conventions.rules
        ? [conventions]
        : [];
  for (const setting of settings) {
    const rules = setting && setting.rules;
    if (!rules || typeof rules !== "object") continue;
    for (const rule of Object.values(rules)) {
      if (!rule || rule.check !== "tagImpliesPath") continue;
      const params = rule.params || {};
      const ruleTags = (Array.isArray(params.tags) ? params.tags : [])
        .filter((t) => typeof t === "string" && t.trim() !== "")
        .map((t) => t.trim());
      for (const t of ruleTags) tags.add(t);
      const segment = typeof params.requiredSegment === "string" ? params.requiredSegment.trim() : "";
      if (ruleTags.length > 0 && segment !== "") segments.add(segment.toLowerCase());
    }
  }
  return { segments, tags: tags.size > 0 ? [...tags] : FALLBACK_TAGS, configured: tags.size > 0 };
}

// Whether the file's frontmatter names an excluded tag: a whole-token,
// case-insensitive match anywhere in the block, as block-excluded.mjs matches.
// Unlike block-excluded, which bounds its read to keep bodies out of memory,
// this hook already holds the whole file, so it reads to the closing fence.
function carriesExcludedTag(content, tags) {
  const lines = content.split(/\r?\n/);
  if (lines[0].trim() !== "---") return false;
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  const block = lines.slice(1, close === -1 ? undefined : close).join("\n");
  return tags.some((tag) => {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}([^A-Za-z0-9_-]|$)`, "i").test(block);
  });
}

// How many files each root may read, given every root's file count. A root
// smaller than an even share is read in full and its unused share passes to
// the larger roots, which split what is left evenly. Where a root sits in the
// settings array moves its share by one file at most.
function fairShares(sizes, budget) {
  const shares = sizes.map(() => 0);
  const smallestFirst = sizes.map((_, i) => i).sort((a, b) => sizes[a] - sizes[b]);
  let left = budget;
  smallestFirst.forEach((i, k) => {
    shares[i] = Math.min(sizes[i], Math.floor(left / (smallestFirst.length - k)));
    left -= shares[i];
  });
  return shares;
}

// Round-robin across a list of lists: the first item of each, then the second
// of each, and so on, skipping lists that have run out. Used twice by
// findHits, at the two levels where an early, noisy group would otherwise
// consume a budget the later groups needed a share of.
function interleave(groups) {
  const out = [];
  const deepest = Math.max(0, ...groups.map((g) => g.length));
  for (let i = 0; i < deepest; i++) {
    for (const g of groups) if (i < g.length) out.push(g[i]);
  }
  return out;
}

// Every markdown line under roots holding at least half the search terms,
// rounded up and never fewer than two, or one when the correction yielded only
// one term. Half, not a flat two: on 2026-09-30 an eight-word correction matched
// twenty lines that shared only "every" and "single" with it, while a real copy
// of a claim shares most of its words. The 2026-09-18 correction yields four
// terms, so its bar stays at two and both of its copies are still found.
//
// The file and hit budgets are divided across roots, never spent first-come,
// because that starves whatever comes last. (The wall-clock ceiling is the one
// shared budget: a timeout leaves later roots unread, and the output says so.) Measured on the real consumer project: a first
// setting of 1855 articles exhausted a global file cap before the second
// setting was reached at all, and once files were divided, a global 20-hit cap
// still let that setting's coincidental matches fill the list before the
// correct campaign's own report appeared.
//
// The file budget is divided by fairShares, after a listing pass that opens
// no file. An even split was the first division, and it wasted what small
// roots left over: on 2026-10-01 rolara's seven roots held 2250 files against
// a 6000-file budget, yet each root got 857, so 998 files of the 1855-file
// vault were never searched and every run said it had stopped short.
//
// Fairness is two levels deep because the starvation is. A per-root hit share
// alone does not reach the file that matters: inside the winning root, walk
// order starves file-to-file exactly as the settings array starved
// root-to-root, and the target sat behind an index line and seven prep-file
// matches. So hits interleave twice, across the files within a root and then
// across the roots. Every matching file contributes a line before any file
// contributes a second, and every root is represented before any root goes
// deeper.
//
// Selection and presentation are separate: interleaving decides WHICH hits
// survive the budget, and the survivors sort by path so the list still reads
// grouped by file.
//
// Returns { hits, truncated }. `truncated` covers every way the search can
// stop short: a root's file share, a root listing past the whole budget, the
// wall-clock ceiling, a file skipped as oversized or unreadable, a file's own
// hit ceiling, and the hit budget itself. The last is deliberate; before it, a
// search that ran out of slots said nothing, which is the false confidence
// divided budgets exist to remove.
function findHits(roots, terms, exclusions) {
  if (terms.length === 0) return { hits: [], truncated: false };
  const floor = terms.length === 1 ? 1 : Math.max(2, Math.ceil(terms.length / 2));
  const walkStart = Date.now();
  const outOfTime = () => Date.now() - walkStart > MAX_WALK_MS;
  let truncated = false;

  // Pass 1: every markdown path under each root, opening no file. A walled-off
  // folder is never entered, so nothing inside it is listed or read.
  const listed = roots.map((root) => {
    const files = [];
    const walk = (dir) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        // No share can exceed the whole budget, so a root that lists past it
        // stops listing rather than spend the clock the reading pass needs.
        if (outOfTime() || files.length >= MAX_FILES) {
          truncated = true;
          return;
        }
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          if (exclusions.segments.has(entry.name.toLowerCase())) continue;
          walk(abs);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          // isFile, so a symlink never leads the read into a walled-off folder.
          files.push(abs);
        }
      }
    };
    walk(root);
    return files;
  });

  // Pass 2: each root reads up to its fair share of the file budget.
  const shares = fairShares(
    listed.map((files) => files.length),
    MAX_FILES
  );
  const rootSequences = [];
  listed.forEach((files, r) => {
    if (shares[r] < files.length) truncated = true;
    // One array of hits per matching file, so the interleave below can give
    // each file its turn instead of letting walk order decide.
    const fileGroups = [];
    for (const abs of files.slice(0, shares[r])) {
      if (outOfTime()) {
        truncated = true;
        break;
      }
      let content;
      try {
        if (statSync(abs).size > MAX_FILE_BYTES) {
          truncated = true;
          continue;
        }
        content = readFileSync(abs, "utf8");
      } catch {
        truncated = true;
        continue;
      }
      if (carriesExcludedTag(content, exclusions.tags)) continue;
      const lines = content.split(/\r?\n/);
      const fileHits = [];
      for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase();
        let matched = 0;
        for (const term of terms) if (lower.includes(term)) matched++;
        if (matched >= floor) {
          if (fileHits.length >= MAX_HITS_PER_FILE) {
            truncated = true;
            break;
          }
          fileHits.push({ file: abs, line: i + 1, text: snippet(lines[i].trim(), terms) });
        }
      }
      if (fileHits.length > 0) fileGroups.push(fileHits);
    }
    if (fileGroups.length > 0) rootSequences.push(interleave(fileGroups));
  });

  const ordered = interleave(rootSequences);
  const hits = ordered.slice(0, MAX_HITS);
  if (ordered.length > hits.length) truncated = true;
  hits.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return { hits, truncated };
}

function main() {
  let raw;
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    process.exit(0);
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  if (!input || typeof input !== "object") process.exit(0);

  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  if (!looksLikeCorrection(prompt)) process.exit(0);

  // cwd follows the session's shell; the search covers the project above it.
  const projectRoot = projectRootFrom(
    typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : process.cwd()
  );
  const terms = searchTerms(prompt);
  const conventions = readConventions(projectRoot);
  const exclusions = exclusionsFrom(conventions);
  // A root that itself sits inside a walled-off folder is never searched, as
  // the path deny rule and the sweep treat it. Measured from the project so a
  // project that happens to live under a folder of that name is not blanked.
  const roots = laneRoots(conventions, projectRoot).filter(
    (r) => !path.relative(projectRoot, r).split(/[\\/]/).some((s) => exclusions.segments.has(s.toLowerCase()))
  );
  const { hits, truncated } = findHits(roots, terms, exclusions);

  const out = [
    "The DM's last message reads as a correction. Their statement stands on its own;",
    "the search below establishes scope, not truth. Never re-litigate the correction.",
    "",
  ];

  if (hits.length === 0) {
    // A correction the hook cannot locate still gets said out loud. Silence here
    // would read as "nothing to fix", which is the failure this hook exists for.
    out.push("No line in this project matched it. Find what they corrected yourself,");
    out.push("then fix every copy before anything else this turn. When what they corrected");
    out.push("was something you said in chat, no file holds it and nothing needs fixing.");
  } else {
    out.push(`${hits.length} line${hits.length === 1 ? " in this project mentions" : "s in this project mention"} it:`);
    out.push("");
    for (const hit of hits) {
      const rel = path.relative(projectRoot, hit.file).split(path.sep).join("/");
      out.push(`  ${rel}:${hit.line}  ${hit.text}`);
    }
    out.push("");
    out.push("Read each line against what the DM corrected. Put to the DM only the lines that repeat");
    out.push("the corrected claim, and ask once whether to fix them all. A line that shares words with");
    out.push("the correction without repeating the claim is not a copy. When no line repeats it, say");
    out.push("nothing to the DM about this list, and find what they corrected yourself, as when");
    out.push("nothing matches. A correction is not closed while a copy survives.");
  }

  // Printed whenever the project excludes content, never only when a skipped
  // file matched: a conditional note would itself reveal what an excluded
  // article says.
  if (exclusions.configured) {
    out.push("");
    out.push("Walled-off content (the folders and tagged articles this project excludes) was not");
    out.push("searched. If the claim could sit there, tell the DM it needs checking by hand.");
  }

  if (truncated) {
    out.push("");
    out.push("This search hit its own size or time limit before finishing. The list above");
    out.push("may be incomplete; a broader manual check may be warranted for a large project.");
  }

  process.stdout.write(out.join("\n") + "\n");
  process.exit(0);
}

main();
