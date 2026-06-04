#!/bin/bash

# Check if the script is running with root/sudo privileges
if [[ $EUID -ne 0 ]]; then
  echo "This script must be run with sudo or as root!" >&2
  exit 1
fi

echo "Building base SVN image..."
docker build -t svn-base -f subversion/Dockerfile.svn-base subversion/

echo "Ensure empty bind dirs exist..."
if [ ! -d "./traefik/logs" ]; then
  mkdir "./traefik/logs"
fi

if [ ! -d "./portainer/portainer_data" ]; then
  mkdir "./portainer/portainer_data"
fi

echo "Starting compose services..."
docker compose up -d --build
