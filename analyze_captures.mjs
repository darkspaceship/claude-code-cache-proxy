import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const logPath = resolve(process.argv[2] || "captures/requests.jsonl");
const lines = readFileSync(logPath, "utf8").trim().split(/\n+/).filter(Boolean);
const records = lines.map((line) => JSON.parse(line)).filter((record) => {
  return record.body && record.url && record.url.includes("/v1/messages");
});

function stable(value) {
  return JSON.stringify(value, Object.keys(value || {}).sort());
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function bodyProjection(body) {
  return {
    model: body.model,
    system: body.system,
    tools: body.tools,
    tool_choice: body.tool_choice,
    thinking: body.thinking,
    betas: body.betas,
    messages: body.messages,
  };
}

function flatten(value, path = "") {
  if (value === null || typeof value !== "object") return [[path, value]];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flatten(item, `${path}[${index}]`));
  }
  return Object.entries(value).flatMap(([key, item]) => {
    return flatten(item, path ? `${path}.${key}` : key);
  });
}

function looksVolatile(value) {
  if (typeof value !== "string") return false;
  return [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
    /\b(?:session|ses|msg|req|toolu|call|cse)_[A-Za-z0-9_-]{8,}\b/,
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    /\b\d{13}\b/,
    /\b[a-z0-9]{24,}\b/i,
  ].some((regex) => regex.test(value));
}

function summarizeDiff(a, b) {
  const left = new Map(flatten(a));
  const right = new Map(flatten(b));
  const paths = new Set([...left.keys(), ...right.keys()]);
  const diffs = [];
  for (const path of paths) {
    const av = left.get(path);
    const bv = right.get(path);
    if (JSON.stringify(av) !== JSON.stringify(bv)) {
      diffs.push({ path, left: av, right: bv, volatile: looksVolatile(av) || looksVolatile(bv) });
    }
  }
  return diffs;
}

console.log(`messages requests: ${records.length}`);
for (const record of records) {
  const projection = bodyProjection(record.body);
  console.log(
    `#${record.index} ${record.body.model} system=${hash(record.body.system)} tools=${hash(record.body.tools)} messages=${hash(record.body.messages)} full=${hash(projection)}`,
  );
  const cacheControls = [];
  for (const [path, value] of flatten(projection)) {
    if (path.endsWith("cache_control")) cacheControls.push([path, value]);
  }
  console.log(`  cache_control count=${cacheControls.length}`);
}

for (let i = 1; i < records.length; i += 1) {
  const a = bodyProjection(records[i - 1].body);
  const b = bodyProjection(records[i].body);
  const diffs = summarizeDiff(a, b);
  console.log(`\nDiff #${records[i - 1].index} -> #${records[i].index}: ${diffs.length} differing leaf paths`);
  const relevant = diffs.filter((diff) => {
    return !diff.path.startsWith("messages") || diff.volatile;
  });
  for (const diff of relevant.slice(0, 80)) {
    const left = typeof diff.left === "string" ? diff.left.slice(0, 160) : stable(diff.left);
    const right = typeof diff.right === "string" ? diff.right.slice(0, 160) : stable(diff.right);
    console.log(`  ${diff.volatile ? "[volatile?] " : ""}${diff.path}`);
    console.log(`    - ${left}`);
    console.log(`    + ${right}`);
  }
  if (relevant.length > 80) console.log(`  ... ${relevant.length - 80} more relevant diffs`);
}
