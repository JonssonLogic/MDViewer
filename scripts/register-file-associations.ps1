<#
.SYNOPSIS
    Register or unregister .md and .qmd file associations for MDViewer.

.DESCRIPTION
    Adds or removes Windows file associations so that .md, .markdown, and .qmd
    files open with MDViewer when double-clicked. Uses HKCU (current user)
    registry keys — no admin elevation required.

.PARAMETER ExePath
    Full path to MDViewer.exe. If omitted, attempts to auto-detect from the
    default install location or the same directory as this script.

.PARAMETER Unregister
    Remove file associations instead of adding them.

.EXAMPLE
    .\register-file-associations.ps1 -ExePath "C:\Program Files\MDViewer\MDViewer.exe"
    .\register-file-associations.ps1 -Unregister

.NOTES
    This script is intended for portable installs. The NSIS/MSI installers
    can handle associations automatically when built with -WithFileAssociations.
#>

param(
    [string]$ExePath,
    [switch]$Unregister
)

$ErrorActionPreference = "Stop"

# --- SHChangeNotify P/Invoke for shell refresh ---

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class ShellNotify {
    [DllImport("shell32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern void SHChangeNotify(uint wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);

    public static void NotifyAssocChanged() {
        // SHCNE_ASSOCCHANGED = 0x08000000, SHCNF_IDLIST = 0x0000
        SHChangeNotify(0x08000000, 0x0000, IntPtr.Zero, IntPtr.Zero);
    }
}
"@

# --- File type definitions ---

$FileTypes = @(
    @{
        Extension   = ".md"
        ProgId      = "MDViewer.md"
        Description = "Markdown Document"
    },
    @{
        Extension   = ".markdown"
        ProgId      = "MDViewer.markdown"
        Description = "Markdown Document"
    },
    @{
        Extension   = ".qmd"
        ProgId      = "MDViewer.qmd"
        Description = "Quarto Document"
    }
)

$ClassesRoot = "HKCU:\Software\Classes"

# --- Unregister ---

if ($Unregister) {
    Write-Host "Removing MDViewer file associations..." -ForegroundColor Cyan

    foreach ($ft in $FileTypes) {
        $extKey = Join-Path $ClassesRoot $ft.Extension
        $progKey = Join-Path $ClassesRoot $ft.ProgId

        # Remove the ProgId key
        if (Test-Path $progKey) {
            Remove-Item $progKey -Recurse -Force
            Write-Host "  Removed $($ft.ProgId)" -ForegroundColor Green
        }

        # Reset extension default if it points to our ProgId
        if (Test-Path $extKey) {
            $currentDefault = (Get-ItemProperty $extKey -Name "(Default)" -ErrorAction SilentlyContinue)."(Default)"
            if ($currentDefault -eq $ft.ProgId) {
                Remove-ItemProperty $extKey -Name "(Default)" -ErrorAction SilentlyContinue
                Write-Host "  Cleared default for $($ft.Extension)" -ForegroundColor Green
            }
        }
    }

    [ShellNotify]::NotifyAssocChanged()
    Write-Host "`nFile associations removed." -ForegroundColor Green
    exit 0
}

# --- Register ---

# Resolve ExePath
if (-not $ExePath) {
    # Try same directory as this script
    $candidate = Join-Path $PSScriptRoot "MDViewer.exe"
    if (Test-Path $candidate) {
        $ExePath = $candidate
    } else {
        # Try default NSIS install location
        $candidate = Join-Path $env:LOCALAPPDATA "MDViewer\MDViewer.exe"
        if (Test-Path $candidate) {
            $ExePath = $candidate
        } else {
            $candidate = Join-Path ${env:ProgramFiles} "MDViewer\MDViewer.exe"
            if (Test-Path $candidate) {
                $ExePath = $candidate
            }
        }
    }
}

if (-not $ExePath -or -not (Test-Path $ExePath)) {
    Write-Host "ERROR: Could not find MDViewer.exe." -ForegroundColor Red
    Write-Host "Please specify the path with -ExePath parameter." -ForegroundColor Yellow
    Write-Host "  Example: .\register-file-associations.ps1 -ExePath `"C:\path\to\MDViewer.exe`"" -ForegroundColor Yellow
    exit 1
}

$ExePath = (Resolve-Path $ExePath).Path
Write-Host "Registering file associations for MDViewer" -ForegroundColor Cyan
Write-Host "  Executable: $ExePath" -ForegroundColor White

foreach ($ft in $FileTypes) {
    $extKey = Join-Path $ClassesRoot $ft.Extension
    $progKey = Join-Path $ClassesRoot $ft.ProgId
    $iconKey = Join-Path $progKey "DefaultIcon"
    $commandKey = Join-Path $progKey "shell\open\command"

    # Create extension key and set default to our ProgId
    if (-not (Test-Path $extKey)) {
        New-Item -Path $extKey -Force | Out-Null
    }
    Set-ItemProperty -Path $extKey -Name "(Default)" -Value $ft.ProgId

    # Create ProgId key with description
    if (-not (Test-Path $progKey)) {
        New-Item -Path $progKey -Force | Out-Null
    }
    Set-ItemProperty -Path $progKey -Name "(Default)" -Value $ft.Description

    # Set icon (use the exe's embedded icon)
    if (-not (Test-Path $iconKey)) {
        New-Item -Path $iconKey -Force | Out-Null
    }
    Set-ItemProperty -Path $iconKey -Name "(Default)" -Value "`"$ExePath`",0"

    # Set open command
    if (-not (Test-Path $commandKey)) {
        New-Item -Path $commandKey -Force | Out-Null
    }
    Set-ItemProperty -Path $commandKey -Name "(Default)" -Value "`"$ExePath`" `"%1`""

    Write-Host "  Registered $($ft.Extension) -> $($ft.ProgId)" -ForegroundColor Green
}

# Notify the shell that associations changed
[ShellNotify]::NotifyAssocChanged()

Write-Host "`nFile associations registered successfully." -ForegroundColor Green
Write-Host "You can now double-click .md, .markdown, and .qmd files to open them in MDViewer." -ForegroundColor White
Write-Host "`nTo undo, run: .\register-file-associations.ps1 -Unregister" -ForegroundColor Yellow
