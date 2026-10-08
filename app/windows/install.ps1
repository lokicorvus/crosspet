# CrossPet 安装：复制到 %LOCALAPPDATA%\Programs\CrossPet，建开始菜单快捷方式，按新版刷新已经接入的 AI，然后打开。不需要管理员权限。
# 覆盖安装即更新：设置、改的名字、自己加的角色、AI 接入都保留。
# -Update：桌宠右键「更新到 …」时由旧版调用（在后台运行、不弹窗口），出错写到 %LOCALAPPDATA%\CrossPet\update.log
param([switch]$Update)
$ErrorActionPreference = 'Stop'
$destination = Join-Path $env:LOCALAPPDATA 'Programs\CrossPet'
$exe = Join-Path $destination 'CrossPet.exe'
$log = Join-Path $env:LOCALAPPDATA 'CrossPet\update.log'

function Say($text, $color = 'Gray') {
    if ($Update) { Add-Content -LiteralPath $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss ') + $text) -Encoding UTF8 }
    else { Write-Host $text -ForegroundColor $color }
}

try {
    if ($Update) { New-Item -ItemType Directory -Path (Split-Path $log) -Force | Out-Null }
    # 只关掉这个位置的 CrossPet（一键更新时旧版自己会退出，这里等它退干净）
    for ($i = 0; $i -lt 20; $i++) {
        $running = @(Get-Process CrossPet -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
        if ($running.Count -eq 0) { break }
        if ($i -ge 6) { $running | Stop-Process -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Milliseconds 500
    }
    if ([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($destination)) {
        if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
        New-Item -ItemType Directory -Path $destination -Force | Out-Null
        Copy-Item -Path (Join-Path $PSScriptRoot '*') -Destination $destination -Recurse -Force
    }
    # 去掉「从网上下载的」标记：不然由资源管理器打开（AI 开始工作时自动出现）可能会弹安全警告
    Get-ChildItem -LiteralPath $destination -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
    $shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'CrossPet.lnk'
    $ws = New-Object -ComObject WScript.Shell
    $link = $ws.CreateShortcut($shortcut)
    $link.TargetPath = $exe
    $link.WorkingDirectory = $destination
    $link.IconLocation = (Join-Path $destination 'AppIcon.ico')
    $link.Save()
    Say "已安装到 $destination" 'Green'

    # 已经接入的 AI 按新版刷新一遍（没接入过的不动）；失败不影响安装
    try {
        $ErrorActionPreference = 'Continue'   # PowerShell 5.1 会把 Python 的 stderr 当成错误，这里不能因此中断
        $env:PYTHONIOENCODING = 'utf-8'
        try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
        $out = & (Join-Path $destination 'python\python.exe') (Join-Path $destination 'tools\integrate.py') refresh 2>&1 | Out-String
        if ($out.Trim()) { Say $out.Trim() }
    } catch { Say "刷新 AI 接入失败：$_（可以在桌宠右键「接入 AI」里手动更新）" 'Yellow' }

    if (-not $Update) { Write-Host '右键桌宠 →「接入 AI」，把你用的 AI 接上。' }
    Start-Process -FilePath $exe
} catch {
    Say "安装失败：$_" 'Red'
    # 一键更新失败时把旧版（如果还在）重新打开
    if ($Update -and (Test-Path -LiteralPath $exe)) { Start-Process -FilePath $exe }
    exit 1
}
