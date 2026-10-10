@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
node "%~dp0scripts\set-password.mjs"
pause
