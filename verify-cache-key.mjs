#!/usr/bin/env node
import { createHash } from "node:crypto";
import { sanitizeRequestBody } from "./sanitize.mjs";

function hash(value) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
}

function makeBody(cch) {
  return {
    model: "example-model",
    stream: true,
    system: [
      {
        type: "text",
        text: `x-anthropic-billing-header: cc_version=2.1.150.e11; cc_entrypoint=sdk-cli; cch=${cch};`,
      },
      {
        type: "text",
        text: "You are a Claude agent built on an Anthropic-compatible SDK.",
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "Reply with exactly ok." }],
      },
    ],
  };
}

const first = makeBody("abc12");
const second = makeBody("ff999");
const firstSanitized = sanitizeRequestBody(first, {
  mode: "stable",
  cchValue: "00000",
}).body;
const secondSanitized = sanitizeRequestBody(second, {
  mode: "stable",
  cchValue: "00000",
}).body;

console.log(`raw first system hash:       ${hash(first.system)}`);
console.log(`raw second system hash:      ${hash(second.system)}`);
console.log(`sanitized first system hash: ${hash(firstSanitized.system)}`);
console.log(`sanitized second system hash:${hash(secondSanitized.system)}`);
console.log("");
console.log(`raw hashes equal:       ${hash(first.system) === hash(second.system)}`);
console.log(
  `sanitized hashes equal: ${hash(firstSanitized.system) === hash(secondSanitized.system)}`,
);
