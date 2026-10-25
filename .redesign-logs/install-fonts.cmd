@echo off
chcp 65001 >nul
set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%PATH%"
cd /d "%~dp0.."
echo RUNNING > "%~dp0fonts.status"
call npm.cmd install @fontsource-variable/inter @fontsource-variable/jetbrains-mono --workspace @ketner/web > "%~dp0fonts.log" 2>&1
echo EXIT=%ERRORLEVEL%>> "%~dp0fonts.log"
echo DONE > "%~dp0fonts.status"
