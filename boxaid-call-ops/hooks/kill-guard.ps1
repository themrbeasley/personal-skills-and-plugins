# kill-guard.ps1
# Blocks session-killing commands before they can reach the client machine.
#
# Dangerous commands do not travel as tool calls. ScreenConnect's shell is
# permanently unavailable, so a command reaches the client machine one way:
# Claude writes it as text, Mr. Beasley pastes it. So this scans text.
#
# One pattern table serves two hook events:
#   Stop        scans last_assistant_message, answers with decision=block
#   PreToolUse  scans the serialized tool_input, answers with permissionDecision=deny
#
# A Stop block does NOT un-print the reply. The text is already on screen. What a
# block buys is that Claude's very next words are a forced retraction, delivered in
# the seconds before a human could select, copy, and paste. See
# docs/adr/0002-kill-guard-on-output.md.
#
# FAIL OPEN by contract: any error, any unparsable input, exit 0 and do nothing.
# A broken guard must never lock up the desk mid-call.

$ErrorActionPreference = 'Stop'

try { $raw = [Console]::In.ReadToEnd() } catch { exit 0 }
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }
try { $payload = $raw | ConvertFrom-Json -ErrorAction Stop } catch { exit 0 }

try {
    $event_name = [string]$payload.hook_event_name

    $project_dir = $env:CLAUDE_PROJECT_DIR
    if (-not $project_dir) { $project_dir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }

    # What text are we scanning?
    if ($event_name -eq 'Stop') {
        $text = [string]$payload.last_assistant_message
    } else {
        $text = ($payload.tool_input | ConvertTo-Json -Depth 12 -Compress)
    }
    if ([string]::IsNullOrWhiteSpace($text)) { exit 0 }

    # Call mode: the flag exists and is younger than 12 hours. A forgotten teardown
    # must not leave yesterday's guard restricting today's desk work.
    $call_dir  = Join-Path $project_dir 'call'
    $flag_path = Join-Path $call_dir 'call-mode.flag'
    $call_mode = $false
    if (Test-Path $flag_path) {
        $armed = [datetime]::MinValue
        $stamp = (Get-Content $flag_path -Raw -Encoding UTF8).Trim()
        if (-not [datetime]::TryParse($stamp, [ref]$armed)) {
            $armed = (Get-Item $flag_path).LastWriteTime
        }
        if (((Get-Date) - $armed).TotalHours -lt 12) { $call_mode = $true }
    }

    $sc = 'screenconnect'

    # ---- Tier 1: armed at all times. Kills ScreenConnect by name.
    # The proximity window spans newlines on purpose. The 2026-07-09 incident put
    # the verb and the target on different lines of one pipeline.
    $t1_kill    = '(?:Stop-Process|taskkill|Stop-Service|Remove-Service|sc(?:\.exe)?\s+(?:stop|delete)|msiexec\s+/x|Uninstall-Package)'
    $t1_disable = '(?:Set-Service[\s\S]{0,80}(?:-StartupType\s+Disabled|-Status\s+Stopped)|"?Start"?\s*(?:-Value|=)\s*4)'
    $t1_verb    = "(?:$t1_kill|$t1_disable)"
    $near       = '[\s\S]{0,200}'
    # The Set-Service disable form nests the target name between the verb and the
    # outcome (Set-Service -Name "ScreenConnect Client" -StartupType Disabled), so
    # the plain verb-near-sc / sc-near-verb ordering below never sees it: the whole
    # t1_disable span, including the nested name, is consumed by $t1_verb before the
    # $sc check runs. This branch checks that nested case directly.
    $t1_nested  = "Set-Service[\s\S]{0,80}$sc[\s\S]{0,80}(?:-StartupType\s+Disabled|-Status\s+Stopped)"
    $tier1      = "(?is)(?:$t1_verb$near$sc|$sc$near$t1_verb|$t1_nested)"

    # ---- Tier 2: armed only in call mode. Cuts the session as a side effect.
    $tier2 = @(
        @{ label = 'shotgun process kill';           pattern = '(?is)Get-Process[\s\S]{0,200}\|[\s\S]{0,120}Stop-Process' }
        @{ label = 'shotgun service kill';           pattern = '(?is)Get-Service[\s\S]{0,200}\|[\s\S]{0,160}(?:Stop-Service|sc(?:\.exe)?\s+delete)' }
        @{ label = 'wildcard taskkill';              pattern = '(?is)taskkill[^\r\n]{0,80}(?:/IM|\*)' }
        @{ label = 'wildcard Stop-Process';          pattern = '(?is)Stop-Process[^\r\n]{0,80}\*' }
        @{ label = 'network adapter disable';        pattern = '(?is)Disable-NetAdapter' }
        @{ label = 'netsh interface disable';        pattern = '(?is)netsh\s+interface\s+set\s+interface[^\r\n]{0,80}disable' }
        @{ label = 'ipconfig release';               pattern = '(?is)ipconfig\s+/release' }
        @{ label = 'bcdedit safe boot';              pattern = '(?is)bcdedit[^\r\n]{0,80}safeboot' }
        @{ label = 'msconfig safe boot';             pattern = '(?is)msconfig[\s\S]{0,200}safe\s?boot' }
        @{ label = 'ScreenConnect Safe Mode button'; pattern = "(?is)(?:$sc[\s\S]{0,160}safe\s?mode|safe\s?mode[\s\S]{0,160}button)" }
        @{ label = 'power off';                      pattern = '(?is)Stop-Computer' }
        @{ label = 'shutdown without restart';       pattern = '(?im)^.*\bshutdown(?:\.exe)?\b\s*/(?:s|f|t\s*\d)(?![^\r\n]*(?:/r|-r)\b).*$' }
    )

    # ---- Restarts are allowed, but only with the reconnect warning line.
    $restart        = '(?is)(?:shutdown(?:\.exe)?[^\r\n]{0,60}(?:/r|-r)\b|Restart-Computer)'
    $warn_reconnect = '(?is)\breconnect'
    $warn_drop      = '(?is)\b(?:drop|drops|disconnect|disconnects|go offline|goes offline)\b'

    # ---- The rogue exception. A Tier 1 pattern passes only when the same text
    # names the instance and says it was verified per the identity SOP.
    $rogue_ok = ($text -match '(?is)\brogue\b') `
        -and ($text -match '(?is)ScreenConnect Legit Boxaid vs Rogue') `
        -and ($text -match '(?is)\b(?:verified|confirmed)\b') `
        -and ($text -match '(?is)(?:ScreenConnect Client \(|\bguid\b|\brelay\b|install path)')

    # A wildcard sweep is a per-instance cut with the per-instance confirmation
    # skipped. It never qualifies for the rogue exception, no matter what it claims.
    if ($text -match '(?is)(?:DisplayName[\s\S]{0,60}-like|screenconnect\*)') { $rogue_ok = $false }

    $blocks = @()

    if (($text -match $tier1) -and (-not $rogue_ok)) {
        $blocks += 'Tier 1: a command that stops, disables, or uninstalls ScreenConnect by name. This is the command class that severed the session on 2026-07-09.'
    }

    if ($call_mode) {
        foreach ($rule in $tier2) {
            if ($text -match $rule.pattern) {
                $blocks += ('Tier 2 (' + $rule.label + '): cuts the remote session as a side effect.')
            }
        }
        if ($text -match $restart) {
            if (-not (($text -match $warn_reconnect) -and ($text -match $warn_drop))) {
                $blocks += 'Restart with no reconnect warning. A reply containing a restart must also say, in one line, that the session will drop for a few minutes and reconnect on its own.'
            }
        }
    }

    if ($blocks.Count -eq 0) { exit 0 }

    if ($event_name -eq 'Stop') {
        $reason = 'KILL GUARD BLOCK. ' + ($blocks -join ' ') + ' Rewrite the reply without that command. Then tell Mr. Beasley plainly what you were about to suggest and why it was blocked, because he has already seen it on screen. If the target really is a rogue ScreenConnect instance, name its install path or fingerprint, state that it was verified per the ScreenConnect Legit Boxaid vs Rogue page, and act on one named service at a time.'
        $out = @{ decision = 'block'; reason = $reason } | ConvertTo-Json -Depth 6
        Write-Output $out
        exit 0
    }

    $reason = 'KILL GUARD DENY. ' + ($blocks -join ' ') + ' Do not place this command on the clipboard and do not run it.'
    $out = @{ hookSpecificOutput = @{ hookEventName = 'PreToolUse'; permissionDecision = 'deny'; permissionDecisionReason = $reason } } | ConvertTo-Json -Depth 6
    Write-Output $out
    exit 0
}
catch { exit 0 }
