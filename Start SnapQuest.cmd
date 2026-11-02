@echo off
setlocal
cd /d "%~dp0"
echo Starting SnapQuest in your browser...
call npm.cmd run dev -- --host 127.0.0.1
echo.
echo If npm reports missing packages, run "npm.cmd install" in this folder first.
pause
