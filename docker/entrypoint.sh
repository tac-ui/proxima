#!/bin/sh
set -e

echo "=== Proxima ==="

# Match container user to host UID/GID of /data mount
if [ -d "/data" ]; then
  HOST_UID=$(stat -c '%u' /data 2>/dev/null || echo "0")
  HOST_GID=$(stat -c '%g' /data 2>/dev/null || echo "0")

  if [ "$HOST_UID" != "0" ]; then
    echo "Matching UID:GID to /data owner ($HOST_UID:$HOST_GID)"
    addgroup -g "$HOST_GID" -S proxima 2>/dev/null || true
    adduser -u "$HOST_UID" -G proxima -S -D -H proxima 2>/dev/null || true

    # Grant access to Docker socket
    if [ -S /var/run/docker.sock ]; then
      DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
      addgroup -g "$DOCKER_GID" -S hostdocker 2>/dev/null || true
      addgroup proxima hostdocker 2>/dev/null || true
    fi

    chown -R "$HOST_UID:$HOST_GID" /data /app 2>/dev/null || true
    echo "Starting Proxima server on port $PXM_PORT as UID $HOST_UID..."
    exec su-exec "$HOST_UID:$HOST_GID" npx tsx server.ts
  fi
fi

echo "Starting Proxima server on port $PXM_PORT..."
exec npx tsx server.ts
