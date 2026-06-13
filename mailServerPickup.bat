@echo off
cd /d "%~dp0"
set "LOGFILE=%~dp0mailpickup.log"
set "PARAM_ONE=%1"
set "PARAM_TWO=%2"

if "%~1"=="" (
  echo Usage: %~nx0 messageID queueType >> "%LOGFILE%" 2>&1
  exit /b 1
)
if "%~2"=="" (
  echo Usage: %~nx0 messageID queueType >> "%LOGFILE%" 2>&1
  exit /b 1
)

echo [%date% %time%] Running %~nx0 "%~1" "%~2" >> "%LOGFILE%"

rem Try HTTP first; if it fails (e.g. SSL-only server), retry with HTTPS
curl -X POST "http://localhost:6245/api/process" ^
  -H "Content-Type: application/json" ^
  -d "{\"messageID\": \"%PARAM_ONE%\", \"queueType\": \"%PARAM_TWO%\"}" >> "%LOGFILE%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] HTTP failed, retrying with HTTPS >> "%LOGFILE%"
  curl -X POST "https://localhost:6245/api/process" -k -s -S ^
    -H "Content-Type: application/json" ^
    -d "{\"messageID\": \"%PARAM_ONE%\", \"queueType\": \"%PARAM_TWO%\"}" >> "%LOGFILE%" 2>&1
)
set "EXITCODE=%ERRORLEVEL%"
echo [%date% %time%] Exit code %EXITCODE% >> "%LOGFILE%"
exit /b %EXITCODE%