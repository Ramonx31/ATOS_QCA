@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv-qca\Scripts\python.exe" (
 echo Execute o INSTALAR.bat desta versao primeiro.
 pause
 exit /b 1
)
.venv-qca\Scripts\python.exe -c "import sys,struct; sys.exit(0 if sys.version_info[:2] in [(3,11),(3,12)] and struct.calcsize('P') == 8 else 1)"
if errorlevel 1 (
 echo Ambiente incompativel. Execute INSTALAR.bat em uma pasta nova.
 pause
 exit /b 1
)
.venv-qca\Scripts\python.exe app.py
if errorlevel 1 pause
