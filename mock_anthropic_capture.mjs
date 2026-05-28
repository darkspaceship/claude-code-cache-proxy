import http from "node:http";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const port = Number(process.env.MOCK_PORT || "8765");
const logPath = resolve(process.env.CAPTURE_LOG || "captures/requests.jsonl");
mkdirSync(dirname(logPath), { recursive: true });
writeFileSync(logPath, "");

let counter = 0;

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = { parseError: true, raw };
    }

    counter += 1;
    appendFileSync(
      logPath,
      JSON.stringify({
        index: counter,
        at: new Date().toISOString(),
        method: req.method,
        url: req.url,
        headers: {
          "anthropic-version": req.headers["anthropic-version"],
          "anthropic-beta": req.headers["anthropic-beta"],
          "content-type": req.headers["content-type"],
          "user-agent": req.headers["user-agent"],
        },
        body,
      }) + "\n",
    );

    if (req.method === "HEAD") {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.url?.includes("/v1/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [] }));
      return;
    }

    const model = body?.model || "mock-model";
    if (body?.stream) {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      writeSse(res, "message_start", {
        type: "message_start",
        message: {
          id: `msg_mock_${counter}`,
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 1,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      });
      writeSse(res, "content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      });
      writeSse(res, "content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "ok" },
      });
      writeSse(res, "content_block_stop", { type: "content_block_stop", index: 0 });
      writeSse(res, "message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 1 },
      });
      writeSse(res, "message_stop", { type: "message_stop" });
      res.end();
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: `msg_mock_${counter}`,
        type: "message",
        role: "assistant",
        model,
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      }),
    );
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mock anthropic server listening on http://127.0.0.1:${port}`);
  console.log(`capture log: ${logPath}`);
});
