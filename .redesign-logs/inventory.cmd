@echo off
chcp 65001 >nul
cd /d "%~dp0..\apps\web"
dir /s /b /a-d src > "%~dp0files.txt"
dir /s /b /a-d public >> "%~dp0files.txt"
cd /d "%~dp0.."
git branch --show-current > "%~dp0git.txt" 2>&1
git status --short >> "%~dp0git.txt" 2>&1
git log --oneline -5 >> "%~dp0git.txt" 2>&1
echo DONE > "%~dp0inventory.status"
