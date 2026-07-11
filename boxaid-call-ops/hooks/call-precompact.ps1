# call-precompact.ps1
# Layer 2 of mid-call context protection. PreCompact.
# Snapshots the call scratchpad to a timestamped file before the context is squeezed,
# so even a summary that loses the thread cannot lose what is already in the file.
#
# PreCompact cannot inject context. Its only output is decision=block plus reason, and
# blocking a compaction mid-call would stall the desk. So this hook writes a file and
# gets out of the way. Layer 3 (SessionStart on compact) is what puts it back in front
# of Claude. Fails open, and always allows the compaction.

$ErrorActionPreference = 'Stop'
try { $null = [Console]::In.ReadToEnd() } catch { exit 0 }

try {
    $project_dir = $env:CLAUDE_PROJECT_DIR
    if (-not $project_dir) { $project_dir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }

    $call_dir  = Join-Path $project_dir 'call'
    $flag_path = Join-Path $call_dir 'call-mode.flag'
    $pad_path  = Join-Path $call_dir 'scratchpad.md'

    if (-not (Test-Path $flag_path)) { exit 0 }
    if (-not (Test-Path $pad_path))  { exit 0 }

    $armed = [datetime]::MinValue
    $stamp = (Get-Content $flag_path -Raw -Encoding UTF8).Trim()
    if (-not [datetime]::TryParse($stamp, [ref]$armed)) { $armed = (Get-Item $flag_path).LastWriteTime }
    if (((Get-Date) - $armed).TotalHours -ge 12) { exit 0 }

    $snap_dir = Join-Path $call_dir 'snapshots'
    New-Item -ItemType Directory -Path $snap_dir -Force | Out-Null

    $snap_name = 'scratchpad-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.md'
    Copy-Item -Path $pad_path -Destination (Join-Path $snap_dir $snap_name) -Force

    Add-Content -Path $pad_path -Value ("`n<!-- context squeezed at " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + " -->") -Encoding UTF8
    exit 0
}
catch { exit 0 }
