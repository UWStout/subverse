#!/bin/bash
echo "Building base SVN image..."
docker build -t svn-base -f subversion/Dockerfile.svn-base subversion/

echo "Starting services..."
docker compose up -d --build
