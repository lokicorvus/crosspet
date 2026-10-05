param([switch]$Interactive)
$ErrorActionPreference = 'Stop'
$exitCode = 0
$transcribing = $false
$destination = Join-Path $env:LOCALAPPDATA 'Programs\CrossPet'
$data = Join-Path $env:LOCALAPPDATA 'CrossPet'
$log = Join-Path $data 'uninstall.log'
try {
    New-Item -ItemType Directory -Path $data -Force | Out-Null
    Start-Transcript -Path $log -Append -Force | Out-Null
    $transcribing = $true
    # Double-clicking starts in the install directory; release our own directory handle.
    Set-Location -LiteralPath ([IO.Path]::GetTempPath())
    [Environment]::CurrentDirectory = [IO.Path]::GetTempPath()
    if (!(Test-Path -LiteralPath $destination)) {
        Write-Host '没有找到已安装的 CrossPet。解压后直接运行的，退出后删掉那个文件夹就行。'
    } else {
        $exe = Join-Path $destination 'CrossPet.exe'
        $python = Join-Path $destination 'python\python.exe'
        $integrator = Join-Path $destination 'tools\integrate.py'
        if (!(Test-Path -LiteralPath $python) -or !(Test-Path -LiteralPath $integrator)) {
            throw '安装不完整：请先用完整的安装包运行 install.cmd，再卸载。'
        }
        $env:PYTHONUTF8 = '1'
        $env:CROSSPET_DATA_DIR = $data
        foreach ($target in @('claude-hooks', 'codex', 'deepseek', 'gemini', 'antigravity')) {
            & $python $integrator uninstall $target
            if ($LASTEXITCODE -ne 0) { throw "撤销 $target 的接入失败，程序文件已保留。" }
        }
        # 只关掉这个位置的 CrossPet，等它释放文件
        $processes = @(Get-Process CrossPet -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
        foreach ($process in $processes) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
        if ($processes.Count -gt 0) {
            Wait-Process -Id $processes.Id -Timeout 10 -ErrorAction SilentlyContinue
        }
        $run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
        if (Test-Path $run) {
            $key = Get-Item $run
            foreach ($name in $key.GetValueNames()) {
                $value = [string]$key.GetValue($name)
                if ($value.Contains($exe)) { Remove-ItemProperty -Path $run -Name $name }
            }
        }
        # Missing/redirected Start Menu directories must not prevent application removal.
        $programs = [Environment]::GetFolderPath('Programs')
        if (![string]::IsNullOrWhiteSpace($programs)) {
            $shortcut = Join-Path $programs 'CrossPet.lnk'
            if (Test-Path -LiteralPath $shortcut) { Remove-Item -LiteralPath $shortcut }
        }
        for ($attempt = 0; $attempt -lt 5; $attempt++) {
            try { Remove-Item -LiteralPath $destination -Recurse -Force; break }
            catch { if ($attempt -eq 4) { throw }; Start-Sleep -Milliseconds 500 }
        }
        Write-Host 'CrossPet 已卸载：各 AI 的接入都已撤销。角色和设置保留在 %LOCALAPPDATA%\CrossPet，不需要的话可以手动删除。' -ForegroundColor Green
    }
} catch {
    $exitCode = 1
    Write-Host "卸载失败：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host "日志：$log"
} finally {
    if ($transcribing) { Stop-Transcript | Out-Null }
    # Keep errors visible for double-click users. CLI/tests remain non-interactive.
    if ($Interactive) { Read-Host '按回车关闭' | Out-Null }
}
exit $exitCode
