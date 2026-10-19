@echo off
setlocal EnableExtensions
chcp 65001 >nul

REM ============================================================
REM  Souvari Skin Lab - prerequisite checker (Windows)
REM  Run as Administrator. Reports what is present and what is
REM  missing before setup-server.bat.
REM ============================================================

echo ============================================================
echo  Souvari prereq check
echo ============================================================
echo.

set "MISSING=0"

REM ---- Git ----
where git >nul 2>&1
if errorlevel 1 (
  echo [MISSING] Git        - install from https://git-scm.com
  set /a MISSING+=1
) else (
  for /f "delims=" %%V in ('git --version') do echo [OK]      Git        %%V
)

REM ---- Node ----
where node >nul 2>&1
if errorlevel 1 (
  echo [MISSING] Node.js    - install Node 20.11+ LTS from https://nodejs.org
  set /a MISSING+=1
) else (
  for /f "delims=" %%V in ('node --version') do echo [OK]      Node.js    %%V
  for /f "delims=" %%V in ('npm --version') do echo [OK]      npm        %%V
)

REM ---- MySQL service ----
set "MYSQL_SVC="
for %%S in (MySQL80 MySQL MySQL57 MySQL56 MySQL55) do (
  sc query "%%S" >nul 2>&1 && if not defined MYSQL_SVC set "MYSQL_SVC=%%S"
)
if defined MYSQL_SVC (
  echo [OK]      MySQL      service "%MYSQL_SVC%" found
  sc query "%MYSQL_SVC%" | findstr /I "RUNNING STOPPED START_PENDING"
) else (
  echo [MISSING] MySQL 8    - no MySQL service found.
  echo            Install from https://dev.mysql.com/downloads/installer/
  echo            ^(choose "MySQL Server 8.0"^) or run: choco install mysql
  set /a MISSING+=1
)

REM ---- mysql client on PATH (optional) ----
where mysql >nul 2>&1
if errorlevel 1 (
  echo [INFO]    mysql CLI  - not on PATH ^(optional; the installer usually omits it^)
) else (
  echo [OK]      mysql CLI  - on PATH
)

REM ---- cloudflared (optional) ----
where cloudflared >nul 2>&1
if errorlevel 1 (
  echo [INFO]    cloudflared - not installed yet ^(needed for Step 3^)
) else (
  echo [OK]      cloudflared - installed
)

echo.
if "%MISSING%"=="0" (
  echo All required prerequisites are present.
  echo Next: clone the repo, then run setup-server.bat.
) else (
  echo %MISSING% required prerequisite^(s^) missing. Install them, then re-run this check.
)
echo.
pause
