---
description: Open a live Boxaid support call. Serve the Tune-Up Snapshot ready to paste, create the call scratchpad, and arm call mode so the kill guard runs at full scope. Brief from the KB if a symptom was given.
---

# /call-start

You are opening a live support call. Mr. Beasley is about to connect, or has just connected, to a client machine over ScreenConnect. Everything you do in this command is in service of one thing: he has the Tune-Up Snapshot in hand before anything else happens.

This command runs at two speeds. Speed 1 happens in your first response, every single time, with no lookups and no questions. Speed 2 happens immediately after, and only if he passed a symptom.

## Speed 1: the instant kit (first response, always)

Do all three, in this order, in one response.

**1. Serve the Tune-Up Snapshot.** Paste this into PowerShell on the client machine the moment ScreenConnect connects, then paste the output back here:

```powershell
$out = "=== STARTUP ITEMS ===`n" + (Get-CimInstance Win32_StartupCommand | Select-Object Name,Command,Location,User | Format-Table -AutoSize | Out-String) + "`n=== INSTALLED APPS ===`n" + (Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -EA SilentlyContinue | Where-Object { $_.DisplayName } | Select-Object DisplayName,DisplayVersion,Publisher | Sort-Object DisplayName | Format-Table -AutoSize | Out-String); $out | Set-Clipboard; Write-Host "Done - copied to clipboard."
```

This is the Tune-Up Snapshot one-liner, kept in sync with [[Live Call Flow]]. If this file and the wiki page ever disagree, update both; the wiki page is the source of truth for the command that runs on the client machine.

**2. Create the call scratchpad.** Write `call/scratchpad.md` with exactly this shape, filling in the symptom only if one was passed as an argument:

    # Call scratchpad

    ## Symptom
    <the argument, verbatim, or "not yet stated">

    ## Findings
    (nothing yet)

    ## Current plan step
    Waiting on the Tune-Up Snapshot output.

    ## Open risks
    (none yet)

No client PII, ever. Symptom and machine facts only. Refer to the client generically. Privacy is fireable.

**3. Arm call mode.** Write `call/call-mode.flag` containing a single ISO 8601 timestamp, the current time, and nothing else. Read the session date from context; do not guess it. Use PowerShell:

    New-Item -ItemType Directory -Path call -Force | Out-Null
    Set-Content -Path call\call-mode.flag -Value (Get-Date).ToString('o') -Encoding UTF8

Then tell him in one line that call mode is armed and the kill guard is at full scope.

## Speed 2: the KB briefing (only if a symptom was passed)

Skip this entirely when `/call-start` was fired with no argument. The briefing happens naturally once the symptom emerges.

Search `wiki/triage/` and `wiki/fixes/` for the symptom. Then give him, short and scannable:

- The likely causes, ordered most likely first, each with the page that covers it.
- The tier to quote, from [[Boxaid Tiers and Pay]].
- Known gotchas for this symptom.

Do not go read the machine. Do not start fixing. He has not connected yet.

## Hard rules

- The Tune-Up Snapshot goes out first. No questions before it, no flowchart before it.
- No client PII in `call/`, in the scratchpad, or anywhere in this repo. Privacy is fireable.
- Keep `call/scratchpad.md` current for the whole call. It is the only thing that survives a context squeeze, and `/teardown` reads it.
- The kill guard is armed. Never emit a command that triggers Safe Mode; that stops, disables, or uninstalls ScreenConnect; that kills processes or services by wildcard; that disables the network; or that powers the machine off. A restart is fine, but the reply must also say in one line that the session will drop for a few minutes and reconnect on its own.
- Call mode expires on its own after 12 hours. `/teardown` disarms it properly.
- No em dashes anywhere (a PostToolUse hook rejects the write otherwise).
