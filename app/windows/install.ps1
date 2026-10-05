$ErrorActionPreference = 'Stop'
$destination = Join-Path $env:LOCALAPPDATA 'Programs\CrossPet'
$exe = Join-Path $destination 'CrossPet.exe'
# Only stop this installation, never another Electron app.
$running = @(Get-Process CrossPet -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
if ($running.Count -gt 0) {
    $running | Stop-Process -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $running.Id -Timeout 10 -ErrorAction SilentlyContinue
}
if ([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($destination)) {
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Copy-Item -Path (Join-Path $PSScriptRoot '*') -Destination $destination -Recurse -Force
}
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'CrossPet.lnk'
$ws = New-Object -ComObject WScript.Shell
$link = $ws.CreateShortcut($shortcut)
$link.TargetPath = $exe
$link.WorkingDirectory = $destination
$link.Save()
Write-Host "Installed: $destination"
Write-Host 'AI hooks can be enabled from the pet context menu.'
Start-Process -FilePath $exe
