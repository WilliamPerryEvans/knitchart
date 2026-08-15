@echo off
REM Double-click this to rebuild KnitChart and update the desktop app.
REM Close KnitChart first -- Windows will not let us replace a running program.
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
echo.
echo   Building KnitChart. This takes a couple of minutes.
echo.
call npm run install-app
if errorlevel 1 (
  echo.
  echo   Something went wrong. The message above says what.
)
echo.
pause
