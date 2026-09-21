@echo off
setlocal
cd /d "%~dp0"

title Grocery POS 4.8.14

echo ==========================================
echo        GROCERY POS 4.8.14
echo        Windows Launcher
echo ==========================================
echo.

if not exist "package.json" (
    echo ERROR: package.json was not found.
    pause
    exit /b 1
)

if not exist "manager.js" (
    echo ERROR: manager.js was not found.
    pause
    exit /b 1
)

node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not available in PATH.
    pause
    exit /b 1
)

if not exist "data\.manager\logs" mkdir "data\.manager\logs"

echo Starting Grocery POS Manager...
echo.

start "Grocery POS Manager" /min cmd /c "node manager.js start"

exit /b 0

