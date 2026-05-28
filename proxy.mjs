#!/usr/bin/env node
import http from "node:http";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { sanitizeRequestBody } from "./sanitize.mjs";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function parseListenValue(value) {
  if (!value) {
    return { host: "127.0.0.1", port: 11434 };
  }

  const [host, port] = value.split(":");
  return {
    host: host || "127.0.0.1",
    port: Number(port || "11434"),
  };
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  return url;
}

function buildTargetUrl(baseUrl, requestUrl) {
  const incoming = new URL(requestUrl || "/", "http://127.0.0.1");
  const target = new URL(baseUrl.toString());
  const basePath = target.pathname.replace(/\/$/, "");
  let requestPath = incoming.pathname.startsWith("/")
    ? incoming.pathname
    : `/${incoming.pathname}`;

  if (
    basePath &&
    (requestPath === basePath || requestPath.startsWith(`${basePath}/`))
  ) {
    requestPath = requestPath.slice(basePath.length) || "/";
  }

  target.pathname = `${basePath}${requestPath}`;
  target.search = incoming.search;
  return target;
}

function isJsonContentType(contentType) {
  return typeof contentType === "string" && /json|\+json/i.test(contentType);
}

function filterRequestHeaders(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

function filterResponseHeaders(headers) {
  const result = {};
  for (const [key, value] of headers.entries()) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      continue;
    }
    if (
      [
        "content-encoding",
        "content-length",
        "content-md5",
        "digest",
      ].includes(key.toLowerCase())
    ) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

function collectRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
    req.on("aborted", () => reject(new Error("client aborted request")));
  });
}

function maybeSanitizeBody(rawBody, contentType, sanitizeOptions) {
  if (!rawBody.length || !isJsonContentType(contentType)) {
    return { body: rawBody, changed: false };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { body: rawBody, changed: false, parseError: true };
  }

  const sanitized = sanitizeRequestBody(parsed, sanitizeOptions);
  if (!sanitized.changed) {
    return { body: rawBody, changed: false };
  }

  return {
    body: Buffer.from(JSON.stringify(sanitized.body), "utf8"),
    changed: true,
    patches: sanitized.patches,
  };
}

function hashRequestBody(body) {
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

function stableSerialize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
    .join(",")}}`;
}

function hashStable(value) {
  return createHash("sha256")
    .update(stableSerialize(value))
    .digest("hex")
    .slice(0, 16);
}

function summarizeArray(value) {
  return Array.isArray(value) ? value.map((item) => hashStable(item)) : null;
}

function summarizeRequestShape(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  return {
    model: typeof body.model === "string" ? body.model : null,
    stream: Boolean(body.stream),
    max_tokens: body.max_tokens ?? null,
    system: summarizeArray(body.system),
    messages: summarizeArray(body.messages),
    metadataUserId:
      body.metadata &&
      typeof body.metadata === "object" &&
      typeof body.metadata.user_id === "string"
        ? hashStable(body.metadata.user_id)
        : null,
    tools: summarizeArray(body.tools),
    thinking: body.thinking ? hashStable(body.thinking) : null,
    output_config: body.output_config ? hashStable(body.output_config) : null,
    context_management: body.context_management
      ? hashStable(body.context_management)
      : null,
  };
}

function logRequestShape(logger, requestHash, body) {
  const shape = summarizeRequestShape(body);
  if (!shape) {
    return;
  }

  logger.info?.(
    `[proxy] shape request=${requestHash} model=${shape.model ?? "null"} stream=${shape.stream} max_tokens=${shape.max_tokens ?? "null"} system=${shape.system ? shape.system.join(",") : "null"} messages=${shape.messages ? shape.messages.join(",") : "null"} metadata.user_id=${shape.metadataUserId ?? "null"} tools=${shape.tools ? shape.tools.join(",") : "null"} thinking=${shape.thinking ?? "null"} output_config=${shape.output_config ?? "null"} context_management=${shape.context_management ?? "null"}`,
  );
}

function extractUsage(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return payload.usage ?? payload.message?.usage ?? null;
}

function formatCacheUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const hit =
    usage.prompt_cache_hit_tokens ??
    usage.cache_read_input_tokens ??
    usage.cache_read_tokens;
  const miss =
    usage.prompt_cache_miss_tokens ??
    usage.cache_creation_input_tokens ??
    usage.cache_creation_tokens;

  if (hit === undefined && miss === undefined) {
    return null;
  }

  return {
    hit: hit ?? 0,
    miss: miss ?? 0,
    hasMiss: miss !== undefined,
  };
}

function logCacheUsage(logger, requestHash, usage) {
  if (!usage || typeof usage !== "object") {
    return;
  }

  const input =
    usage.input_tokens ??
    usage.prompt_tokens ??
    usage.prompt_token_count;
  const output = usage.output_tokens ?? usage.completion_tokens ?? 0;
  if (input !== undefined || output !== undefined) {
    logger.info?.(
      `[proxy] usage input=${input ?? 0} output=${output} request=${requestHash}`,
    );
  }

  const cacheUsage = formatCacheUsage(usage);
  if (cacheUsage) {
    const missText = cacheUsage.hasMiss ? cacheUsage.miss : "unknown";
    logger.info?.(
      `[proxy] cache hit=${cacheUsage.hit} miss=${missText} request=${requestHash}`,
    );
  }
}

async function forwardWithCacheTrace(upstreamResponse, res, logger, requestHash) {
  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    await forwardSseWithCacheTrace(upstreamResponse, res, logger, requestHash);
    return;
  }

  const bodyText = await upstreamResponse.text();
  try {
    const json = JSON.parse(bodyText);
    logCacheUsage(logger, requestHash, extractUsage(json));
  } catch {
    // Non-JSON responses are still forwarded unchanged.
  }
  res.end(bodyText);
}

async function forwardSseWithCacheTrace(upstreamResponse, res, logger, requestHash) {
  const reader = upstreamResponse.body?.getReader();
  if (!reader) {
    res.end();
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    const text = decoder.decode(value, { stream: true });
    res.write(text);
    buffer += text;

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const eventText = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of eventText.split(/\r?\n/)) {
        if (!line.startsWith("data:")) {
          continue;
        }
        const data = line.slice(5).trimStart();
        if (!data || data === "[DONE]") {
          continue;
        }
        try {
          const json = JSON.parse(data);
          logCacheUsage(logger, requestHash, extractUsage(json));
        } catch {
          // Ignore non-JSON SSE data.
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }

  const tail = decoder.decode();
  if (tail) {
    res.write(tail);
  }
  res.end();
}

export function createProxyServer(options = {}) {
  const upstreamBaseUrlValue =
    options.upstreamBaseUrl ?? process.env.PROXY_UPSTREAM_URL;
  if (!upstreamBaseUrlValue) {
    throw new Error(
      "Set PROXY_UPSTREAM_URL or pass --upstream before starting the proxy.",
    );
  }
  const upstreamBaseUrl = normalizeBaseUrl(upstreamBaseUrlValue);
  const sanitizeOptions = {
    mode: options.mode ?? process.env.PROXY_SANITIZE_MODE ?? "stable",
    cchValue: options.cchValue ?? process.env.PROXY_CCH_VALUE ?? "00000",
  };
  const verbose = Boolean(options.verbose ?? process.env.PROXY_VERBOSE);
  const traceCache = Boolean(options.traceCache ?? process.env.PROXY_TRACE_CACHE);
  const traceShape = Boolean(options.traceShape ?? process.env.PROXY_TRACE_SHAPE);
  const logger = options.logger ?? console;

  return http.createServer(async (req, res) => {
    const controller = new AbortController();
    req.on("aborted", () => controller.abort());
    res.on("close", () => {
      if (!res.writableEnded) {
        controller.abort();
      }
    });

    try {
      const rawBody = await collectRequestBody(req);
      const maybeBody = maybeSanitizeBody(
        rawBody,
        req.headers["content-type"],
        sanitizeOptions,
      );
      const requestHash = hashRequestBody(maybeBody.body);
      if (traceShape) {
        try {
          logRequestShape(
            logger,
            requestHash,
            JSON.parse(maybeBody.body.toString("utf8")),
          );
        } catch {
          logger.info?.(`[proxy] shape request=${requestHash} parse_error=true`);
        }
      }

      const targetUrl = buildTargetUrl(upstreamBaseUrl, req.url);
      const headers = filterRequestHeaders(req.headers);
      const upstreamResponse = await fetch(targetUrl, {
        method: req.method,
        headers,
        body:
          req.method && ["GET", "HEAD"].includes(req.method.toUpperCase())
            ? undefined
            : maybeBody.body.length
              ? maybeBody.body
              : undefined,
        signal: controller.signal,
      });

      if (verbose) {
        logger.info?.(
          `[proxy] ${req.method} ${req.url} -> ${upstreamResponse.status} ${upstreamResponse.statusText}`,
        );
      }

      if (verbose && !upstreamResponse.ok && upstreamResponse.body) {
        try {
          const preview = await upstreamResponse.clone().text();
          logger.info?.(
            `[proxy] upstream error body: ${preview.slice(0, 1000)}`,
          );
        } catch (error) {
          logger.info?.(
            `[proxy] failed to read upstream error body: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      res.writeHead(
        upstreamResponse.status,
        upstreamResponse.statusText,
        filterResponseHeaders(upstreamResponse.headers),
      );

      if (!upstreamResponse.body) {
        res.end();
        return;
      }

      if (traceCache) {
        await forwardWithCacheTrace(upstreamResponse, res, logger, requestHash);
        return;
      }

      await pipeline(Readable.fromWeb(upstreamResponse.body), res);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({
        error: "proxy_error",
        message: error instanceof Error ? error.message : String(error),
      }));
      if (logger && typeof logger.error === "function") {
        logger.error(error);
      }
    }
  });
}

export async function startProxy(options = {}) {
  const listen = parseListenValue(
    options.listen ?? process.env.PROXY_LISTEN ?? "127.0.0.1:11434",
  );
  const server = createProxyServer(options);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listen.port, listen.host, resolve);
  });

  const address = server.address();
  return { server, address };
}

function parseArgs(argv) {
  const args = {
    listen: process.env.PROXY_LISTEN ?? "127.0.0.1:11434",
    upstreamBaseUrl: process.env.PROXY_UPSTREAM_URL,
    mode: process.env.PROXY_SANITIZE_MODE ?? "stable",
    cchValue: process.env.PROXY_CCH_VALUE ?? "00000",
    verbose: Boolean(process.env.PROXY_VERBOSE),
    traceCache: Boolean(process.env.PROXY_TRACE_CACHE),
    traceShape: Boolean(process.env.PROXY_TRACE_SHAPE),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--listen") {
      args.listen = argv[++i];
    } else if (value === "--upstream") {
      args.upstreamBaseUrl = argv[++i];
    } else if (value === "--mode") {
      args.mode = argv[++i];
    } else if (value === "--cch-value") {
      args.cchValue = argv[++i];
    } else if (value === "--verbose") {
      args.verbose = true;
    } else if (value === "--trace-cache") {
      args.traceCache = true;
    } else if (value === "--trace-shape") {
      args.traceShape = true;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.upstreamBaseUrl) {
    console.error(
      "Set PROXY_UPSTREAM_URL or pass --upstream before starting the proxy.",
    );
    process.exit(1);
  }
  const { server, address } = await startProxy(args);
  const actual = typeof address === "object" && address
    ? `${address.address}:${address.port}`
    : String(address);
  console.log(`Claude Code proxy listening on http://${actual}`);
  console.log(`Upstream base URL: ${args.upstreamBaseUrl}`);
  console.log(`Sanitize mode: ${args.mode}`);
  console.log(`Verbose: ${Boolean(args.verbose)}`);
  console.log(`Trace cache: ${Boolean(args.traceCache)}`);
  console.log(`Trace shape: ${Boolean(args.traceShape)}`);

  const shutdown = () => {
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
