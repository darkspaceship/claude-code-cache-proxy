# Claude Code 快取代理外掛

這個專案提供一個本機代理，適合 Claude Code 使用任何相容 Anthropic 的後端時，避免每輪變動的快取敏感標頭導致前綴快取失效。

## 功能

- 接收 Claude Code 打到本機位址的請求
- 轉送到你真正的 Anthropic 相容後端
- 標準化 `x-anthropic-billing-header`，讓 `cch` 保持穩定
- 可選擇直接移除 billing header
- 以 Claude Code 外掛形式提供，並帶有背景 SessionStart hook
- 附帶啟動器，會把 `ANTHROPIC_BASE_URL` 改成本機代理，同時把原始上游保存到 `PROXY_UPSTREAM_URL`

## 檔案

- `.claude-plugin/plugin.json` - 外掛清單
- `hooks/hooks.json` - 透過 Claude Code 的 SessionStart hook 自動啟動代理
- `bin/claude-code-cache-proxy.mjs` - 啟動 Claude Code 的包裝器

## 手動執行代理

```bash
export PROXY_UPSTREAM_URL=https://upstream.example.com/anthropic
node proxy.mjs --listen 127.0.0.1:11434 --upstream "$PROXY_UPSTREAM_URL"
```

接著把 Claude Code 指向代理：

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:11434/anthropic
export ANTHROPIC_AUTH_TOKEN=your-token
export ANTHROPIC_API_KEY=your-token
```

## 透過啟動器執行 Claude Code

先設定真正的上游，再透過包裝器啟動：

```bash
export ANTHROPIC_BASE_URL=https://upstream.example.com/anthropic
npm run claude
```

啟動器會：

- 把目前的 `ANTHROPIC_BASE_URL` 複製到 `PROXY_UPSTREAM_URL`
- 把 `ANTHROPIC_BASE_URL` 改成 `http://127.0.0.1:11434/anthropic`
- 啟動載入本機外掛的 Claude Code

它也會先把代理啟動起來，再繼續啟動 Claude Code，所以 `--resume`
這類流程也能正常運作。

## 可選參數

命令列參數優先於環境變數。內建 SessionStart hook 會執行
`node proxy.mjs --upstream "$PROXY_UPSTREAM_URL"`，代理啟動時會讀取以下
`PROXY_*` 環境變數。布林環境變數的規則是：不設定就是關閉，任意非空值就是開啟。

### 代理參數

| 命令列參數 | 環境變數 | 預設值 | 說明 |
| --- | --- | --- | --- |
| `--listen <host:port>` | `PROXY_LISTEN` | `127.0.0.1:11434` | 代理監聽的本機位址。透過啟動器使用時如果改了它，也要把 `PROXY_BASE_URL` 改成對應的 `http://host:port/anthropic`。 |
| `--upstream <url>` | `PROXY_UPSTREAM_URL` | 必填 | 真正的 Anthropic 相容上游 base URL，例如 `https://api.example.com/anthropic`。手動啟動代理時必須提供這個參數或環境變數。 |
| `--mode <stable\|drop>` | `PROXY_SANITIZE_MODE` | `stable` | `stable` 只改寫 `cch` 值；`drop` 會移除整行 `x-anthropic-billing-header`。 |
| `--cch-value <value>` | `PROXY_CCH_VALUE` | `00000` | `stable` 模式下寫入的固定 `cch` 值。 |
| `--verbose` | `PROXY_VERBOSE` | 關閉 | 輸出請求方法、路徑、上游狀態，以及簡短的上游錯誤預覽。 |
| `--trace-cache` | `PROXY_TRACE_CACHE` | 關閉 | 從 JSON 與 SSE 回應中輸出 token usage 與可辨識的快取計數欄位。 |
| `--trace-shape` | `PROXY_TRACE_SHAPE` | 關閉 | 輸出雜湊後的請求結構欄位，用於排查快取復用；不會輸出 prompt 原文。 |

### 啟動器參數

| 環境變數 | 預設值 | 說明 |
| --- | --- | --- |
| `ANTHROPIC_BASE_URL` | 未設定 `PROXY_UPSTREAM_URL` 時必填 | 透過啟動器執行時，先把它設成真正的上游。啟動器會把它複製到 `PROXY_UPSTREAM_URL`，再改成本機代理位址給 Claude Code 使用。 |
| `PROXY_UPSTREAM_URL` | 無 | 明確指定真正的上游，優先級高於 `ANTHROPIC_BASE_URL`。如果 `ANTHROPIC_BASE_URL` 已經指向本機代理，就用這個變數指定真正的上游。 |
| `PROXY_BASE_URL` | `http://127.0.0.1:11434/anthropic` | 啟動器寫入 `ANTHROPIC_BASE_URL` 的本機代理 base URL。需要換連接埠時，請和 `PROXY_LISTEN` 一起設定。 |
| `PROXY_START_WAIT_MS` | `2000` | hook 或啟動器等待代理連接埠可用的最長時間，超過後 Claude Code 才會繼續。 |
| `CLAUDE_BIN` | `claude` | 要啟動的 Claude Code 執行檔。適合自訂安裝路徑或版本包裝器。 |

`npm run claude --` 後面的參數會原樣傳給 Claude Code。`ANTHROPIC_AUTH_TOKEN`、
`ANTHROPIC_API_KEY`、`ANTHROPIC_MODEL` 等 Claude Code 驗證與模型環境變數會原樣透傳。

## 安裝到 Claude Code

```bash
claude plugin marketplace add .
claude plugin install claude-code-cache-proxy@local-cache-proxy --scope local
```

啟用後，在 Claude Code 中執行 `/reload-plugins`，或重新啟動對話。

## 設定已安裝的外掛

如果你正常執行已安裝外掛的 `claude`，SessionStart hook 可以啟動代理，但不能反過來修改
Claude Code 已經載入的環境變數。所以要把 Claude Code 指向本機代理，再把代理指向
真正的上游：

```bash
export PROXY_UPSTREAM_URL=https://upstream.example.com/anthropic
export ANTHROPIC_BASE_URL=http://127.0.0.1:11434/anthropic
export ANTHROPIC_AUTH_TOKEN=your-token
export ANTHROPIC_API_KEY=your-token
claude
```

也可以把同樣的值放進 Claude Code settings，例如 `~/.claude/settings.json`
或專案中的 `.claude/settings.local.json`：

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

如果要更換本機連接埠，監聽位址和 Claude Code base URL 要一起改：

```json
{
  "env": {
    "PROXY_LISTEN": "127.0.0.1:11500",
    "PROXY_UPSTREAM_URL": "https://upstream.example.com/anthropic",
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:11500/anthropic"
  }
}
```

如果你用啟動器而不是直接執行 `claude`，則把 `ANTHROPIC_BASE_URL` 設成真正的上游。
啟動器會把它移到 `PROXY_UPSTREAM_URL`，然後再把 Claude Code 指向本機代理。

若你想直接刪除 header，而不是標準化它：

```bash
node proxy.mjs --mode drop
```

## 測試

```bash
npm test
npm run verify
```

`npm run verify` 會建立兩個只差 `cch` 的 Claude Code 風格請求。
原始 system hash 會不同，清理後的 system hash 應該相同。
