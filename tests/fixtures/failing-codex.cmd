@echo off
if "%1"=="mcp" if "%2"=="add" exit /b 23
call "%REAL_CODEX_COMMAND%" %*
