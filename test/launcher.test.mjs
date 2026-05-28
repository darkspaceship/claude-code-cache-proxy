import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PROXY_BASE_URL,
  buildClaudeCodeLaunchEnv,
  isLocalProxyBaseUrl,
} from "../launcher.mjs";

test("buildClaudeCodeLaunchEnv rewrites ANTHROPIC_BASE_URL and preserves the upstream", () => {
  const env = buildClaudeCodeLaunchEnv({
    ANTHROPIC_BASE_URL: "https://upstream.example.com/anthropic",
  });

  assert.equal(env.PROXY_UPSTREAM_URL, "https://upstream.example.com/anthropic");
  assert.equal(env.ANTHROPIC_BASE_URL, DEFAULT_PROXY_BASE_URL);
});

test("buildClaudeCodeLaunchEnv keeps an explicit PROXY_UPSTREAM_URL", () => {
  const env = buildClaudeCodeLaunchEnv({
    ANTHROPIC_BASE_URL: "https://upstream.example.com/anthropic",
    PROXY_UPSTREAM_URL: "https://secondary.example.com/anthropic",
  });

  assert.equal(env.PROXY_UPSTREAM_URL, "https://secondary.example.com/anthropic");
  assert.equal(env.ANTHROPIC_BASE_URL, DEFAULT_PROXY_BASE_URL);
});

test("buildClaudeCodeLaunchEnv can use a custom local proxy base URL", () => {
  const env = buildClaudeCodeLaunchEnv({
    ANTHROPIC_BASE_URL: "https://upstream.example.com/anthropic",
    PROXY_BASE_URL: "http://127.0.0.1:11500/anthropic",
  });

  assert.equal(env.PROXY_UPSTREAM_URL, "https://upstream.example.com/anthropic");
  assert.equal(env.ANTHROPIC_BASE_URL, "http://127.0.0.1:11500/anthropic");
});

test("buildClaudeCodeLaunchEnv requires an upstream when none is configured", () => {
  assert.throws(
    () =>
      buildClaudeCodeLaunchEnv({
        PATH: "/usr/bin",
      }),
    /set ANTHROPIC_BASE_URL or PROXY_UPSTREAM_URL/i,
  );
});

test("buildClaudeCodeLaunchEnv rejects an already-local proxy URL without an upstream", () => {
  assert.throws(
    () =>
      buildClaudeCodeLaunchEnv({
        ANTHROPIC_BASE_URL: DEFAULT_PROXY_BASE_URL,
      }),
    /already points at the local proxy/i,
  );
});

test("buildClaudeCodeLaunchEnv rejects an invalid custom proxy base URL", () => {
  assert.throws(
    () =>
      buildClaudeCodeLaunchEnv({
        ANTHROPIC_BASE_URL: "https://upstream.example.com/anthropic",
        PROXY_BASE_URL: "not-a-url",
      }),
    /PROXY_BASE_URL must be a valid URL/i,
  );
});

test("isLocalProxyBaseUrl recognizes the default local proxy URL", () => {
  assert.equal(isLocalProxyBaseUrl(DEFAULT_PROXY_BASE_URL), true);
  assert.equal(isLocalProxyBaseUrl("https://upstream.example.com/anthropic"), false);
});

test("isLocalProxyBaseUrl recognizes a custom local proxy URL", () => {
  assert.equal(
    isLocalProxyBaseUrl(
      "http://127.0.0.1:11500/anthropic",
      "http://127.0.0.1:11500/anthropic/",
    ),
    true,
  );
});
