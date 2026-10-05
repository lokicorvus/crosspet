param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\CrossPet'),
    [switch]$SkipBuild,
    [switch]$NoLaunch,
    [switch]$NoShortcut
)
$ErrorActionPreference = 'Stop'
if (-not $SkipBuild) { & (Join-Path $PSScriptRoot 'app\build.ps1') }
$arch = & node -p 'process.arch'
if ($LASTEXITCODE -ne 0) { throw 'Node.js is required to select the build architecture.' }
$source = Join-Path $PSScriptRoot "build\CrossPet-win32-$arch"
if (-not (Test-Path -LiteralPath (Join-Path $source 'CrossPet.exe'))) { throw 'Build not found. Run app\build.ps1 first.' }
$target = [IO.Path]::GetFullPath($InstallDir)
$exe = Join-Path $target 'CrossPet.exe'
if (Test-Path -LiteralPath $target) {
    $manifest = Join-Path $target 'resources\app\package.json'
    if ((Get-ChildItem -LiteralPath $target -Force | Measure-Object).Count -gt 0 -and
        (-not (Test-Path -LiteralPath $manifest) -or (Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).name -ne 'crosspet')) {
        throw "Refusing to overwrite a non-CrossPet directory: $target"
    }
}
Get-Process -Name CrossPet -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process
New-Item -ItemType Directory -Path $target -Force | Out-Null
Get-ChildItem -LiteralPath $source | Copy-Item -Destination $target -Recurse -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'uninstall.ps1') -Destination $target -Force
if (-not $NoShortcut) {
    $shortcutPath = Join-Path ([Environment]::GetFolderPath('Programs')) 'CrossPet.lnk'
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $exe
    $shortcut.WorkingDirectory = $target
    $shortcut.Save()
}
Write-Host "Installed: $exe"
Write-Host 'Optional AI hooks (Python 3 on PATH):'
Write-Host ('  python "{0}" install codex' -f (Join-Path $target 'resources\app\tools\integrate.py'))
Write-Host 'Other integrations: claude-hooks, deepseek, gemini, antigravity'
if (-not $NoLaunch) { Start-Process -FilePath $exe -WorkingDirectory $target }
