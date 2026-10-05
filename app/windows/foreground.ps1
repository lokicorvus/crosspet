# One long-lived helper; emits executable names only, never window titles/content.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class CrossPetForeground {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
}
'@
$last = ''
while ($true) {
    $processId = [uint32]0
    $window = [CrossPetForeground]::GetForegroundWindow()
    [void][CrossPetForeground]::GetWindowThreadProcessId($window, [ref]$processId)
    $name = ''
    if ($processId -gt 0) {
        try { $name = (Get-Process -Id $processId -ErrorAction Stop).ProcessName.ToLowerInvariant() + '.exe' } catch {}
    }
    if ($name -ne $last) {
        [Console]::WriteLine($name)
        [Console]::Out.Flush()
        $last = $name
    }
    Start-Sleep -Milliseconds 500
}
