@echo off
chcp 65001 >nul
cd /d "%~dp0..\apps\web\src"
set "OUT=%~dp0audit-%~1.txt"
echo === counts: slate/cyan/emerald/zinc/sky/amber/red/gray/white/black/teal/green/hex per file === > "%OUT%"
for /r %%F in (*.tsx *.ts) do (
  for /f %%C in ('findstr /R /C:"slate-" /C:"cyan-" /C:"emerald-" /C:"zinc-" /C:"sky-" /C:"amber-" /C:"red-[0-9]" /C:"gray-" /C:"teal-" /C:"green-[0-9]" /C:"text-white" /C:"bg-white" /C:"bg-black" /C:"#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]" /C:"brand-[0-9]" /C:"rounded-\[" /C:"rounded-2xl" /C:"rounded-xl" "%%F" ^| find /c /v ""') do (
    if not "%%C"=="0" echo %%C %%F >> "%OUT%"
  )
)
echo === emoji-ish === >> "%OUT%"
findstr /S /N /C:"⏳" /C:"✨" /C:"🚀" /C:"✅" /C:"⚡" /C:"🔒" /C:"💳" /C:"⭐" /C:"🎉" /C:"❌" /C:"⚠" *.tsx >> "%OUT%"
echo DONE >> "%OUT%"
