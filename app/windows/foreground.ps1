# One hidden, long-lived watcher; emits only process names, never window titles.
param([int]$ParentId)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CrossPetForeground {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
}
'@
$previous = ''
$previousWindow = [IntPtr]::Zero
$wasDown = $false
$parentCheck = [Diagnostics.Stopwatch]::StartNew()
while ($true) {
    if ($parentCheck.ElapsedMilliseconds -gt 1000) {
        if (-not (Get-Process -Id $ParentId -ErrorAction SilentlyContinue)) { break }
        $parentCheck.Restart()
    }
    $window = [CrossPetForeground]::GetForegroundWindow()
    if ($window -ne $previousWindow) {
        $previousWindow = $window
        [uint32]$foregroundId = 0
        [void][CrossPetForeground]::GetWindowThreadProcessId($window, [ref]$foregroundId)
        $process = Get-Process -Id $foregroundId -ErrorAction SilentlyContinue
        $name = if ($process) { $process.ProcessName.ToLowerInvariant() } else { '' }
        if ($name -ne $previous) { [Console]::WriteLine($name); $previous = $name }
    }
    # A non-activating transparent window can lose the renderer's pointerup.
    $down = ([CrossPetForeground]::GetAsyncKeyState(1) -band 0x8000) -ne 0
    if ($wasDown -and -not $down) { [Console]::WriteLine('@mouse-up') }
    $wasDown = $down
    Start-Sleep -Milliseconds 32
}
