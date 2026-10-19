@echo off
rem Waypoint launcher (Windows). Opens the vault saved in %APPDATA%\Waypoint\config.json,
rem or a folder passed as an argument:  Waypoint.cmd "C:\path\to\vault"
cd /d "%~dp0"
if not exist "node_modules\electron" (
  echo Waypoint is not installed yet. Open a terminal in this folder and run:  npm install
  pause
  exit /b 1
)
rem Electron downloads its program on first use. npm install does this; this is the fallback.
if not exist "node_modules\electron\dist\electron.exe" node -e "require('electron')"
start "" "node_modules\electron\dist\electron.exe" "%~dp0." %*
