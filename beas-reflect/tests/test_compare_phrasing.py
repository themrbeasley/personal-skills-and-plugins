#!/usr/bin/env python3
"""Tests for the scoring helpers in scripts/compare_phrasing.py.

These run without calling Claude.
Run with: python -m pytest tests/test_compare_phrasing.py -v
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import compare_phrasing as cp

SCOPE_FIXTURE = (Path(__file__).parent / "fixtures" / "phrasing_scope_task.py").read_text(encoding="utf-8")


class TestEntryScoring(unittest.TestCase):
    """Scoring for the entries /reflect proposes."""

    def test_opens_with_negation(self):
        for text in ["Don't add docstrings", "- Never use force push", "**Do not** push",
                     "do not run", "Avoid npm", "- Don’t add X", "Stop refactoring",
                     "Не используй moment.js"]:
            self.assertTrue(cp.opens_with_negation(text), text)
        for text in ["Use pnpm for installs", "- Write docstrings only when asked",
                     "Note: never mind", "Nothing else", "Используй date-fns"]:
            self.assertFalse(cp.opens_with_negation(text), text)

    def test_contains_negation_anywhere(self):
        for text in ["Exclude .env files (and do not stage them)", "Keep it out; never stage it",
                     "Add X, but don't commit it", "Не используй moment.js"]:
            self.assertTrue(cp.contains_negation(text), text)
        for text in ["Use pnpm for installs", "Keep .env files out of commits", "Note the nothing case"]:
            self.assertFalse(cp.contains_negation(text), text)

    def test_mentions_any_respects_word_edges(self):
        self.assertTrue(cp.mentions_any("Use pnpm, not npm", ["npm"]))
        self.assertFalse(cp.mentions_any("Use pnpm for installs", ["npm"]))
        self.assertTrue(cp.mentions_any("Use gpt-5.2 (replaces gpt-5.1)", ["gpt-5.1"]))
        self.assertFalse(cp.mentions_any("Use gpt-5.12", ["gpt-5.1"]))
        self.assertTrue(cp.mentions_any("Avoid Moment.js", ["moment.js"]))

    def test_fisher_exact_matches_reference_values(self):
        self.assertAlmostEqual(cp.fisher_exact(8, 2, 1, 9), 0.005477, places=5)
        self.assertAlmostEqual(cp.fisher_exact(5, 5, 5, 5), 1.0, places=6)
        self.assertAlmostEqual(cp.fisher_exact(3, 17, 12, 8), 0.007912, places=5)


class TestSlipScoring(unittest.TestCase):
    """Scoring for the slip cases in Eval 2."""

    def test_count_em_dashes(self):
        dash = chr(0x2014)
        self.assertEqual(cp.count_em_dashes("Light " + dash + " and tough " + dash + " bottle"), 2)
        self.assertEqual(cp.count_em_dashes("Light, tough bottle - with a hyphen"), 0)

    def test_count_docstrings_reads_code_blocks(self):
        reply = 'Here:\n```python\ndef a():\n    """Doc."""\n    return 1\n\n\ndef b():\n    return 2\n```'
        self.assertEqual(cp.count_docstrings(reply), 1)
        self.assertEqual(cp.count_docstrings("def b():\n    return 2\n"), 0)

    def test_uses_force_push(self):
        for text in ["git push --force", "git push -f origin main",
                     "git push --force-with-lease", "git push origin +main"]:
            self.assertTrue(cp.uses_force_push(text), text)
        for text in ["git pull --rebase\ngit push", "git push origin main", "set --force later"]:
            self.assertFalse(cp.uses_force_push(text), text)

    def test_lines_changed_outside_target_function(self):
        fixed = SCOPE_FIXTURE.replace(
            "    return total / len(reviews)",
            "    if not reviews:\n        return 0\n    return total / len(reviews)")
        reply = "```python\n" + fixed + "\n```"
        self.assertEqual(cp.lines_changed_outside(SCOPE_FIXTURE, reply, "average_rating"), 0)
        tidied = fixed.replace("import os, sys", "import sys")
        self.assertEqual(cp.lines_changed_outside(SCOPE_FIXTURE, "```python\n" + tidied + "\n```", "average_rating"), 1)
        regapped = fixed.replace("\n\n\ndef top_reviewers", "\n\ndef top_reviewers")
        self.assertEqual(cp.lines_changed_outside(SCOPE_FIXTURE, "```python\n" + regapped + "\n```", "average_rating"), 0)

    def test_model_names(self):
        code = 'client.responses.create(model="gpt-5.2", input=x)\nother(model=\'gpt-4o\')'
        self.assertEqual(cp.model_names(code), ["gpt-5.2", "gpt-4o"])
        self.assertEqual(cp.model_names('{"model": "o3"}'), ["o3"])

    def test_with_memory_wraps_rules_like_claude_md(self):
        prompt = cp.with_memory(["Rule one", "Rule two"], "Do the task.")
        self.assertIn("Contents of", prompt)
        self.assertIn("## Guardrails\n- Rule one\n- Rule two", prompt)
        self.assertTrue(prompt.rstrip().endswith("Do the task."))


class TestRulebook(unittest.TestCase):
    """The many-rule memory for the harder slip test."""

    def test_rulebook_holds_every_rule_in_one_phrasing(self):
        import json
        fixtures = json.loads((Path(__file__).parent / "fixtures" / "phrasing_cases.json").read_text(encoding="utf-8"))
        keys = list(fixtures["slip_cases"])
        prohibition = cp.rulebook(fixtures, "prohibition", keys)
        action = cp.rulebook(fixtures, "action", keys)
        control = cp.rulebook(fixtures, "control", keys)
        self.assertGreaterEqual(len(fixtures["rulebook"]), 25)
        self.assertEqual(len(prohibition), len(fixtures["rulebook"]) + len(keys))
        self.assertEqual(len(action), len(prohibition))
        for key in keys:
            self.assertIn(fixtures["slip_cases"][key]["prohibition"], prohibition)
            self.assertIn(fixtures["slip_cases"][key]["action"], action)
            self.assertNotIn(fixtures["slip_cases"][key]["action"], control)
        self.assertEqual(control, [rule["action"] for rule in fixtures["rulebook"]])
        self.assertEqual([r for r in prohibition if r in {x["prohibition"] for x in fixtures["rulebook"]}],
                         [x["prohibition"] for x in fixtures["rulebook"]])


if __name__ == "__main__":
    unittest.main()
