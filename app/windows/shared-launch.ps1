param([Parameter(Mandatory=$true)][string]$PackageDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
try {
    $destination = Join-Path $env:LOCALAPPDATA 'Programs\CrossPet'
    $message = "当前程序位于共享文件夹，无法从这里直接运行。`n`n是否复制到 Windows 本机并启动？`n$destination`n`n已有角色和设置会保留。"
    $answer = [System.Windows.Forms.MessageBox]::Show($message, 'CrossPet', 'OKCancel', 'Information')
    if ($answer -eq [System.Windows.Forms.DialogResult]::OK) {
        & (Join-Path $PackageDirectory 'install.ps1')
    }
} catch {
    [System.Windows.Forms.MessageBox]::Show("安装未完成：$($_.Exception.Message)", 'CrossPet', 'OK', 'Error') | Out-Null
    exit 1
}
