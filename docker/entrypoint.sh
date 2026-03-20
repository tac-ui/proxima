#!/bin/sh
set -e

echo "=== Proxima ==="

# Determine target UID/GID: PUID/PGID env vars take priority, then /data owner detection
TARGET_UID="${PUID:-}"
TARGET_GID="${PGID:-}"

if [ -z "$TARGET_UID" ] && [ -d "/data" ]; then
  TARGET_UID=$(stat -c '%u' /data 2>/dev/null || echo "0")
  TARGET_GID=$(stat -c '%g' /data 2>/dev/null || echo "0")
fi

TARGET_GID="${TARGET_GID:-0}"

if [ -n "$TARGET_UID" ] && [ "$TARGET_UID" != "0" ]; then
  echo "Matching UID:GID to $TARGET_UID:$TARGET_GID"
  addgroup -g "$TARGET_GID" -S proxima 2>/dev/null || true
  adduser -u "$TARGET_UID" -G proxima -S -D -H proxima 2>/dev/null || true

  # Grant access to Docker socket
  if [ -S /var/run/docker.sock ]; then
    DOCKER_GID=$(stat -c '%g' /var/run/docker.sock 2>/dev/null || echo "")
    if [ -n "$DOCKER_GID" ]; then
      addgroup -g "$DOCKER_GID" -S hostdocker 2>/dev/null || true
      addgroup proxima hostdocker 2>/dev/null || true
    fi
  fi

  chown -R "$TARGET_UID:$TARGET_GID" /data 2>/dev/null || true
  echo "Starting Proxima server on port $PXM_PORT as UID $TARGET_UID..."
  exec su-exec proxima npx tsx server.ts
fi

echo "Starting Proxima server on port $PXM_PORT..."
exec npx tsx server.ts
