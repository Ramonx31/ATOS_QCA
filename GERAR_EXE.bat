@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv-qca\Scripts\python.exe" goto erro
.venv-qca\Scripts\python.exe -m pip install "pyinstaller>=6,<7"
if errorlevel 1 goto erro
.venv-qca\Scripts\python.exe -m PyInstaller --noconfirm --clean --onefile --name QCA_Atos --add-data "static;static" --add-data "exemplo;exemplo" --add-data "data;data" --collect-all rapidocr_onnxruntime --collect-all onnxruntime --collect-all pyclipper --collect-all shapely app.py
if errorlevel 1 goto erro
echo Executavel criado em dist\QCA_Atos.exe
echo Os modelos do leitor de prints estao incluidos no executavel.
pause
exit /b 0
:erro
echo Falha na geracao. Execute INSTALAR.bat e confira a mensagem acima.
pause
exit /b 1
