:: This is a special setup file for local testing with an active docker (not for use on the NAS)
@echo off
setlocal enabledelayedexpansion

:: Check if the script is running with Administrator privileges
fsutil dirty query %systemdrive% >nul 2>&1
if %errorlevel% neq 0 (
  echo This script must be run as Administrator! >&2
  exit /b 1
)

:: Read .env file and set variables
for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do (
    set "%%a=%%b"
)

:: Check if the base traefik ports are in use (Local listeners only)
netstat -ano | findstr /R /C:"^[ ]*TCP[ ]*[0-9.]*:443 " /C:"^[ ]*TCP[ ]*\[::\]:443 " >nul
if %errorlevel% equ 0 (
  echo Port 443 is in use locally. Please free this port first (see '/dsm_scripts' folder^)
  exit /b 1
)

netstat -ano | findstr /R /C:"^[ ]*TCP[ ]*[0-9.]*:80 " /C:"^[ ]*TCP[ ]*\[::\]:80 " >nul
if %errorlevel% equ 0 (
  echo Port 80 is in use locally. Please free this port first (see '/dsm_scripts' folder^)
  exit /b 1
)

:: Check for presence of certs
if not exist ".\certs\cert.crt" (
  set /p yn="Would you like to generate a self-signed, IP-based certificate for traefik? (y/n): "
  if /i "!yn!"=="y" (
    :: Get Local IP address using PowerShell
    for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -InterfaceAlias 'Wi-Fi', 'Ethernet' -AddressFamily IPv4 | Select-Object -First 1).IPAddress"`) do set LOCAL_IP=%%i

    echo Generating certificate using '!LOCAL_IP!' ...
    if not exist ".\certs" mkdir ".\certs"

    :: Point directly to your User-only Git installation configuration file
    set "OPENSSL_CONF_PATH=%LOCALAPPDATA%\Programs\Git\mingw64\etc\ssl\openssl.cnf"

    openssl req -x509 -newkey rsa:4096 -sha256 -days 365 -nodes ^
      -config "!OPENSSL_CONF_PATH!" ^
      -keyout .\certs\cert.key -out .\certs\cert.crt ^
      -subj "/CN=*.%BASE_DOMAIN%" ^
      -addext "subjectAltName = DNS:*.%BASE_DOMAIN%, DNS:%BASE_DOMAIN%, IP:!LOCAL_IP!"
  )
)

:: Check if Docker background service is running
echo Checking Docker daemon status...
docker info >nul 2>&1
if %errorlevel% neq 0 (
  echo ERROR: The Docker background daemon is not running!
  echo Please start Docker Desktop and try running this script again.
  exit /b 1
)

:: Build SVN docker image
echo Building base SVN image...
docker build -t svn-base -f subversion/Dockerfile.svn-base subversion/

:: Make sure bind directories are created
echo Ensure empty bind dirs exist...
if not exist "%SVN_ROOT%" mkdir "%SVN_ROOT%"
if not exist "%GIT_ROOT%" mkdir "%GIT_ROOT%"
if not exist "%LORE_ROOT%" mkdir "%LORE_ROOT%"
if not exist ".\traefik\logs" mkdir ".\traefik\logs"
if not exist ".\portainer\portainer_data" mkdir ".\portainer\portainer_data"

:: Start the compose services
echo Starting compose services...
docker compose up -d --build

endlocal
