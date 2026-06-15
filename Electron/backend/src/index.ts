import { homedir } from "node:os";
import { join } from "node:path";
import { migrateLegacyData } from "./migration";
import { createBackend } from "./server";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const host = argument("--host", process.env.FORGELINK_HOST || process.env.TWILIO_PHONE_HOST || "127.0.0.1");
const port = Number(argument("--port", process.env.FORGELINK_PORT || process.env.TWILIO_PHONE_PORT || "5055"));
const dataDir = process.env.FORGELINK_DATA_DIR || process.env.TWILIO_PHONE_DATA_DIR || join(homedir(), ".forgelink");
const apiToken = process.env.FORGELINK_API_TOKEN || process.env.TWILIO_PHONE_API_TOKEN || "";
if (!apiToken) throw new Error("FORGELINK_API_TOKEN is required.");
migrateLegacyData(join(homedir(), ".twilio-phone"), dataDir);
migrateLegacyData(join(homedir(), ".config", "TwilioPhone"), dataDir);
const { server } = createBackend({ host, port, dataDir, apiToken });

server.listen(port, host, () => console.log(`ForgeLink backend listening on http://${host}:${port}`));

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
