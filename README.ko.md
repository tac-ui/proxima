<p align="center">
  <img src="public/logo.svg" width="80" height="80" alt="Proxima" />
</p>

<h1 align="center">Proxima</h1>

<p align="center">
  셀프 호스팅을 위한 올인원 클라우드 인프라 컨트롤 패널.<br/>
  Docker Compose 스택 관리, Cloudflare Tunnel 리버스 프록시, Analytics, Git 기반 배포를 하나의 웹 UI에서 통합 관리합니다.
</p>

<p align="center">
  <a href="README.md">English</a>
</p>

---

## 기능

- **Docker 스택 관리** — Docker Compose 스택 배포, 시작, 중지, 재시작, 삭제. 브라우저에서 Compose YAML과 `.env` 파일 편집. 실시간 컨테이너 상태, 로그, 웹 터미널 접속.
- **리버스 프록시 (Cloudflare Tunnel)** — Cloudflare Tunnel을 통한 도메인 라우팅. DNS CNAME 자동 관리 및 Tunnel Ingress 자동 동기화. SSL은 Cloudflare Edge에서 종료 — 로컬 인증서 관리 불필요.
- **Analytics** — Cloudflare GraphQL Analytics API 기반 트래픽 분석. 요청 수, 대역폭, 캐시 히트율, 국가별 트래픽 조회.
- **Git 클론 & 배포** — HTTPS 또는 SSH로 저장소 클론, `docker-compose` 파일 자동 탐지, 원클릭 스택 배포. SSH 키 관리 및 저장소별 커스텀 스크립트 실행.
- **웹 터미널** — 브라우저에서 인터랙티브 쉘 세션. 탭 기반 멀티 세션 지원 (xterm.js + WebSocket PTY).
- **네트워크 디스커버리** — 실행 중인 Docker 컨테이너와 내부 IP/포트 자동 탐지. 프록시 타겟 자동 제안.
- **사용자 관리** — 역할 기반 접근 제어 (Admin / Manager / Viewer). JWT 인증. 최초 실행 시 설정 마법사.
- **감사 로그** — 모든 사용자 활동 추적, 카테고리/날짜 필터링. 90일 자동 정리. Admin 전용.
- **커맨드 팔레트** — `Cmd+K` / `Ctrl+K`로 빠른 페이지 검색 및 이동.
- **브랜딩 & Open Graph** — 설정 페이지에서 앱 이름, 로고, 파비콘, Open Graph 메타데이터 커스터마이징.

---

## 빠른 시작

### 사전 요구 사항

- Docker 및 Docker Compose 설치
- Cloudflare 계정 (Tunnel 기반 리버스 프록시 사용 시)

### 설치

1. `compose.yaml` 파일을 생성합니다:

```yaml
services:
  proxima:
    image: jeonhui/proxima:latest
    container_name: proxima
    restart: unless-stopped
    pid: host  # 선택: 호스트 프로세스 탐지 활성화
    ports:
      - "20222:20222"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - pxm-data:/data
      - pxm-stacks:/data/stacks
    networks:
      - pxm-network

networks:
  pxm-network:
    name: pxm-network

volumes:
  pxm-data:
  pxm-stacks:
```

2. 컨테이너를 실행합니다:

```bash
docker compose up -d
```

3. 브라우저에서 `http://<서버 IP>:20222`에 접속합니다.

4. 설정 마법사가 표시되면 첫 번째 관리자 계정을 생성합니다.

> **기존 리버스 프록시를 사용 중인 경우**, 포트 `20222`만 열고 기존 프록시에서 `localhost:20222`로 포워딩하세요.

---

## 사용 방법

### 스택

**Stacks** 메뉴에서 Docker Compose 스택을 관리합니다.

- **Deploy Stack**을 클릭하여 Compose YAML로 새 스택 생성
- 스택 상세 페이지에서 Compose 파일과 환경변수 편집
- **Logs** 탭에서 실시간 로그 스트리밍
- **Terminal** 탭에서 컨테이너 내부 접속

### 라우트

**Routes** 메뉴에서 Cloudflare Tunnel 기반 리버스 프록시를 설정합니다.

1. **Settings > Cloudflare**에서 API 토큰, Zone ID, Tunnel 토큰 설정
2. 도메인과 내부 서비스를 연결하는 프록시 호스트 생성
3. DNS CNAME 레코드와 Tunnel Ingress 규칙이 자동 동기화

### 프로젝트

**Projects** 메뉴에서 Git 저장소를 클론하고 배포합니다.

- HTTPS 또는 SSH로 클론 (SSH 키는 **SSH Keys**에서 관리)
- 클론된 저장소에서 `docker-compose` 파일 자동 탐지
- 탐지된 Compose 파일을 원클릭으로 스택 배포
- 저장소별 커스텀 스크립트 등록 및 실행

### 터미널

**Terminal** 메뉴에서 독립 쉘 세션을 사용합니다.

- 여러 터미널 탭 생성 가능
- xterm.js 기반 인터랙티브 쉘

### 설정

- **Appearance** — 라이트, 다크, 시스템 테마 전환
- **Branding** — 앱 이름, 로고, 파비콘, Open Graph 메타데이터 커스터마이징
- **Cloudflare** — API 자격 증명 및 Tunnel 설정

### 사용자 역할

| 역할 | 권한 |
|------|------|
| **Admin** | 전체 접근. 사용자 관리, 감사 로그, 모든 설정. |
| **Manager** | 스택, 라우트, 프로젝트, 터미널, 브랜딩 관리. |
| **Viewer** | 스택, 라우트, 프로젝트 읽기 전용. |

---

## 설정

### 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PXM_PORT` | `20222` | 서버 포트 |
| `PXM_DATA_DIR` | `/data` | 데이터 루트 디렉토리 |
| `PXM_STACKS_DIR` | `/data/stacks` | 스택 파일 저장 경로 |
| `PXM_HOST_DATA_DIR` | `PXM_DATA_DIR`과 동일 | 호스트 데이터 경로 (Cloudflare Tunnel bind mount에 필요) |

### 볼륨

| 경로 | 설명 |
|------|------|
| `/var/run/docker.sock` | Docker 소켓 (컨테이너 관리에 필수) |
| `/data` | 모든 설정 및 데이터베이스 파일 |
| `/data/stacks` | Docker Compose 스택 파일 |

---

## 개발

```bash
# 의존성 설치
npm install

# 개발 서버 실행 (Next.js + WebSocket 서버)
npm run dev
```

| 명령어 | 설명 |
|--------|------|
| `npm run dev` | 개발 서버 실행 (tsx로 커스텀 서버 구동) |
| `npm run build` | 프로덕션 빌드 (Next.js standalone 출력) |
| `npm run start` | 프로덕션 빌드 실행 |

### 아키텍처

Proxima는 단일 Node.js 프로세스로 실행됩니다 — Next.js를 감싼 커스텀 HTTP 서버에 터미널 연결을 위한 WebSocket 서버가 포함되어 있습니다. 별도의 백엔드 프로세스가 없습니다.

| 계층 | 기술 |
|------|------|
| 프론트엔드 | Next.js 15, React 19, TypeScript, Tailwind CSS 4, @tac-ui/web |
| 백엔드 | Next.js API Routes, Drizzle ORM, Better-SQLite3 |
| 실시간 | Server-Sent Events (SSE), WebSocket |
| 터미널 | xterm.js, node-pty |
| 인프라 | Docker / Docker Compose, Cloudflare Tunnel |
| 분석 | Cloudflare GraphQL Analytics API |

---

## 라이선스

이 프로젝트는 독점 소프트웨어입니다. 모든 권리 보유.
