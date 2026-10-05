param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\CrossPet'),
    [switch]$RemoveIntegrations,
    [switch]$NoShortcut
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $InstallDir)) { Write-Host 'CrossPet is not installed there.'; exit 0 }
$target = (Resolve-Path -LiteralPath $InstallDir).Path
$manifest = Join-Path $target 'resources\app\package.json'
$exe = Join-Path $target 'CrossPet.exe'
if ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing to remove a linked directory.' }
if (-not (Test-Path -LiteralPath $exe) -or -not (Test-Path -LiteralPath $manifest) -or
    (Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).name -ne 'crosspet') {
    throw "Not a CrossPet installation: $target"
}
if ($target -in @([IO.Path]::GetPathRoot($target), $env:USERPROFILE, $env:LOCALAPPDATA)) {
    throw "Refusing to remove this directory: $target"
}
if ($RemoveIntegrations) {
    $helper = Join-Path $target 'resources\app\tools\integrate.py'
    foreach ($integration in @('claude-hooks', 'codex', 'deepseek', 'gemini', 'antigravity')) {
        & python $helper uninstall $integration
        if ($LASTEXITCODE -ne 0) { throw "Could not remove $integration. Installation retained." }
    }
}
Get-Process -Name CrossPet -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$login = Get-ItemProperty -LiteralPath $runKey -Name CrossPet -ErrorAction SilentlyContinue
if ($login -and $login.CrossPet.Contains($exe)) { Remove-ItemProperty -LiteralPath $runKey -Name CrossPet }
if (-not $NoShortcut) {
    $shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'CrossPet.lnk'
    if (Test-Path -LiteralPath $shortcut) {
        $link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
        if ($link.TargetPath -eq $exe) { Remove-Item -LiteralPath $shortcut }
    }
}
# The resolved target above must contain our executable and package manifest.
Remove-Item -LiteralPath $target -Recurse -Force
Write-Host "Removed $target. Character data and settings are retained in LOCALAPPDATA\CrossPet."
