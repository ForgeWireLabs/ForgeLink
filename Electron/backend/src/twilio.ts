import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeNumber } from "./phone";

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  publicBaseUrl: string;
}

export function loadTwilioConfig(): TwilioConfig {
  return {
    accountSid: (process.env.TWILIO_ACCOUNT_SID || "").trim(),
    authToken: (process.env.TWILIO_AUTH_TOKEN || "").trim(),
    phoneNumber: (process.env.TWILIO_PHONE_NUMBER || "").trim(),
    publicBaseUrl: (process.env.TWILIO_PUBLIC_BASE_URL || "").trim().replace(/\/$/, "")
  };
}

export async function sendTwilioMessage(toValue: string, body: string, mediaUrls: string[]): Promise<Record<string, unknown>> {
  const config = loadTwilioConfig();
  if (!config.accountSid || !config.authToken || !config.phoneNumber) {
    throw new Error("Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.");
  }
  const fields = new URLSearchParams({ To: normalizeNumber(toValue), From: normalizeNumber(config.phoneNumber), Body: body });
  for (const url of mediaUrls) fields.append("MediaUrl", url);
  const authorization = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${authorization}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: fields,
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`Twilio rejected the message (${response.status}): ${JSON.stringify(payload)}`);
  return payload;
}

export function validateTwilioSignature(pathname: string, fields: Record<string, string>, signature: string): boolean {
  const config = loadTwilioConfig();
  if (!config.authToken || !config.publicBaseUrl || !signature) return false;
  const value = `${config.publicBaseUrl}${pathname}${Object.keys(fields).sort().map((key) => `${key}${fields[key]}`).join("")}`;
  const expected = createHmac("sha1", config.authToken).update(value).digest("base64");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
