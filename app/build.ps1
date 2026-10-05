param([switch]$Zip)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'Install Node.js 22.12 or later (including npm), then reopen PowerShell.'
}
Push-Location (Join-Path $PSScriptRoot 'windows')
try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Windows build failed.' }
    if ($Zip) {
        $arch = & node -p 'process.arch'
        $output = Join-Path $repo "build\CrossPet-win32-$arch"
        Compress-Archive -Path $output -DestinationPath "$output.zip" -Force
        Write-Host "Archive: $output.zip"
    }
} finally { Pop-Location }
