#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildClaudeCodeLaunchEnv } from "../launcher.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const claudeBin = process.env.CLAUDE_BIN || "claude";
const args = ["--plugin-dir", repoRoot, ...process.argv.slice(2)];

let env;
try {
  env = buildClaudeCodeLaunchEnv(process.env);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}

const child = spawn(claudeBin, args, {
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
