# Claude Code 캐시 프록시 플러그인

이 프로젝트는 Claude Code가 어떤 Anthropic 호환 백엔드를 사용하더라도, 캐시에 영향을 주는 가변 헤더 때문에 prefix cache가 깨지는 일을 줄이기 위한 로컬 프록시를 제공합니다.

## 기능

- Claude Code 트래픽을 로컬 base URL에서 받음
- 실제 Anthropic 호환 백엔드로 전달함
- `x-anthropic-billing-header`를 정규화해 `cch`를 안정화함
- 필요하면 billing header를 완전히 제거할 수 있음
- Claude Code 플러그인으로 제공되며 SessionStart hook 포함
- `ANTHROPIC_BASE_URL`을 로컬 프록시로 바꾸고, 원래 upstream은 `PROXY_UPSTREAM_URL`에 보존하는 launcher 포함

## 파일

- `.claude-plugin/plugin.json` - 플러그인 manifest
- `hooks/hooks.json` - Claude Code의 SessionStart hook으로 프록시를 자동 시작
- `bin/claude-code-cache-proxy.mjs` - 환경을 바꿔 Claude Code를 시작하는 launcher

## 프록시를 수동으로 실행

```bash
export PROXY_UPSTREAM_URL=https://upstream.example.com/anthropic
node proxy.mjs --listen 127.0.0.1:11434 --upstream "$PROXY_UPSTREAM_URL"
```

그 다음 Claude Code를 프록시로 향하게 합니다.

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:11434/anthropic
export ANTHROPIC_AUTH_TOKEN=your-token
export ANTHROPIC_API_KEY=your-token
```

## launcher로 Claude Code 실행

먼저 실제 upstream을 설정한 뒤 wrapper로 실행합니다.

```bash
export ANTHROPIC_BASE_URL=https://upstream.example.com/anthropic
npm run claude
```

launcher는 다음을 수행합니다.

- 현재 `ANTHROPIC_BASE_URL`을 `PROXY_UPSTREAM_URL`로 복사
- `ANTHROPIC_BASE_URL`을 `http://127.0.0.1:11434/anthropic`으로 변경
- 로컬 플러그인을 로드한 Claude Code를 시작

또한 Claude Code를 계속하기 전에 프록시를 먼저 띄우므로 `--resume`
같은 흐름도 같은 방식으로 동작합니다.

## 옵션

CLI 플래그는 환경 변수보다 우선합니다. 내장 SessionStart hook는
`node proxy.mjs --upstream "$PROXY_UPSTREAM_URL"`를 실행하며, 프록시는 시작할 때
아래 `PROXY_*` 환경 변수를 읽습니다. boolean 환경 변수는 설정하지 않으면 off,
비어 있지 않은 값을 넣으면 on입니다.

### 프록시 옵션

| CLI flag | 환경 변수 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `--listen <host:port>` | `PROXY_LISTEN` | `127.0.0.1:11434` | 프록시가 바인딩할 로컬 주소입니다. launcher를 쓰면서 이 값을 바꾸면 `PROXY_BASE_URL`도 대응되는 `http://host:port/anthropic`으로 설정하세요. |
| `--upstream <url>` | `PROXY_UPSTREAM_URL` | 필수 | 실제 Anthropic 호환 upstream base URL입니다. 예: `https://api.example.com/anthropic`. 프록시를 수동으로 실행할 때는 이 플래그나 환경 변수가 필요합니다. |
| `--mode <stable\|drop>` | `PROXY_SANITIZE_MODE` | `stable` | `stable`은 `cch` 값만 바꿉니다. `drop`은 `x-anthropic-billing-header` 줄을 제거합니다. |
| `--cch-value <value>` | `PROXY_CCH_VALUE` | `00000` | `stable` mode에서 사용할 고정 `cch` 값입니다. |
| `--verbose` | `PROXY_VERBOSE` | Off | 요청 method, path, upstream status, 짧은 upstream error preview를 출력합니다. |
| `--trace-cache` | `PROXY_TRACE_CACHE` | Off | JSON/SSE 응답에서 token usage와 인식 가능한 cache counter를 출력합니다. |
| `--trace-shape` | `PROXY_TRACE_SHAPE` | Off | cache reuse를 디버깅하기 위해 요청 구조 필드를 hash로 출력합니다. prompt 원문은 출력하지 않습니다. |

### launcher 옵션

| 환경 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `ANTHROPIC_BASE_URL` | `PROXY_UPSTREAM_URL`이 없으면 필수 | launcher를 사용할 때는 먼저 실제 upstream을 여기에 설정합니다. launcher가 이를 `PROXY_UPSTREAM_URL`로 복사한 뒤, Claude Code가 쓰도록 로컬 프록시 URL로 바꿉니다. |
| `PROXY_UPSTREAM_URL` | 없음 | 실제 upstream을 명시합니다. `ANTHROPIC_BASE_URL`보다 우선합니다. `ANTHROPIC_BASE_URL`이 이미 로컬 프록시를 가리킬 때 사용하세요. |
| `PROXY_BASE_URL` | `http://127.0.0.1:11434/anthropic` | launcher가 `ANTHROPIC_BASE_URL`에 쓰는 로컬 프록시 base URL입니다. 다른 포트를 쓰려면 `PROXY_LISTEN`과 함께 설정하세요. |
| `PROXY_START_WAIT_MS` | `2000` | hook 또는 launcher가 Claude Code를 계속하기 전에 프록시 포트가 연결 가능한지 기다리는 최대 시간입니다. |
| `CLAUDE_BIN` | `claude` | 실행할 Claude Code executable입니다. 커스텀 설치 경로나 version wrapper에 유용합니다. |

`npm run claude --` 뒤의 인자는 Claude Code로 그대로 전달됩니다.
`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` 같은 Claude Code 인증과
모델 환경 변수도 그대로 전달됩니다.

## Claude Code에 설치

```bash
claude plugin marketplace add .
claude plugin install claude-code-cache-proxy@local-cache-proxy --scope local
```

활성화 후 Claude Code에서 `/reload-plugins`를 실행하거나 세션을 다시 시작하세요.

## 설치된 플러그인 설정

설치된 플러그인을 일반 `claude`로 실행하면 SessionStart hook는 프록시를 시작할 수 있지만,
이미 로드된 Claude Code 환경 변수를 다시 쓸 수는 없습니다. Claude Code는 로컬
프록시를 바라보게 하고, 프록시는 실제 upstream을 바라보게 설정하세요.

```bash
export PROXY_UPSTREAM_URL=https://upstream.example.com/anthropic
export ANTHROPIC_BASE_URL=http://127.0.0.1:11434/anthropic
export ANTHROPIC_AUTH_TOKEN=your-token
export ANTHROPIC_API_KEY=your-token
claude
```

같은 값을 Claude Code settings에 넣을 수도 있습니다. 예:
`~/.claude/settings.json` 또는 프로젝트의 `.claude/settings.local.json`.

```json
{
  "env": {
    "PROXY_UPSTREAM_URL": "https://upstream.example.com/anthropic",
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:11434/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "your-token",
    "ANTHROPIC_API_KEY": "your-token",
    "PROXY_SANITIZE_MODE": "stable",
    "PROXY_TRACE_CACHE": "1"
  }
}
```

로컬 포트를 바꾸려면 listen address와 Claude Code base URL을 함께 맞춰야 합니다.

```json
{
  "env": {
    "PROXY_LISTEN": "127.0.0.1:11500",
    "PROXY_UPSTREAM_URL": "https://upstream.example.com/anthropic",
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:11500/anthropic"
  }
}
```

plain `claude` 대신 launcher를 쓴다면 `ANTHROPIC_BASE_URL`을 실제 upstream으로 설정하세요.
launcher가 이를 `PROXY_UPSTREAM_URL`로 옮긴 뒤 Claude Code를 로컬 프록시로 향하게 합니다.

헤더를 정규화 대신 제거하고 싶다면:

```bash
node proxy.mjs --mode drop
```

## 테스트

```bash
npm test
npm run verify
```

`npm run verify`는 `cch`만 다른 두 개의 Claude Code 스타일 요청을 만듭니다.
원본 system hash는 달라야 하고, sanitized system hash는 같아야 합니다.
