import { createHmac, timingSafeEqual } from "node:crypto";
import { connect as netConnect } from "node:net";
import { connect as tlsConnect, TLSSocket } from "node:tls";
import { ChannelAdapter, ChannelCapabilities, CredentialValidation, InboundMessage, OutboundMessage, SendResult } from "./channels";

// Provider-neutral email channel adapter (work item 018, EMAIL-001/003).
//
// Email is an internet channel for durable, non-urgent, long-form communication —
// a fallback, never the default human-approval loop. ForgeLink owns the message
// state; the provider is an edge. The contracts here (outbound, inbound
// normalization, attachment bounds, delivery/failure mapping, credential
// validation, disabled state) are SMTP-compatible but not coupled to one provider.
//
// Determinism: the adapter sends through an injectable transport so tests never
// touch a real SMTP server. The default transport (sendSmtpEmail) is a minimal
// SMTP submission client and is operator-verified live (see docs/email-channel.md);
// the parts ForgeLink relies on — address/attachment validation, MIME assembly,
// and error classification — are pure and unit-tested.

export const EMAIL_LIMITS = {
  maxSubject: 998,
  maxBodyBytes: 256 * 1024,
  maxAttachments: 10,
  maxAttachmentBytes: 20 * 1024 * 1024,
  maxTotalAttachmentBytes: 25 * 1024 * 1024
};

const EMAIL_ADDRESS = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;   // implicit TLS (true, e.g. 465) vs STARTTLS upgrade (false, e.g. 587)
  user: string;
  pass: string;
  from: string;
}

export interface EmailAttachment {
  filename: string;
  contentType?: string;
  contentBase64: string;   // base64-encoded bytes; bounds are checked on the decoded size
}

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  attachments?: EmailAttachment[];
}

// Normalized inbound email — the contract an inbound source (IMAP poll or provider
// webhook, EMAIL-004) maps onto. Defined here so the normalization is provider-neutral.
export interface InboundEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  providerMessageId: string | null;
  attachmentNames: string[];
  receivedAt: string | null;
}

export type EmailTransport = (email: Required<OutboundEmail>, config: EmailConfig) => Promise<{ providerMessageId: string | null; accepted: string[] }>;

export function loadEmailConfig(): EmailConfig {
  const port = Number(process.env.FORGELINK_SMTP_PORT || 465);
  const safePort = Number.isInteger(port) && port > 0 && port < 65536 ? port : 465;
  const secureEnv = process.env.FORGELINK_SMTP_SECURE;
  return {
    host: (process.env.FORGELINK_SMTP_HOST || "").trim(),
    port: safePort,
    secure: secureEnv ? secureEnv === "1" : safePort === 465,
    user: (process.env.FORGELINK_SMTP_USER || "").trim(),
    pass: process.env.FORGELINK_SMTP_PASS || "",
    from: (process.env.FORGELINK_SMTP_FROM || process.env.FORGELINK_SMTP_USER || "").trim()
  };
}

export function emailConfigured(config: EmailConfig = loadEmailConfig()): boolean {
  return Boolean(config.host && config.user && config.pass && config.from);
}

export function normalizeEmailAddress(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 254 || !EMAIL_ADDRESS.test(raw)) throw new Error("A valid email recipient is required.");
  const at = raw.lastIndexOf("@");
  return `${raw.slice(0, at)}@${raw.slice(at + 1).toLowerCase()}`;
}

// Validate and normalize an outbound email, enforcing subject/body/attachment
// bounds. Throws a caller-safe error (no provider detail) on any violation.
export function validateOutboundEmail(email: OutboundEmail): Required<OutboundEmail> {
  const to = normalizeEmailAddress(email.to);
  const subject = String(email.subject ?? "").replace(/[\r\n]+/g, " ").trim();
  if (subject.length > EMAIL_LIMITS.maxSubject) throw new Error("Email subject is too long.");
  const text = String(email.text ?? "");
  if (Buffer.byteLength(text, "utf8") > EMAIL_LIMITS.maxBodyBytes) throw new Error("Email body exceeds the size limit.");
  const attachments = Array.isArray(email.attachments) ? email.attachments : [];
  if (attachments.length > EMAIL_LIMITS.maxAttachments) throw new Error("Too many email attachments.");
  let total = 0;
  const normalized = attachments.map((attachment) => {
    const filename = String(attachment.filename || "").replace(/[\r\n"]+/g, "").trim();
    if (!filename) throw new Error("Each email attachment needs a filename.");
    const bytes = Buffer.byteLength(String(attachment.contentBase64 || ""), "utf8") === 0 ? 0 : Buffer.from(String(attachment.contentBase64 || ""), "base64").length;
    if (bytes === 0) throw new Error("Email attachment content is empty.");
    if (bytes > EMAIL_LIMITS.maxAttachmentBytes) throw new Error("An email attachment exceeds the per-file size limit.");
    total += bytes;
    return { filename, contentType: attachment.contentType || "application/octet-stream", contentBase64: String(attachment.contentBase64) };
  });
  if (total > EMAIL_LIMITS.maxTotalAttachmentBytes) throw new Error("Email attachments exceed the total size limit.");
  return { to, subject: subject || "(no subject)", text, attachments: normalized };
}

function foldBase64(value: string): string {
  return (value.match(/.{1,76}/g) || []).join("\r\n");
}

// Build an RFC 5322 message. Plain text when there are no attachments, otherwise
// multipart/mixed. The body is dot-stuffed at send time, not here.
export function buildMimeMessage(email: Required<OutboundEmail>, from: string): string {
  const date = new Date().toUTCString();
  const baseHeaders = [
    `From: ${from}`,
    `To: ${email.to}`,
    `Subject: ${email.subject}`,
    `Date: ${date}`,
    "MIME-Version: 1.0"
  ];
  if (!email.attachments.length) {
    return [...baseHeaders, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", foldBase64(Buffer.from(email.text, "utf8").toString("base64"))].join("\r\n");
  }
  const boundary = `forgelink-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const parts: string[] = [
    ...baseHeaders,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    foldBase64(Buffer.from(email.text, "utf8").toString("base64"))
  ];
  for (const attachment of email.attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      "",
      foldBase64(attachment.contentBase64)
    );
  }
  parts.push(`--${boundary}--`, "");
  return parts.join("\r\n");
}

// Classify a send failure as retryable (transient) or permanent. SMTP 4xx and
// transport/network errors are retryable; 5xx and validation errors are permanent.
export function mapEmailError(error: unknown): { message: string; retriable: boolean } {
  const status = (error as { smtpCode?: number }).smtpCode;
  if (typeof status === "number") {
    if (status >= 400 && status < 500) return { message: `Email provider temporarily rejected the message (${status}).`, retriable: true };
    return { message: `Email provider rejected the message (${status}).`, retriable: false };
  }
  const code = (error as { code?: string }).code || "";
  if (["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND", "EPIPE"].includes(code)) return { message: "Email delivery failed to reach the provider.", retriable: true };
  return { message: "Email delivery failed.", retriable: false };
}

// Inbound normalization contract (EMAIL-001). The concrete inbound source (EMAIL-004)
// is deferred; this turns a generic provider payload into ForgeLink's neutral shape.
export function parseInboundEmail(payload: unknown): InboundEmail {
  const record = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const attachments = Array.isArray(record.attachments) ? record.attachments : [];
  const addr = (value: unknown): string => {
    try { return normalizeEmailAddress(value); } catch { return String(value ?? "").trim(); }
  };
  return {
    from: addr(record.from),
    to: addr(record.to),
    subject: String(record.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, EMAIL_LIMITS.maxSubject),
    text: String(record.text ?? "").slice(0, EMAIL_LIMITS.maxBodyBytes),
    providerMessageId: record.messageId ? String(record.messageId) : record.id ? String(record.id) : null,
    attachmentNames: attachments.map((a) => String((a as { filename?: unknown }).filename || "")).filter(Boolean),
    receivedAt: record.receivedAt ? String(record.receivedAt) : record.date ? String(record.date) : null
  };
}

// Map an inbound email onto the shared InboundMessage contract so it flows through
// the same local store/threading as other channels.
export function inboundEmailToMessage(email: InboundEmail): InboundMessage {
  return {
    from: email.from,
    to: email.to,
    body: email.subject ? `${email.subject}\n\n${email.text}` : email.text,
    mediaUrls: [],
    providerMessageId: email.providerMessageId
  };
}

const EMAIL_CAPABILITIES: ChannelCapabilities = {
  kind: "internet",
  provider: "smtp",
  displayName: "Email",
  capabilities: ["email_send", "inbound_email"]
};

// Minimal SMTP submission client used as the default transport. Implicit TLS when
// `secure`, otherwise a plain connection upgraded via STARTTLS. AUTH LOGIN only.
// Live behavior is operator-verified; tests inject a fake transport instead.
export const sendSmtpEmail: EmailTransport = (email, config) => new Promise((resolve, reject) => {
  if (!emailConfigured(config)) { reject(new Error("Email (SMTP) is not configured.")); return; }
  const message = buildMimeMessage(email, config.from).replace(/\r?\n\./g, "\r\n..");
  let socket: TLSSocket | import("node:net").Socket = config.secure
    ? tlsConnect({ host: config.host, port: config.port, servername: config.host })
    : netConnect({ host: config.host, port: config.port });
  let buffer = "";
  let stage = 0;
  let upgraded = config.secure;
  let settled = false;
  const fail = (error: Error) => { if (!settled) { settled = true; try { socket.destroy(); } catch { /* noop */ } reject(error); } };
  const send = (line: string) => socket.write(`${line}\r\n`);
  const codeError = (code: number, detail: string): Error => Object.assign(new Error(detail), { smtpCode: code });
  socket.setTimeout(20_000, () => fail(Object.assign(new Error("SMTP timeout."), { code: "ETIMEDOUT" })));
  socket.on("error", (error) => fail(Object.assign(error as Error, { code: (error as { code?: string }).code })));
  const onData = (chunk: Buffer | string) => {
    buffer += chunk.toString("utf8");
    let index = buffer.lastIndexOf("\n");
    if (index < 0) return;
    const block = buffer.slice(0, index + 1);
    buffer = buffer.slice(index + 1);
    const lastLine = block.trimEnd().split("\n").pop() || "";
    if (/^\d{3}-/.test(lastLine)) return; // multiline continuation; wait for the final line
    const code = Number(lastLine.slice(0, 3));
    advance(code);
  };
  const advance = (code: number) => {
    try {
      switch (stage) {
        case 0: if (code !== 220) throw codeError(code, "SMTP greeting failed."); send(`EHLO forgelink.local`); stage = upgraded ? 2 : 1; break;
        case 1: if (code !== 250) throw codeError(code, "EHLO failed."); send("STARTTLS"); stage = 10; break;
        case 2: if (code !== 250) throw codeError(code, "EHLO failed."); send("AUTH LOGIN"); stage = 3; break;
        case 3: if (code !== 334) throw codeError(code, "AUTH LOGIN not accepted."); send(Buffer.from(config.user, "utf8").toString("base64")); stage = 4; break;
        case 4: if (code !== 334) throw codeError(code, "SMTP username rejected."); send(Buffer.from(config.pass, "utf8").toString("base64")); stage = 5; break;
        case 5: if (code !== 235) throw codeError(code, "SMTP authentication failed."); send(`MAIL FROM:<${config.from}>`); stage = 6; break;
        case 6: if (code !== 250) throw codeError(code, "MAIL FROM rejected."); send(`RCPT TO:<${email.to}>`); stage = 7; break;
        case 7: if (code !== 250 && code !== 251) throw codeError(code, "Recipient rejected."); send("DATA"); stage = 8; break;
        case 8: if (code !== 354) throw codeError(code, "DATA not accepted."); socket.write(`${message}\r\n.\r\n`); stage = 9; break;
        case 9: if (code !== 250) throw codeError(code, "Message not accepted."); send("QUIT"); if (!settled) { settled = true; resolve({ providerMessageId: null, accepted: [email.to] }); } break;
        case 10: {
          if (code !== 220) throw codeError(code, "STARTTLS failed.");
          const plain = socket as import("node:net").Socket;
          plain.removeListener("data", onData);
          const secure = tlsConnect({ socket: plain, servername: config.host });
          socket = secure;
          upgraded = true;
          stage = 2;
          secure.on("error", (error) => fail(Object.assign(error as Error, { code: (error as { code?: string }).code })));
          secure.on("data", onData);
          secure.once("secureConnect", () => send("EHLO forgelink.local"));
          break;
        }
        default: break;
      }
    } catch (error) {
      fail(error as Error);
    }
  };
  socket.on("data", onData);
});

// --- Inbound webhook (work item 018, EMAIL-004) -----------------------------
// Inbound email arrives through a provider webhook (e.g. a forwarding/parse
// service). It is disabled unless an inbound secret is configured, and every
// delivery is HMAC-signed over the raw body so an unauthenticated POST cannot
// inject messages.
export function emailInboundConfigured(secret = process.env.FORGELINK_EMAIL_INBOUND_SECRET): boolean {
  return Boolean((secret || "").trim());
}

export function validateEmailWebhookSignature(rawBody: string, signatureHex: string, secret: string): boolean {
  if (!secret || !/^[a-f0-9]{64}$/i.test(String(signatureHex || ""))) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signatureHex, "hex"); } catch { return false; }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

// --- Signed quick-action boundaries (work item 018, EMAIL-006) ---------------
// A signed link in an email can approve/deny/dismiss a pending request. The token
// itself carries only signature + expiry + action validity; the server enforces
// the remaining boundaries (anti-replay single-use, contact policy, and that a
// real pending request exists) before applying anything.
export const EMAIL_QUICK_ACTIONS = new Set(["approve", "deny", "dismiss"]);

export function emailQuickActionConfigured(secret = process.env.FORGELINK_EMAIL_ACTION_SECRET): boolean {
  return Boolean((secret || "").trim());
}

export interface QuickActionPayload { rid: string; action: string; nonce: string; exp: number; }

export function mintQuickActionToken(payload: QuickActionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyQuickActionToken(token: string, secret: string, nowMs = Date.now()): { ok: boolean; reason: string; payload?: QuickActionPayload } {
  if (!secret) return { ok: false, reason: "not_configured" };
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const expected = createHmac("sha256", secret).update(parts[0]).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(parts[1], "base64url"); } catch { return { ok: false, reason: "bad_signature" }; }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return { ok: false, reason: "bad_signature" };
  let payload: QuickActionPayload;
  try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return { ok: false, reason: "malformed" }; }
  if (!payload || typeof payload.rid !== "string" || !payload.rid || typeof payload.nonce !== "string" || !payload.nonce) return { ok: false, reason: "malformed" };
  if (!EMAIL_QUICK_ACTIONS.has(String(payload.action))) return { ok: false, reason: "invalid_action" };
  if (typeof payload.exp !== "number" || payload.exp <= nowMs) return { ok: false, reason: "expired" };
  return { ok: true, reason: "ok", payload };
}

export function createEmailAdapter(transport: EmailTransport = sendSmtpEmail): ChannelAdapter & { sendEmail(email: OutboundEmail): Promise<SendResult>; parseInboundEmail(payload: unknown): InboundEmail } {
  const sendEmail = async (email: OutboundEmail): Promise<SendResult> => {
    const config = loadEmailConfig();
    if (!emailConfigured(config)) throw new Error("Email (SMTP) is not configured.");
    const normalized = validateOutboundEmail(email);
    try {
      const result = await transport(normalized, config);
      return { providerMessageId: result.providerMessageId, status: result.accepted.includes(normalized.to) ? "sent" : "queued", raw: { accepted: result.accepted } };
    } catch (error) {
      const mapped = mapEmailError(error);
      throw Object.assign(new Error(mapped.message), { retriable: mapped.retriable });
    }
  };
  return {
    capabilities: () => EMAIL_CAPABILITIES,
    supports: (capability) => EMAIL_CAPABILITIES.capabilities.includes(capability),
    validateCredentials: async (): Promise<CredentialValidation> => {
      const config = loadEmailConfig();
      return emailConfigured(config) ? { ok: true, accountName: config.from } : { ok: false, error: "Email requires SMTP host, user, password, and from address." };
    },
    // Generic registry send: text email derived from the neutral OutboundMessage.
    send: async (message: OutboundMessage): Promise<SendResult> => {
      const firstLine = message.body.split(/\r?\n/)[0]?.slice(0, 120) || "(no subject)";
      return sendEmail({ to: message.to, subject: firstLine, text: message.body });
    },
    sendEmail,
    parseInbound: (payload) => inboundEmailToMessage(parseInboundEmail(payload)),
    parseInboundEmail: (payload) => parseInboundEmail(payload)
  };
}
