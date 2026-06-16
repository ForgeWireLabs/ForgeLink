const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const root = resolve(__dirname, "../../..");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("JSON MCP templates reference the ForgeLink human server and token file", () => {
  const files = [
    "install/mcp-configs/vscode/mcp.json",
    "install/mcp-configs/claude/forgelink-human.json",
    "install/mcp-configs/forgewire/forgelink-human.json"
  ];
  for (const file of files) {
    const text = read(file);
    const parsed = JSON.parse(text);
    assert.match(text, /mcp\\\\forgelink-human\\\\dist\\\\server\.js/);
    assert.match(text, /FORGELINK_API_TOKEN_FILE/);
    assert.match(text, /FORGELINK_CHANNEL_TOKEN_FILE/);
    assert.match(text, /FORGELINK_CHANNEL_ID/);
    assert.ok(parsed);
  }
});

test("Codex MCP template carries the same server contract", () => {
  const text = read("install/mcp-configs/codex/config.toml");
  assert.match(text, /mcp\\\\forgelink-human\\\\dist\\\\server\.js/);
  assert.match(text, /FORGELINK_API_TOKEN_FILE/);
  assert.match(text, /FORGELINK_CHANNEL_TOKEN_FILE/);
  assert.match(text, /FORGELINK_SOURCE = "codex"/);
});

test("installer script builds the server before writing app configs", () => {
  const text = read("scripts/install/install-forgelink-mcp.ps1");
  assert.match(text, /npm run build/);
  assert.match(text, /forgelink-human/);
  assert.match(text, /FORGELINK_API_TOKEN_FILE/);
  assert.match(text, /FORGELINK_CHANNEL_TOKEN_FILE/);
});
