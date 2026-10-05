# Send one real Windows drag to the test pet, then restore the cursor.
param([int]$FromX, [int]$FromY, [int]$ToX, [int]$ToY, [int]$RestoreX, [int]$RestoreY)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System.Runtime.InteropServices;
public static class CrossPetTestMouse {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, System.UIntPtr extra);
}
'@
try {
    [void][CrossPetTestMouse]::SetCursorPos($FromX, $FromY)
    Start-Sleep -Milliseconds 200
    [CrossPetTestMouse]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 200
    [void][CrossPetTestMouse]::SetCursorPos($ToX, $ToY)
    Start-Sleep -Milliseconds 300
} finally {
    [CrossPetTestMouse]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 200
    [void][CrossPetTestMouse]::SetCursorPos($RestoreX, $RestoreY)
}
