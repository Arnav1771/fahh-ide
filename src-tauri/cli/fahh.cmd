@echo off
rem fahh: open files and folders in Fahh Editor, e.g. fahh . or fahh folder or fahh file:line
rem Starts the editor detached and returns the prompt at once. Lives in <install dir>\bin.
if /i "%~1"=="agent" goto agent
start "" "%~dp0..\fahh-editor.exe" %*
exit /b 0

:agent
if not exist "%~dp0fahh-agent.exe" (
  echo fahh: 'fahh-agent' is not installed 1>&2
  exit /b 1
)
set "ARGS="
shift
:next
if "%~1"=="" goto run
set ARGS=%ARGS% %1
shift
goto next
:run
"%~dp0fahh-agent.exe"%ARGS%
exit /b %errorlevel%
