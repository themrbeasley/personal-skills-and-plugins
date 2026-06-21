---
name: dnd
description: Show the D&D campaign toolkit and available skills. Use when the user types /dnd, asks what tools are available, or wants to know what to run next after a session.
---

Show the user what's available in the dnd-campaign-toolkit. Format your response as:

1. A one-line description: "Collaborative post-session workflow for D&D DMs. Every skill drafts its output and waits for your approval before writing files."
2. The session pipeline as a simple flow: debrief > prep > content / chronicler > kb-validator
3. A second line for standalone tools: "Standalone: homebrew, timeline, historian (read-only agent, spawned by timeline and content)."
4. A table with one row per skill/agent, columns: Name | When to use | What it produces
   Include all six skills (debrief, prep, content, chronicler, timeline, homebrew) and all three agents (lore, kb-validator, historian).
   For prep, use: "Build a session brief with your DM" | "Session brief (work review, recap, north stars, handouts)"
   For timeline, use: "Build or update a campaign chronology, or answer a temporal question" | "Chronology document in the KB (or a direct answer for pure queries)"
   For historian, use: "Read-only temporal analysis: chronological indexing, calendar conversion, consistency checks" | "Structured chronological report"
5. A single closing line: "What would you like to do?"

Keep everything scannable. No preamble.
