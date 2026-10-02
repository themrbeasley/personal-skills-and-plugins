#!/usr/bin/env python3
"""Instruction files state each instruction as the action to take.

Checks the prompt strings and templates that word what /reflect writes, and
(from Task 4 on) the prose of SKILL.md and commands/*.md.
Run with: python -m pytest tests/test_instruction_phrasing.py -v
"""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from lib.reflect_utils import PROJECT_SPECIFIC_ERROR_PATTERNS
from lib.semantic_detector import ANALYSIS_PROMPT, CONTRADICTION_PROMPT, ERROR_TO_GUIDELINE_PROMPT

MID = re.compile(r"(?i)\b(?:don['’]t|do not|never)\b")
CAPS = re.compile(r"\b(?:NOT|NO|NEVER)\b")
LEAD = re.compile(r"(?i)^\s*(?:[-*>]|\d+\.)?\s*(?:\*\*)?(?:avoid|stop)\b")
CODE = re.compile(r"`[^`]*`")
QUOTED = re.compile(r'"[^"]*"|“[^”]*”')
PROMPTS = {"ANALYSIS_PROMPT": ANALYSIS_PROMPT, "ERROR_TO_GUIDELINE_PROMPT": ERROR_TO_GUIDELINE_PROMPT,
           "CONTRADICTION_PROMPT": CONTRADICTION_PROMPT}


def prose_hits(name, lines):
    """Lines whose prose (code and quoted user text removed) states a prohibition."""
    hits = []
    for n, line in lines:
        prose = QUOTED.sub("", CODE.sub("", line))
        if MID.search(prose) or CAPS.search(prose) or LEAD.search(prose):
            hits.append("%s:%d: %s" % (name, n, line.strip()))
    return hits


class TestOutputWording(unittest.TestCase):
    """What /reflect writes for users is worded as the action to take."""

    def test_formatting_rules_teach_the_rule(self):
        reflect = (ROOT / "commands" / "reflect.md").read_text(encoding="utf-8")
        section = reflect[reflect.index("## Formatting Rules"):reflect.index("## Size Check")]
        self.assertIn("Write every entry as the action to take", section)
        self.assertIn("Write docstrings only when the user asks for them", section)
        self.assertEqual(prose_hits("reflect.md", enumerate(section.splitlines(), 1)), [])

    def test_bans_keep_their_exact_meaning(self):
        reflect = (ROOT / "commands" / "reflect.md").read_text(encoding="utf-8")
        section = reflect[reflect.index("## Formatting Rules"):reflect.index("## Size Check")]
        for name, text in (("Formatting Rules", section), ("ANALYSIS_PROMPT", ANALYSIS_PROMPT)):
            self.assertIn('"never log secrets" becomes "Keep secrets out of logs"', text, name)
            self.assertIn("end the entry after the move", text, name)
        self.assertIn('"leave X alone" becomes "Keep X as it is"', section)

    def test_entries_name_what_they_govern(self):
        reflect = (ROOT / "commands" / "reflect.md").read_text(encoding="utf-8")
        section = reflect[reflect.index("## Formatting Rules"):reflect.index("## Size Check")]
        for name, text in (("Formatting Rules", section), ("ANALYSIS_PROMPT", ANALYSIS_PROMPT)):
            self.assertIn("Name the thing the entry is about", text, name)
        self.assertIn('"Keep force pushes off main"', section)
        self.assertIn("**Keep `$(...)` command substitution out of these commands:**", reflect)

    def test_prompts_ask_for_action_first_output(self):
        self.assertIn("Write it as the action to take", ANALYSIS_PROMPT)
        self.assertIn("Start with the move to make", ERROR_TO_GUIDELINE_PROMPT)
        for name, prompt in PROMPTS.items():
            self.assertIn("Respond with one JSON object and nothing else", prompt, name)
            self.assertEqual(prose_hits(name, enumerate(prompt.splitlines(), 1)), [])

    def test_error_guideline_templates_state_actions(self):
        for error_type, _, guideline in PROJECT_SPECIFIC_ERROR_PATTERNS:
            self.assertFalse(MID.search(guideline), "%s: %s" % (error_type, guideline))


OPTION = re.compile(r'(?i)"description":\s*"(?:don[\'’]t|never|do not|avoid)\b')
ENTRY = re.compile(r"(?i)(?:│\s*-\s*|→\s*\")(?:don['’]t|never|do not|avoid)\b")
INSTRUCTION_FILES = [ROOT / "SKILL.md"] + sorted((ROOT / "commands").glob("*.md"))


def scan(path):
    """Prohibition-worded instructions in a markdown file.

    Prose is checked with code spans and quoted user text removed. Inside code
    blocks, menu option text, proposed entries, and comment lines are checked.
    """
    hits, prose, in_fence = [], [], False
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            continue
        if not in_fence:
            prose.append((n, line))
        elif OPTION.search(line) or ENTRY.search(line) or (line.lstrip().startswith("#") and MID.search(line)):
            hits.append("%s:%d: %s" % (path.name, n, line.strip()))
    return prose_hits(path.name, prose) + hits


class TestInstructionProse(unittest.TestCase):
    """The plugin's own instructions to Claude are worded as the action to take."""

    def test_instruction_files_state_actions(self):
        hits = [hit for path in INSTRUCTION_FILES for hit in scan(path)]
        self.assertEqual(hits, [], "\n" + "\n".join(hits))


if __name__ == "__main__":
    unittest.main()
