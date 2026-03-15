# Deployment Guide

This guide covers how to build and publish Proxima Docker images using GitHub Actions CI/CD.

## Prerequisites

- [Docker Hub](https://hub.docker.com/) account
- GitHub repository with this codebase

## Setup CI/CD

### 1. Create Docker Hub Access Token

1. Go to [Docker Hub > Account Settings > Security](https://hub.docker.com/settings/security)
2. Click **New Access Token**
3. Name: `proxima-ci` (or any name)
4. Permissions: **Read & Write**
5. Copy the generated token

### 2. Add GitHub Secrets

Go to your GitHub repository **Settings > Secrets and variables > Actions** and add:

| Secret | Value |
|--------|-------|
| `DOCKERHUB_USERNAME` | Your Docker Hub username |
| `DOCKERHUB_TOKEN` | The access token from step 1 |

### 3. Create Docker Hub Repository

1. Go to [Docker Hub](https://hub.docker.com/)
2. Click **Create Repository**
3. Name: `proxima`
4. Visibility: Public (or Private)

## Publishing a Release

### Tag and Push

```bash
# Update version in package.json (if not already done)
# e.g., "version": "1.0.0"

# Create a git tag matching the version
git tag v1.0.0

# Push the tag to trigger CI/CD
git push origin v1.0.0
```

The workflow will automatically:
1. Build the Docker image for **linux/amd64** and **linux/arm64**
2. Push to Docker Hub with two tags:
   - `jeonhui/proxima:latest`
   - `jeonhui/proxima:1.0.0`

### Version Bump Workflow

When releasing a new version:

1. Update `package.json` version:
   ```json
   "version": "1.1.0"
   ```

2. Commit and tag:
   ```bash
   git add package.json
   git commit -m "chore: bump version to 1.1.0"
   git tag v1.1.0
   git push origin main --tags
   ```

3. The CI/CD pipeline will build and push `latest` + `1.1.0` tags.

## Manual Docker Build

If you need to build locally without CI/CD:

```bash
# Build
docker build -t jeonhui/proxima:latest .

# Push
docker login
docker push jeonhui/proxima:latest

# Build with version tag
docker build -t jeonhui/proxima:1.0.0 -t jeonhui/proxima:latest .
docker push jeonhui/proxima:1.0.0
docker push jeonhui/proxima:latest
```

## Multi-Platform Build (Local)

```bash
# Create a builder (one-time setup)
docker buildx create --name proxima-builder --use

# Build and push for amd64 + arm64
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t jeonhui/proxima:latest \
  -t jeonhui/proxima:1.0.0 \
  --push .
```

## Monitoring CI/CD

- Check build status: Go to **GitHub > Actions** tab
- Each tag push triggers the **Docker Build & Publish** workflow
- Build logs show each step: checkout, buildx setup, login, build, push

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `denied: requested access to the resource is denied` | Check `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets |
| Build fails on arm64 | Ensure `docker/setup-buildx-action` is using QEMU emulation (included by default) |
| Tag already exists on Docker Hub | Docker Hub allows overwriting tags. The new build will replace the old one. |
| Workflow not triggered | Ensure the tag matches `v*` pattern (e.g., `v1.0.0`, not `1.0.0`) |
