#!/usr/bin/env node
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PROXY_BASE_URL,
  isLocalProxyBaseUrl,
} from "../launcher.mjs";

const DEFAULT_LISTEN = "127.0.0.1:11434";
const DEFAULT_START_WAIT_MS = 2000;

function parseListen(value = DEFAULT_LISTEN) {
  const input = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_LISTEN;
  const lastColon = input.lastIndexOf(":");
  if (lastColon <= 0) {
    return { host: "127.0.0.1", port: 11434 };
  }

  const host = input.slice(0, lastColon).replace(/^\[(.*)\]$/, "$1") || "127.0.0.1";
  const port = Number(input.slice(lastColon + 1));
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 11434,
  };
}

function resolveUpstream(env, proxyBaseUrl) {
  const upstream = env.PROXY_UPSTREAM_URL || env.ANTHROPIC_BASE_URL;
  if (!upstream || isLocalProxyBaseUrl(upstream, proxyBaseUrl)) {
    return null;
  }
  return upstream;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canConnect(host, port, timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
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
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

async function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(host, port, 200)) {
      return true;
    }
    await wait(100);
  }
  return false;
}

export async function ensureProxyRunning(env = process.env, logger = console) {
  const listen = parseListen(env.PROXY_LISTEN ?? DEFAULT_LISTEN);
  const proxyBaseUrl = env.PROXY_BASE_URL || DEFAULT_PROXY_BASE_URL;
  const upstream = resolveUpstream(env, proxyBaseUrl);

  if (!upstream) {
    logger.error?.(
      "[cache-proxy] skipped: set PROXY_UPSTREAM_URL before starting Claude Code, or use the launcher to rewrite ANTHROPIC_BASE_URL.",
    );
    return { started: false, ready: false, pid: null, listen, proxyBaseUrl, upstream: null };
  }

  if (await canConnect(listen.host, listen.port)) {
    return { started: false, ready: true, pid: null, listen, proxyBaseUrl, upstream };
  }

  const proxyPath = fileURLToPath(new URL("../proxy.mjs", import.meta.url));
  const child = spawn(
    process.execPath,
    [proxyPath, "--listen", `${listen.host}:${listen.port}`, "--upstream", upstream],
    {
      detached: true,
      stdio: "ignore",
      env: {
        ...env,
        PROXY_BASE_URL: proxyBaseUrl,
        PROXY_LISTEN: `${listen.host}:${listen.port}`,
        PROXY_UPSTREAM_URL: upstream,
      },
    },
  );
  child.unref();

  const ready = await waitForPort(
    listen.host,
    listen.port,
    Number(env.PROXY_START_WAIT_MS ?? DEFAULT_START_WAIT_MS),
  );
  if (!ready) {
    logger.error?.(
      `[cache-proxy] proxy started but ${listen.host}:${listen.port} was not ready within ${env.PROXY_START_WAIT_MS ?? DEFAULT_START_WAIT_MS}ms`,
    );
  }

  return { started: true, ready, pid: child.pid ?? null, listen, proxyBaseUrl, upstream };
}

async function main() {
  try {
    await ensureProxyRunning(process.env, console);
  } catch (error) {
    console.error(
      `[cache-proxy] failed to start proxy: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
