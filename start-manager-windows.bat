@echo off
setlocal
cd /d "%~dp0"
title EverJoy POS Manager 4.8.17
if not exist "package.json" (echo ERROR: package.json not found.&pause&exit /b 1)
node --version >nul 2>&1
if errorlevel 1 (echo ERROR: Node.js is not installed or not available in PATH.&pause&exit /b 1)
if not exist "data\.manager\logs" mkdir "data\.manager\logs"
start "EverJoy POS Manager" /min cmd /c "node manager.js start --ui --no-browser"
exit /b 0
