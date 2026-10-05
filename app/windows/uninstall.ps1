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
        Write-Host 'No installed CrossPet was found. A portable copy can be removed by deleting its extracted folder after exiting it.'
    } else {
        $exe = Join-Path $destination 'CrossPet.exe'
        $python = Join-Path $destination 'resources\app\runtime\python\python.exe'
        $integrator = Join-Path $destination 'resources\app\tools\integrate.py'
        if (!(Test-Path -LiteralPath $python) -or !(Test-Path -LiteralPath $integrator)) {
            throw 'The installation is incomplete. Run install.cmd from a complete package, then try uninstalling again.'
        }
        $env:PYTHONUTF8 = '1'
        foreach ($target in @('claude-hooks', 'codex', 'gemini', 'antigravity')) {
            & $python $integrator uninstall $target
            if ($LASTEXITCODE -ne 0) { throw "Failed to remove $target hooks. Application files retained." }
        }
        # Terminate only this installation and its foreground helper, then wait for file handles.
        $processes = @(Get-Process CrossPet -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
        foreach ($process in $processes) {
            Get-CimInstance Win32_Process -Filter "ParentProcessId=$($process.Id)" -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*app\windows\foreground.ps1*' } |
                ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
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
        Write-Host 'CrossPet uninstalled. Characters and settings were retained.' -ForegroundColor Green
    }
} catch {
    $exitCode = 1
    Write-Host "Uninstall failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Log: $log"
} finally {
    if ($transcribing) { Stop-Transcript | Out-Null }
    # Keep errors visible for double-click users. CLI/tests remain non-interactive.
    if ($Interactive) { Read-Host 'Press Enter to close' | Out-Null }
}
exit $exitCode
