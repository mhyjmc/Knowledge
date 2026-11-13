@echo off
setlocal
cd /d "%~dp0"
echo Project directory: %CD%
echo.
echo [1/2] TypeScript check
call npm.cmd run typecheck
set "kb_types_exit=%ERRORLEVEL%"
echo.
echo [2/2] API tests
call npm.cmd test
set "kb_tests_exit=%ERRORLEVEL%"
echo.
echo TypeScript exit code: %kb_types_exit%
echo API tests exit code: %kb_tests_exit%
echo Exit code 0 means success.
if not "%~1"=="--no-pause" pause
if not "%kb_types_exit%"=="0" exit /b 1
if not "%kb_tests_exit%"=="0" exit /b 1
exit /b 0
