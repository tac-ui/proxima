#!/bin/sh
set -e

echo "=== Proxima ==="
echo "Starting Proxima server on port $PXM_PORT..."
exec npx tsx server.ts
