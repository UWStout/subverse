#!/bin/bash

# Check if the script is running with root/sudo privileges
if [[ $EUID -ne 0 ]]; then
  echo "This script must be run with sudo or as root!" >&2
  exit 1
fi

# Check for presence of the root data folder
if [ ! -d "/volume1/subverse-data" ]; then
  echo "The subverse root data folder could not be found."
  echo "Please ensure '/volume1/subverse-data' exists and try again"
  exit 1
fi

# Check if the base traefik ports are in use
if netstat -tulpn | grep -E -q "(:|\])443 "; then
  echo "Port 443 is in use. Please free this port first (see '/dsm_scripts' folder)"
  exit 1
fi

if netstat -tulpn | grep -E -q "(:|\])80 "; then
  echo "Port 80 is in use. Please free this port first (see '/dsm_scripts' folder)"
  exit 1
fi

# Check for required environment file
if [ ! -f "./traefik/.secrets.env" ]; then
  read -p "The './traefik/.secrets.env' file must exist first. Would you like to create an empty one? (y/n): " yn
  case $yn in
    [Yy]*)
      touch "./traefik/.secrets.env"
      ;;
    *)
      echo "Aborting setup."
      exit 1
      ;;
  esac
fi

# Check for presence of certs
if [ ! -f "./traefik/certs/cert.crt" ]; then
  read -p "Would you like to generate a self-signed, IP-based certificate for traefik? (y/n): " yn
  case $yn in
    [Yy]*)
      LOCAL_IP=$(ip route get 1.1.1.1 | grep -oP 'src \K\S+')
      echo "Generating certificate using '${LOCAL_IP}' ..."
      mkdir -p ./traefik/certs
      openssl req -x509 -newkey rsa:4096 -sha256 -days 365 -nodes \
        -keyout ./traefik/certs/cert.key -out ./traefik/certs/cert.crt \
        -subj "/CN=*.subverse" \
        -addext "subjectAltName = DNS:*.subverse, DNS:subverse, IP:${LOCAL_IP}"
      ;;
  esac
fi

# Build SVN docker image
echo "Building base SVN image..."
docker build -t svn-base -f subversion/Dockerfile.svn-base subversion/

# Make sure bind directories are created
echo "Ensure empty bind dirs exist..."
if [ ! -d "/volume1/subverse-data/svn-root" ]; then
  mkdir "/volume1/subverse-data/svn-root"
fi

if [ ! -d "/volume1/subverse-data/git-root" ]; then
  mkdir "/volume1/subverse-data/git-root"
fi

if [ ! -d "./traefik/logs" ]; then
  mkdir "./traefik/logs"
fi

if [ ! -d "./portainer/portainer_data" ]; then
  mkdir "./portainer/portainer_data"
fi

# Start the compose services
echo "Starting compose services..."
docker compose up -d --build
