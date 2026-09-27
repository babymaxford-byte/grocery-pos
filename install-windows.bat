@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

title Grocery POS - Windows Installer

set "APP_DIR=%~dp0"
set "NODE_MIN=20"

echo.
echo ============================================================
echo              GROCERY POS WINDOWS INSTALLER
 echo ============================================================
echo.
echo This installer will:
echo   1. Check for Node.js 20 or newer
 echo   2. Install Node.js 22 LTS if possible
 echo   3. Install the POS npm dependencies
 echo   4. Create local Windows launchers
 echo   5. Check the POS files
 echo.

where node >nul 2>nul
if errorlevel 1 goto :install_node

for /f "tokens=1 delims=." %%A in ('node -p "process.versions.node" 2^>nul') do set "NODE_MAJOR=%%A"
if not defined NODE_MAJOR goto :install_node
if !NODE_MAJOR! LSS %NODE_MIN% goto :install_node

echo [OK] Node.js detected: 
node -v
echo.
goto :install_deps

:install_node
echo [INFO] Node.js %NODE_MIN% or newer was not found.
echo.

where winget >nul 2>nul
if errorlevel 1 goto :node_manual

echo [INFO] Installing Node.js 22 LTS using Windows Package Manager...
echo.
winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
if errorlevel 1 goto :node_manual

rem Refresh PATH for this process when Node was installed system-wide.
set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"

where node >nul 2>nul
if errorlevel 1 goto :node_restart

for /f "tokens=1 delims=." %%A in ('node -p "process.versions.node" 2^>nul') do set "NODE_MAJOR=%%A"
if not defined NODE_MAJOR goto :node_restart
if !NODE_MAJOR! LSS %NODE_MIN% goto :node_manual

echo [OK] Node.js installed:
node -v
echo.
goto :install_deps

:node_restart
echo.
echo Node.js was installed, but Windows has not refreshed this Command Prompt's PATH yet.
echo.
echo Please close this window, open a NEW Command Prompt, and run:
echo.
echo   "%~f0"
echo.
pause
exit /b 1

:node_manual
echo.
echo ============================================================
echo Node.js installation could not be completed automatically.
echo ============================================================
echo.
echo Please install Node.js 22 LTS from:
echo https://nodejs.org/
echo.
echo Then open a NEW Command Prompt and run this installer again.
echo.
pause
exit /b 1

:install_deps
echo [INFO] Node.js:
node -v
echo [INFO] npm:
npm -v
echo.

if not exist "package.json" (
  echo [ERROR] package.json was not found.
  echo Make sure this installer is being run from the extracted POS folder.
  pause
  exit /b 1
)

if not exist "server\index.js" (
  echo [ERROR] server\index.js was not found.
  pause
  exit /b 1
)

if not exist "manager.js" (
  echo [ERROR] manager.js was not found.
  pause
  exit /b 1
)

echo [INFO] Installing POS dependencies...
echo This may take a few minutes on the first installation.
echo.
npm install
if errorlevel 1 (
  echo.
  echo [ERROR] npm install failed.
  echo.
  echo If this is a fresh Windows installation, make sure:
  echo   - Node.js 20+ is installed
  echo   - You have Internet access for the first npm install
  echo   - Windows Defender/antivirus is not blocking npm
  echo.
  pause
  exit /b 1
)

echo.
echo [INFO] Checking POS JavaScript files...
node --check manager.js
if errorlevel 1 goto :check_failed
node --check server\index.js
if errorlevel 1 goto :check_failed

echo.
echo [INFO] Creating local Windows launchers...

>"start-manager-windows.bat" echo @echo off
>>"start-manager-windows.bat" echo cd /d "%%~dp0"
>>"start-manager-windows.bat" echo title Grocery POS Manager
>>"start-manager-windows.bat" echo node manager.js start --ui

>"start-pos-windows.bat" echo @echo off
>>"start-pos-windows.bat" echo cd /d "%%~dp0"
>>"start-pos-windows.bat" echo title Grocery POS
>>"start-pos-windows.bat" echo node manager.js start

>"stop-pos-windows.bat" echo @echo off
>>"stop-pos-windows.bat" echo cd /d "%%~dp0"
>>"stop-pos-windows.bat" echo title Grocery POS Stop
>>"stop-pos-windows.bat" echo node manager.js stop

if not exist "data" mkdir "data"

:done
echo.
echo ============================================================
echo                 INSTALLATION COMPLETE
 echo ============================================================
echo.
echo POS folder:
echo   %APP_DIR%
echo.
echo Created launchers:
echo   start-manager-windows.bat
 echo   start-pos-windows.bat
 echo   stop-pos-windows.bat
 echo.
echo To start the POS Manager:
echo   Double-click start-manager-windows.bat
 echo.
echo The Manager will start the POS and open its local control panel.
echo.
echo POS:     http://127.0.0.1:5173
 echo Manager: http://127.0.0.1:3010
 echo.
echo NOTE: The first npm install requires Internet access.
echo After installation, the POS itself can run locally/offline.
echo.
pause
exit /b 0

:check_failed
echo.
echo [ERROR] A POS JavaScript file failed the syntax check.
echo Review the error above before using the POS.
pause
exit /b 1
