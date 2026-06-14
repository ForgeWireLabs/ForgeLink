import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { validateTwilioSignature } from "./twilio";

test("validates Twilio webhook signatures", () => {
  const previousToken = process.env.TWILIO_AUTH_TOKEN;
  const previousBase = process.env.TWILIO_PUBLIC_BASE_URL;
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_PUBLIC_BASE_URL = "https://phone.example";
  try {
    const fields = { Body: "hello", From: "+15551234567", MessageSid: "SM1" };
    const value = `https://phone.example/webhooks/sms${Object.keys(fields).sort().map((key) => `${key}${fields[key as keyof typeof fields]}`).join("")}`;
    const signature = createHmac("sha1", "test-token").update(value).digest("base64");
    assert.equal(validateTwilioSignature("/webhooks/sms", fields, signature), true);
    assert.equal(validateTwilioSignature("/webhooks/sms", fields, "wrong"), false);
  } finally {
    if (previousToken === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = previousToken;
    if (previousBase === undefined) delete process.env.TWILIO_PUBLIC_BASE_URL; else process.env.TWILIO_PUBLIC_BASE_URL = previousBase;
  }
});
