@echo off
title DrawLogix :3001
cd /d "%~dp0DrawLogix"
set "DRAWLOGIX_ODA=C:\Users\IKIO\ODA\ODAFileConverter.exe"
echo Starting DrawLogix on http://localhost:3001 ...
call npm start
echo.
echo DrawLogix stopped. Press any key to close.
pause >nul
