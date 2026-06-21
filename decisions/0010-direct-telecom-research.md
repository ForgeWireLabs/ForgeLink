---
id: 0010
title: Direct Telecom Research
status: accepted
date: 2026-06-20
supersedes: []
---

# 0010: Direct Telecom Research

## Context

Work item 015 (CLV-019) asks what it would take for ForgeLink to reduce
reliance on application telecom providers such as Twilio, Telnyx, Plivo, or
Bandwidth for carrier SMS/MMS and PSTN voice.

ForgeLink already owns the local communications runtime: contacts, policy,
message and call state, approvals, diagnostics, exports, and local UI. Direct
telecom is a different boundary. It means operating closer to carrier networks,
telephony trust frameworks, phone-number assignment, emergency calling,
anti-abuse programs, and ongoing compliance.

This is a product and architecture research record, not legal advice and not a
shipping decision.

## Decision

ForgeLink will not pursue direct carrier telecom as the first implementation
path. The current best path is:

1. Keep ForgeLink's local runtime provider-neutral.
2. Use commercial telecom edge providers for SMS/MMS and PSTN voice while the
   product matures.
3. Add provider conformance tests before expanding beyond the existing edges.
4. Revisit more direct telecom only when there is a concrete deployment that can
   fund compliance, operations, carrier relationships, number inventory,
   emergency-service handling, and abuse monitoring.

If ForgeLink later needs a more direct telecom edge, the lowest-friction path is
not immediate carrier interconnect. It is a staged telecom edge:

1. Voice: SIP trunk or BYOC-style carrier connection through a regulated
   carrier/trunking partner, with ForgeLink still treating the partner as an
   edge adapter.
2. Messaging: aggregator or carrier-approved SMPP access only after A2P/10DLC,
   toll-free, or short-code requirements are owned by an operator/compliance
   function.
3. Direct carrier partnership or SMSC/MMSC access only after volume,
   compliance, support, and economics justify it.

## Findings

### SIP trunking

SIP trunking can reduce reliance on programmable voice APIs, but it does not
remove the PSTN edge. It moves ForgeLink toward operating SIP infrastructure:
session border controller or SIP server, authentication, IP allow-lists,
origination/termination routing, codec/bandwidth planning, failover, fraud
controls, call recording policy, emergency calling configuration, CNAM, and
STIR/SHAKEN treatment.

Twilio's SIP trunking documentation is a useful example of the surface area:
trunks include termination, origination, number assignment, IP access control
lists, credential lists, emergency calling, CNAM, and STIR/SHAKEN features
([Twilio Elastic SIP Trunking](https://www.twilio.com/docs/sip-trunking)).

ForgeLink implication: SIP is plausible as a future voice edge, but it should be
an adapter behind the existing voice contract. It is not a replacement for local
policy, call history, diagnostics, or operator controls.

### SMPP, SMSC, and MMSC access

SMPP can provide lower-level SMS connectivity, and SMSC/MMSC access is closer to
carrier messaging infrastructure. These paths usually require commercial
agreements, throughput commitments, abuse controls, deliverability operations,
number/campaign registration, carrier-specific error handling, opt-out handling,
support escalation, and 24/7 operational posture.

ForgeLink implication: SMPP or direct SMSC/MMSC access is not a near-term
desktop-app feature. It would be a separate telecom gateway product or managed
operator deployment, still feeding normalized events into ForgeLink's messaging
contract.

### Phone number provisioning

Direct telecom needs number inventory or number assignment through a provider,
carrier, reseller, or numbering partner. Number ownership affects inbound
routing, portability, caller ID, messaging eligibility, emergency location,
brand trust, campaign approval, cost, and support.

ForgeLink implication: phone numbers remain provider-edge resources. ForgeLink
should store only normalized provider IDs and number metadata needed for local
state, avoiding claims that it owns the phone network identity.

### A2P/10DLC

US application-to-person messaging over 10-digit long codes depends on brand and
campaign registration, vetting, content/use-case constraints, opt-in/opt-out
expectations, and carrier filtering. Twilio describes A2P 10DLC as an ecosystem
trust program tied to registration rather than a Twilio-only feature
([Twilio A2P 10DLC](https://help.twilio.com/articles/4408675845019-SMS-Compliance-and-A2P-10DLC-in-the-US)).

ForgeLink implication: direct SMS does not bypass A2P/10DLC. The product must
continue to represent campaign/compliance state as edge-provider or deployment
state, not as a property of the local ForgeLink runtime.

### STIR/SHAKEN, caller ID reputation, and CNAM

The FCC's caller-ID authentication work requires voice providers to implement
STIR/SHAKEN in IP voice networks, with the goal of reducing spoofed robocalls
([FCC caller ID authentication](https://www.fcc.gov/call-authentication)).
Twilio's trusted-calling documentation shows how attestation and verification
data surface in provider callbacks and SIP headers
([Twilio Trusted Calling](https://www.twilio.com/docs/voice/trusted-calling-with-shakenstir)).

CNAM and caller reputation are adjacent operating concerns. CNAM data may be
looked up or registered through provider/carrier workflows; reputation depends
on call behavior, complaint rates, answer rates, attestation, labels, analytics,
and remediation processes.

ForgeLink implication: ForgeLink can display provider-reported trust and CNAM
signals, but should not claim full attestation or reputation control unless it
owns the required carrier/provider enrollment and operations.

### E911 and emergency scope

The FCC requires interconnected VoIP services using the PSTN to meet Enhanced
911 obligations, including emergency routing and registered-location behavior
([FCC VoIP and 911 guide](https://www.fcc.gov/consumers/guides/voip-and-911-service)).
Emergency calling changes the product's risk profile dramatically: location
collection, updates, disclaimers, routing, testing, support, outage behavior,
and jurisdictional requirements become core obligations.

ForgeLink implication: emergency calling remains explicitly out of scope until a
separate emergency-services work item exists. The current voice implementation
must continue to present call control and call history only.

### Toll-free and short-code messaging

Toll-free and short-code messaging can improve deliverability or brand posture
for some use cases, but both add approval, vetting, cost, throughput,
content-policy, and support obligations. They are campaign infrastructure, not a
local runtime primitive.

ForgeLink implication: these should be modeled as future messaging-edge
capabilities only when an operator has a concrete use case and compliance owner.

### Carrier partnership and operating costs

A more direct telecom path requires more than software:

- carrier, aggregator, numbering, or trunking contracts;
- compliance owner and legal review;
- campaign registration and ongoing content governance;
- number inventory, porting, renewals, and support;
- abuse, fraud, spam, and robocall monitoring;
- emergency calling posture where applicable;
- uptime, failover, observability, and escalation processes;
- billing, tax/regulatory fee awareness, and cost controls;
- test numbers, staging accounts, and live-network validation.

ForgeLink implication: the cost center moves from provider fees to operating a
telecom edge. That is not justified until ForgeLink has enough volume,
deployment specificity, or control requirements to pay for the complexity.

## Capability Boundary

| Capability | ForgeLink can own locally | Requires telecom edge or carrier ecosystem |
| --- | --- | --- |
| Contacts, policy, attention, approvals | Yes | No |
| Local inbox/outbox and call ledger | Yes | No |
| SMS/MMS to ordinary phone numbers | Adapter contract only | Yes |
| PSTN voice calls | Local call state/control only | Yes |
| SIP signaling | Possible future adapter | Trunk/provider/carrier path |
| SMPP/SMSC/MMSC | Gateway integration only | Contracts, carrier/aggregator access |
| Phone number assignment | Metadata and routing config | Numbering/provider/carrier partner |
| A2P/10DLC | Store/display compliance state | Registration/vetting/carrier filtering |
| STIR/SHAKEN | Store/display attestation state | Provider/carrier authentication |
| CNAM and reputation | Store/display reported state | Registry/provider/carrier operations |
| E911 | Out of scope until explicit item | Emergency routing/location obligations |

## Future Work Gate

Before ForgeLink opens any direct-telecom implementation item, that item must
name:

- target geography and service type;
- whether the work is voice, SMS/MMS, or both;
- provider, trunk, aggregator, or carrier partner;
- number provisioning and portability path;
- A2P/10DLC, toll-free, short-code, or campaign requirements;
- STIR/SHAKEN, caller-ID, CNAM, and reputation approach;
- emergency-calling stance, including explicit non-support if E911 is out of
  scope;
- fraud/abuse monitoring and opt-out handling;
- deterministic conformance tests and opt-in live-network tests;
- cost model and rollback plan.

## Consequences

- ForgeLink remains honest about what local software can own versus what carrier
  networks require.
- Current provider-neutral contracts stay valuable because a future SIP/SMPP
  edge can plug into the same local model.
- Direct telecom research does not block CLV-020 local-only onboarding,
  CLV-021 provider conformance tests, or CLV-022 migration coordination.
- Emergency calling, caller-ID reputation, CNAM, STIR/SHAKEN, and SMS compliance
  remain explicit future gates rather than implied features.
