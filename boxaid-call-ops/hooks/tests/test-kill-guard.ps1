# test-kill-guard.ps1
# Feeds synthetic hook payloads to kill-guard.ps1 on stdin and asserts on its stdout.
# Not a hook. Never wired into settings.json. Run it by hand:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.claude\hooks\tests\test-kill-guard.ps1

$ErrorActionPreference = 'Stop'
$project_dir = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
# Locate the guard relative to this test file so this line needs no edit at install:
# the guard is always one folder up from this tests/ folder (boxaid-call-ops/hooks/ now, .claude/hooks/ after install).
$guard       = Join-Path $PSScriptRoot '..\kill-guard.ps1'
$call_dir    = Join-Path $project_dir 'call'
$flag_path   = Join-Path $call_dir 'call-mode.flag'

$env:CLAUDE_PROJECT_DIR = $project_dir

# Preserve any real call in progress.
$saved_flag = $null
if (Test-Path $flag_path) { $saved_flag = Get-Content $flag_path -Raw -Encoding UTF8 }

function Set-CallMode([bool]$on) {
    if ($on) {
        New-Item -ItemType Directory -Path $call_dir -Force | Out-Null
        Set-Content -Path $flag_path -Value (Get-Date).ToString('o') -Encoding UTF8
    } elseif (Test-Path $flag_path) {
        Remove-Item $flag_path -Force
    }
}

function Invoke-Guard($payload) {
    $json = $payload | ConvertTo-Json -Depth 8 -Compress
    $json | powershell.exe -NoProfile -ExecutionPolicy Bypass -File $guard
}

function Stop-Payload([string]$reply) {
    return @{ hook_event_name = 'Stop'; session_id = 'test'; last_assistant_message = $reply }
}

function Tool-Payload([string]$command) {
    return @{ hook_event_name = 'PreToolUse'; session_id = 'test'; tool_name = 'PowerShell'; tool_input = @{ command = $command } }
}

$failures = 0
$passes   = 0

function Assert-Blocked([string]$name, $payload) {
    $out = Invoke-Guard $payload
    if ($out -match 'decision' -or $out -match 'permissionDecision') {
        $script:passes++; Write-Host "PASS  blocked: $name" -ForegroundColor Green
    } else {
        $script:failures++; Write-Host "FAIL  should have blocked: $name" -ForegroundColor Red
    }
}

function Assert-Passed([string]$name, $payload) {
    $out = Invoke-Guard $payload
    if ([string]::IsNullOrWhiteSpace($out)) {
        $script:passes++; Write-Host "PASS  allowed: $name" -ForegroundColor Green
    } else {
        $script:failures++; Write-Host "FAIL  should have passed: $name" -ForegroundColor Red
        Write-Host "      guard said: $out"
    }
}

# ---------------------------------------------------------------- Tier 1, always armed
Set-CallMode $false

Assert-Blocked 'tier1 stop-process by name, call mode off' (Stop-Payload 'Run this: Stop-Process -Name ScreenConnect.ClientService -Force')
Assert-Blocked 'tier1 sc delete by name'                   (Stop-Payload 'Now run: sc.exe delete "ScreenConnect Client (a1b2c3)"')
Assert-Blocked 'tier1 taskkill by name'                    (Stop-Payload 'taskkill /F /IM ScreenConnect.WindowsClient.exe')
Assert-Blocked 'tier1 wildcard sweep across lines'         (Stop-Payload @"
Get-Service | Where-Object {`$_.DisplayName -like "ScreenConnect*"} |
  ForEach-Object { Stop-Service -Force; sc.exe delete `$_.Name }
"@)
Assert-Blocked 'tier1 service disable via Set-Service'     (Stop-Payload 'Set-Service -Name "ScreenConnect Client" -StartupType Disabled')
Assert-Blocked 'tier1 through the PowerShell tool'         (Tool-Payload 'Stop-Service -Name "ScreenConnect Client (a1b2c3)"')

# ---------------------------------------------------------------- the rogue exception
Assert-Passed 'rogue override, fully verified, one named instance' (Stop-Payload @'
This is the rogue instance. It is not ours: install path
C:\Program Files (x86)\ScreenConnect Client (deadbeef)\, relay is not the Boxaid relay,
and I confirmed against the host console per ScreenConnect Legit Boxaid vs Rogue that it
is not one of our sessions. Verified. Remove that one service only:
sc.exe delete "ScreenConnect Client (deadbeef)"
'@)

Assert-Blocked 'rogue language but a wildcard sweep' (Stop-Payload @'
These are rogue. Verified per ScreenConnect Legit Boxaid vs Rogue against the host
console, the relay is wrong and the guid is unknown. Clean them all:
Get-Service | Where-Object { $_.DisplayName -like "ScreenConnect*" } | Stop-Service -Force
'@)

Assert-Blocked 'bare kill claiming rogue with no verification' (Stop-Payload 'That is a rogue. Stop-Service -Name "ScreenConnect Client (deadbeef)"')

# ---------------------------------------------------------------- Tier 2, call mode OFF
Assert-Passed 'tier2 shotgun kill is allowed off-call'  (Stop-Payload 'Get-Process chrome | Stop-Process -Force')
Assert-Passed 'tier2 network off is allowed off-call'   (Stop-Payload 'Disable-NetAdapter -Name "Wi-Fi"')
Assert-Passed 'tier2 safe boot is allowed off-call'     (Stop-Payload 'bcdedit /set {current} safeboot minimal')
Assert-Passed 'tier2 power off is allowed off-call'     (Stop-Payload 'Stop-Computer -Force')

# ---------------------------------------------------------------- Tier 2, call mode ON
Set-CallMode $true

Assert-Blocked 'tier2 shotgun process kill'   (Stop-Payload 'Get-Process chrome | Stop-Process -Force')
Assert-Blocked 'tier2 shotgun service kill'   (Stop-Payload 'Get-Service | Where-Object { $_.Status -eq "Running" } | Stop-Service')
Assert-Blocked 'tier2 wildcard taskkill'      (Stop-Payload 'taskkill /F /IM chrome.exe')
Assert-Blocked 'tier2 disable-netadapter'     (Stop-Payload 'Disable-NetAdapter -Name "Wi-Fi" -Confirm:$false')
Assert-Blocked 'tier2 netsh interface off'    (Stop-Payload 'netsh interface set interface "Wi-Fi" disable')
Assert-Blocked 'tier2 ipconfig release'       (Stop-Payload 'ipconfig /release')
Assert-Blocked 'tier2 bcdedit safeboot'       (Stop-Payload 'bcdedit /set {current} safeboot minimal')
Assert-Blocked 'tier2 msconfig safe boot'     (Stop-Payload 'Open msconfig, go to the Boot tab, and tick Safe boot.')
Assert-Blocked 'tier2 screenconnect safe mode button' (Stop-Payload 'In the ScreenConnect toolbar, press the Safe Mode button.')
Assert-Blocked 'tier2 stop-computer'          (Stop-Payload 'Stop-Computer -Force')
Assert-Blocked 'tier2 bare shutdown'          (Stop-Payload 'shutdown /s /t 0')

# ---------------------------------------------------------------- restarts
Assert-Blocked 'restart with no reconnect warning' (Stop-Payload 'Reboot now: shutdown /r /t 0')
Assert-Blocked 'Restart-Computer with no warning'  (Stop-Payload 'Restart-Computer -Force')

Assert-Passed 'restart WITH the reconnect warning' (Stop-Payload @'
Heads up before you run this: the session will drop for a few minutes and reconnect on
its own. Do not panic.

shutdown /r /t 0
'@)

# ---------------------------------------------------------------- false positives
Assert-Passed 'the Tune-Up Snapshot one-liner is not a kill' (Tool-Payload '$out = "=== STARTUP ITEMS ===" + (Get-CimInstance Win32_StartupCommand | Out-String) + (Get-ItemProperty ''HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'' -EA SilentlyContinue | Where-Object { $_.DisplayName } | Out-String); $out | Set-Clipboard')
Assert-Passed 'reinstating the service is not a kill'        (Stop-Payload 'Set-Service -Name "ScreenConnect Client (a1b2c3)" -StartupType Automatic')

# ---------------------------------------------------------------- fail open
$garbage = 'not json at all' | powershell.exe -NoProfile -ExecutionPolicy Bypass -File $guard
if ([string]::IsNullOrWhiteSpace($garbage) -and $LASTEXITCODE -eq 0) {
    $passes++; Write-Host 'PASS  fails open on garbage stdin' -ForegroundColor Green
} else {
    $failures++; Write-Host 'FAIL  did not fail open on garbage stdin' -ForegroundColor Red
}

# ---------------------------------------------------------------- teardown
Set-CallMode $false
if ($saved_flag) { Set-Content -Path $flag_path -Value $saved_flag -Encoding UTF8 -NoNewline }

Write-Host ''
Write-Host "$passes passed, $failures failed"
if ($failures -gt 0) { exit 1 }
exit 0
