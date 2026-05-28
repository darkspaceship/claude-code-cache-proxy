# Claude Code 缓存代理插件

这个项目提供一个本地代理，适合 Claude Code 使用任何兼容 Anthropic 的后端时，避免缓存敏感头部每轮变化导致前缀缓存失效。

## 功能

- 接收 Claude Code 发往本地地址的请求
- 转发到你真实的 Anthropic 兼容后端
- 规范化 `x-anthropic-billing-header`，让 `cch` 保持稳定
- 可选直接移除 billing header
- 以 Claude Code 插件形式提供，并带有后台 SessionStart hook
- 带一个启动器，自动把 `ANTHROPIC_BASE_URL` 改到本地代理，同时把原始上游保存到 `PROXY_UPSTREAM_URL`

## 文件

- `.claude-plugin/plugin.json` - 插件清单
- `hooks/hooks.json` - 通过 Claude Code 的 SessionStart hook 自动启动代理
- `bin/claude-code-cache-proxy.mjs` - 启动 Claude Code 的包装器

## 手动运行代理

```bash
export PROXY_UPSTREAM_URL=https://upstream.example.com/anthropic
node proxy.mjs --listen 127.0.0.1:11434 --upstream "$PROXY_UPSTREAM_URL"
```

然后把 Claude Code 指向代理：

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:11434/anthropic
export ANTHROPIC_AUTH_TOKEN=your-token
export ANTHROPIC_API_KEY=your-token
```

## 通过启动器运行 Claude Code

先设置真实上游，再通过包装器启动：

```bash
export ANTHROPIC_BASE_URL=https://upstream.example.com/anthropic
npm run claude
```

启动器会：

- 把当前 `ANTHROPIC_BASE_URL` 复制到 `PROXY_UPSTREAM_URL`
- 把 `ANTHROPIC_BASE_URL` 改成 `http://127.0.0.1:11434/anthropic`
- 启动带本地插件的 Claude Code

它还会先把代理拉起来，再继续启动 Claude Code，所以 `--resume`
这类流程也能正常工作。

## 可选参数

命令行参数优先于环境变量。内置 SessionStart hook 会执行
`node proxy.mjs --upstream "$PROXY_UPSTREAM_URL"`，代理启动时会读取下面这些
`PROXY_*` 环境变量。布尔环境变量的规则是：不设置就是关闭，任意非空值就是开启。

### 代理参数

| 命令行参数 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--listen <host:port>` | `PROXY_LISTEN` | `127.0.0.1:11434` | 代理监听的本地地址。通过启动器使用时如果改了它，也要把 `PROXY_BASE_URL` 改成匹配的 `http://host:port/anthropic`。 |
| `--upstream <url>` | `PROXY_UPSTREAM_URL` | 必填 | 真实的 Anthropic 兼容上游 base URL，例如 `https://api.example.com/anthropic`。手动启动代理时必须提供这个参数或环境变量。 |
| `--mode <stable\|drop>` | `PROXY_SANITIZE_MODE` | `stable` | `stable` 只改写 `cch` 值；`drop` 会移除整行 `x-anthropic-billing-header`。 |
| `--cch-value <value>` | `PROXY_CCH_VALUE` | `00000` | `stable` 模式下写入的固定 `cch` 值。 |
| `--verbose` | `PROXY_VERBOSE` | 关闭 | 打印请求方法、路径、上游状态，以及简短的上游错误预览。 |
| `--trace-cache` | `PROXY_TRACE_CACHE` | 关闭 | 从 JSON 和 SSE 响应里打印 token usage 与可识别的缓存计数字段。 |
| `--trace-shape` | `PROXY_TRACE_SHAPE` | 关闭 | 打印哈希后的请求结构字段，用于排查缓存复用；不会打印 prompt 原文。 |

### 启动器参数

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ANTHROPIC_BASE_URL` | 未设置 `PROXY_UPSTREAM_URL` 时必填 | 通过启动器运行时，先把它设成真实上游。启动器会把它复制到 `PROXY_UPSTREAM_URL`，再把它改成本地代理地址给 Claude Code 使用。 |
| `PROXY_UPSTREAM_URL` | 无 | 显式指定真实上游，优先级高于 `ANTHROPIC_BASE_URL`。如果 `ANTHROPIC_BASE_URL` 已经指向本地代理，就用这个变量指定真实上游。 |
| `PROXY_BASE_URL` | `http://127.0.0.1:11434/anthropic` | 启动器写入 `ANTHROPIC_BASE_URL` 的本地代理 base URL。需要换端口时，和 `PROXY_LISTEN` 一起设置。 |
| `PROXY_START_WAIT_MS` | `2000` | hook 或启动器等待代理端口可用的最长时间，超过后 Claude Code 才继续。 |
| `CLAUDE_BIN` | `claude` | 要启动的 Claude Code 可执行文件。适合自定义安装路径或版本包装器。 |

`npm run claude --` 后面的参数会原样传给 Claude Code。`ANTHROPIC_AUTH_TOKEN`、
`ANTHROPIC_API_KEY`、`ANTHROPIC_MODEL` 等 Claude Code 鉴权和模型环境变量会原样透传。

## 安装到 Claude Code

```bash
claude plugin marketplace add .
claude plugin install claude-code-cache-proxy@local-cache-proxy --scope local
```

启用后，在 Claude Code 里执行 `/reload-plugins`，或者重启会话。

## 配置已安装的插件

如果你正常运行已安装插件的 `claude`，SessionStart hook 可以启动代理，但不能反过来修改
Claude Code 已经加载好的环境变量。所以要把 Claude Code 指向本地代理，再把代理指向
真实上游：

```bash
export PROXY_UPSTREAM_URL=https://upstream.example.com/anthropic
export ANTHROPIC_BASE_URL=http://127.0.0.1:11434/anthropic
export ANTHROPIC_AUTH_TOKEN=your-token
export ANTHROPIC_API_KEY=your-token
claude
```

也可以把同样的值放进 Claude Code settings，比如 `~/.claude/settings.json`
或项目里的 `.claude/settings.local.json`：

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

如果要换本地端口，监听地址和 Claude Code base URL 要一起改：

```json
{
  "env": {
    "PROXY_LISTEN": "127.0.0.1:11500",
    "PROXY_UPSTREAM_URL": "https://upstream.example.com/anthropic",
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:11500/anthropic"
  }
}
```

如果你用启动器而不是直接运行 `claude`，则把 `ANTHROPIC_BASE_URL` 设成真实上游。
启动器会把它移动到 `PROXY_UPSTREAM_URL`，然后再把 Claude Code 指向本地代理。

如果你想直接删除 header，而不是规范化它：

```bash
node proxy.mjs --mode drop
```

## 测试

```bash
npm test
npm run verify
```

`npm run verify` 会构造两个只差 `cch` 的 Claude Code 风格请求。
原始 system hash 会不同，清洗后的 system hash 应该相同。
