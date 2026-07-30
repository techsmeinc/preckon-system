@echo off
REM One-click launcher for DrawLogix + the portal (each in its own window).
REM Double-click this file. Then open:  http://localhost:5173/drawlogix/studio
start "DrawLogix :3001" "%~dp0_run-drawlogix.bat"
start "Portal :5173" "%~dp0_run-portal.bat"
echo.
echo Launching both servers in separate windows...
echo   DrawLogix : http://localhost:3001
echo   Portal    : http://localhost:5173
echo.
echo Open in your browser:  http://localhost:5173/drawlogix/studio
echo (Give them ~10 seconds to start. Close their windows to stop the servers.)
echo.
pause
