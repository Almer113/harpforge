@echo off
rem Stops the HarpForge server.
title Stop HarpForge
cd /d "%~dp0"
call npm.cmd run undeploy
echo.
pause
