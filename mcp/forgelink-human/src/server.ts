import { readFileSync } from "node:fs";
import { stdin, stdout } from "node:process";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
type AgentMessage = {
  id: string;
  channel_id: string;
  source: string;
  kind: string;
  urgency: string;
  title: string;
  body: string;
  actions: string;
  status: string;
  action_result: string;
  created_at: string;
  expires_at?: string | null;
};

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_VERSION = "0.1.0";
const DEFAULT_BASE_URL = "http://127.0.0.1:5055";
const DEFAULT_CHANNEL = "forgewire";
const DEFAULT_SOURCE = "forgelink-mcp";
const URGENCIES = new Set(["low", "normal", "high", "urgent"]);

const persona = `ForgeLink is the private human boundary for ForgeWire-style agentic apps.

Speak like a capable operator, not a feed. Be concise, specific, and respectful
of attention. Ask for a human only when a decision, approval, clarification, or
real-world awareness is needed. Do not self-promote. Do not create engagement
loops. Never include secrets, tokens, private phone numbers, personal media, or
unnecessary message bodies.`;

const channelContract = `Use ForgeLink's local authenticated agent-channel API.

POST /api/agent-channels/:channel_id/messages creates a human-directed message.
GET /api/agent-messages lists stored human messages and outcomes.
POST /api/agent-messages/:id/actions/:action_id records an explicit human action.

Required message fields: source, kind, urgency, title, body. Actions are
bounded id/label pairs. ForgeLink stores agent messages separately from SMS.`;

const securityBoundary = `Security boundary:
- Load the ForgeLink local API token from FORGELINK_API_TOKEN or FORGELINK_API_TOKEN_FILE.
- Treat the token like a local session secret.
- Keep FORGELINK_BASE_URL on loopback unless a human has designed another boundary.
- Do not log message bodies, tokens, phone numbers, personal media, or action payloads.
- Human actions must come from explicit ForgeLink UI interaction.`;

const installGuide = `Install by adding this server to an MCP client config.

Command: node
Args: ["<repo>/mcp/forgelink-human/dist/server.js"]
Env: FORGELINK_BASE_URL, FORGELINK_API_TOKEN_FILE or FORGELINK_API_TOKEN,
FORGELINK_CHANNEL_ID, FORGELINK_SOURCE.

Templates live under install/mcp-configs/.`;

const tools = [
  {
    name: "send_human_message",
    description: "Send a concise human-directed message into ForgeLink without creating an approval action.",
    inputSchema: objectSchema(["title", "body"], {
      title: stringSchema("Short human-readable title."),
      body: stringSchema("Concise message body for the human."),
      channel_id: stringSchema("ForgeLink agent channel id. Defaults to FORGELINK_CHANNEL_ID."),
      source: stringSchema("Source app identity. Defaults to FORGELINK_SOURCE."),
      kind: stringSchema("Message kind, such as status_update or operator_prompt."),
      urgency: enumSchema(["low", "normal", "high", "urgent"], "Message urgency."),
      expires_at: stringSchema("Optional ISO expiry timestamp."),
      id: stringSchema("Optional idempotency id.")
    })
  },
  {
    name: "request_human_approval",
    description: "Ask a human to choose from explicit approval/action buttons in ForgeLink.",
    inputSchema: objectSchema(["title", "body", "actions"], {
      title: stringSchema("Short approval title."),
      body: stringSchema("Specific approval context."),
      actions: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: objectSchema(["id", "label"], {
          id: stringSchema("Stable action id, for example approve or deny."),
          label: stringSchema("Button label shown to the human.")
        })
      },
      channel_id: stringSchema("ForgeLink agent channel id. Defaults to FORGELINK_CHANNEL_ID."),
      source: stringSchema("Source app identity. Defaults to FORGELINK_SOURCE."),
      kind: stringSchema("Message kind. Defaults to approval_request."),
      urgency: enumSchema(["low", "normal", "high", "urgent"], "Approval urgency."),
      expires_at: stringSchema("Optional ISO expiry timestamp."),
      id: stringSchema("Optional idempotency id.")
    })
  },
  {
    name: "list_human_messages",
    description: "List recent ForgeLink agent-channel messages and human outcomes.",
    inputSchema: objectSchema([], {
      status: stringSchema("Optional status filter: unread, read, dismissed, acted, expired."),
      channel_id: stringSchema("Optional channel filter."),
      limit: { type: "integer", minimum: 1, maximum: 100, default: 25 }
    })
  },
  {
    name: "get_human_message",
    description: "Fetch one ForgeLink agent-channel message by id.",
    inputSchema: objectSchema(["id"], { id: stringSchema("Agent message id.") })
  },
  {
    name: "dismiss_human_message",
    description: "Dismiss an agent-channel message after it is no longer useful.",
    inputSchema: objectSchema(["id"], { id: stringSchema("Agent message id.") })
  },
  {
    name: "record_human_action",
    description: "Record a selected human action for a ForgeLink agent-channel message.",
    inputSchema: objectSchema(["id", "action_id"], {
      id: stringSchema("Agent message id."),
      action_id: stringSchema("Action id from the message actions array.")
    })
  },
  {
    name: "channel_status",
    description: "Check ForgeLink local API health and summarize agent-channel counts.",
    inputSchema: objectSchema([], {})
  }
];

const resources = [
  { uri: "forgelink://persona", name: "ForgeLink Persona", description: "ForgeWire-style communication rules.", mimeType: "text/plain" },
  { uri: "forgelink://channel-contract", name: "Agent Channel Contract", description: "ForgeLink local API contract.", mimeType: "text/plain" },
  { uri: "forgelink://security-boundary", name: "Security Boundary", description: "Token, loopback, logging, and approval boundaries.", mimeType: "text/plain" },
  { uri: "forgelink://install", name: "Install Guide", description: "MCP client install summary.", mimeType: "text/plain" }
];

const prompts = [
  {
    name: "forgelink_ask_human",
    description: "Prepare a concise question for a human through ForgeLink.",
    arguments: [{ name: "question", description: "Decision or clarification needed.", required: true }]
  },
  {
    name: "forgelink_request_approval",
    description: "Prepare an approval request with explicit approve/deny actions.",
    arguments: [{ name: "request", description: "Operation requiring approval.", required: true }]
  },
  {
    name: "forgelink_escalate_concisely",
    description: "Escalate only the human-relevant facts, without feed-like narration.",
    arguments: [{ name: "situation", description: "Situation to summarize.", required: true }]
  },
  {
    name: "forgelink_summarize_before_interrupting",
    description: "Summarize work state before asking for attention.",
    arguments: [{ name: "context", description: "Current task context.", required: true }]
  }
];

function stringSchema(description: string): JsonObject {
  return { type: "string", description };
}

function enumSchema(values: string[], description: string): JsonObject {
  return { type: "string", enum: values, description };
}

function objectSchema(required: string[], properties: Record<string, Json>): JsonObject {
  return { type: "object", required, properties, additionalProperties: false };
}

function baseUrl(): string {
  return String(process.env.FORGELINK_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function channelId(args: JsonObject): string {
  return text(args.channel_id, "channel_id", 80, process.env.FORGELINK_CHANNEL_ID || DEFAULT_CHANNEL);
}

function source(args: JsonObject): string {
  return text(args.source, "source", 80, process.env.FORGELINK_SOURCE || DEFAULT_SOURCE);
}

function apiToken(): string {
  const direct = process.env.FORGELINK_API_TOKEN?.trim();
  if (direct) return direct;
  const file = process.env.FORGELINK_API_TOKEN_FILE?.trim();
  if (file) return readFileSync(file, "utf8").trim();
  throw new Error("Set FORGELINK_API_TOKEN or FORGELINK_API_TOKEN_FILE.");
}

function text(value: Json | undefined, label: string, max: number, fallback = ""): string {
  const result = String(value ?? fallback).trim();
  if (!result || result.length > max) throw new Error(`${label} is required and must be <= ${max} characters.`);
  return result;
}

function optionalText(value: Json | undefined, label: string, max: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return text(value, label, max);
}

function urgency(value: Json | undefined): string {
  const result = String(value || "normal");
  if (!URGENCIES.has(result)) throw new Error("urgency must be low, normal, high, or urgent.");
  return result;
}

function actions(value: Json | undefined): Array<{ id: string; label: string }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new Error("actions must contain 1 to 8 items.");
  return value.map((item) => {
    const record = asObject(item, "action");
    return { id: text(record.id, "action.id", 40), label: text(record.label, "action.label", 80) };
  });
}

function asObject(value: Json | undefined, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as JsonObject;
}

async function forgeFetch(path: string, init?: RequestInit): Promise<Json> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${apiToken()}`);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${baseUrl()}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({})) as JsonObject;
  if (!response.ok) throw new Error(String(payload.error || `ForgeLink request failed (${response.status})`));
  return payload;
}

function messagePayload(args: JsonObject, defaultKind: string, includeActions: boolean): JsonObject {
  const payload: JsonObject = {
    source: source(args),
    kind: text(args.kind, "kind", 80, defaultKind),
    urgency: urgency(args.urgency),
    title: text(args.title, "title", 160),
    body: text(args.body, "body", 4000)
  };
  const expiresAt = optionalText(args.expires_at, "expires_at", 80);
  const id = optionalText(args.id, "id", 120);
  if (expiresAt) payload.expires_at = expiresAt;
  if (id) payload.id = id;
  if (includeActions) payload.actions = actions(args.actions) as unknown as Json;
  return payload;
}

async function callTool(name: string, args: JsonObject): Promise<Json> {
  if (name === "send_human_message") {
    return forgeFetch(`/api/agent-channels/${encodeURIComponent(channelId(args))}/messages`, {
      method: "POST",
      body: JSON.stringify(messagePayload(args, "operator_prompt", false))
    });
  }
  if (name === "request_human_approval") {
    return forgeFetch(`/api/agent-channels/${encodeURIComponent(channelId(args))}/messages`, {
      method: "POST",
      body: JSON.stringify(messagePayload(args, "approval_request", true))
    });
  }
  if (name === "list_human_messages") {
    const limit = Math.max(1, Math.min(100, Number(args.limit || 25)));
    let rows = await forgeFetch("/api/agent-messages") as AgentMessage[];
    const status = optionalText(args.status, "status", 40);
    const channel = optionalText(args.channel_id, "channel_id", 80);
    if (status) rows = rows.filter((message) => message.status === status);
    if (channel) rows = rows.filter((message) => message.channel_id === channel);
    return rows.slice(0, limit) as unknown as Json;
  }
  if (name === "get_human_message") {
    const id = text(args.id, "id", 120);
    const rows = await forgeFetch("/api/agent-messages") as AgentMessage[];
    const found = rows.find((message) => message.id === id);
    if (!found) throw new Error("Agent message not found.");
    return found as unknown as Json;
  }
  if (name === "dismiss_human_message") {
    return forgeFetch(`/api/agent-messages/${encodeURIComponent(text(args.id, "id", 120))}/dismiss`, { method: "POST" });
  }
  if (name === "record_human_action") {
    const id = encodeURIComponent(text(args.id, "id", 120));
    const actionId = encodeURIComponent(text(args.action_id, "action_id", 40));
    return forgeFetch(`/api/agent-messages/${id}/actions/${actionId}`, { method: "POST" });
  }
  if (name === "channel_status") {
    const health = await forgeFetch("/health");
    const rows = await forgeFetch("/api/agent-messages") as AgentMessage[];
    const counts = rows.reduce<Record<string, number>>((acc, message) => {
      acc[message.status] = (acc[message.status] || 0) + 1;
      return acc;
    }, {});
    return { base_url: baseUrl(), channel_id: process.env.FORGELINK_CHANNEL_ID || DEFAULT_CHANNEL, health, counts };
  }
  throw new Error(`Unknown tool: ${name}`);
}

function resourceText(uri: string): string {
  if (uri === "forgelink://persona") return persona;
  if (uri === "forgelink://channel-contract") return channelContract;
  if (uri === "forgelink://security-boundary") return securityBoundary;
  if (uri === "forgelink://install") return installGuide;
  throw new Error(`Unknown resource: ${uri}`);
}

function promptText(name: string, args: JsonObject): string {
  const base = `${persona}\n\nUse ForgeLink only when human attention is actually needed.`;
  if (name === "forgelink_ask_human") return `${base}\n\nDraft a direct question: ${String(args.question || "")}`;
  if (name === "forgelink_request_approval") return `${base}\n\nDraft an approval request with clear actions: ${String(args.request || "")}`;
  if (name === "forgelink_escalate_concisely") return `${base}\n\nEscalate this situation in the fewest useful facts: ${String(args.situation || "")}`;
  if (name === "forgelink_summarize_before_interrupting") return `${base}\n\nSummarize current state before interrupting: ${String(args.context || "")}`;
  throw new Error(`Unknown prompt: ${name}`);
}

async function handle(method: string, params: JsonObject): Promise<Json> {
  if (method === "initialize") {
    return {
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: { name: "forgelink-human", version: SERVER_VERSION },
      capabilities: { tools: {}, resources: {}, prompts: {} }
    };
  }
  if (method === "tools/list") return { tools } as unknown as Json;
  if (method === "tools/call") {
    const result = await callTool(text(params.name, "name", 120), asObject(params.arguments || {}, "arguments"));
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } as Json;
  }
  if (method === "resources/list") return { resources } as unknown as Json;
  if (method === "resources/read") {
    const uri = text(params.uri, "uri", 160);
    return { contents: [{ uri, mimeType: "text/plain", text: resourceText(uri) }] } as Json;
  }
  if (method === "prompts/list") return { prompts } as unknown as Json;
  if (method === "prompts/get") {
    const name = text(params.name, "name", 120);
    const args = asObject(params.arguments || {}, "arguments");
    return { messages: [{ role: "user", content: { type: "text", text: promptText(name, args) } }] } as Json;
  }
  throw new Error(`Unsupported method: ${method}`);
}

function writeMessage(message: JsonObject): void {
  const body = JSON.stringify(message);
  stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

async function dispatch(message: JsonObject): Promise<void> {
  if (!("id" in message)) return;
  try {
    const result = await handle(String(message.method || ""), asObject(message.params || {}, "params"));
    writeMessage({ jsonrpc: "2.0", id: message.id, result });
  } catch (error) {
    writeMessage({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32000, message: error instanceof Error ? error.message : String(error) }
    });
  }
}

let buffer = Buffer.alloc(0);
stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  void pump();
});

async function pump(): Promise<void> {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) throw new Error("Missing Content-Length header.");
    const length = Number(match[1]);
    const start = headerEnd + 4;
    const end = start + length;
    if (buffer.length < end) return;
    const payload = buffer.subarray(start, end).toString("utf8");
    buffer = buffer.subarray(end);
    await dispatch(JSON.parse(payload) as JsonObject);
  }
}
