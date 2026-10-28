# Installs the Bijou Footage Rebuild panel for Adobe Premiere Pro (Windows).
# Run this from a normal PowerShell window (no admin needed for a per-user install).
#
# What it does:
#   1. Enables "debug mode" for Adobe's CEP extension host, which lets Premiere
#      load this unsigned, locally-developed extension at all.
#   2. Symlinks this folder into Premiere's per-user extensions directory, so
#      future edits here show up next time Premiere restarts (no re-copying).

$ErrorActionPreference = 'Stop'

$csxsVersions = 4..12
foreach ($v in $csxsVersions) {
    $key = "HKCU:\Software\Adobe\CSXS.$v"
    if (-not (Test-Path $key)) {
        New-Item -Path $key -Force | Out-Null
    }
    New-ItemProperty -Path $key -Name 'PlayerDebugMode' -Value '1' -PropertyType String -Force | Out-Null
}
Write-Host "Enabled PlayerDebugMode for CSXS.4 through CSXS.12."

$sourceDir = $PSScriptRoot
$extensionsDir = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
if (-not (Test-Path $extensionsDir)) {
    New-Item -ItemType Directory -Path $extensionsDir -Force | Out-Null
}
$linkPath = Join-Path $extensionsDir 'com.bijounga.footagerebuild'

if (Test-Path $linkPath) {
    $existing = Get-Item $linkPath -Force
    if ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        # A symlink: .Delete() removes just the link, not the target's contents.
        Write-Host "Removing existing symlink at $linkPath"
        $existing.Delete()
    } else {
        # A real folder (the plain-copy fallback from a previous run) - needs -Recurse.
        Write-Host "Removing existing copy at $linkPath"
        Remove-Item -Path $linkPath -Recurse -Force
    }
}

try {
    New-Item -ItemType SymbolicLink -Path $linkPath -Target $sourceDir -Force -ErrorAction Stop | Out-Null
    Write-Host "Linked $linkPath -> $sourceDir"
} catch {
    Write-Host "Symlink creation failed (needs admin PowerShell or Windows Developer Mode enabled)."
    Write-Host "Falling back to a plain copy instead - re-run this script after future edits to pick them up."
    Copy-Item -Path $sourceDir -Destination $linkPath -Recurse -Force
    Write-Host "Copied to $linkPath"
}
Write-Host ""
Write-Host "Done. Restart Premiere Pro, then open it from Window > Extensions > Bijou Footage Rebuild."
