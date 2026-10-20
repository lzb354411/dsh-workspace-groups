@echo off
rem ASCII-only launcher: Chinese text lives in the .ps1 (UTF-8 with BOM),
rem because a .bat containing UTF-8 Chinese is mis-parsed by cmd.exe on this machine.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 pause
