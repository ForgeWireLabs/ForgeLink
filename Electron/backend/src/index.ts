import { homedir } from "node:os";
import { join } from "node:path";
import { createBackend } from "./server";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const host = argument("--host", process.env.TWILIO_PHONE_HOST || "127.0.0.1");
const port = Number(argument("--port", process.env.TWILIO_PHONE_PORT || "5055"));
const dataDir = process.env.TWILIO_PHONE_DATA_DIR || join(homedir(), ".twilio-phone");
const { server } = createBackend({ host, port, dataDir });

server.listen(port, host, () => console.log(`Twilio Phone backend listening on http://${host}:${port}`));

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
