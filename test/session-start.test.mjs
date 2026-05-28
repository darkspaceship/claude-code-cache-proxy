import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { ensureProxyRunning } from "../hooks/session-start.mjs";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function waitForPort(port, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(port)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let settled = false;

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(200, () => finish(false));
  });
}

test("session-start hook launches the proxy and forwards requests", async () => {
  const received = [];
  const upstream = http.createServer(async (req, res) => {
    const body = await readBody(req);
    received.push({ url: req.url, body: JSON.parse(body) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  const upstreamAddress = await listen(upstream);

  const probe = http.createServer(() => {});
  const probeAddress = await listen(probe);
  await close(probe);

  const result = await ensureProxyRunning(
    {
      PROXY_LISTEN: `127.0.0.1:${probeAddress.port}`,
      PROXY_UPSTREAM_URL: `http://127.0.0.1:${upstreamAddress.port}/anthropic`,
      PROXY_START_WAIT_MS: "2500",
    },
    { error() {}, info() {} },
  );

  try {
    assert.equal(result.started, true);
    assert.equal(result.ready, true);
    assert.notEqual(result.pid, null);
    assert.equal(await waitForPort(probeAddress.port), true);

    const response = await fetch(
      `http://127.0.0.1:${probeAddress.port}/v1/messages?beta=true`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "example-model",
          stream: false,
          system: [],
          messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        }),
      },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(received.length, 1);
    assert.equal(received.at(-1).url, "/anthropic/v1/messages?beta=true");
  } finally {
    if (result.pid) {
      try {
        process.kill(result.pid, "SIGTERM");
      } catch {
        // The child may have already exited.
      }
    }
    await close(upstream);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});
