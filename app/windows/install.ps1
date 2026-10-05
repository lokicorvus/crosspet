# CrossPet 安装：复制到 %LOCALAPPDATA%\Programs\CrossPet，建开始菜单快捷方式，然后打开。不需要管理员权限。
# 覆盖安装即更新：设置、改的名字、自己加的角色都保留；装好后在桌宠右键「接入 AI」里把用到的 AI 再「接入 / 更新」一次。
$ErrorActionPreference = 'Stop'
$destination = Join-Path $env:LOCALAPPDATA 'Programs\CrossPet'
$exe = Join-Path $destination 'CrossPet.exe'
# 只关掉这个位置的 CrossPet
$running = @(Get-Process CrossPet -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
if ($running.Count -gt 0) {
    $running | Stop-Process -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $running.Id -Timeout 10 -ErrorAction SilentlyContinue
}
if ([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($destination)) {
    if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Copy-Item -Path (Join-Path $PSScriptRoot '*') -Destination $destination -Recurse -Force
}
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'CrossPet.lnk'
$ws = New-Object -ComObject WScript.Shell
$link = $ws.CreateShortcut($shortcut)
$link.TargetPath = $exe
$link.WorkingDirectory = $destination
$link.IconLocation = (Join-Path $destination 'AppIcon.ico')
$link.Save()
Write-Host "已安装到 $destination" -ForegroundColor Green
Write-Host '右键桌宠 →「接入 AI」，把你用的 AI 接上。'
Start-Process -FilePath $exe
