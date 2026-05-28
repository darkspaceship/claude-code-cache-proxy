# Claude Code キャッシュプロキシプラグイン

このプロジェクトは、Claude Code が任意の Anthropic 互換バックエンドを使うときに、キャッシュに影響する可変ヘッダーで prefix cache が壊れるのを防ぐためのローカルプロキシを提供します。

## できること

- Claude Code の通信をローカルのベース URL で受ける
- 実際の Anthropic 互換バックエンドへ転送する
- `x-anthropic-billing-header` を正規化し、`cch` を安定化する
- 必要なら billing header を完全に削除する
- Claude Code プラグインとして SessionStart hook を含める
- `ANTHROPIC_BASE_URL` をローカルプロキシへ書き換え、元の upstream を `PROXY_UPSTREAM_URL` に保存する launcher を含める

## ファイル

- `.claude-plugin/plugin.json` - プラグイン定義
- `hooks/hooks.json` - Claude Code の SessionStart hook でプロキシを自動起動
- `bin/claude-code-cache-proxy.mjs` - 環境を書き換えて Claude Code を起動する launcher

## プロキシを手動起動する

```bash
export PROXY_UPSTREAM_URL=https://upstream.example.com/anthropic
node proxy.mjs --listen 127.0.0.1:11434 --upstream "$PROXY_UPSTREAM_URL"
```

その後、Claude Code をプロキシへ向けます。

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:11434/anthropic
export ANTHROPIC_AUTH_TOKEN=your-token
export ANTHROPIC_API_KEY=your-token
```

## launcher で Claude Code を起動する

まず本物の upstream を設定し、その後 wrapper から起動します。

```bash
export ANTHROPIC_BASE_URL=https://upstream.example.com/anthropic
npm run claude
```

launcher は次を行います。

- 現在の `ANTHROPIC_BASE_URL` を `PROXY_UPSTREAM_URL` にコピーする
- `ANTHROPIC_BASE_URL` を `http://127.0.0.1:11434/anthropic` に書き換える
- ローカルプラグインを読み込んだ Claude Code を起動する

また、Claude Code を続行する前にプロキシを起動するため、`--resume`
のようなフローでも同じように動作します。

## オプション

CLI フラグは環境変数より優先されます。付属の SessionStart hook は
`node proxy.mjs --upstream "$PROXY_UPSTREAM_URL"` を実行し、プロキシ起動時に
以下の `PROXY_*` 環境変数を読みます。boolean の環境変数は、未設定なら off、
空でない値が入っていれば on です。

### プロキシオプション

| CLI flag | 環境変数 | デフォルト | 説明 |
| --- | --- | --- | --- |
| `--listen <host:port>` | `PROXY_LISTEN` | `127.0.0.1:11434` | プロキシが待ち受けるローカルアドレス。launcher 利用時に変更する場合は、`PROXY_BASE_URL` も対応する `http://host:port/anthropic` にしてください。 |
| `--upstream <url>` | `PROXY_UPSTREAM_URL` | 必須 | 実際の Anthropic 互換 upstream base URL。例: `https://api.example.com/anthropic`。手動プロキシ起動ではこのフラグまたは環境変数が必須です。 |
| `--mode <stable\|drop>` | `PROXY_SANITIZE_MODE` | `stable` | `stable` は `cch` 値だけを書き換えます。`drop` は `x-anthropic-billing-header` 行を削除します。 |
| `--cch-value <value>` | `PROXY_CCH_VALUE` | `00000` | `stable` mode で使う固定 `cch` 値。 |
| `--verbose` | `PROXY_VERBOSE` | Off | リクエスト method、path、upstream status、短い upstream error preview を出力します。 |
| `--trace-cache` | `PROXY_TRACE_CACHE` | Off | JSON/SSE レスポンスから token usage と認識できる cache counter を出力します。 |
| `--trace-shape` | `PROXY_TRACE_SHAPE` | Off | cache reuse の調査用に、リクエスト構造を hash 化して出力します。prompt 本文は出力しません。 |

### launcher オプション

| 環境変数 | デフォルト | 説明 |
| --- | --- | --- |
| `ANTHROPIC_BASE_URL` | `PROXY_UPSTREAM_URL` 未設定時は必須 | launcher 利用時は、まず実際の upstream をここに設定します。launcher がこれを `PROXY_UPSTREAM_URL` にコピーし、その後 Claude Code 用にローカルプロキシ URL へ書き換えます。 |
| `PROXY_UPSTREAM_URL` | なし | 実際の upstream を明示します。`ANTHROPIC_BASE_URL` より優先されます。`ANTHROPIC_BASE_URL` がすでにローカルプロキシを指している場合に使います。 |
| `PROXY_BASE_URL` | `http://127.0.0.1:11434/anthropic` | launcher が `ANTHROPIC_BASE_URL` に書き込むローカルプロキシ base URL。別ポートを使う場合は `PROXY_LISTEN` と一緒に設定してください。 |
| `PROXY_START_WAIT_MS` | `2000` | hook または launcher が、Claude Code を続行する前にプロキシの port 到達性を待つ最大時間です。 |
| `CLAUDE_BIN` | `claude` | 起動する Claude Code executable。カスタムインストールパスや version wrapper に使えます。 |

`npm run claude --` 以降の引数は Claude Code にそのまま渡されます。
`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_API_KEY`、`ANTHROPIC_MODEL` などの
Claude Code 認証・モデル環境変数はそのまま引き継がれます。

## Claude Code にインストールする

```bash
claude plugin marketplace add .
claude plugin install claude-code-cache-proxy@local-cache-proxy --scope local
```

有効化後、Claude Code で `/reload-plugins` を実行するか、セッションを再起動してください。

## インストール済みプラグインの設定

インストール済みプラグインを通常の `claude` で起動する場合、SessionStart hook はプロキシを
起動できますが、Claude Code がすでに読み込んだ環境変数を書き換えることはできません。
Claude Code はローカルプロキシへ向け、プロキシは実際の upstream へ向けます。

```bash
export PROXY_UPSTREAM_URL=https://upstream.example.com/anthropic
export ANTHROPIC_BASE_URL=http://127.0.0.1:11434/anthropic
export ANTHROPIC_AUTH_TOKEN=your-token
export ANTHROPIC_API_KEY=your-token
claude
```

同じ値を Claude Code settings に入れることもできます。例:
`~/.claude/settings.json` または project の `.claude/settings.local.json`。

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

ローカルポートを変える場合は、listen address と Claude Code base URL を合わせてください。

```json
{
  "env": {
    "PROXY_LISTEN": "127.0.0.1:11500",
    "PROXY_UPSTREAM_URL": "https://upstream.example.com/anthropic",
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:11500/anthropic"
  }
}
```

plain `claude` ではなく launcher を使う場合は、`ANTHROPIC_BASE_URL` を実際の upstream
に設定してください。launcher がそれを `PROXY_UPSTREAM_URL` へ移し、その後 Claude Code
をローカルプロキシへ向けます。

ヘッダーを正規化ではなく削除したい場合は、次を使います。

```bash
node proxy.mjs --mode drop
```

## テスト

```bash
npm test
npm run verify
```

`npm run verify` は `cch` だけが違う 2 つの Claude Code 風リクエストを作成します。
元の system hash は異なり、sanitized 後の system hash は一致するはずです。
