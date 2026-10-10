#!/bin/sh
# Entrypoint for the production stage.
#
# Named volumes are initialized by Docker as root-owned (0755) on the VM's
# native filesystem, so the unprivileged 'node' user cannot create the SQLite
# database file inside them (Prisma reports this as SQLITE_CANTOPEN). This
# script runs as root to fix ownership of the data directory - including any
# files a previous root run may have left behind - then drops privileges to
# the 'node' user for the actual application process.
set -e

DATA_DIR="/usr/src/app/data"
mkdir -p "$DATA_DIR"
chown -R node:node "$DATA_DIR"

# Initialize (or upgrade) the database schema before starting the app.
# `prisma db push` is idempotent, so this is a no-op when the schema already
# matches. It runs unconditionally - not just when the DB file is missing - so
# deploying a new image with schema changes upgrades an existing volume on
# boot. Runs as 'node' so any files it creates are owned by the app user.
gosu node npm run db:push

# Docker socket access for server/docker.js (SVN container sync). The app
# runs as unprivileged 'node', but a bind-mounted docker socket keeps its
# host ownership and permissions - typically root:root or root:docker with
# mode 0660 - so 'node' usually cannot connect to it directly (EACCES). When
# that is the case, proxy the socket through a root-run socat listener owned
# by 'node' and point dockerode at it via DOCKER_HOST. When the socket is
# already accessible to 'node' (for example because the service was granted
# the host's docker group), this is skipped and the default path is used.
if [ -z "${DOCKER_HOST:-}" ] && [ -S /var/run/docker.sock ] \
    && ! gosu node test -w /var/run/docker.sock 2>/dev/null; then
    echo "docker socket not accessible to 'node'; starting socat proxy" >&2
    if command -v socat >/dev/null 2>&1; then
        socat UNIX-LISTEN:/tmp/docker-proxy.sock,mode=600,user=node,fork,reuseaddr \
            UNIX-CONNECT:/var/run/docker.sock &
        SOCAT_PID=$!
        sleep 0.2
        if ! kill -0 "$SOCAT_PID" 2>/dev/null; then
            echo "ERROR: socat proxy failed to start; SVN sync will not work" >&2
            exit 1
        fi
        export DOCKER_HOST=unix:///tmp/docker-proxy.sock
    else
        echo "WARNING: socat is not installed; SVN sync will fail with EACCES" >&2
    fi
fi

exec gosu node "$@"
