import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

async function readJson(relativePath) {
  return JSON.parse(
    await readFile(new URL(relativePath, import.meta.url), "utf8"),
  );
}

test("plugin manifest declares the cache proxy monitor", async () => {
  const manifest = await readJson("../.claude-plugin/plugin.json");

  assert.equal(manifest.name, "claude-code-cache-proxy");
  assert.equal(manifest.experimental.monitors, "./monitors/monitors.json");
});

test("marketplace entry points at the local plugin root", async () => {
  const marketplace = await readJson("../.claude-plugin/marketplace.json");

  assert.equal(marketplace.name, "local-cache-proxy");
  assert.ok(Array.isArray(marketplace.plugins));
  assert.equal(marketplace.plugins[0].name, "claude-code-cache-proxy");
  assert.equal(marketplace.plugins[0].source, "./");
});

test("monitor command launches the proxy from the plugin root", async () => {
  const monitors = await readJson("../monitors/monitors.json");

  assert.ok(Array.isArray(monitors));
  assert.equal(monitors[0].name, "cache-proxy");
  assert.match(monitors[0].command, /proxy\.mjs/);
  assert.match(monitors[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}/);
  assert.match(monitors[0].command, /\$\{PROXY_UPSTREAM_URL\}/);
});
