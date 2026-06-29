@echo off
echo.
echo  ====================================
echo   LiteIDE Setup
echo  ====================================
echo.

echo [1/5] Cleaning old install...
if exist node_modules rmdir /s /q node_modules

echo.
echo [2/5] Installing packages (no scripts)...
call npm install --ignore-scripts
if %errorlevel% neq 0 ( echo ERROR: npm install failed & pause & exit /b 1 )

echo.
echo [3/5] Downloading Electron binary...
call node node_modules/electron/install.js

echo.
echo [4/5] Fixing security + approving scripts...
call npm audit fix --force
call npm approve-scripts electron
call npm approve-scripts node-pty
call npm approve-scripts electron-winstaller
call npm install electron
call node node_modules/electron/install.js

echo.
echo [5/5] Building native terminal (node-pty)...
set GYP_MSVS_VERSION=2026
set GYP_MSVS_OVERRIDE_PATH=C:\Program Files\Microsoft Visual Studio\18\Community
call npx electron-rebuild -f -w node-pty
if %errorlevel% neq 0 (
    echo WARNING: node-pty build failed - terminal still works with fallback
)

echo.
echo  ====================================
echo   Setup complete!
echo.
echo   To run:   npm start
echo   To build: npm run dist
echo  ====================================
echo.
pause
