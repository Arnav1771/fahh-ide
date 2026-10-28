# Fahh Editor One-Line Installer for Windows
# Usage:
#   irm https://fahhide.duckdns.org/install.ps1 | iex

$ErrorActionPreference = "Stop"

Write-Host @"
========================================================================
   ____      _     _       _____    _ _ _             
  |  __|__ _| |__ | |__   | ____|__| (_) |_ ___  _ __ 
  | |_ / _` | '_ \| '_ \  |  _| / _` | | __/ _ \| '__|
  |  _| (_| | | | | | | | | |__| (_| | | || (_) | |   
  |_|  \__,_|_| |_|_| |_| |_____\__,_|_|\__\___/|_|   
                                                      
  Sovereign Spatial AI Code Editor - Tauri 2 + Rust
========================================================================
"@ -ForegroundColor Cyan

# 1. Check OS
if (-not ($IsWindows -or $env:OS -like "*Windows*")) {
    Write-Error "This installer is designed for Windows 10/11 (x64). For Linux or macOS, please download release packages from https://github.com/Arnav1771/fahh-ide/releases."
    return
}

# 2. Query GitHub Releases for the latest asset
$repo = "Arnav1771/fahh-ide"
$apiUrl = "https://api.github.com/repos/$repo/releases/latest"
Write-Host "Checking latest release from GitHub..." -ForegroundColor Yellow

$assetUrl = $null
$version = "latest"

try {
    $release = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "Fahh-Installer" } -TimeoutSec 10
    if ($release -and $release.assets) {
        $version = $release.tag_name
        # Match x64-setup.exe or .exe
        $targetAsset = $release.assets | Where-Object { $_.name -like "*x64-setup.exe" -or $_.name -like "*x64*.exe" } | Select-Object -First 1
        if ($targetAsset) {
            $assetUrl = $targetAsset.browser_download_url
        }
    }
} catch {
    Write-Warning "Could not query GitHub Releases API directly (possibly rate-limited). Falling back to direct release URL."
}

if (-not $assetUrl) {
    # Fallback to direct latest release binary URL
    $assetUrl = "https://github.com/$repo/releases/latest/download/Fahh.Editor_0.6.5_x64-setup.exe"
}

Write-Host "Downloading Fahh Editor $version..." -ForegroundColor Green
Write-Host "Source: $assetUrl" -ForegroundColor DarkGray

$tempDir = [System.IO.Path]::GetTempPath()
$installerPath = Join-Path $tempDir "Fahh-Editor-Setup.exe"

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $assetUrl -OutFile $installerPath -UseBasicParsing
} catch {
    Write-Error "Failed to download installer from $assetUrl : $_"
    return
}

Write-Host "Download complete. Starting installation..." -ForegroundColor Green

# 3. Launch the installer
try {
    $process = Start-Process -FilePath $installerPath -PassThru
    Write-Host "The installer wizard has been launched. Please follow the prompt to complete setup." -ForegroundColor Cyan
    $process.WaitForExit()
} catch {
    Write-Error "Failed to launch installer: $_"
    return
}

# 4. Clean up installer file
if (Test-Path $installerPath) {
    Remove-Item $installerPath -Force -ErrorAction SilentlyContinue
}

Write-Host @"

[OK] Fahh Editor installation completed!
You can launch Fahh Editor from your Start Menu or type 'fahh' in your terminal.
Website: https://fahhide.duckdns.org
Wiki Docs: https://github.com/Arnav1771/fahh-ide/wiki
"@ -ForegroundColor Green
