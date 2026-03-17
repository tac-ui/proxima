# Deploy Proxima

Proxima 프로젝트를 배포합니다. package.json 버전을 업데이트하고, 커밋 & 푸시한 뒤 Git 태그를 생성하여 Docker CI/CD를 트리거합니다.

## Steps

### 1. 버전 확인 및 업데이트

- `package.json`에서 현재 버전을 읽는다.
- 인자가 있으면 (`$ARGUMENTS`) 해당 버전을 사용한다. (예: `1.2.0`)
- 인자가 없으면 현재 버전의 patch를 +1 한다. (예: `1.1.2` → `1.1.3`)
- 사용자에게 새 버전을 확인받은 뒤 `package.json`의 `"version"` 필드를 업데이트한다.

### 2. 빌드 검증

```bash
npx tsc --noEmit
```

타입 체크가 실패하면 중단하고 에러를 보고한다.

### 3. 커밋 & 푸시

- 변경된 파일을 스테이징하고 커밋한다.
- 커밋 메시지: `release: v{version}`
- `main` 브랜치에 push 한다.

### 4. 태그 생성 & 푸시

```bash
git tag v{version}
git push origin v{version}
```

태그 푸시 시 GitHub Actions (`docker-publish.yml`)가 자동으로 Docker 이미지를 빌드하고 `jeonhui/proxima:{version}` + `jeonhui/proxima:latest`로 Docker Hub에 push 한다.

### 5. CI 확인

```bash
gh run list --limit 1
```

워크플로우가 트리거되었는지 확인하고, 실행 URL을 사용자에게 보여준다.

## 완료

배포 요약을 출력한다:
- 이전 버전 → 새 버전
- 태그: `v{version}`
- Docker 이미지: `jeonhui/proxima:{version}`
- CI 실행 URL
