@echo off
rem Builds HarpForge and starts its server on port 5280 (if it isn't running already).
title Start HarpForge
cd /d "%~dp0"
call npm.cmd run deploy
echo.
pause
