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

test("plugin manifest declares the cache proxy hooks", async () => {
  const manifest = await readJson("../.claude-plugin/plugin.json");

  assert.equal(manifest.name, "claude-code-cache-proxy");
  assert.equal(manifest.version, "0.1.3");
  assert.equal(manifest.experimental, undefined);
  assert.equal(manifest.hooks, undefined);
});

test("marketplace entry points at the local plugin root", async () => {
  const marketplace = await readJson("../.claude-plugin/marketplace.json");

  assert.equal(marketplace.name, "local-cache-proxy");
  assert.ok(Array.isArray(marketplace.plugins));
  assert.equal(marketplace.plugins[0].name, "claude-code-cache-proxy");
  assert.equal(marketplace.plugins[0].source, "./");
});

test("SessionStart hook launches the proxy from the plugin root", async () => {
  const hooks = await readJson("../hooks/hooks.json");

  assert.ok(Array.isArray(hooks.hooks.SessionStart));
  assert.equal(hooks.hooks.SessionStart[0].matcher, ".*");
  assert.match(hooks.hooks.SessionStart[0].hooks[0].command, /session-start\.mjs/);
  assert.match(
    hooks.hooks.SessionStart[0].hooks[0].command,
    /\$\{CLAUDE_PLUGIN_ROOT\}/,
  );
});
