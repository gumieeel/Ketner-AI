@echo off
rem Вспомогательный скрипт проверок редизайна. Использование: check.cmd <метка>
rem Удаляется по завершении работы; в git не коммитится.
chcp 65001 >nul
set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%PATH%"
cd /d "%~dp0.."
set "TAG=%~1"
if "%TAG%"=="" set "TAG=run"
set "OUT=.redesign-logs\%TAG%"
echo RUNNING > "%OUT%.status"
call npm.cmd run typecheck > "%OUT%-typecheck.log" 2>&1
echo EXIT=%ERRORLEVEL%>> "%OUT%-typecheck.log"
call npm.cmd run lint > "%OUT%-lint.log" 2>&1
echo EXIT=%ERRORLEVEL%>> "%OUT%-lint.log"
call npm.cmd test --workspace @ketner/web > "%OUT%-test.log" 2>&1
echo EXIT=%ERRORLEVEL%>> "%OUT%-test.log"
if "%~2"=="build" (
  call npm.cmd run build --workspace @ketner/web > "%OUT%-build.log" 2>&1
  echo EXIT=%ERRORLEVEL%>> "%OUT%-build.log"
)
echo DONE > "%OUT%.status"
