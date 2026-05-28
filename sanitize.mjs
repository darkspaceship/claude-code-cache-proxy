const DEFAULT_CCH_VALUE = "00000";

function rewriteBillingHeaderLine(line, { mode, cchValue }) {
  const match = line.match(/^(\s*x-anthropic-billing-header:\s*)(.*)$/);
  if (!match) {
    return { line, changed: false, removed: false };
  }

  if (mode === "drop") {
    return { line: "", changed: true, removed: true };
  }

  const prefix = match[1];
  const body = match[2];
  const nextBody = body.replace(/\bcch=([^;]+);/, `cch=${cchValue};`);
  const nextLine = `${prefix}${nextBody}`;
  return {
    line: nextLine,
    changed: nextLine !== line,
    removed: false,
  };
}

export function normalizeBillingHeaderText(text, options = {}) {
  if (typeof text !== "string") {
    return text;
  }

  const mode = options.mode ?? "stable";
  const cchValue = options.cchValue ?? DEFAULT_CCH_VALUE;
  if (mode !== "stable" && mode !== "drop") {
    throw new Error(`Unsupported sanitize mode: ${mode}`);
  }

  const lines = text.split(/\r?\n/);
  let changed = false;
  const nextLines = [];

  for (const line of lines) {
    const result = rewriteBillingHeaderLine(line, { mode, cchValue });
    changed = changed || result.changed;
    if (!result.removed) {
      nextLines.push(result.line);
    }
  }

  if (!changed) {
    return text;
  }

  return nextLines.join("\n");
}

function sanitizeSystemValue(system, options) {
  if (typeof system === "string") {
    const next = normalizeBillingHeaderText(system, options);
    return { value: next, changed: next !== system };
  }

  if (!Array.isArray(system)) {
    return { value: system, changed: false };
  }

  let changed = false;
  const nextSystem = [];

  for (const entry of system) {
    if (
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof entry.text === "string"
    ) {
      const nextText = normalizeBillingHeaderText(entry.text, options);
      if (options.mode === "drop" && nextText.trim() === "") {
        changed = true;
        continue;
      }
      if (nextText !== entry.text) {
        changed = true;
        nextSystem.push({ ...entry, text: nextText });
        continue;
      }
    }

    nextSystem.push(entry);
  }

  return { value: nextSystem, changed };
}

export function sanitizeRequestBody(body, options = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { body, changed: false, patches: [] };
  }

  const nextBody = structuredClone(body);
  const patches = [];

  const model = typeof nextBody.model === "string" ? nextBody.model : "";
  const isDeepSeek = /deepseek/i.test(model);

  if ("system" in nextBody) {
    const result = sanitizeSystemValue(nextBody.system, options);
    if (result.changed) {
      nextBody.system = result.value;
      patches.push("system");
    }
  }

  if (isDeepSeek && nextBody.metadata && typeof nextBody.metadata === "object") {
    const currentUserId = nextBody.metadata.user_id;
    let nextUserId = currentUserId;
    if (options.deepseekUserId) {
      nextUserId = options.deepseekUserId;
    } else if (
      typeof currentUserId === "string" &&
      currentUserId.startsWith("{")
    ) {
      try {
        const parsed = JSON.parse(currentUserId);
        if (parsed && typeof parsed.device_id === "string" && parsed.device_id) {
          nextUserId = parsed.device_id;
        } else {
          nextUserId = "claude-code";
        }
      } catch {
        nextUserId = "claude-code";
      }
    }

    if (nextUserId !== currentUserId) {
      nextBody.metadata = { ...nextBody.metadata, user_id: nextUserId };
      patches.push("metadata.user_id");
    }
  }

  return {
    body: nextBody,
    changed: patches.length > 0,
    patches,
  };
}

export { DEFAULT_CCH_VALUE };
