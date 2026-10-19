import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  handleRequest,
  normalizeMode,
  storyRequest,
} from "../zed-extension/server/codestory-mcp.mjs";

test("codeStory MCP request pins the skill, mode, output, and review boundary", () => {
  const request = storyRequest("detailed");
  for (const expected of [
    "codestory-storyteller",
    "`detailed` mode",
    ".codestory/story.json",
    "version 3",
    "cover every changed hunk",
    "open or refresh the codeStory app",
  ]) {
    assert.ok(request.includes(expected), `missing ${expected}`);
  }
  assert.equal(normalizeMode(), "guided");
  assert.throws(() => normalizeMode("fast"), /brief, guided, or detailed/);
});

test("codeStory MCP exposes a prompt and tool with the three story modes", () => {
  const initialized = handleRequest({
    method: "initialize",
    params: { protocolVersion: "2025-06-18" },
  });
  assert.equal(initialized.protocolVersion, "2025-06-18");
  assert.deepEqual(initialized.capabilities, {
    prompts: { listChanged: false },
    tools: { listChanged: false },
  });

  const listedTools = handleRequest({ method: "tools/list" }).tools;
  assert.equal(listedTools[0].name, "start_codestory");
  assert.deepEqual(listedTools[0].inputSchema.properties.mode.enum, [
    "brief",
    "guided",
    "detailed",
  ]);

  const prompt = handleRequest({
    method: "prompts/get",
    params: { name: "codestory", arguments: { mode: "brief" } },
  });
  assert.match(prompt.messages[0].content.text, /`brief` mode/);
});

test("bundled codeStory MCP server speaks JSON-RPC over stdio", async (t) => {
  const installed = mkdtempSync(join(tmpdir(), "codestory-zed-mcp-"));
  const entrypoint = join(installed, "codestory-mcp.mjs");
  symlinkSync(
    fileURLToPath(new URL("../zed-extension/server/codestory-mcp.mjs", import.meta.url)),
    entrypoint,
  );
  t.after(() => rmSync(installed, { recursive: true, force: true }));
  const child = spawn(process.execPath, [entrypoint], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const responses = [];
  lines.on("line", (line) => responses.push(JSON.parse(line)));

  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18" },
  })}\n`);
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "start_codestory", arguments: { mode: "guided" } },
  })}\n`);

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("MCP response timeout"));
    }, 2_000);
    const interval = setInterval(() => {
      if (responses.length < 2) return;
      clearTimeout(timeout);
      clearInterval(interval);
      resolve();
    }, 10);
  });
  assert.equal(responses[0].result.serverInfo.name, "codestory");
  assert.match(responses[1].result.content[0].text, /`guided` mode/);
});
