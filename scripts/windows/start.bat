@echo off
title Laukolaroser server
cd /d "%~dp0"
"%~dp0node\node.exe" scripts\launch-local.cjs
echo.
pause
