// Reproducible ForgeLink killer demo (work item 017, OCX-016).
//
// Drives the full human-boundary decision lifecycle against a real local backend,
// using only synthetic data and no telecom credentials. A ForgeWire/Codex agent
// asks to publish a GitHub release; ForgeLink shows the evidence pack, the mobile
// surface gets a redacted alert, the operator approves, the agent reports the
// outcome, and ForgeLink replays the audited lifecycle.
//
// Run with `npm run demo` (builds the backend first). It is also exercised by
// killer-demo.test.js so the flow stays reproducible.

const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { randomBytes } = require("node:crypto");
const { createBackend } = require("../backend-dist/server");

const apiToken = "killer-demo-launch-token";

// Synthetic release-approval request. No real repo, contacts, or credentials.
function releaseApproval() {
  return {
    id: "demo-release-approval",
    source: "codex-demo",
    kind: "approval_request",
    urgency: "normal",
    title: "Publish GitHub release v2.1.0 (sample)",
    body: "Codex wants to publish release v2.1.0 of forgewire/forgelink-demo. (sample)",
    intent: "Publish a tagged GitHub release for the demo repository.",
    requested_action: "Create and publish GitHub release v2.1.0 from the release branch.",
    reason_for_interrupt: "Publishing a release is operator-gated and cannot proceed without approval.",
    risk: "high",
    required_authority: "general_approval",
    to_human: "operator:primary",
    affected_resources: ["repo:forgewire/forgelink-demo (sample)", "tag:v2.1.0"],
    expires_at: "2099-01-01T00:00:00.000Z",
    timeout_behavior: "deny_on_timeout",
    deny_behavior: "do_not_publish",
    expected_response_time: "15 minutes",
    no_response_behavior: "deny_on_timeout",
    can_batch: false,
    template_id: "github_release",
    actions: [{ id: "approve", label: "Approve" }, { id: "deny", label: "Deny" }],
    decision_options: [{ id: "approve", label: "Approve" }, { id: "deny", label: "Deny" }],
    evidence_pack: {
      summary: "Publish release v2.1.0: cockpit summaries, reviewed outbox, sample workspace. (sample)",
      affected_resources: ["repo:forgewire/forgelink-demo (sample)", "tag:v2.1.0"],
      diff_summary: "37 files changed, +1.2k/-180 across renderer, backend, docs. (sample)",
      proposed_operation: "gh release create v2.1.0 --notes-file RELEASE_NOTES.md (sample)",
      checks: ["unit + integration suite green (sample)", "validate_system.py passed (sample)"],
      rollback_plan: "Delete the v2.1.0 release/tag and re-point latest to v2.0.3. (sample)",
      links: ["local://sample-release-notes", "local://sample-ci-run"],
      limitations: "Synthetic demo evidence only; no live repository is touched.",
      redaction_profile: "desktop_full"
    }
  };
}

async function runKillerDemo({ log = console.log } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-killer-demo-"));
  const { server } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const launch = { Authorization: `Bearer ${apiToken}` };
  const json = async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
    return body;
  };
  try {
    log("ForgeLink killer demo — synthetic data, no telecom credentials.\n");

    log("1. Provisioning a local agent channel credential for ForgeWire/Codex…");
    const channel = await json(await fetch(`${baseUrl}/api/agent-channels`, { method: "POST", headers: { ...launch, "Content-Type": "application/json" }, body: JSON.stringify({ channel_id: "forgewire", label: "ForgeWire Fabric (demo)" }) }));
    log(`   channel ready (credential issued, not shown).\n`);

    log("2. Agent requests approval to publish a GitHub release, with an evidence pack…");
    const approval = releaseApproval();
    const created = await json(await fetch(`${baseUrl}/api/agent-channels/forgewire/messages`, { method: "POST", headers: { "Content-Type": "application/json", "X-ForgeLink-Channel-Token": channel.token }, body: JSON.stringify(approval) }));
    const id = created.message.id;
    log(`   Decisions surface shows: "${created.message.title}"`);
    log(`   evidence: tests, diff summary, version, release notes, rollback (template ${created.message.template_id}).\n`);

    log("3. Mobile surface receives a redacted alert (mobile lock-screen profile)…");
    const redacted = await json(await fetch(`${baseUrl}/api/redaction-profiles/preview`, { method: "POST", headers: { ...launch, "Content-Type": "application/json" }, body: JSON.stringify({ profile: "mobile_lock_screen", notification: { title: approval.title, body: approval.body } }) }));
    log(`   mobile shows title only, body ${redacted.notification.redacted ? "redacted" : "shown"}: "${redacted.notification.title}".\n`);

    log("4. Operator approves the request on the desktop cockpit…");
    const decided = await json(await fetch(`${baseUrl}/api/agent-messages/${encodeURIComponent(id)}/actions/approve`, { method: "POST", headers: { ...launch, "Content-Type": "application/json" }, body: JSON.stringify({ operator_alias: "operator:primary", comment: "Approved for the demo." }) }));
    log(`   decision recorded: ${decided.decision ? decided.decision.decision : "approve"} (audited).\n`);

    log("5. Agent publishes and reports the outcome back to ForgeLink…");
    await json(await fetch(`${baseUrl}/api/agent-messages/${encodeURIComponent(id)}/outcome`, { method: "POST", headers: { ...launch, "Content-Type": "application/json" }, body: JSON.stringify({ outcome_state: "action_succeeded", outcome_summary: "Release v2.1.0 published. (sample)", reported_resources: ["tag:v2.1.0"], source: "codex-demo" }) }));
    log("   outcome: action_succeeded.\n");

    log("6. ForgeLink replays the audited lifecycle…");
    const replay = await json(await fetch(`${baseUrl}/api/agent-messages/${encodeURIComponent(id)}/replay`, { headers: launch }));
    for (const step of replay.steps) log(`   - ${step.step}: ${step.summary}`);
    log(`   audit chain verified: ${replay.audit_verification.ok ? "ok" : "BROKEN"} (${replay.audit.length} entries).\n`);

    const result = { id, final_state: replay.final_state, decided: replay.decided, audit_ok: replay.audit_verification.ok, steps: replay.steps.length };
    log(`Done. final_state=${result.final_state}, decided=${result.decided}, audit_ok=${result.audit_ok}.`);
    return result;
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
}

module.exports = { runKillerDemo, releaseApproval };

if (require.main === module) {
  // Set exitCode and let the event loop drain naturally; a forced process.exit()
  // races node:sqlite handle teardown and trips a libuv assertion on Windows.
  runKillerDemo().then((result) => {
    if (!result.audit_ok || !result.decided) { console.error("Demo did not reach a clean audited outcome."); process.exitCode = 1; }
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
