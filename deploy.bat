@echo off
cd /d C:\Users\peter\Dropbox\Development\TimerApp
set /p msg="What changed? "
git add .
git commit -m "%msg%"
git push
echo.
echo Done! Render will auto-deploy shortly.
echo.
pause
