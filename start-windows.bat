@echo off
cd /d %~dp0
if not exist node_modules (
  echo Pehli baar setup ho raha hai, thoda wait karein...
  call npm install
)
echo.
echo Website: http://localhost:3000
echo Admin  : http://localhost:3000/admin/
echo.
node server.js
pause
