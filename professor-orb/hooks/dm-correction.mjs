#!/usr/bin/env node
// UserPromptSubmit hook: catches a DM correction and, in Task 2, searches the
// campaign lane for every copy of what they corrected.
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

// Correction-shaped language. Deliberately narrow: this hook runs on every DM
// message, so each pattern added here is a lane grep added to some ordinary
// turn. Every pattern requires an explicit wrongness marker ("wrong",
// "incorrect", "not what I said") or the verb "happen" under a negation.
// "never" alone is NOT enough: "the party never found the ledger" is the DM
// narrating, not correcting, and the test pins that case as silent.
const CORRECTION_PATTERNS = [
  /\bnever\s+(?:\w+\s+){0,2}happen(?:ed)?\b/i,
  /\b(?:did\s*n[o']?t|didnt|does\s*n[o']?t)\s+(?:\w+\s+){0,2}happen(?:ed)?\b/i,
  /\b(?:that'?s|that\s+is|this\s+is|it'?s|you'?re|thats)\s+(?:just\s+)?(?:wrong|incorrect|false|backwards)\b/i,
  /\bnot\s+what\s+i\s+(?:said|told|asked|meant)\b/i,
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
// Wall-clock ceiling for the WHOLE search across all roots, independent of
// MAX_FILES. Belt-and-suspenders: MAX_FILES bounds the common case, this
// bounds the worst case.
const MAX_WALK_MS = 7000;

// Words that carry no search signal. Short list on purpose: the length filter
// below removes most function words already, and an over-long stoplist starts
// removing the nouns a correction turns on.
const STOPWORDS = new Set([
  "that", "this", "never", "happened", "happen", "wrong", "incorrect", "said",
  "told", "about", "there", "their", "they", "them", "with", "from", "have",
  "what", "when", "where", "which", "were", "was", "and", "the", "for", "not",
  "didnt", "doesnt", "actually", "really", "just", "only", "also", "fucking",
]);

// The correction's content words, which are what the lane is searched for. A
// term must be four characters or longer: shorter tokens match everywhere and
// turn every report into a hit.
function searchTerms(text) {
  const seen = new Set();
  for (const raw of text.toLowerCase().split(/[^a-z0-9']+/)) {
    const word = raw.replace(/'/g, "");
    if (word.length < 4) continue;
    if (STOPWORDS.has(word)) continue;
    seen.add(word);
    if (seen.size >= 8) break;
  }
  return [...seen];
}

// Every prong of every setting, plus the proposals folder. Returns absolute
// paths that exist. An absent or unreadable conventions file returns an empty
// array, and main() does NOT treat that as "say nothing": it still prints the
// correction preamble plus an explicit "could not locate it" message. An empty
// array here means the search found nothing to look in, not that the hook
// failed to run.
function laneRoots(cwd) {
  let conventions;
  try {
    conventions = JSON.parse(readFileSync(path.resolve(cwd, ".professor-orb", "conventions.json"), "utf8"));
  } catch {
    return [];
  }
  if (!conventions || typeof conventions !== "object") return [];

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

// Every markdown line under roots holding at least two search terms, or one
// when the correction yielded only one term. Two is the floor because a single
// common noun ("reporter") matches half a campaign, and the DM reads this list.
//
// Each root gets its OWN share of MAX_FILES, never a shared global pool. This
// is the fix for the defect that made this hook miss the exact file the
// 2026-09-18 incident lived in: that file sat in the second of two settings in
// the real consumer project, behind a first setting large enough (1855
// articles) to exhaust a GLOBAL 2000-file cap on its own, so the hook reported
// six confidently-wrong hits from the first setting and never reached the
// second at all. Per-root division guarantees every configured root is
// attempted with SOME budget, regardless of how large an earlier root is.
//
// Returns { hits, truncated }. `truncated` is true when any root's own share,
// or the overall wall-clock ceiling, cut the walk short before it finished
// naturally, so the caller can tell the DM the list may be incomplete rather
// than implying it is exhaustive.
function findHits(roots, terms) {
  if (terms.length === 0) return { hits: [], truncated: false };
  const floor = terms.length === 1 ? 1 : 2;
  const hits = [];
  const perRootCap = Math.max(50, Math.floor(MAX_FILES / Math.max(1, roots.length)));
  const walkStart = Date.now();
  let truncated = false;

  for (const root of roots) {
    if (hits.length >= MAX_HITS) break;
    if (Date.now() - walkStart > MAX_WALK_MS) {
      truncated = true;
      break;
    }
    let filesSeenInRoot = 0;

    const walk = (dir) => {
      if (hits.length >= MAX_HITS) return;
      if (Date.now() - walkStart > MAX_WALK_MS) {
        truncated = true;
        return;
      }
      if (filesSeenInRoot >= perRootCap) {
        truncated = true;
        return;
      }
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (hits.length >= MAX_HITS) return;
        if (Date.now() - walkStart > MAX_WALK_MS) {
          truncated = true;
          return;
        }
        if (filesSeenInRoot >= perRootCap) {
          truncated = true;
          return;
        }
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          walk(abs);
          continue;
        }
        if (!entry.name.toLowerCase().endsWith(".md")) continue;
        filesSeenInRoot++;
        let content;
        try {
          if (statSync(abs).size > MAX_FILE_BYTES) continue;
          content = readFileSync(abs, "utf8");
        } catch {
          continue;
        }
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const lower = lines[i].toLowerCase();
          let matched = 0;
          for (const term of terms) if (lower.includes(term)) matched++;
          if (matched >= floor) {
            hits.push({ file: abs, line: i + 1, text: lines[i].trim() });
            if (hits.length >= MAX_HITS) return;
          }
        }
      }
    };

    walk(root);
  }

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

  const cwd = typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : process.cwd();
  const terms = searchTerms(prompt);
  const { hits, truncated } = findHits(laneRoots(cwd), terms);

  const out = [
    "The DM's last message reads as a correction. Their statement stands on its own;",
    "the search below establishes scope, not truth. Never re-litigate the correction.",
    "",
  ];

  if (hits.length === 0) {
    // A correction the hook cannot locate still gets said out loud. Silence here
    // would read as "nothing to fix", which is the failure this hook exists for.
    out.push("No line in the campaign lane matched it. Find what they corrected yourself,");
    out.push("then fix every copy before anything else this turn.");
  } else {
    out.push(`${hits.length} line${hits.length === 1 ? "" : "s"} in the campaign lane mention it:`);
    out.push("");
    for (const hit of hits) {
      const rel = path.relative(cwd, hit.file).split(path.sep).join("/");
      out.push(`  ${rel}:${hit.line}  ${hit.text}`);
    }
    out.push("");
    out.push("Report this list to the DM and ask once whether to fix them all.");
    out.push("A correction is not closed while a copy survives.");
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
