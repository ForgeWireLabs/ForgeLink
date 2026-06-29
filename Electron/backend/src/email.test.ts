import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMimeMessage,
  createEmailAdapter,
  EMAIL_LIMITS,
  EmailTransport,
  loadEmailConfig,
  mapEmailError,
  normalizeEmailAddress,
  parseInboundEmail,
  validateOutboundEmail
} from "./email";

// Configure SMTP env so the adapter treats the channel as enabled. Tests inject a
// fake transport, so no real SMTP server is contacted.
function configureEmail(): void {
  process.env.FORGELINK_SMTP_HOST = "smtp.example.com";
  process.env.FORGELINK_SMTP_USER = "ops@example.com";
  process.env.FORGELINK_SMTP_PASS = "secret";
  process.env.FORGELINK_SMTP_FROM = "ForgeLink <ops@example.com>";
}
function clearEmailConfig(): void {
  for (const key of ["FORGELINK_SMTP_HOST", "FORGELINK_SMTP_USER", "FORGELINK_SMTP_PASS", "FORGELINK_SMTP_FROM", "FORGELINK_SMTP_PORT", "FORGELINK_SMTP_SECURE"]) delete process.env[key];
}

const okTransport: EmailTransport = async (email) => ({ providerMessageId: "msg-1", accepted: [email.to] });

// --- EMAIL-001: provider-neutral contracts ---------------------------------

test("EMAIL-001: normalizes and validates email addresses", () => {
  assert.equal(normalizeEmailAddress("Person@Example.COM"), "Person@example.com");
  assert.throws(() => normalizeEmailAddress("not-an-email"));
  assert.throws(() => normalizeEmailAddress("a@b@c.com"));
  assert.throws(() => normalizeEmailAddress(""));
});

test("EMAIL-001: validates outbound bounds and defaults the subject", () => {
  const normalized = validateOutboundEmail({ to: "to@example.com", subject: "Hello\r\nthere", text: "body" });
  assert.equal(normalized.subject, "Hello there");
  assert.equal(normalized.to, "to@example.com");
  // Empty subject defaults rather than producing a header injection point.
  assert.equal(validateOutboundEmail({ to: "to@example.com", subject: "", text: "x" }).subject, "(no subject)");
  // Attachment count and per-file bounds are enforced.
  const many = Array.from({ length: EMAIL_LIMITS.maxAttachments + 1 }, () => ({ filename: "a.txt", contentBase64: Buffer.from("x").toString("base64") }));
  assert.throws(() => validateOutboundEmail({ to: "to@example.com", subject: "s", text: "t", attachments: many }), /Too many/);
  const big = Buffer.alloc(EMAIL_LIMITS.maxAttachmentBytes + 1).toString("base64");
  assert.throws(() => validateOutboundEmail({ to: "to@example.com", subject: "s", text: "t", attachments: [{ filename: "big.bin", contentBase64: big }] }), /per-file size/);
});

test("EMAIL-001: builds plain and multipart MIME messages", () => {
  const plain = buildMimeMessage(validateOutboundEmail({ to: "to@example.com", subject: "Hi", text: "Body line" }), "ops@example.com");
  assert.match(plain, /Content-Type: text\/plain; charset=utf-8/);
  assert.match(plain, /^Subject: Hi$/m);
  const withAttachment = buildMimeMessage(validateOutboundEmail({ to: "to@example.com", subject: "Hi", text: "b", attachments: [{ filename: "note.txt", contentBase64: Buffer.from("hi").toString("base64") }] }), "ops@example.com");
  assert.match(withAttachment, /Content-Type: multipart\/mixed; boundary=/);
  assert.match(withAttachment, /Content-Disposition: attachment; filename="note.txt"/);
});

test("EMAIL-001: classifies retryable vs permanent failures", () => {
  assert.equal(mapEmailError(Object.assign(new Error("x"), { smtpCode: 451 })).retriable, true);
  assert.equal(mapEmailError(Object.assign(new Error("x"), { smtpCode: 550 })).retriable, false);
  assert.equal(mapEmailError(Object.assign(new Error("x"), { code: "ECONNRESET" })).retriable, true);
  assert.equal(mapEmailError(new Error("x")).retriable, false);
  // Mapped messages never carry provider bodies.
  assert.doesNotMatch(mapEmailError(Object.assign(new Error("raw provider body"), { smtpCode: 550 })).message, /raw provider body/);
});

test("EMAIL-001: normalizes inbound email payloads (disabled-source contract)", () => {
  const inbound = parseInboundEmail({ from: "Sender@Example.com", to: "ops@example.com", subject: "Re: hi", text: "hello", messageId: "<abc@x>", date: "2026-06-29T00:00:00Z", attachments: [{ filename: "a.pdf" }] });
  assert.equal(inbound.from, "Sender@example.com");
  assert.equal(inbound.providerMessageId, "<abc@x>");
  assert.deepEqual(inbound.attachmentNames, ["a.pdf"]);
  assert.equal(inbound.receivedAt, "2026-06-29T00:00:00Z");
});

// --- EMAIL-003: outbound adapter behind the registry -----------------------

test("EMAIL-003: advertises the email channel capabilities", () => {
  const adapter = createEmailAdapter(okTransport);
  const caps = adapter.capabilities();
  assert.equal(caps.kind, "internet");
  assert.equal(caps.provider, "smtp");
  assert.ok(adapter.supports("email_send"));
  assert.ok(adapter.supports("inbound_email"));
  assert.ok(!adapter.supports("sms_send"));
});

test("EMAIL-003: send success maps to a SendResult", async () => {
  configureEmail();
  try {
    const adapter = createEmailAdapter(okTransport);
    const result = await adapter.sendEmail({ to: "to@example.com", subject: "Hi", text: "body" });
    assert.equal(result.status, "sent");
    assert.equal(result.providerMessageId, "msg-1");
  } finally { clearEmailConfig(); }
});

test("EMAIL-003: provider rejection surfaces a redacted permanent error", async () => {
  configureEmail();
  try {
    const rejecting: EmailTransport = async () => { throw Object.assign(new Error("550 raw provider mailbox unavailable"), { smtpCode: 550 }); };
    const adapter = createEmailAdapter(rejecting);
    await assert.rejects(() => adapter.sendEmail({ to: "to@example.com", subject: "Hi", text: "b" }), (error: Error & { retriable?: boolean }) => {
      assert.equal(error.retriable, false);
      assert.doesNotMatch(error.message, /mailbox unavailable/);
      return true;
    });
  } finally { clearEmailConfig(); }
});

test("EMAIL-003: transient transport failure is retryable", async () => {
  configureEmail();
  try {
    const flaky: EmailTransport = async () => { throw Object.assign(new Error("reset"), { code: "ECONNRESET" }); };
    await assert.rejects(() => createEmailAdapter(flaky).sendEmail({ to: "to@example.com", subject: "Hi", text: "b" }), (error: Error & { retriable?: boolean }) => {
      assert.equal(error.retriable, true);
      return true;
    });
  } finally { clearEmailConfig(); }
});

test("EMAIL-003: missing credentials are reported cleanly and block sending", async () => {
  clearEmailConfig();
  const adapter = createEmailAdapter(okTransport);
  assert.equal((await adapter.validateCredentials()).ok, false);
  await assert.rejects(() => adapter.sendEmail({ to: "to@example.com", subject: "Hi", text: "b" }), /not configured/);
});

test("EMAIL-003: invalid recipient and attachment bounds are rejected before send", async () => {
  configureEmail();
  try {
    let calls = 0;
    const counting: EmailTransport = async (email) => { calls += 1; return { providerMessageId: "x", accepted: [email.to] }; };
    const adapter = createEmailAdapter(counting);
    await assert.rejects(() => adapter.sendEmail({ to: "nope", subject: "Hi", text: "b" }));
    const tooMany = Array.from({ length: EMAIL_LIMITS.maxAttachments + 1 }, () => ({ filename: "a.txt", contentBase64: Buffer.from("x").toString("base64") }));
    await assert.rejects(() => adapter.sendEmail({ to: "to@example.com", subject: "Hi", text: "b", attachments: tooMany }));
    assert.equal(calls, 0, "the transport must not be called for invalid input");
  } finally { clearEmailConfig(); }
});

test("EMAIL-003: validateCredentials reflects configuration", async () => {
  configureEmail();
  try {
    assert.equal((await createEmailAdapter(okTransport).validateCredentials()).ok, true);
    assert.equal(loadEmailConfig().host, "smtp.example.com");
  } finally { clearEmailConfig(); }
});
