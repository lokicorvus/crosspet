@echo off
rem Run in a separate window: uninstall.ps1 may delete this batch file and its directory.
start "CrossPet Uninstall" powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" -Interactive
