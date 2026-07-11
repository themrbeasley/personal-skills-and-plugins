# call-restore.ps1
# Layer 3 of mid-call context protection. SessionStart, matchers compact and resume.
# When a fresh window opens mid-call, re-injects the scratchpad and re-arms Claude's
# awareness that the call is live and the guard is at full scope. Silent when call
# mode is off. Fails open.

$ErrorActionPreference = 'Stop'
try { $null = [Console]::In.ReadToEnd() } catch { exit 0 }

try {
    $project_dir = $env:CLAUDE_PROJECT_DIR
    if (-not $project_dir) { $project_dir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }

    $call_dir  = Join-Path $project_dir 'call'
    $flag_path = Join-Path $call_dir 'call-mode.flag'
    $pad_path  = Join-Path $call_dir 'scratchpad.md'

    if (-not (Test-Path $flag_path)) { exit 0 }

    $armed = [datetime]::MinValue
    $stamp = (Get-Content $flag_path -Raw -Encoding UTF8).Trim()
    if (-not [datetime]::TryParse($stamp, [ref]$armed)) { $armed = (Get-Item $flag_path).LastWriteTime }
    if (((Get-Date) - $armed).TotalHours -ge 12) { exit 0 }

    $pad = ''
    if (Test-Path $pad_path) { $pad = Get-Content $pad_path -Raw -Encoding UTF8 }

    $context = @"
A LIVE CALL IS IN PROGRESS. Call mode was armed at $($armed.ToString('yyyy-MM-dd HH:mm:ss')) and the kill guard is running at full scope: no command that stops, disables, or uninstalls ScreenConnect, kills processes or services by wildcard, disables the network, triggers Safe Mode, or powers the machine off. A restart is allowed only if the same reply warns, in one line, that the session will drop for a few minutes and reconnect on its own.

This window is fresh, so the call thread is only in the file below. Pick up from the current plan step. Keep call/scratchpad.md current. No client PII.

--- call/scratchpad.md ---
$pad
--- end scratchpad ---
"@

    $out = @{ hookSpecificOutput = @{ hookEventName = 'SessionStart'; additionalContext = $context } } | ConvertTo-Json -Depth 6
    Write-Output $out
    exit 0
}
catch { exit 0 }
