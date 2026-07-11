# call-reminder.ps1
# Layer 1 of mid-call context protection. UserPromptSubmit.
# While call mode is on, injects a small note keeping Claude aware the call is live and
# the guard is armed. Adaptive: a one-liner when the scratchpad is fresh, the full note
# when it has gone stale or on every tenth message.
# Silent and free when call mode is off. Fails open.

$ErrorActionPreference = 'Stop'
try { $null = [Console]::In.ReadToEnd() } catch { exit 0 }

try {
    $project_dir = $env:CLAUDE_PROJECT_DIR
    if (-not $project_dir) { $project_dir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }

    $call_dir   = Join-Path $project_dir 'call'
    $flag_path  = Join-Path $call_dir 'call-mode.flag'
    $pad_path   = Join-Path $call_dir 'scratchpad.md'
    $count_path = Join-Path $call_dir '.reminder-count'

    if (-not (Test-Path $flag_path)) { exit 0 }

    $armed = [datetime]::MinValue
    $stamp = (Get-Content $flag_path -Raw -Encoding UTF8).Trim()
    if (-not [datetime]::TryParse($stamp, [ref]$armed)) { $armed = (Get-Item $flag_path).LastWriteTime }
    if (((Get-Date) - $armed).TotalHours -ge 12) { exit 0 }

    $count = 0
    if (Test-Path $count_path) {
        $parsed = 0
        if ([int]::TryParse((Get-Content $count_path -Raw -Encoding UTF8).Trim(), [ref]$parsed)) { $count = $parsed }
    }
    $count = $count + 1
    Set-Content -Path $count_path -Value $count -Encoding UTF8

    $stale = $true
    if (Test-Path $pad_path) {
        $stale = ((Get-Date) - (Get-Item $pad_path).LastWriteTime).TotalMinutes -ge 10
    }

    if ($stale -or ($count % 10 -eq 0)) {
        $context = @"
CALL MODE ACTIVE. The kill guard is armed at full scope: no command that stops, disables, or uninstalls ScreenConnect, kills processes or services by wildcard, disables the network, triggers Safe Mode, or powers the machine off. A restart is allowed only if the same reply warns, in one line, that the session will drop for a few minutes and reconnect on its own.
Update call/scratchpad.md now: symptom, findings so far, current plan step, open risks. No client PII. The scratchpad is the only thing that survives a context squeeze.
"@
    } else {
        $context = 'CALL MODE ACTIVE. Kill guard armed. Scratchpad current.'
    }

    $out = @{ hookSpecificOutput = @{ hookEventName = 'UserPromptSubmit'; additionalContext = $context }; suppressOutput = $true } | ConvertTo-Json -Depth 6
    Write-Output $out
    exit 0
}
catch { exit 0 }
