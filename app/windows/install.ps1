# CrossPet 安装：复制到 %LOCALAPPDATA%\Programs\CrossPet（一键更新时是旧版所在的文件夹，见 -Target），建开始菜单快捷方式，按新版刷新已经接入的 AI，然后打开。不需要管理员权限。
# 覆盖安装即更新：设置、改的名字、自己加的角色、AI 接入都保留。
# -Update：桌宠右键「更新到 …」时由旧版调用（在后台运行、不弹窗口），出错写到 %LOCALAPPDATA%\CrossPet\update.log
# -Target：一键更新时旧版传它自己所在的文件夹，原地换成新版。以前总是装到 Programs\CrossPet，
#   自己解压在别处（文档、E 盘……）的人更新完再从原来的位置打开、或开机自启的还是旧版，每次都提示更新。
#   那个文件夹里只有 CrossPet 自己的文件时才原地换；多了别的东西（怕连带删掉）就照旧装到 Programs\CrossPet
param([switch]$Update, [string]$Target)   # 不能叫 Destination：PowerShell 变量名不分大小写，会和下面的 $destination 是同一个
$ErrorActionPreference = 'Stop'
$default = Join-Path $env:LOCALAPPDATA 'Programs\CrossPet'
$destination = $default
$exe = Join-Path $destination 'CrossPet.exe'
$log = Join-Path $env:LOCALAPPDATA 'CrossPet\update.log'

function Say($text, $color = 'Gray') {
    if ($Update) { Add-Content -LiteralPath $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss ') + $text) -Encoding UTF8 }
    else { Write-Host $text -ForegroundColor $color }
}

# 能不能原地换：是一个装着 CrossPet.exe 的文件夹（不是盘符根目录），里面每一项新安装包里都有（系统自己放的 desktop.ini、Thumbs.db 除外）
function InPlace($dir) {
    try { $dir = [IO.Path]::GetFullPath($dir).TrimEnd('\') } catch { return $null }
    if (-not $dir -or $dir.Length -le 3 -or -not (Test-Path -LiteralPath (Join-Path $dir 'CrossPet.exe'))) { return $null }
    $known = @(Get-ChildItem -LiteralPath $PSScriptRoot -Force | ForEach-Object { $_.Name }) + 'desktop.ini', 'Thumbs.db'
    $extra = @(Get-ChildItem -LiteralPath $dir -Force | Where-Object { $known -notcontains $_.Name } | ForEach-Object { $_.Name })
    if ($extra.Count -gt 0) { Say "$dir 里还有别的东西（$($extra -join '、')），不在那里原地更新，装到 $default"; return $null }
    # 要在它旁边建 .new、把它改名：上一层没有写权限（比如 Program Files）就换不了
    $probe = Join-Path (Split-Path $dir) ('.crosspet-write-test-' + $PID)
    try { New-Item -ItemType Directory -Path $probe -ErrorAction Stop | Out-Null; Remove-Item -LiteralPath $probe -Force }
    catch { Say "$(Split-Path $dir) 没有写权限，不在那里原地更新，装到 $default"; return $null }
    return $dir
}

try {
    if ($Update) { New-Item -ItemType Directory -Path (Split-Path $log) -Force | Out-Null }
    if ($Update -and -not $Target) {
        # 1.4.0 及以前的旧版不传 -Target：看是哪个 CrossPet.exe 叫起的这个脚本（它这时多半还没退完），就装回它那里。
        # 它已经退出、看不到了，就照旧装到 Programs\CrossPet
        try {
            $caller = Get-Process -Id (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId -ErrorAction Stop
            # 从解压出来的安装包本身叫起来的（双击 exe 安装）不算：那是要装到 Programs\CrossPet
            if ($caller.ProcessName -eq 'CrossPet' -and $caller.Path -and [IO.Path]::GetFullPath((Split-Path $caller.Path)) -ne [IO.Path]::GetFullPath($PSScriptRoot)) { $Target = Split-Path $caller.Path }
        } catch { }
    }
    if ($Target) { $here = InPlace $Target; if ($here) { $destination = $here } }
    $exe = Join-Path $destination 'CrossPet.exe'
    # 只关掉这个位置的 CrossPet（一键更新时旧版自己会退出，这里等它退干净）
    for ($i = 0; $i -lt 20; $i++) {
        $running = @(Get-Process CrossPet -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
        if ($running.Count -eq 0) { break }
        if ($i -ge 6) { $running | Stop-Process -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Milliseconds 500
    }
    if ([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($destination)) {
        # 接入的 AI（Codex、DeepSeek Harness……）每次调钩子都会用 Programs\CrossPet\python\python.exe 跑一下 crosspet-hook.py，一两秒就结束。
        # 它们在跑时这些文件删不掉、目录也改不了名（#24）：先等它们退出，等 10 秒还在就结束掉（只少记一个事件）
        # 只查会从安装目录里跑起来的几个程序名：读全部进程的路径在 Windows 上一次就要一秒多，按次数算的「10 秒」会拖成半分钟（test.5 实测 37 秒）
        function OurProcesses { @(Get-Process -Name python, pythonw, CrossPet -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($destination + '\', [StringComparison]::OrdinalIgnoreCase) }) }
        $deadline = (Get-Date).AddSeconds(10)
        while ((OurProcesses).Count -gt 0 -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
        $busy = OurProcesses
        if ($busy.Count -gt 0) { Say "结束占用安装目录的进程：$(($busy | ForEach-Object { $_.Name + ' ' + $_.Id }) -join '，')"; $busy | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500 }

        # 不原地删（#24：以前先删旧目录再复制，删到一半失败就留下缺了 characters、integrations 的目录，之后每次启动都崩）。
        # 现在新版先完整复制到 CrossPet.new，再把旧目录改名成 CrossPet.old-时间、新目录改名成 CrossPet，最后删旧的。
        # 哪一步失败都退得回去：旧目录要么没动过、要么改回原名
        $parent = Split-Path $destination
        $staged = "$destination.new"
        Get-ChildItem -LiteralPath $parent -Directory -Filter "$(Split-Path $destination -Leaf).old-*" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue   # 上次没删掉的旧版本
        if (Test-Path -LiteralPath $staged) { Remove-Item -LiteralPath $staged -Recurse -Force }
        New-Item -ItemType Directory -Path $staged -Force | Out-Null
        Copy-Item -Path (Join-Path $PSScriptRoot '*') -Destination $staged -Recurse -Force
        foreach ($need in 'CrossPet.exe', 'characters', 'web', 'integrations', 'tools', 'python') {
            if (-not (Test-Path -LiteralPath (Join-Path $staged $need))) { Remove-Item -LiteralPath $staged -Recurse -Force -ErrorAction SilentlyContinue; throw "新版本复制不完整（缺少 $need），旧版本没有动" }
        }
        $old = "$destination.old-" + (Get-Date -Format 'yyyyMMddHHmmss')
        $hadOld = Test-Path -LiteralPath $destination
        if ($hadOld) {
            try { Rename-Item -LiteralPath $destination -NewName (Split-Path $old -Leaf) }
            catch {
                Remove-Item -LiteralPath $staged -Recurse -Force -ErrorAction SilentlyContinue
                throw "旧版本的文件正被别的程序占用，没法替换（$($_.Exception.Message)）。旧版本没有动；请关掉 Codex、DeepSeek Harness 等正在用的 AI 后再更新"
            }
        }
        try { Rename-Item -LiteralPath $staged -NewName (Split-Path $destination -Leaf) }
        catch {
            if ($hadOld) { Rename-Item -LiteralPath $old -NewName (Split-Path $destination -Leaf) -ErrorAction SilentlyContinue }   # 换回旧版本
            throw
        }
        if ($hadOld) { Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue }   # 删不掉（还有文件被占用）就留着，下次安装时再清
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

    # 开机自启指着别处的旧版 CrossPet.exe（以前在那份里打开的）：改指这一份，不然每次开机打开的还是旧版
    try {
        $run = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name CrossPet -ErrorAction SilentlyContinue
        $was = if ($run) { $run.CrossPet.Trim('"') } else { $null }
        if ($was -and $was -like '*\CrossPet.exe' -and $was -ne $exe) {
            Set-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name CrossPet -Value "`"$exe`""
            Say "开机自启原来指着 $was，改成 $exe"
        }
    } catch { Say "改开机自启失败：$_" 'Yellow' }

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
    if ($Update) {
        # 一键更新失败时把旧版（如果还在）重新打开，并且明说没装上——以前只写日志，用户完全不知道
        if (Test-Path -LiteralPath $exe) { Start-Process -FilePath $exe }
        try {
            Add-Type -AssemblyName PresentationFramework
            [System.Windows.MessageBox]::Show("更新没装上：$_`n`nCrossPet 还是原来的版本，可以稍后在右键菜单里再点更新。", 'CrossPet') | Out-Null
        } catch { }
    }
    exit 1
}
