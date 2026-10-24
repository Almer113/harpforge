@echo off
rem Says whether the HarpForge server is running, and where to open it.
title HarpForge Status
cd /d "%~dp0"
call npm.cmd run deploy:status
echo.
pause
