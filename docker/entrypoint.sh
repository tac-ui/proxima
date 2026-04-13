#!/bin/sh
set -e

echo "=== Proxima ==="

# ── Optional runtimes (cached in /data/.runtimes to survive restarts) ──

RUNTIME_CACHE="/data/.runtimes"

if [ -n "$PXM_JAVA_VERSION" ]; then
  JAVA_DIR="${RUNTIME_CACHE}/java-${PXM_JAVA_VERSION}"
  if [ -x "${JAVA_DIR}/bin/java" ]; then
    echo "Java ${PXM_JAVA_VERSION} (cached)"
  else
    ARCH=$(uname -m)
    case "$ARCH" in x86_64) ARCH=x64;; aarch64) ARCH=aarch64;; esac
    echo "Installing Java ${PXM_JAVA_VERSION} (Adoptium Temurin, ${ARCH})..."
    if curl -fsSL -o /tmp/jre.tar.gz \
      "https://api.adoptium.net/v3/binary/latest/${PXM_JAVA_VERSION}/ga/linux/${ARCH}/jre/hotspot/normal/eclipse?project=jdk"; then
      mkdir -p "${JAVA_DIR}"
      tar xzf /tmp/jre.tar.gz -C "${JAVA_DIR}" --strip-components=1
      rm -f /tmp/jre.tar.gz
    else
      echo "Warning: Java ${PXM_JAVA_VERSION} is not available from Adoptium"
    fi
  fi
  if [ -x "${JAVA_DIR}/bin/java" ]; then
    export JAVA_HOME="${JAVA_DIR}"
    export PATH="${JAVA_DIR}/bin:$PATH"
    echo "  $("${JAVA_DIR}/bin/java" -version 2>&1 | head -1)"
  fi
fi

if [ -n "$PXM_PYTHON_VERSION" ]; then
  PYTHON_DIR="${RUNTIME_CACHE}/python-${PXM_PYTHON_VERSION}"
  if [ -x "${PYTHON_DIR}/bin/python3" ]; then
    echo "Python ${PXM_PYTHON_VERSION} (cached)"
    export PATH="${PYTHON_DIR}/bin:$PATH"
    echo "  $("${PYTHON_DIR}/bin/python3" --version)"
  else
    echo "Installing Python ${PXM_PYTHON_VERSION}..."
    INSTALLED=false
    # Try Alpine package first (fastest)
    if apk add --no-cache "python3~=${PXM_PYTHON_VERSION}" py3-pip 2>/dev/null; then
      echo "  $(python3 --version)"
      INSTALLED=true
    else
      # Fallback: build from source (cached for subsequent starts)
      echo "  Alpine package not available, building from source (first start only)..."
      apk add --no-cache python3-dev build-base libffi-dev zlib-dev openssl-dev 2>/dev/null || true
      PYTHON_MINOR=$(echo "$PXM_PYTHON_VERSION" | grep -oE '^[0-9]+\.[0-9]+')
      PYTHON_FULL=$(curl -fsSL "https://www.python.org/ftp/python/" \
        | grep -oE ">${PYTHON_MINOR}\.[0-9]+/" | sed 's/[>/]//g' | sort -V | tail -1)
      if [ -n "$PYTHON_FULL" ] && \
         curl -fsSL -o /tmp/python.tar.xz \
           "https://www.python.org/ftp/python/${PYTHON_FULL}/Python-${PYTHON_FULL}.tar.xz"; then
        cd /tmp && tar xf python.tar.xz && cd "Python-${PYTHON_FULL}"
        ./configure --prefix="${PYTHON_DIR}" --with-ensurepip=install >/dev/null 2>&1
        make -j"$(nproc)" >/dev/null 2>&1 && make install >/dev/null 2>&1
        cd /app && rm -rf /tmp/Python-* /tmp/python.tar.xz
        INSTALLED=true
      fi
    fi
    if [ "$INSTALLED" = true ] && [ -x "${PYTHON_DIR}/bin/python3" ]; then
      export PATH="${PYTHON_DIR}/bin:$PATH"
      echo "  $("${PYTHON_DIR}/bin/python3" --version)"
    elif [ "$INSTALLED" != true ]; then
      echo "  Warning: Python ${PXM_PYTHON_VERSION} not available, using pre-installed $(python3 --version 2>&1)"
    fi
  fi
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
