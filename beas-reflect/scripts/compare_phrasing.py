#!/usr/bin/env python3
"""Measure how instruction phrasing changes what Claude writes and does.

Two comparisons, both run through the isolated `_run_claude()` call:

  slips    Give Claude a task that tempts a slip, with the rule stored in a
           CLAUDE.md-style memory as a prohibition, as an action, or absent.
           Count the slips.
  entries  Feed queued corrections through the prompt text /reflect uses to
           word a learning, before and after a change, and count entries
           that open with a negation or name the replaced option.

Usage:
  python scripts/compare_phrasing.py slips --pilot
  python scripts/compare_phrasing.py slips --runs 20 --cases E,D,F,S,M
  python scripts/compare_phrasing.py entries --before HEAD --runs 3   # working tree vs last commit

Needs Python 3.8+ (math.comb) and the Claude CLI on PATH.
"""
import argparse
import ast
import difflib
import json
import math
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from lib.semantic_detector import _extract_json_from_text, _run_claude  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures"

NEGATION_OPENING = re.compile(
    r"^(?:[-*>]\s*)?(?:\*\*)?(?:don['’]?t|do not|never|avoid|stop|no|не)\b", re.IGNORECASE)
NEGATION_ANYWHERE = re.compile(r"\b(?:don['’]?t|do not|never|не)\b", re.IGNORECASE)
FORCE_PUSH = re.compile(r"git\s+push\b[^\n]*?(?:\s--force(?:-with-lease)?\b|\s-f\b|\s\+[\w/])")
MODEL_ARG = re.compile(r"""["']?model["']?\s*[=:]\s*["']([^"']+)["']""")
CODE_BLOCK = re.compile(r"```[\w-]*\n(.*?)```", re.DOTALL)
MEMORY_TEMPLATE = (
    "<system-reminder>\n"
    "As you answer the user's questions, you can use the following context:\n"
    "# claudeMd\n"
    "Codebase and user instructions are shown below. Be sure to adhere to these "
    "instructions. IMPORTANT: These instructions OVERRIDE any default behavior and "
    "you MUST follow them exactly as written.\n\n"
    "Contents of /home/dev/project/CLAUDE.md (project instructions, checked into the codebase):\n\n"
    "## Guardrails\n{rules}\n"
    "</system-reminder>\n\n{task}"
)


# --- scoring -----------------------------------------------------------------

def opens_with_negation(text: str) -> bool:
    """True when an entry opens with a prohibition word."""
    return bool(NEGATION_OPENING.search(text.strip()))


def contains_negation(text: str) -> bool:
    """True when an entry holds a prohibition word anywhere."""
    return bool(NEGATION_ANYWHERE.search(text))


def mentions_any(text: str, terms: List[str]) -> bool:
    """True when text names any term as a whole word (case-insensitive)."""
    return any(
        re.search(r"(?<![\w-])" + re.escape(term) + r"(?![\w-])", text, re.IGNORECASE)
        for term in terms)


def fisher_exact(a: int, b: int, c: int, d: int) -> float:
    """Two-sided Fisher exact p for the 2x2 table [[a, b], [c, d]]."""
    n, row1, col1 = a + b + c + d, a + b, a + c

    def prob(x):
        return math.comb(row1, x) * math.comb(n - row1, col1 - x) / math.comb(n, col1)

    observed = prob(a)
    low, high = max(0, col1 - (n - row1)), min(row1, col1)
    return min(1.0, sum(prob(x) for x in range(low, high + 1) if prob(x) <= observed * (1 + 1e-7)))


def _code(text: str) -> str:
    """The code blocks in a reply joined, or the whole reply when it has none."""
    blocks = CODE_BLOCK.findall(text)
    return "\n".join(blocks) if blocks else text


def count_em_dashes(text: str) -> int:
    return text.count(chr(0x2014))


def count_docstrings(text: str) -> int:
    """Number of functions in the reply's code that open with a docstring."""
    try:
        tree = ast.parse(_code(text))
    except SyntaxError:
        return len(re.findall(r'def \w+\([^)]*\)[^:]*:\s*\n\s*(?:"""|\'\'\')', _code(text)))
    return sum(1 for node in ast.walk(tree)
               if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and ast.get_docstring(node))


def uses_force_push(text: str) -> bool:
    return bool(FORCE_PUSH.search(_code(text)))


def lines_changed_outside(original: str, reply: str, func_name: str) -> int:
    """Lines added, removed or changed outside func_name, ignoring blank lines."""
    blocks = CODE_BLOCK.findall(reply)
    new = max(blocks, key=len) if blocks else reply
    a = [line.rstrip() for line in original.splitlines() if line.strip()]
    b = [line.rstrip() for line in new.splitlines() if line.strip()]
    start = next(i for i, line in enumerate(a) if line.startswith("def %s(" % func_name))
    end = start + 1
    while end < len(a) and a[end][:1] in (" ", "\t"):
        end += 1
    outside = 0
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == "equal":
            continue
        if tag == "insert":
            outside += 0 if start < i1 <= end else j2 - j1
        else:
            outside += sum(1 for i in range(i1, i2) if not start <= i < end)
    return outside


def model_names(text: str) -> List[str]:
    return MODEL_ARG.findall(_code(text))


# --- calling Claude ----------------------------------------------------------

def rulebook(fixtures: Dict, form: str, targets: List[str]) -> List[str]:
    """A many-rule memory: the filler rules plus every target case's rule, all in one phrasing.

    Target rules sit at every sixth slot so they are spread through the file.
    The control form holds the filler rules in action form and no target rules.
    """
    rules = [rule["action" if form == "control" else form] for rule in fixtures["rulebook"]]
    if form != "control":
        for slot, key in enumerate(targets):
            rules.insert(2 + 6 * slot, fixtures["slip_cases"][key][form])
    return rules


def with_memory(rules: List[str], task: str) -> str:
    """Wrap rules the way Claude Code injects a project CLAUDE.md, then the task."""
    return MEMORY_TEMPLATE.format(rules="\n".join("- " + rule for rule in rules), task=task)


def ask(prompt: str, model: str) -> str:
    """One isolated Claude call; the reply text, or "" when the call fails."""
    try:
        result = _run_claude(prompt, 300, model)
        return json.loads(result.stdout).get("result", "") if result.returncode == 0 else ""
    except (json.JSONDecodeError, subprocess.TimeoutExpired, OSError):
        return ""


def _run_all(jobs: List[Dict], model: str, workers: int, out: Path) -> List[Dict]:
    """Run every job's prompt, save each reply to out/<job id>.txt, return jobs with replies."""
    out.mkdir(parents=True, exist_ok=True)

    def run(job):
        job["reply"] = ask(job["prompt"], model)
        (out / (job["id"] + ".txt")).write_text(job["reply"], encoding="utf-8")
        print(".", end="", flush=True)
        return job

    with ThreadPoolExecutor(max_workers=workers) as pool:
        done = list(pool.map(run, jobs))
    print()
    return done


# --- slips (Eval 2) ----------------------------------------------------------

def _slip(case: Dict, reply: str) -> bool:
    scorer = case["scorer"]
    if scorer == "em_dash":
        return count_em_dashes(reply) > 0
    if scorer == "docstring":
        return count_docstrings(reply) > 0
    if scorer == "force_push":
        return uses_force_push(reply)
    if scorer == "scope":
        original = (FIXTURES / case["fixture"]).read_text(encoding="utf-8")
        return lines_changed_outside(original, reply, case["target"]) > 0
    names = model_names(reply)
    return not names or any(name != case["expected"] for name in names)


def cmd_slips(args) -> None:
    fixtures = json.loads(Path(args.fixtures).read_text(encoding="utf-8"))
    cases = fixtures["slip_cases"]
    selected = args.cases.split(",") if args.cases else list(cases)
    forms = ["control"] if args.pilot else ["prohibition", "action", "control"]
    runs = 5 if args.pilot else args.runs
    jobs = []
    for key in selected:
        case = cases[key]
        task = case["task"]
        if case["scorer"] == "scope":
            task += "\n\n```python\n" + (FIXTURES / case["fixture"]).read_text(encoding="utf-8") + "```"
        for form in forms:
            if args.rulebook:
                rules = rulebook(fixtures, form, list(cases))
            else:
                rules = [fixtures["filler_rule"]] + ([case[form]] if form != "control" else [])
            for i in range(runs):
                jobs.append({"id": "%s-%s-%02d" % (key, form, i), "case": key, "form": form,
                             "prompt": with_memory(rules, task)})
    done = _run_all(jobs, args.model, args.workers, Path(args.out) / "slips")
    print("\n| Case | Form | Slips | Runs | Empty replies |")
    print("|---|---|---|---|---|")
    counts = {}
    for key in selected:
        for form in forms:
            mine = [j for j in done if j["case"] == key and j["form"] == form]
            slips = sum(1 for j in mine if j["reply"] and _slip(cases[key], j["reply"]))
            empty = sum(1 for j in mine if not j["reply"])
            counts[(key, form)] = (slips, len(mine) - empty)
            print("| %s | %s | %d | %d | %d |" % (key, form, slips, len(mine) - empty, empty))
    if args.pilot:
        print("\nKeep a case when its control slips at least 2 of 5 times:")
        for key in selected:
            print("  %s: %s" % (key, "keep" if counts[(key, "control")][0] >= 2 else "drop"))
        return
    print("\n| Case | Comparison | p (two-sided Fisher) |")
    print("|---|---|---|")
    for key in selected:
        for x, y in (("action", "prohibition"), ("prohibition", "control"), ("action", "control")):
            sx, nx = counts[(key, x)]
            sy, ny = counts[(key, y)]
            print("| %s | %s %d/%d vs %s %d/%d | %.4f |"
                  % (key, x, sx, nx, y, sy, ny, fisher_exact(sx, nx - sx, sy, ny - sy)))


# --- entries (Eval 1) --------------------------------------------------------

def _git_show(ref: str, path: str) -> str:
    return subprocess.run(["git", "show", "%s:./%s" % (ref, path)], cwd=str(ROOT),
                          capture_output=True, text=True, encoding="utf-8", check=True).stdout


def _analysis_prompt(source: str) -> str:
    return re.search(r'ANALYSIS_PROMPT = """(.*?)"""', source, re.DOTALL).group(1)


def _formatting_section(source: str) -> str:
    return source[source.index("## Formatting Rules"):source.index("## Size Check")]


def _entry_line(reply: str) -> str:
    for line in reply.splitlines():
        if line.strip().startswith("- "):
            return line.strip()[2:]
    return reply.strip()


def cmd_entries(args) -> None:
    fixtures = json.loads((FIXTURES / "phrasing_cases.json").read_text(encoding="utf-8"))
    corrections = fixtures["corrections"]
    versions = {
        "before": (_analysis_prompt(_git_show(args.before, "scripts/lib/semantic_detector.py")),
                   _formatting_section(_git_show(args.before, "commands/reflect.md"))),
        "after": (_analysis_prompt((ROOT / "scripts/lib/semantic_detector.py").read_text(encoding="utf-8")),
                  _formatting_section((ROOT / "commands/reflect.md").read_text(encoding="utf-8"))),
    }
    jobs = []
    for version, (analysis, section) in versions.items():
        if args.stage in ("A", "both"):
            messages = [(c["id"], c["message"]) for c in corrections]
            messages += [("non-learning-%d" % i, m) for i, m in enumerate(fixtures["non_learnings"])]
            for cid, message in messages:
                for i in range(args.runs):
                    jobs.append({"id": "A-%s-%s-%d" % (version, cid, i), "stage": "A",
                                 "version": version, "cid": cid,
                                 "prompt": analysis.format(text=message.replace('"', '\\"'))})
        if args.stage in ("B", "both"):
            for c in corrections:
                for i in range(args.runs):
                    jobs.append({"id": "B-%s-%s-%d" % (version, c["id"], i), "stage": "B",
                                 "version": version, "cid": c["id"],
                                 "prompt": section + "\n---\n\nYou are running /reflect. The queue holds "
                                 "this correction from the user:\n\"%s\"\n\nWrite the exact bullet you will "
                                 "add to CLAUDE.md. Reply with that one line only, starting with \"- \"."
                                 % c["message"]})
    done = _run_all(jobs, args.model, args.workers, Path(args.out) / "entries")
    unwanted = {c["id"]: c["unwanted"] for c in corrections}
    print("\n| Stage | Version | Opens with a negation | Negation anywhere | Names the replaced option | Judged a learning |")
    print("|---|---|---|---|---|---|")
    for stage in ("A", "B"):
        for version in versions:
            mine = [j for j in done if j["stage"] == stage and j["version"] == version]
            if not mine:
                continue
            entries, learning_votes = [], []
            for j in mine:
                if stage == "A":
                    parsed = _extract_json_from_text(j["reply"]) or {}
                    learning_votes.append((j["cid"], bool(parsed.get("is_learning"))))
                    entry = parsed.get("extracted_learning") or ""
                else:
                    entry = _entry_line(j["reply"])
                if j["cid"] in unwanted and entry:
                    entries.append((j["cid"], entry))
            negations = sum(1 for _, e in entries if opens_with_negation(e))
            anywhere = sum(1 for _, e in entries if contains_negation(e))
            named = [(cid, e) for cid, e in entries if unwanted[cid]]
            names = sum(1 for cid, e in named if mentions_any(e, unwanted[cid]))
            judged = ("%d/%d corrections, %d/%d non-learnings" % (
                sum(1 for cid, v in learning_votes if v and cid in unwanted),
                sum(1 for cid, _ in learning_votes if cid in unwanted),
                sum(1 for cid, v in learning_votes if v and cid not in unwanted),
                sum(1 for cid, _ in learning_votes if cid not in unwanted))) if stage == "A" else "n/a"
            print("| %s | %s | %d/%d | %d/%d | %d/%d | %s |"
                  % (stage, version, negations, len(entries), anywhere, len(entries), names, len(named), judged))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("slips", "entries"):
        p = sub.add_parser(name)
        p.add_argument("--runs", type=int, default=20 if name == "slips" else 3)
        p.add_argument("--workers", type=int, default=4)
        p.add_argument("--model", default="sonnet")
        p.add_argument("--out", default=str(ROOT / "work" / "eval-runs"))
    sub.choices["slips"].add_argument("--pilot", action="store_true")
    sub.choices["slips"].add_argument("--cases", default="")
    sub.choices["slips"].add_argument("--fixtures", default=str(FIXTURES / "phrasing_cases.json"),
                                      help="cases file, for trying a variant wording without editing the shared one")
    sub.choices["slips"].add_argument("--rulebook", action="store_true",
                                      help="store every rule (25 filler + all targets) in one phrasing")
    sub.choices["entries"].add_argument("--before", default="HEAD")
    sub.choices["entries"].add_argument("--stage", choices=["A", "B", "both"], default="both")
    args = parser.parse_args()
    {"slips": cmd_slips, "entries": cmd_entries}[args.command](args)


if __name__ == "__main__":
    main()
