import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import zlib from "node:zlib";
import { test } from "node:test";
import { sanitizeRequestBody } from "../sanitize.mjs";
import { createProxyServer, startProxy } from "../proxy.mjs";

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

function digest(value) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
}

test("sanitizeRequestBody normalizes only the billing cch value", () => {
  const input = {
    model: "example-model",
    system: [
      {
        type: "text",
        text: "x-anthropic-billing-header: cc_version=2.1.150.e11; cc_entrypoint=sdk-cli; cch=0fd65;",
      },
      {
        type: "text",
        text: "You are a Claude agent.",
        cache_control: { type: "ephemeral" },
      },
    ],
  };

  const result = sanitizeRequestBody(input, {
    mode: "stable",
    cchValue: "00000",
  });

  assert.equal(result.changed, true);
  assert.equal(
    result.body.system[0].text,
    "x-anthropic-billing-header: cc_version=2.1.150.e11; cc_entrypoint=sdk-cli; cch=00000;",
  );
  assert.equal(result.body.system[1].text, "You are a Claude agent.");
  assert.equal(
    input.system[0].text,
    "x-anthropic-billing-header: cc_version=2.1.150.e11; cc_entrypoint=sdk-cli; cch=0fd65;",
  );
});

test("sanitizeRequestBody can drop the billing header entirely", () => {
  const input = {
    system: [
      {
        type: "text",
        text: "x-anthropic-billing-header: cc_version=2.1.150.e11; cc_entrypoint=sdk-cli; cch=abc12;",
      },
      {
        type: "text",
        text: "You are a Claude agent.",
      },
    ],
  };

  const result = sanitizeRequestBody(input, { mode: "drop" });

  assert.equal(result.changed, true);
  assert.equal(result.body.system.length, 1);
  assert.equal(result.body.system[0].text, "You are a Claude agent.");
});

test("createProxyServer requires an upstream URL", () => {
  const previous = process.env.PROXY_UPSTREAM_URL;
  delete process.env.PROXY_UPSTREAM_URL;

  try {
    assert.throws(
      () => createProxyServer({ upstreamBaseUrl: undefined }),
      /set PROXY_UPSTREAM_URL or pass --upstream/i,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.PROXY_UPSTREAM_URL;
    } else {
      process.env.PROXY_UPSTREAM_URL = previous;
    }
  }
});

test("proxy rewrites the request body and preserves JSON responses", async () => {
  const received = [];
  const upstream = http.createServer(async (req, res) => {
    const body = await readBody(req);
    received.push({ url: req.url, body: JSON.parse(body) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  const upstreamAddress = await listen(upstream);

  const { server: proxy, address } = await startProxy({
    listen: "127.0.0.1:0",
    upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/anthropic`,
    mode: "stable",
    cchValue: "00000",
    logger: { error() {} },
  });

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/v1/messages?beta=true`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "test-key",
        },
        body: JSON.stringify({
          model: "example-model",
          stream: false,
          system: [
            {
              type: "text",
              text: "x-anthropic-billing-header: cc_version=2.1.150.e11; cc_entrypoint=sdk-cli; cch=ff999;",
            },
          ],
          messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        }),
      },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(received.length, 1);
    assert.equal(received[0].url, "/anthropic/v1/messages?beta=true");
    assert.equal(
      received[0].body.system[0].text,
      "x-anthropic-billing-header: cc_version=2.1.150.e11; cc_entrypoint=sdk-cli; cch=00000;",
    );
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("proxy accepts local base URLs that include the upstream mount path", async () => {
  const received = [];
  const upstream = http.createServer(async (req, res) => {
    const body = await readBody(req);
    received.push({ url: req.url, body: JSON.parse(body) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  const upstreamAddress = await listen(upstream);

  const { server: proxy, address } = await startProxy({
    listen: "127.0.0.1:0",
    upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/anthropic`,
    logger: { error() {} },
  });

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/anthropic/v1/messages?beta=true`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "example-model",
          system: [],
          messages: [],
        }),
      },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(received.length, 1);
    assert.equal(received[0].url, "/anthropic/v1/messages?beta=true");
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("proxy preserves streaming responses", async () => {
  const upstream = http.createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req));
    assert.equal(body.stream, true);
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    });
    res.write('event: message_start\n');
    res.write('data: {"type":"message_start"}\n\n');
    res.write('event: message_stop\n');
    res.write('data: {"type":"message_stop"}\n\n');
    res.end();
  });
  const upstreamAddress = await listen(upstream);

  const { server: proxy, address } = await startProxy({
    listen: "127.0.0.1:0",
    upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/anthropic`,
    logger: { error() {} },
  });

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/v1/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "example-model",
          stream: true,
          system: [],
          messages: [],
        }),
      },
    );

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("content-type"),
      "text/event-stream; charset=utf-8",
    );
    const text = await response.text();
    assert.match(text, /message_start/);
    assert.match(text, /message_stop/);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("proxy removes compression headers after fetch decompresses upstream responses", async () => {
  const upstream = http.createServer(async (req, res) => {
    await readBody(req);
    const body = Buffer.from(JSON.stringify({ ok: true }));
    const gzipped = zlib.gzipSync(body);
    res.writeHead(200, {
      "content-type": "application/json",
      "content-encoding": "gzip",
      "content-length": String(gzipped.length),
    });
    res.end(gzipped);
  });
  const upstreamAddress = await listen(upstream);

  const { server: proxy, address } = await startProxy({
    listen: "127.0.0.1:0",
    upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/anthropic`,
    logger: { error() {} },
  });

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/v1/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "example-model",
          stream: false,
          system: [],
          messages: [],
        }),
      },
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-encoding"), null);
    assert.equal(response.headers.get("content-length"), null);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("proxy can trace non-streaming DeepSeek cache usage", async () => {
  const logs = [];
  const upstream = http.createServer(async (req, res) => {
    await readBody(req);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_test",
      type: "message",
      usage: {
        input_tokens: 15,
        output_tokens: 1,
        prompt_cache_hit_tokens: 10,
        prompt_cache_miss_tokens: 5,
      },
    }));
  });
  const upstreamAddress = await listen(upstream);

  const { server: proxy, address } = await startProxy({
    listen: "127.0.0.1:0",
    upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/anthropic`,
    traceCache: true,
    logger: { info(message) { logs.push(message); }, error() {} },
  });

  try {
    const body = {
      model: "deepseek-v4-pro",
      system: [],
      messages: [{ role: "user", content: "hello" }],
    };
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).usage.prompt_cache_hit_tokens, 10);
    assert.ok(logs.some((line) => line.includes("cache hit=10 miss=5")));
    assert.ok(logs.some((line) => line.includes(`request=${digest(body)}`)));
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("proxy can trace streaming DeepSeek cache usage", async () => {
  const logs = [];
  const upstream = http.createServer(async (req, res) => {
    await readBody(req);
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
    });
    res.write("event: message_start\n");
    res.write(`data: ${JSON.stringify({
      type: "message_start",
      message: {
        id: "msg_test",
        type: "message",
        usage: {
          input_tokens: 15,
          output_tokens: 0,
          prompt_cache_hit_tokens: 11,
          prompt_cache_miss_tokens: 4,
        },
      },
    })}\n\n`);
    res.write("event: message_stop\n");
    res.write('data: {"type":"message_stop"}\n\n');
    res.end();
  });
  const upstreamAddress = await listen(upstream);

  const { server: proxy, address } = await startProxy({
    listen: "127.0.0.1:0",
    upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/anthropic`,
    traceCache: true,
    logger: { info(message) { logs.push(message); }, error() {} },
  });

  try {
    const body = {
      model: "deepseek-v4-pro",
      stream: true,
      system: [],
      messages: [{ role: "user", content: "hello" }],
    };
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    assert.equal(response.status, 200);
    assert.match(await response.text(), /message_start/);
    assert.ok(logs.some((line) => line.includes("cache hit=11 miss=4")));
    assert.ok(logs.some((line) => line.includes(`request=${digest(body)}`)));
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("proxy does not estimate uncached input when DeepSeek omits cache miss tokens", async () => {
  const logs = [];
  const upstream = http.createServer(async (req, res) => {
    await readBody(req);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_test",
      type: "message",
      usage: {
        input_tokens: 29996,
        output_tokens: 14,
        prompt_cache_hit_tokens: 13952,
      },
    }));
  });
  const upstreamAddress = await listen(upstream);

  const { server: proxy, address } = await startProxy({
    listen: "127.0.0.1:0",
    upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/anthropic`,
    traceCache: true,
    logger: { info(message) { logs.push(message); }, error() {} },
  });

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-v4-pro",
        system: [],
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    assert.equal(response.status, 200);
    await response.json();
    assert.ok(
      logs.some((line) =>
        line.includes("cache hit=13952 miss=unknown"),
      ),
    );
    assert.ok(logs.every((line) => !line.includes("estimated_uncached")));
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("proxy uses reported cache miss when DeepSeek provides it", async () => {
  const logs = [];
  const upstream = http.createServer(async (req, res) => {
    await readBody(req);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_test",
      type: "message",
      usage: {
        input_tokens: 100,
        output_tokens: 1,
        prompt_cache_hit_tokens: 40,
        prompt_cache_miss_tokens: 25,
      },
    }));
  });
  const upstreamAddress = await listen(upstream);

  const { server: proxy, address } = await startProxy({
    listen: "127.0.0.1:0",
    upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/anthropic`,
    traceCache: true,
    logger: { info(message) { logs.push(message); }, error() {} },
  });

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-v4-pro",
        system: [],
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    assert.equal(response.status, 200);
    await response.json();
    assert.ok(
      logs.some((line) =>
        line.includes("cache hit=40 miss=25"),
      ),
    );
    assert.ok(logs.every((line) => !line.includes("estimated_uncached")));
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("proxy traces usage even when cache fields are absent", async () => {
  const logs = [];
  const upstream = http.createServer(async (req, res) => {
    await readBody(req);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_test",
      type: "message",
      usage: {
        input_tokens: 12,
        output_tokens: 1,
      },
    }));
  });
  const upstreamAddress = await listen(upstream);

  const { server: proxy, address } = await startProxy({
    listen: "127.0.0.1:0",
    upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/anthropic`,
    traceCache: true,
    logger: { info(message) { logs.push(message); }, error() {} },
  });

  try {
    const body = {
      model: "deepseek-v4-pro",
      system: [],
      messages: [{ role: "user", content: "hello" }],
    };
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).usage.input_tokens, 12);
    assert.ok(logs.some((line) => line.includes("usage input=12 output=1")));
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("proxy can trace request shape without logging prompt text", async () => {
  const logs = [];
  const upstream = http.createServer(async (req, res) => {
    await readBody(req);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  const upstreamAddress = await listen(upstream);

  const { server: proxy, address } = await startProxy({
    listen: "127.0.0.1:0",
    upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/anthropic`,
    traceShape: true,
    logger: { info(message) { logs.push(message); }, error() {} },
  });

  try {
    const body = {
      model: "deepseek-v4-pro",
      stream: true,
      max_tokens: 1024,
      metadata: { user_id: "stable-user" },
      system: [{ type: "text", text: "secret system text" }],
      messages: [{ role: "user", content: "secret user text" }],
      tools: [{ name: "tool_a", description: "secret tool text" }],
      thinking: { type: "adaptive" },
    };
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    assert.equal(response.status, 200);
    await response.json();
    const shapeLog = logs.find((line) => line.includes("[proxy] shape"));
    assert.ok(shapeLog);
    assert.match(shapeLog, /model=deepseek-v4-pro/);
    assert.match(shapeLog, /stream=true/);
    assert.match(shapeLog, /system=[0-9a-f]{16}/);
    assert.match(shapeLog, /messages=[0-9a-f]{16}/);
    assert.doesNotMatch(shapeLog, /secret/);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("sanitizeRequestBody stabilizes metadata.user_id for DeepSeek", () => {
  const input = {
    model: "deepseek-v4-pro",
    metadata: {
      user_id:
        "{\"device_id\":\"device-1\",\"account_uuid\":\"\",\"session_id\":\"session-a\"}",
    },
    system: [],
  };

  const result = sanitizeRequestBody(input, {
    mode: "stable",
    cchValue: "00000",
    deepseekUserId: "device-1",
  });

  assert.equal(result.changed, true);
  assert.equal(result.body.metadata.user_id, "device-1");
  assert.equal(
    input.metadata.user_id,
    "{\"device_id\":\"device-1\",\"account_uuid\":\"\",\"session_id\":\"session-a\"}",
  );
});
