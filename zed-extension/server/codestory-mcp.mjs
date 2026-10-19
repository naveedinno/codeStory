import { createInterface } from "node:readline";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

export const MODES = Object.freeze(["brief", "guided", "detailed"]);

const SERVER_INFO = Object.freeze({ name: "codestory", version: "0.1.0" });

export function normalizeMode(value) {
  const mode = typeof value === "string" && value.length > 0 ? value : "guided";
  if (!MODES.includes(mode)) {
    throw new Error("mode must be brief, guided, or detailed");
  }
  return mode;
}

export function storyRequest(value) {
  const mode = normalizeMode(value);
  return `Create a codeStory for the current change in the active Zed worktree.

First load and follow the installed \`codestory-storyteller\` skill. That skill is the authoritative story schema and craft contract; do not invent a smaller format when it is unavailable. Use \`${mode}\` mode and write the resulting version 3 story to \`.codestory/story.json\` unless the skill's splitting test requires scoped stories.

Treat the current Agent conversation as intent evidence. Review the exact requested Git scope, cover every changed hunk, keep camera ranges within the skill limits, validate the finished artifact, and leave \`.codestory/\` local. When it is ready, tell me to open or refresh the codeStory app.`;
}

function prompts() {
  return [{
    name: "codestory",
    title: "Create a codeStory",
    description: "Create a validated walkthrough for the current Git change.",
    arguments: [{
      name: "mode",
      description: "Story detail level: brief, guided, or detailed (default: guided).",
      required: false,
    }],
  }];
}

function tools() {
  return [{
    name: "start_codestory",
    title: "Start a codeStory",
    description: "Returns the authoritative workflow request for creating and validating a codeStory in the active worktree.",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: MODES,
          default: "guided",
          description: "How much review detail the story should contain.",
        },
      },
      additionalProperties: false,
    },
  }];
}

export function handleRequest(message) {
  const { method, params = {} } = message;
  switch (method) {
    case "initialize":
      return {
        protocolVersion:
          typeof params.protocolVersion === "string"
            ? params.protocolVersion
            : "2025-06-18",
        capabilities: {
          prompts: { listChanged: false },
          tools: { listChanged: false },
        },
        serverInfo: SERVER_INFO,
        instructions:
          "Use the codestory prompt or start_codestory tool when the user asks for a review walkthrough or story.",
      };
    case "ping":
      return {};
    case "prompts/list":
      return { prompts: prompts() };
    case "prompts/get": {
      if (params.name !== "codestory") {
        throw Object.assign(new Error(`unknown prompt: ${params.name ?? ""}`), {
          code: -32602,
        });
      }
      return {
        description: "Create a validated walkthrough for the current Git change.",
        messages: [{
          role: "user",
          content: { type: "text", text: storyRequest(params.arguments?.mode) },
        }],
      };
    }
    case "tools/list":
      return { tools: tools() };
    case "tools/call": {
      if (params.name !== "start_codestory") {
        throw Object.assign(new Error(`unknown tool: ${params.name ?? ""}`), {
          code: -32602,
        });
      }
      return {
        content: [{
          type: "text",
          text: storyRequest(params.arguments?.mode),
        }],
        isError: false,
      };
    }
    default:
      throw Object.assign(new Error(`method not found: ${method ?? ""}`), {
        code: -32601,
      });
  }
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export function startServer(input = process.stdin) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: error.message },
      });
      return;
    }
    if (message.id === undefined || message.id === null) return;
    try {
      send({ jsonrpc: "2.0", id: message.id, result: handleRequest(message) });
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: Number.isInteger(error.code) ? error.code : -32603,
          message: error.message,
        },
      });
    }
  });
  return lines;
}

if (
  process.argv[1]
  && basename(process.argv[1]) === basename(fileURLToPath(import.meta.url))
) {
  startServer();
}
