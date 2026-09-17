@echo off
REM ══════════════════════════════════════════════════════════════════════
REM  CHAIWALA — local preview
REM  The page uses ES modules, so it must be served over http:// rather
REM  than opened straight from disk. Double-click this file.
REM ══════════════════════════════════════════════════════════════════════
setlocal
cd /d "%~dp0"
set PORT=5173

echo.
echo   CHAIWALA - serving this folder at http://localhost:%PORT%
echo   Close this window to stop.
echo.

where py >nul 2>nul
if %errorlevel%==0 (
  start "" "http://localhost:%PORT%/"
  py -m http.server %PORT%
  goto :end
)

where python >nul 2>nul
if %errorlevel%==0 (
  start "" "http://localhost:%PORT%/"
  python -m http.server %PORT%
  goto :end
)

where node >nul 2>nul
if %errorlevel%==0 (
  start "" "http://localhost:%PORT%/"
  npx --yes serve -l %PORT% .
  goto :end
)

echo   Neither Python nor Node was found on PATH.
echo   Serve this folder with any static web server and open index.html.
pause

:end
endlocal
