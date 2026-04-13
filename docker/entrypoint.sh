#!/bin/sh
set -e

echo "=== Proxima ==="

# ── Optional runtimes (installed as root before privilege drop) ──
if [ -n "$PXM_JAVA_VERSION" ]; then
  PKG="openjdk${PXM_JAVA_VERSION}-jre"
  echo "Installing Java ${PXM_JAVA_VERSION} (${PKG})..."
  apk add --no-cache "$PKG" \
    && echo "  JAVA_HOME=$(dirname $(dirname $(readlink -f $(which java))))" \
    || echo "Warning: failed to install ${PKG} — check available versions (8, 11, 17, 21)"
fi

if [ -n "$PXM_PYTHON_VERSION" ]; then
  # Alpine uses 'python3' for 3.x; specific minor versions use 'python3~=3.xx'
  echo "Installing Python ${PXM_PYTHON_VERSION}..."
  apk add --no-cache "python3~=${PXM_PYTHON_VERSION}" py3-pip \
    && echo "  $(python3 --version)" \
    || echo "Warning: failed to install Python ${PXM_PYTHON_VERSION} — check available versions for this Alpine release"
fi

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
  adduser -u "$TARGET_UID" -G proxima -S -D -h /home/proxima proxima 2>/dev/null || true
  mkdir -p /home/proxima
  chown "$TARGET_UID:$TARGET_GID" /home/proxima 2>/dev/null || true

  # Grant access to Docker socket
  if [ -S /var/run/docker.sock ]; then
    DOCKER_GID=$(stat -c '%g' /var/run/docker.sock 2>/dev/null || echo "")
    if [ -n "$DOCKER_GID" ]; then
      addgroup -g "$DOCKER_GID" -S hostdocker 2>/dev/null || true
      addgroup proxima hostdocker 2>/dev/null || true
    fi
  fi

  chown -R "$TARGET_UID:$TARGET_GID" /data 2>/dev/null || true

  # Run user init scripts if /data/init.d/ exists
  if [ -d /data/init.d ]; then
    for script in /data/init.d/*.sh; do
      [ -f "$script" ] || continue
      echo "Running init script: $(basename "$script")"
      su-exec proxima /bin/bash "$script" || echo "Warning: $(basename "$script") failed"
    done
  fi

  echo "Starting Proxima server on port $PXM_PORT as UID $TARGET_UID..."
  exec su-exec proxima npx tsx server.ts
fi

echo "Starting Proxima server on port $PXM_PORT..."
exec npx tsx server.ts
