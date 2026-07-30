@echo off
title Portal :5173
cd /d "%~dp0artifacts\boq-platform"
set "PORT=5173"
set "BASE_PATH=/"
set "API_URL=http://localhost:5000"
set "DRAWLOGIX_URL=http://localhost:3001"
echo Starting portal on http://localhost:5173 ...
call pnpm dev
echo.
echo Portal stopped. Press any key to close.
pause >nul
