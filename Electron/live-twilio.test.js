// Opt-in live Twilio test (PR-013). Skipped unless FORGELINK_LIVE_TWILIO=1 and
// TWILIO_* credentials are present, so CI and ordinary runs never need network
// or a real account. Run it deliberately to validate against the live API.

const assert = require("node:assert/strict");
const test = require("node:test");
const { validateTwilioCredentials } = require("./onboarding");

const enabled = process.env.FORGELINK_LIVE_TWILIO === "1";
const haveCreds = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
const skip = !enabled
  ? "set FORGELINK_LIVE_TWILIO=1 (with TWILIO_* env) to run the live Twilio test"
  : (!haveCreds ? "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER are required for the live test" : false);

test("opt-in: validates real Twilio credentials against the live API", { skip }, async () => {
  const result = await validateTwilioCredentials({
    account_sid: process.env.TWILIO_ACCOUNT_SID,
    auth_token: process.env.TWILIO_AUTH_TOKEN,
    twilio_number: process.env.TWILIO_PHONE_NUMBER,
    public_base_url: process.env.TWILIO_PUBLIC_BASE_URL || "https://example.com",
    webhook_host: "127.0.0.1",
    webhook_port: 5055
  });
  assert.equal(result.phone_number, process.env.TWILIO_PHONE_NUMBER);
  assert.ok(result.account_name, "expected an account name from the live API");
});
