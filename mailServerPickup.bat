@echo off
cd /d "%~dp0"
set "LOGFILE=%~dp0mailpickup.log"
set "PARAM_ONE=%1"
set "PARAM_TWO=%2"

if "%~1"=="" exit /b 1
if "%~2"=="" exit /b 1

echo [%date% %time%] Processing %PARAM_ONE% (%PARAM_TWO%) >> "%LOGFILE%"

curl -s -S -X POST "http://localhost:6245/api/process" ^
  -H "Content-Type: application/json" ^
  -d "{\"messageID\": \"%PARAM_ONE%\", \"queueType\": \"%PARAM_TWO%\"}" >nul 2>&1
if errorlevel 1 (
  curl -s -S -X POST "https://localhost:6245/api/process" -k ^
    -H "Content-Type: application/json" ^
    -d "{\"messageID\": \"%PARAM_ONE%\", \"queueType\": \"%PARAM_TWO%\"}" >nul 2>&1
)
echo [%date% %time%] Done (exit code %ERRORLEVEL%) >> "%LOGFILE%"