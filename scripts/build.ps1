<#
.SYNOPSIS
    Build script for MDViewer — produces NSIS installer, MSI installer, and portable ZIP.

.DESCRIPTION
    Builds the MDViewer Tauri application and copies the resulting artifacts
    to an output directory. Optionally bakes file associations (.md, .qmd)
    into the installer.

.PARAMETER OutputDir
    Directory where build artifacts are copied. Default: ./release

.PARAMETER SkipBuild
    Skip the build step and just package existing artifacts.

.PARAMETER NsisOnly
    Build only the NSIS installer (skip MSI).

.PARAMETER MsiOnly
    Build only the MSI installer (skip NSIS).

.PARAMETER WithFileAssociations
    Bake .md and .qmd file associations into the installer so they are
    registered automatically on install.

.EXAMPLE
    .\build.ps1
    .\build.ps1 -OutputDir .\dist -NsisOnly
    .\build.ps1 -WithFileAssociations
#>

param(
    [string]$OutputDir = ".\release",
    [switch]$SkipBuild,
    [switch]$NsisOnly,
    [switch]$MsiOnly,
    [switch]$WithFileAssociations
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$TauriConfPath = Join-Path $ProjectRoot "src-tauri\tauri.conf.json"

# --- Helpers ---

function Write-Step($msg) {
    Write-Host "`n==> $msg" -ForegroundColor Cyan
}

function Write-Ok($msg) {
    Write-Host "    OK: $msg" -ForegroundColor Green
}

function Write-Err($msg) {
    Write-Host "    ERROR: $msg" -ForegroundColor Red
}

function Assert-Command($cmd, $label) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Err "$label is not installed or not in PATH ('$cmd' not found)."
        exit 1
    }
    $ver = & $cmd --version 2>&1 | Select-Object -First 1
    Write-Ok "$label — $ver"
}

# --- Prerequisite check ---

Write-Step "Checking prerequisites"
Assert-Command "node"  "Node.js"
Assert-Command "npm"   "npm"
Assert-Command "cargo" "Rust/Cargo"

# Check Tauri CLI via npx
try {
    $tauriVer = & npx tauri --version 2>&1 | Select-Object -First 1
    Write-Ok "Tauri CLI — $tauriVer"
} catch {
    Write-Err "Tauri CLI not found. Run 'npm install' first."
    exit 1
}

# --- Read version from tauri.conf.json ---

Write-Step "Reading project configuration"
$confText = Get-Content $TauriConfPath -Raw
$conf = $confText | ConvertFrom-Json
$version = $conf.version
$productName = $conf.productName
Write-Ok "$productName v$version"

# --- Patch tauri.conf.json if needed ---

$confModified = $false

try {
    # Patch targets if -NsisOnly or -MsiOnly
    if ($NsisOnly -and $MsiOnly) {
        Write-Err "Cannot use -NsisOnly and -MsiOnly together."
        exit 1
    }

    if ($NsisOnly -or $MsiOnly -or $WithFileAssociations) {
        Write-Step "Patching tauri.conf.json for this build"

        # Re-parse fresh for patching
        $confObj = $confText | ConvertFrom-Json

        if ($NsisOnly) {
            $confObj.bundle.targets = @("nsis")
            Write-Ok "Targets narrowed to: nsis"
        }
        if ($MsiOnly) {
            $confObj.bundle.targets = @("msi")
            Write-Ok "Targets narrowed to: msi"
        }

        if ($WithFileAssociations) {
            $fileAssociations = @(
                @{
                    ext         = @("md", "markdown")
                    mimeType    = "text/markdown"
                    description = "Markdown Document"
                    role        = "Viewer"
                },
                @{
                    ext         = @("qmd")
                    mimeType    = "text/markdown"
                    description = "Quarto Document"
                    role        = "Viewer"
                }
            )
            $confObj.bundle | Add-Member -NotePropertyName "fileAssociations" -NotePropertyValue $fileAssociations -Force
            Write-Ok "File associations added (.md, .markdown, .qmd)"
        }

        $patchedJson = $confObj | ConvertTo-Json -Depth 10
        Set-Content -Path $TauriConfPath -Value $patchedJson -Encoding UTF8
        $confModified = $true
    }

    # --- Build ---

    if (-not $SkipBuild) {
        Write-Step "Building $productName v$version"
        Write-Host "    This may take several minutes on the first build..." -ForegroundColor Yellow

        Push-Location $ProjectRoot
        try {
            & npm run tauri build
            if ($LASTEXITCODE -ne 0) {
                Write-Err "Build failed with exit code $LASTEXITCODE"
                exit $LASTEXITCODE
            }
        } finally {
            Pop-Location
        }
        Write-Ok "Build completed"
    } else {
        Write-Step "Skipping build (using existing artifacts)"
    }

} finally {
    # --- Restore original tauri.conf.json ---
    if ($confModified) {
        Write-Step "Restoring original tauri.conf.json"
        Set-Content -Path $TauriConfPath -Value $confText -Encoding UTF8
        Write-Ok "Restored"
    }
}

# --- Collect artifacts ---

Write-Step "Collecting build artifacts"

$bundleDir = Join-Path $ProjectRoot "src-tauri\target\release\bundle"
$releaseExe = Join-Path $ProjectRoot "src-tauri\target\release\$productName.exe"
$outDir = Join-Path $ProjectRoot $OutputDir

if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$artifacts = @()

# NSIS installer
$nsisDir = Join-Path $bundleDir "nsis"
if (Test-Path $nsisDir) {
    $nsisFiles = Get-ChildItem $nsisDir -Filter "*.exe"
    foreach ($f in $nsisFiles) {
        Copy-Item $f.FullName -Destination $outDir -Force
        $artifacts += Join-Path $outDir $f.Name
        Write-Ok "NSIS installer: $($f.Name)"
    }
}

# MSI installer
$msiDir = Join-Path $bundleDir "msi"
if (Test-Path $msiDir) {
    $msiFiles = Get-ChildItem $msiDir -Filter "*.msi"
    foreach ($f in $msiFiles) {
        Copy-Item $f.FullName -Destination $outDir -Force
        $artifacts += Join-Path $outDir $f.Name
        Write-Ok "MSI installer: $($f.Name)"
    }
}

# Portable ZIP
if (Test-Path $releaseExe) {
    Write-Step "Creating portable ZIP"
    $portableDir = Join-Path $env:TEMP "MDViewer-portable-$$"
    New-Item -ItemType Directory -Path $portableDir -Force | Out-Null

    Copy-Item $releaseExe -Destination $portableDir
    $regScript = Join-Path $PSScriptRoot "register-file-associations.ps1"
    if (Test-Path $regScript) {
        Copy-Item $regScript -Destination $portableDir
    }

    $zipName = "$productName-$version-portable.zip"
    $zipPath = Join-Path $outDir $zipName
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

    Compress-Archive -Path (Join-Path $portableDir "*") -DestinationPath $zipPath -Force
    $artifacts += $zipPath
    Write-Ok "Portable ZIP: $zipName"

    Remove-Item $portableDir -Recurse -Force
} else {
    Write-Host "    WARN: $productName.exe not found — skipping portable ZIP" -ForegroundColor Yellow
}

# --- Summary ---

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Build Summary — $productName v$version"     -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

if ($artifacts.Count -eq 0) {
    Write-Host "  No artifacts found. Did the build succeed?" -ForegroundColor Yellow
} else {
    foreach ($a in $artifacts) {
        $file = Get-Item $a
        $sizeMB = [math]::Round($file.Length / 1MB, 2)
        $hash = (Get-FileHash $a -Algorithm SHA256).Hash.Substring(0, 16)
        Write-Host "  $($file.Name)  ($sizeMB MB)  SHA256: $hash..." -ForegroundColor White
    }
    Write-Host ""
    Write-Host "  Output directory: $outDir" -ForegroundColor Green
}

Write-Host ""
