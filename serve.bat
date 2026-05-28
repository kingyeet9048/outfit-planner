@echo off
REM Run a local HTTP server so the app can be tested before deploying to GitHub Pages.
REM Open http://127.0.0.1:5173/ in your browser after this starts.
cd /d "%~dp0"
echo Serving outfit-planner at http://127.0.0.1:5173/
echo Press Ctrl+C to stop.
where python >nul 2>&1
if %errorlevel%==0 (
  python -m http.server 5173 --bind 127.0.0.1
  goto :eof
)
where py >nul 2>&1
if %errorlevel%==0 (
  py -m http.server 5173 --bind 127.0.0.1
  goto :eof
)
where npx >nul 2>&1
if %errorlevel%==0 (
  npx --yes serve -p 5173 -L
  goto :eof
)
echo Neither python nor npx was found. Install Python or Node.js and try again.
pause
