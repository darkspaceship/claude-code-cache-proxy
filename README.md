# Claude Code Cache Proxy Plugin

This project provides a local proxy for Claude Code when you want to use any Anthropic-compatible backend, but do not want Claude Code's changing cache-sensitive header to break cache reuse.

## Languages

- [English](./README.md)
- [简体中文](./README.zh-CN.md)
- [繁體中文](./README.zh-TW.md)
- [日本語](./README.ja.md)
- [한국어](./README.ko.md)

## What it does

- Accepts Claude Code traffic on a local base URL
- Forwards requests to your real Anthropic-compatible backend
- Normalizes `x-anthropic-billing-header` so `cch` stays stable
- Optionally drops the billing header entirely
- Ships as a Claude Code plugin with a SessionStart hook
- Includes a launcher that rewrites `ANTHROPIC_BASE_URL` to the local proxy and preserves the original upstream in `PROXY_UPSTREAM_URL`

## Files

- `.claude-plugin/plugin.json` - plugin manifest
- `hooks/hooks.json` - auto-starts the proxy via a Claude Code SessionStart hook
- `bin/claude-code-cache-proxy.mjs` - launcher that starts Claude Code with the rewritten environment

## Run the proxy manually

```bash
export PROXY_UPSTREAM_URL=https://upstream.example.com/anthropic
node proxy.mjs --listen 127.0.0.1:11434 --upstream "$PROXY_UPSTREAM_URL"
```

Then point Claude Code at the proxy:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:11434/anthropic
export ANTHROPIC_AUTH_TOKEN=your-token
export ANTHROPIC_API_KEY=your-token
```

## Run Claude Code through the launcher

Set your real upstream first, then launch Claude Code through the wrapper:

```bash
export ANTHROPIC_BASE_URL=https://upstream.example.com/anthropic
npm run claude
```

The launcher will:

- copy your current `ANTHROPIC_BASE_URL` into `PROXY_UPSTREAM_URL`
- rewrite `ANTHROPIC_BASE_URL` to `http://127.0.0.1:11434/anthropic`
- start Claude Code with the local plugin loaded

It also starts the proxy before Claude Code continues, which makes resume
flows work the same way.

## Options

CLI flags override environment variables. The bundled SessionStart hook starts
`node proxy.mjs --upstream "$PROXY_UPSTREAM_URL"`, and the proxy reads the
`PROXY_*` environment variables when it starts. For boolean environment
variables, unset means off and any non-empty value means on.

### Proxy options

| CLI flag | Environment variable | Default | Description |
| --- | --- | --- | --- |
| `--listen <host:port>` | `PROXY_LISTEN` | `127.0.0.1:11434` | Local address for the proxy server. If you change it while using the launcher, also set `PROXY_BASE_URL` to the matching `http://host:port/anthropic` URL. |
| `--upstream <url>` | `PROXY_UPSTREAM_URL` | Required | Real Anthropic-compatible upstream base URL, such as `https://api.example.com/anthropic`. Manual proxy mode requires this flag or env var. |
| `--mode <stable\|drop>` | `PROXY_SANITIZE_MODE` | `stable` | `stable` rewrites only the `cch` value. `drop` removes the `x-anthropic-billing-header` line. |
| `--cch-value <value>` | `PROXY_CCH_VALUE` | `00000` | Stable `cch` value used in `stable` mode. |
| `--verbose` | `PROXY_VERBOSE` | Off | Logs request method, path, upstream status, and a short upstream error preview. |
| `--trace-cache` | `PROXY_TRACE_CACHE` | Off | Logs token usage and known cache counters from JSON and SSE responses. |
| `--trace-shape` | `PROXY_TRACE_SHAPE` | Off | Logs hashed request-shape fields for debugging cache reuse without printing prompt text. |

### Launcher options

| Environment variable | Default | Description |
| --- | --- | --- |
| `ANTHROPIC_BASE_URL` | Required unless `PROXY_UPSTREAM_URL` is set | When using the launcher, set this to the real upstream first. The launcher copies it into `PROXY_UPSTREAM_URL`, then rewrites it to the local proxy URL for Claude Code. |
| `PROXY_UPSTREAM_URL` | None | Explicit real upstream. Takes precedence over `ANTHROPIC_BASE_URL`. Use this if `ANTHROPIC_BASE_URL` already points at the local proxy. |
| `PROXY_BASE_URL` | `http://127.0.0.1:11434/anthropic` | Local proxy base URL written into `ANTHROPIC_BASE_URL` by the launcher. Set it together with `PROXY_LISTEN` if you need another port. |
| `PROXY_START_WAIT_MS` | `2000` | How long the hook or launcher waits for the proxy port to become reachable before Claude Code continues. |
| `CLAUDE_BIN` | `claude` | Claude Code executable to launch. Useful for a custom install path or version wrapper. |

Arguments after `npm run claude --` are passed through to Claude Code. Claude
Code auth and model variables such as `ANTHROPIC_AUTH_TOKEN`,
`ANTHROPIC_API_KEY`, and `ANTHROPIC_MODEL` are passed through unchanged.

## Install the plugin into Claude Code

```bash
claude plugin marketplace add .
claude plugin install claude-code-cache-proxy@local-cache-proxy --scope local
```

After enabling it, run `/reload-plugins` in Claude Code or restart the session.

## Configure an installed plugin

When you start Claude Code normally with the installed plugin, the SessionStart hook can
start the proxy, but it cannot rewrite Claude Code's already-loaded environment.
Configure Claude Code to call the local proxy, and configure the proxy to call
your real upstream:

```bash
export PROXY_UPSTREAM_URL=https://upstream.example.com/anthropic
export ANTHROPIC_BASE_URL=http://127.0.0.1:11434/anthropic
export ANTHROPIC_AUTH_TOKEN=your-token
export ANTHROPIC_API_KEY=your-token
claude
```

You can put the same values in a Claude Code settings file, for example
`~/.claude/settings.json` or a project `.claude/settings.local.json`:

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

If you change the proxy port, keep the listen address and Claude Code base URL
matched:

```json
{
  "env": {
    "PROXY_LISTEN": "127.0.0.1:11500",
    "PROXY_UPSTREAM_URL": "https://upstream.example.com/anthropic",
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:11500/anthropic"
  }
}
```

If you use the launcher instead of plain `claude`, set `ANTHROPIC_BASE_URL` to
the real upstream. The launcher will move it into `PROXY_UPSTREAM_URL` and then
point Claude Code at the local proxy.

If you want to drop the header instead of normalizing it:

```bash
node proxy.mjs --mode drop
```

## Test

```bash
npm test
npm run verify
```

`npm run verify` constructs two Claude Code-like requests that differ only by `cch`.
The raw system hashes should differ, while the sanitized system hashes should match.
