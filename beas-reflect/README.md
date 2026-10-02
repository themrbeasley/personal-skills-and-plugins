# beas-reflect

Based on [claude-reflect](https://github.com/BayramAnnakov/claude-reflect) by Bayram Annakov (MIT license). A self-learning system for Claude Code: it captures your corrections and discovers workflow patterns, then turns them into permanent memory and reusable skills.

## What's different from claude-reflect

- **Every note is written as the action to take.** "don't add docstrings unless I ask" becomes "Write docstrings only when the user asks for them"; "never commit .env files" becomes "Keep .env files out of commits". Each note names the thing it is about and carries your reason after a colon when you gave one.
- **The plugin's own instructions to Claude are written the same way**, and a test keeps prohibitions out of them.
- **Semantic analysis works**: it returns answers, runs without loading your whole setup (about 3,000 input tokens per check instead of 70,000), saves nothing into your project history, and handles non-English text on Windows.
- **The evidence** is in [docs/eval-results.md](docs/eval-results.md). In short: in a 30-rule memory, "Never use em dashes" stopped working on tasks unrelated to writing (14 of 20 replies slipped, the same as no rule), while "Keep em dashes out of all text" held (1 of 20).

## What it does

### 1. Learn from Corrections

When you correct Claude ("no, use gpt-5.1 not gpt-5"), it remembers forever.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  You correct    │ ──► │  Hook captures  │ ──► │  /reflect adds  │
│  Claude Code    │     │  to queue       │     │  to CLAUDE.md   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
      (automatic)            (automatic)            (manual review)
```

### 2. Discover Workflow Patterns (NEW in v2)

Analyzes your session history to find repeating tasks that could become reusable commands.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Your past      │ ──► │ /reflect-skills │ ──► │   Generates     │
│  sessions       │     │ finds patterns  │     │   /commands     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
    (68 sessions)         (AI-powered)            (you approve)
```

Example: You've asked "review my productivity" 12 times → suggests creating `/daily-review`

## Key Features

| Feature | What it does |
|---------|--------------|
| **Permanent Memory** | Corrections sync to CLAUDE.md — Claude remembers across sessions |
| **Skill Discovery** | Finds repeating patterns in your history → generates commands |
| **Multi-language** | AI understands corrections in any language |
| **Skill Improvement** | Corrections during `/deploy` improve the deploy skill itself |

## Installation

```bash
# Add the professor-orb marketplace (this repo), once
claude plugin marketplace add themrbeasley/personal-skills-and-plugins

# Install the plugin at user level
claude plugin install beas-reflect@professor-orb-marketplace --scope user

# IMPORTANT: Restart Claude Code to activate the plugin
```

After installation, **restart Claude Code** (exit and reopen). Then hooks auto-configure and commands are ready.

> **First run?** When you run `/reflect` for the first time, you'll be prompted to scan your past sessions for learnings.

### Prerequisites

- [Claude Code](https://claude.ai/code) CLI installed
- Python 3.6+ (included on most systems)

### Platform Support

- **macOS**: Fully supported
- **Linux**: Fully supported
- **Windows**: Fully supported (native Python, no WSL required)

## Commands

| Command | Description |
|---------|-------------|
| `/reflect` | Process queued learnings with human review |
| `/reflect --scan-history` | Scan ALL past sessions for missed learnings |
| `/reflect --dry-run` | Preview changes without applying |
| `/reflect --targets` | Show detected config files (CLAUDE.md, AGENTS.md) |
| `/reflect --review` | Show queue with confidence scores and decay status |
| `/reflect --dedupe` | Find and consolidate similar entries in CLAUDE.md |
| `/reflect --include-tool-errors` | Include tool execution errors in scan |
| `/reflect-skills` | Discover skill candidates from repeating patterns |
| `/reflect-skills --days N` | Analyze last N days (default: 14) |
| `/reflect-skills --project <path>` | Analyze specific project |
| `/reflect-skills --all-projects` | Scan all projects for cross-project patterns |
| `/reflect-skills --dry-run` | Preview patterns without generating skill files |
| `/skip-reflect` | Discard all queued learnings |
| `/view-queue` | View pending learnings without processing |

## How It Works


### Two-Stage Process

**Stage 1: Capture (Automatic)**

Hooks run automatically to detect and queue corrections:

| Hook | Trigger | Purpose |
|------|---------|---------|
| `session_start_reminder.py` | Session start | Shows pending learnings reminder |
| `capture_learning.py` | Every prompt | Detects correction patterns and queues them |
| `check_learnings.py` | Before compaction | Backs up queue and informs user |
| `post_commit_reminder.py` | After git commit | Reminds to run /reflect after completing work |

**Stage 2: Process (Manual)**

Run `/reflect` to review and apply queued learnings to CLAUDE.md.

### Detection Methods

beas-reflect uses a **hybrid detection approach**:

**1. Regex patterns (real-time capture)**

Fast pattern matching during sessions detects:

- **Corrections**: `"no, use X"` / `"don't use Y"` / `"actually..."` / `"that's wrong"`
- **Positive feedback**: `"Perfect!"` / `"Exactly right"` / `"Great approach"`
- **Explicit markers**: `"remember:"` — highest confidence

**2. Semantic AI validation (during /reflect)**

When you run `/reflect`, an AI-powered semantic filter:
- **Multi-language support** — understands corrections in any language
- **Better accuracy** — filters out false positives from regex
- **Cleaner learnings** — extracts concise, actionable statements

Example: A Spanish correction like `"no, usa Python"` is correctly detected even though it doesn't match English patterns.

Each captured learning has a **confidence score** (0.60-0.95). The final score is the higher of regex and semantic confidence.

### Human Review

When you run `/reflect`, Claude presents a summary table with options:
- **Apply** - Accept the learning and add to CLAUDE.md
- **Edit before applying** - Modify the learning text first
- **Skip** - Discard this learning

### Multi-Target Sync

Approved learnings are synced to:
- `~/.claude/CLAUDE.md` (global - applies to all projects)
- `./CLAUDE.md` (project-specific)
- `./**/CLAUDE.md` (subdirectories - auto-discovered)
- `./.claude/commands/*.md` (skill files - when correction relates to a skill)
- `AGENTS.md` (if exists - works with Codex, Cursor, Aider, Jules, Zed, Factory)
- Docs reachable from the above via `@filename` includes or markdown links (bounded depth, cycles handled, code blocks/external URLs skipped) — useful when CLAUDE.md delegates guidance to `standards.md`, `architecture.md`, etc.

Run `/reflect --targets` to see which files will be updated.

### Skill Discovery

Run `/reflect-skills` to discover repeating patterns in your sessions that could become reusable skills:

```
/reflect-skills                 # Analyze current project (last 14 days)
/reflect-skills --days 30       # Analyze last 30 days
/reflect-skills --all-projects  # Analyze all projects (slower)
/reflect-skills --dry-run       # Preview patterns without generating files
```

**Features:**
- **AI-powered detection** — uses reasoning, not regex, to find patterns
- **Semantic similarity** — detects same intent across different phrasings
- **Project-aware** — groups patterns by project, suggests correct location
- **Smart assignment** — asks where each skill should go (project vs global)
- **Generates skill files** — creates draft skills in `.claude/commands/`

**How it works:**

The skill discovers patterns by analyzing your session history semantically. Different phrasings of the same intent are recognized:

```
Session 1: "review my productivity for today"
Session 2: "how was my focus this afternoon?"
Session 3: "check my ActivityWatch data"
Session 4: "evaluate my work hours"
```

Claude reasons: *"These 4 requests have the same intent - reviewing productivity data. The workflow is: fetch time tracking data → categorize activities → calculate focus score. This is a strong candidate for /daily-review."*

**Example output:**
```
════════════════════════════════════════════════════════════
SKILL CANDIDATES DISCOVERED
════════════════════════════════════════════════════════════

Found 2 potential skills from analyzing 68 sessions:

1. /daily-review (High) — from my-productivity-tools
   → Review productivity using time tracking data
   Evidence: 15 similar requests
   Corrections learned: "use local timezone", "chat apps can be work"

2. /deploy-app (High) — from my-webapp
   → Deploy application with pre-flight checks
   Evidence: 10 similar requests
   Corrections learned: "always run tests first"

════════════════════════════════════════════════════════════

Which skills should I generate?
> [1] /daily-review, [2] /deploy-app

Where should each skill be created?
┌──────────────────────┬─────────────────────────┐
│ /daily-review        │ my-productivity-tools   │
│ /deploy-app          │ my-webapp               │
└──────────────────────┴─────────────────────────┘

Skills created:
  ~/projects/my-productivity-tools/.claude/commands/daily-review.md
  ~/projects/my-webapp/.claude/commands/deploy-app.md
```

**Generated skill file example:**

```markdown
---
description: Deploy application with pre-flight checks
allowed-tools: Bash, Read, Write
---

## Context
Deployment scripts in ./scripts/deploy/

## Your Task
Deploy the application to the specified environment.

### Steps
1. Run test suite
2. Build production assets
3. Deploy to target environment
4. Verify deployment health

### Guardrails
- Always run tests before deploying
- Keep Fridays free of production deploys
- Check for pending migrations

---
*Generated by /reflect-skills from 10 session patterns*
```

### Skill Improvement Routing

When you correct Claude while using a skill (e.g., `/deploy`), the correction can be routed back to the skill file itself:

```
User: /deploy
Claude: [deploys without running tests]
User: "no, always run tests before deploying"

→ /reflect detects this relates to /deploy
→ Offers to add learning to .claude/commands/deploy.md
→ Skill file updated with new step
```

This makes skills smarter over time, not just CLAUDE.md.

## Switching from claude-reflect

Install one or the other: both capture the same corrections into the same queue file, so having both installed saves every correction twice. Corrections already waiting in the queue carry over.

```bash
claude plugin uninstall claude-reflect@claude-reflect-marketplace --scope user
claude plugin install beas-reflect@professor-orb-marketplace --scope user
# Restart Claude Code
```

## Updating

A change reaches Claude Code only when `version` goes up in both `beas-reflect/.claude-plugin/plugin.json` and the plugin's entry in `.claude-plugin/marketplace.json`. Then:

```bash
claude plugin marketplace update professor-orb-marketplace
claude plugin update beas-reflect@professor-orb-marketplace
# Restart Claude Code
```

## Uninstall

```bash
claude plugin uninstall beas-reflect@professor-orb-marketplace
```

## File Structure

```
beas-reflect/
├── .claude-plugin/
│   └── plugin.json         # Plugin manifest (auto-registers hooks)
├── commands/
│   ├── reflect.md          # Main command
│   ├── reflect-skills.md   # Skill discovery
│   ├── skip-reflect.md     # Discard queue
│   └── view-queue.md       # View queue
├── hooks/
│   └── hooks.json          # Auto-configured when plugin installed
├── scripts/
│   ├── lib/
│   │   ├── reflect_utils.py      # Shared utilities
│   │   └── semantic_detector.py  # AI-powered semantic analysis
│   ├── capture_learning.py       # Hook: detect corrections
│   ├── check_learnings.py        # Hook: pre-compact check
│   ├── post_commit_reminder.py   # Hook: post-commit reminder
│   ├── compare_detection.py      # Compare regex vs semantic detection
│   ├── extract_session_learnings.py
│   ├── extract_tool_errors.py
│   ├── extract_tool_rejections.py
│   └── legacy/                   # Bash scripts (deprecated)
├── tests/                  # Test suite
└── SKILL.md                # Skill context for Claude
```

## Features

### Historical Scan

First time using beas-reflect? Run:

```bash
/reflect --scan-history
```

This scans all your past sessions for corrections you made, so you don't lose learnings from before installation.

### Smart Filtering

Claude filters out:
- Questions (not corrections)
- One-time task instructions
- Context-specific requests
- Vague/non-actionable feedback

Only reusable learnings are kept.

### Duplicate Detection

Before adding a learning, existing CLAUDE.md content is checked. If similar content exists, you can:
- Merge with existing entry
- Replace the old entry
- Skip the duplicate

### Semantic Deduplication

Over time, CLAUDE.md can accumulate similar entries. Run `/reflect --dedupe` to:
- Find semantically similar entries (even with different wording)
- Propose consolidated versions
- Clean up redundant learnings

Example:
```
Before:
  - Use gpt-5.1 for complex tasks
  - Prefer gpt-5.1 for reasoning
  - gpt-5.1 is better for hard problems

After:
  - Use gpt-5.1 for complex reasoning tasks
```

## Tips

1. **Use explicit markers** for important learnings:
   ```
   remember: always use venv for Python projects
   ```

2. **Run /reflect after git commits** - The hook reminds you, but make it a habit

3. **Historical scan on new machines** - When setting up a new dev environment:
   ```
   /reflect --scan-history --days 90
   ```

4. **Project vs Global** - Model names and general patterns go global; project-specific conventions stay in project CLAUDE.md

5. **Discover skills monthly** - Run `/reflect-skills --days 30` monthly to find automation opportunities you might have missed

6. **Skills get smarter** - When you correct Claude during a skill, that correction can be routed back to the skill file itself via `/reflect`

7. **Extend session retention** - Claude Code deletes local sessions after 30 days by default. Since beas-reflect relies on session history for `/reflect --scan-history` and `/reflect-skills`, extend this in `~/.claude/settings.json`:
   ```json
   { "cleanupPeriodDays": 99999 }
   ```

## Contributing

Pull requests welcome! Please read the contributing guidelines first.

## License

MIT
