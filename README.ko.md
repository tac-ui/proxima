<p align="center">
  <img src="public/logo.svg" width="80" height="80" alt="Proxima" />
</p>

<h1 align="center">Proxima</h1>

<p align="center">
  셀프 호스팅을 위한 올인원 클라우드 인프라 컨트롤 패널.<br/>
  Docker Compose 스택 관리, Cloudflare Tunnel 리버스 프록시, Analytics, Git 기반 배포, AI 어시스턴트를 하나의 웹 UI에서 통합 관리합니다.
</p>

<p align="center">
  <a href="README.md">English</a>
</p>

---

## 기능

- **Docker 스택 관리** — Docker Compose 스택 배포, 시작, 중지, 재시작, 삭제. 브라우저에서 Compose YAML과 `.env` 파일 편집. 실시간 컨테이너 상태, 로그, 웹 터미널 접속.
- **리버스 프록시 (Cloudflare Tunnel)** — Cloudflare Tunnel을 통한 도메인 라우팅. DNS CNAME 자동 관리 및 Tunnel Ingress 자동 동기화. SSL은 Cloudflare Edge에서 종료 — 로컬 인증서 관리 불필요.
- **Analytics** — Cloudflare GraphQL Analytics API 기반 트래픽 분석. 요청 수, 대역폭, 캐시 히트율, 국가별 트래픽 조회.
- **Git 프로젝트 & Run Script** — HTTPS 또는 SSH로 저장소 클론, 저장소별 SSH 키 관리, 커스텀 실행 스크립트 등록, 실행 중인 서비스에 도메인 직접 연결. 개발/스테이징 환경에 적합.
- **OpenClaw AI 어시스턴트** — [OpenClaw](https://github.com/openclaw/openclaw) 기반 내장형 개인 AI 어시스턴트. AI 모델과 채팅 (OpenAI, Anthropic, Google, DeepSeek, xAI 등), 메시징 채널 연결 (Telegram, Discord, Slack, WhatsApp, Signal, Matrix), Proxima 대시보드에서 모든 설정 관리.
- **웹 터미널** — 브라우저에서 인터랙티브 쉘 세션. 탭 기반 멀티 세션 지원 (xterm.js + WebSocket PTY).
- **서버 디스커버리** — 실행 중인 Docker 컨테이너와 호스트 프로세스 자동 탐지. 프로세스 별칭 설정, 서비스 추적, 프록시 타겟 자동 제안.
- **헬스 체크** — 설정 가능한 간격으로 도메인 상태 모니터링. Slack, Telegram으로 알림 발송.
- **시스템 모니터링** — 실시간 CPU, 메모리, 디스크 사용량 모니터링 및 히스토리 차트.
- **사용자 관리** — 역할 기반 접근 제어 (Admin / Manager / Viewer). JWT 인증. 최초 실행 시 설정 마법사.
- **감사 로그** — 모든 사용자 활동 추적, 카테고리/날짜 필터링. 90일 자동 정리. Admin 전용.
- **알림** — Slack, Telegram 알림 채널 설정. 도메인 기반 필터링 및 테스트 기능.
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
    pid: host
    network_mode: host
    environment:
      - PUID=1000  # 호스트 사용자 ID (확인: id -u)
      - PGID=1000  # 호스트 그룹 ID (확인: id -g)
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - pxm-data:/data
      - pxm-stacks:/data/stacks

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

> **참고:** `network_mode: host`를 권장합니다. Proxima와 Cloudflare Tunnel이 호스트 네트워크를 공유하여 `localhost` 라우팅이 바로 동작합니다. 포트 매핑 불필요 — 포트 `20222`가 호스트에 자동으로 노출됩니다.
>
> **방화벽:** iptables 또는 클라우드 보안 그룹을 사용하는 경우, 포트 `20222` TCP 인바운드를 허용해야 합니다.

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

1. **Settings > Cloudflare**에서 API 토큰, Zone, Tunnel 토큰 설정
2. 도메인과 내부 서비스를 연결하는 라우트 생성
3. DNS CNAME 레코드와 Tunnel Ingress 규칙이 자동 동기화

> **중요:** 모든 터널 라우트는 Proxima에서만 관리하세요. Cloudflare 대시보드에서 직접 추가한 라우트는 Proxima 동기화 시 덮어쓰기됩니다.

#### Cloudflare API 토큰 권한

| 리소스 | 권한 |
|--------|------|
| Zone - DNS | **편집** |
| Zone - Zone | **읽기** |
| Zone - Analytics | 읽기 (선택, 대시보드 분석용) |
| Account - Cloudflare Tunnel | **편집** |

Zone Resources는 대상 zone 또는 "모든 영역"으로 설정해야 합니다.

### 프로젝트

**Projects** 메뉴에서 Git 저장소를 클론하고 서비스를 실행합니다.

- HTTPS 또는 SSH로 클론 (SSH 키는 **SSH Keys**에서 관리)
- 각 저장소는 사용한 SSH 키를 기억 — Pull, Checkout, Branch 조회 시 올바른 키를 자동으로 사용
- **기존 저장소 Import** — **Import** 버튼으로 `/data/stacks/`에 이미 있는 git 저장소를 등록 (예: 터미널에서 clone한 프로젝트)
- 저장소별 커스텀 **실행 스크립트** (쉘 스크립트) 등록
- 실행 스크립트로 Proxima 컨테이너 내부에서 서비스 시작 (예: `npx next dev -p 3000`)
- **Domain** 탭에서 도메인 연결 — 포트만 입력, 호스트는 자동으로 `localhost`
- **삭제** 시 Proxima 등록과 디스크 파일 모두 제거 (확인 모달 표시)

#### 도메인 연결 (프로젝트)

1. 프로젝트를 열고 **Domain** 탭으로 이동
2. 서브도메인 입력 (비워두면 프로젝트 이름 사용) 후 Zone 선택
3. 서비스가 실행되는 포트 입력 (예: `3000`)
4. **Connect Domain** 클릭 — DNS와 터널 인그레스가 자동 설정
5. 필요 시 **Use root domain** 체크로 zone 도메인 직접 사용 (예: `example.com`)

### OpenClaw AI 어시스턴트

**OpenClaw** 메뉴에서 개인 AI 어시스턴트를 설정하고 사용합니다.

#### 최초 설정

1. **OpenClaw** 페이지로 이동 — 온보딩 마법사가 표시됩니다
2. AI 프로바이더 선택 (Anthropic, OpenAI, Google, OpenRouter)
3. API 키를 붙여넣고 **Start OpenClaw** 클릭
4. 게이트웨이가 자동으로 시작 — 바로 채팅 가능

#### 대시보드 기능

- **채팅 세션** — 세션 생성 후 클릭하면 스트리밍 응답이 지원되는 전체 페이지 채팅
- **채널** — 메시징 플랫폼 연결 (Telegram, Discord, Slack, WhatsApp, Signal, Matrix) 가이드 위저드 제공
- **모델 선택** — 드롭다운에서 기본 AI 모델 즉시 변경
- **API 키** — 13개 이상의 프로바이더 자격 증명 관리 (OpenAI, Anthropic, Google Gemini, OpenRouter, DeepSeek, xAI, Groq, Mistral, Fireworks, Perplexity, Ollama, Azure OpenAI, Cloudflare AI Gateway)
- **설정** — Agent 설정 (시스템 프롬프트, 사고 수준, 메모리), 채널 정책 (DM/그룹 접근 제어), Git 작업용 SSH 키, 전체 JSON 설정 에디터
- **사용량** — 토큰 사용량 및 비용 추적

#### 동작 방식

OpenClaw는 통합 자식 프로세스로 실행됩니다 (Docker 불필요). 활성화 시 자동으로 시작되고, 크래시 시 최대 5회까지 자동 재시작(백오프 적용)되며, 서버 종료 시 정상적으로 함께 종료됩니다. 모든 설정은 Proxima 웹 UI에서 관리합니다.

### 서버

**Servers** 메뉴에서 실행 중인 컨테이너와 호스트 프로세스를 확인합니다.

- **Containers** 탭 — 모든 Docker 컨테이너와 포트, 네트워크, 볼륨 정보
- **Processes** 탭 — 호스트의 TCP 리스닝 프로세스
- 별표(추적)로 서비스를 표시하면 라우트 생성 시 서비스 검색에 노출
- 추적된 프로세스에 **별칭** 설정 — 라우트 생성 시 쉽게 식별 가능

### 터미널

**Terminal** 메뉴에서 독립 쉘 세션을 사용합니다.

- 여러 터미널 탭 생성 가능
- xterm.js 기반 인터랙티브 쉘

> **참고:** 호스트 쉘 접근은 **Admin** 역할이 필요합니다.

### 설정

- **Appearance** — 라이트, 다크, 시스템 테마 전환
- **Branding** — 앱 이름, 로고, 파비콘, Open Graph 메타데이터 커스터마이징
- **Notifications** — Slack, Telegram 알림 채널 설정. 도메인 기반 필터링
- **OpenClaw** — AI 어시스턴트 활성화/비활성화 (설정은 OpenClaw 대시보드에서)
- **Cloudflare** — API 자격 증명, Zone, Tunnel 설정
- **Users** — 사용자 및 역할 관리 (Admin 전용)
- **Audit Logs** — 전체 활동 로그 조회 (Admin 전용)

### 사용자 역할

| 역할 | 권한 |
|------|------|
| **Admin** | 전체 접근. 사용자 관리, 호스트 쉘, 감사 로그, 모든 설정. |
| **Manager** | 스택, 라우트, 프로젝트, 터미널, OpenClaw, 브랜딩 관리. |
| **Viewer** | 스택, 라우트, 프로젝트 읽기 전용. |

---

## 설정

### 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PXM_PORT` | `20222` | 서버 포트 |
| `PXM_HOSTNAME` | `0.0.0.0` | 서버 바인드 주소 |
| `PXM_DATA_DIR` | `/data` | 데이터 루트 디렉토리 |
| `PXM_STACKS_DIR` | `/data/stacks` | 스택 파일 저장 경로 |
| `PUID` | *(자동 감지)* | 이 사용자 ID로 실행. 미설정 시 `/data` 마운트 소유자에서 감지. |
| `PGID` | *(자동 감지)* | 이 그룹 ID로 실행. 미설정 시 `/data` 마운트 소유자에서 감지. |

### 볼륨

| 경로 | 설명 |
|------|------|
| `/var/run/docker.sock` | Docker 소켓 (컨테이너 관리에 필수) |
| `/data` | 모든 설정 및 데이터베이스 파일 |
| `/data/stacks` | Docker Compose 스택 파일 |
| `/data/openclaw` | OpenClaw 게이트웨이 상태 및 세션 데이터 |
| `/data/init.d/` | 사용자 초기화 스크립트 (`.sh` 파일, 컨테이너 시작 시 proxima 유저로 실행) |

### Init 스크립트

`/data/init.d/`에 `.sh` 파일을 넣으면 컨테이너 시작 시 자동 실행됩니다. bash로 proxima 유저 권한으로 실행됩니다.

예시 — Claude Code CLI 설치:
```bash
mkdir -p /path/to/data/init.d
cat > /path/to/data/init.d/01-claude.sh << 'EOF'
#!/bin/bash
# /data 볼륨에 claude 데이터 보존
mkdir -p /data/.claude /data/.local
ln -sfn /data/.claude "$HOME/.claude"
ln -sfn /data/.local "$HOME/.local"

# .claude.json 설정 파일 보존
[ -f /data/.claude.json ] || touch /data/.claude.json
ln -sfn /data/.claude.json "$HOME/.claude.json"

# local bin을 PATH에 영구 추가
grep -q '.local/bin' "$HOME/.bashrc" 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
export PATH="$HOME/.local/bin:$PATH"

# Claude Code가 없으면 설치
if ! command -v claude >/dev/null 2>&1; then
  curl -fsSL https://claude.ai/install.sh | /bin/bash
fi
EOF
```

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
| `npm run lint` | ESLint 코드 검사 |
| `npm run format` | Prettier 코드 포맷팅 |

### 아키텍처

Proxima는 단일 Node.js 프로세스로 실행됩니다 — Next.js를 감싼 커스텀 HTTP 서버에 터미널 연결을 위한 WebSocket 서버가 포함되어 있습니다. OpenClaw는 Proxima가 관리하는 통합 자식 프로세스로 실행됩니다.

| 계층 | 기술 |
|------|------|
| 프론트엔드 | Next.js 15, React 19, TypeScript, Tailwind CSS 4, @tac-ui/web |
| 백엔드 | Next.js API Routes, Drizzle ORM, Better-SQLite3 |
| 실시간 | Server-Sent Events (SSE), WebSocket |
| 터미널 | xterm.js, node-pty |
| AI 어시스턴트 | OpenClaw (자식 프로세스, WebSocket RPC) |
| 인프라 | Docker / Docker Compose, Cloudflare Tunnel |
| 분석 | Cloudflare GraphQL Analytics API |

---

## 라이선스

이 프로젝트는 [MIT 라이선스](LICENSE)로 배포됩니다.
