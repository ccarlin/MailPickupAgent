@echo off
rem Run the MailPickupAgent Node.js app with header and message files
cd /d "%~dp0"
set "LOGFILE=%~dp0mailpickup.log"
if "%~1"=="" (
  echo Usage: %~nx0 header-file message-file >> "%LOGFILE%" 2>&1
  exit /b 1
)
if "%~2"=="" (
  echo Usage: %~nx0 header-file message-file >> "%LOGFILE%" 2>&1
  exit /b 1
)
echo [%date% %time%] Running %~nx0 "%~1" "%~2" >> "%LOGFILE%"
node "%~dp0index.js" "%~1" "%~2" >> "%LOGFILE%" 2>&1
set "EXITCODE=%ERRORLEVEL%"
echo [%date% %time%] Exit code %EXITCODE% >> "%LOGFILE%"
exit /b %EXITCODE%
