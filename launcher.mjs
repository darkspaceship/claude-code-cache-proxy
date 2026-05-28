export const DEFAULT_PROXY_BASE_URL = "http://127.0.0.1:11434/anthropic";

function normalizeProxyUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname || "/"}`;
  } catch {
    return null;
  }
}

export function isLocalProxyBaseUrl(value, proxyBaseUrl = DEFAULT_PROXY_BASE_URL) {
  const normalizedValue = normalizeProxyUrl(value);
  const normalizedDefaultProxy = normalizeProxyUrl(DEFAULT_PROXY_BASE_URL);
  const normalizedProxy = normalizeProxyUrl(proxyBaseUrl) ?? normalizedDefaultProxy;
  return (
    normalizedValue === normalizedDefaultProxy ||
    normalizedValue === normalizedProxy
  );
}

export function buildClaudeCodeLaunchEnv(env = process.env) {
  const nextEnv = { ...env };
  const explicitUpstream = nextEnv.PROXY_UPSTREAM_URL;
  const currentBaseUrl = nextEnv.ANTHROPIC_BASE_URL;
  const upstream = explicitUpstream || currentBaseUrl;
  const proxyBaseUrl = nextEnv.PROXY_BASE_URL || DEFAULT_PROXY_BASE_URL;

  if (!normalizeProxyUrl(proxyBaseUrl)) {
    throw new Error("PROXY_BASE_URL must be a valid URL.");
  }

  if (!upstream) {
    throw new Error(
      "Set ANTHROPIC_BASE_URL or PROXY_UPSTREAM_URL before launching Claude Code.",
    );
  }

  if (isLocalProxyBaseUrl(upstream, proxyBaseUrl)) {
    if (!explicitUpstream) {
      throw new Error(
        "ANTHROPIC_BASE_URL already points at the local proxy; set PROXY_UPSTREAM_URL explicitly before launching Claude Code.",
      );
    }
    throw new Error(
      "PROXY_UPSTREAM_URL already points at the local proxy; set it to your real upstream backend.",
    );
  }

  nextEnv.PROXY_UPSTREAM_URL = explicitUpstream || currentBaseUrl;
  nextEnv.ANTHROPIC_BASE_URL = proxyBaseUrl;
  return nextEnv;
}
