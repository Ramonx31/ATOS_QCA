@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "QCA_PY_VERSION="
py -3.12 -c "import struct,sys; sys.exit(0 if struct.calcsize('P') == 8 else 1)" >nul 2>&1
if not errorlevel 1 (
 set "QCA_PY_VERSION=3.12"
 goto criar
)
py -3.11 -c "import struct,sys; sys.exit(0 if struct.calcsize('P') == 8 else 1)" >nul 2>&1
if not errorlevel 1 (
 set "QCA_PY_VERSION=3.11"
 goto criar
)
echo.
echo Esta plataforma precisa de Python 3.12 ou 3.11 de 64 bits.
echo O leitor de prints desta versao nao aceita Python 3.13 ou 3.14.
echo.
echo Instale o Python 3.12 executando este comando no PowerShell:
echo winget install --id Python.Python.3.12 --exact --architecture x64
echo.
echo Depois, feche esta janela e execute INSTALAR.bat novamente.
echo Nao e necessario desinstalar seu Python atual.
pause
exit /b 1
:criar
echo Preparando ambiente exclusivo com Python %QCA_PY_VERSION%...
if exist ".venv-qca\Scripts\python.exe" goto validar
if exist ".venv-qca" goto ambiente_invalido
py -%QCA_PY_VERSION% -m venv .venv-qca
if errorlevel 1 goto erro
:validar
.venv-qca\Scripts\python.exe -c "import sys,struct; sys.exit(0 if sys.version_info[:2] in [(3,11),(3,12)] and struct.calcsize('P') == 8 else 1)"
if errorlevel 1 goto ambiente_invalido
.venv-qca\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 goto erro
echo Verificando dependencias e modelos do leitor de prints...
.venv-qca\Scripts\python.exe -c "from rapidocr_onnxruntime import RapidOCR; from PIL import Image; import openpyxl; RapidOCR(intra_op_num_threads=-1,inter_op_num_threads=-1); print('Leitor de prints verificado.')"
if errorlevel 1 goto erro
echo.
echo Instalacao concluida. Abra INICIAR.bat.
echo Nao e necessario instalar Tesseract OCR.
pause
exit /b 0
:ambiente_invalido
echo O ambiente .venv-qca esta incompleto ou usa um Python incompativel.
echo Extraia o ZIP em uma pasta nova e execute INSTALAR.bat nessa pasta.
echo Nenhum ambiente existente foi removido.
pause
exit /b 1
:erro
echo.
echo Nao foi possivel concluir a instalacao. Envie o erro exibido acima.
pause
exit /b 1
