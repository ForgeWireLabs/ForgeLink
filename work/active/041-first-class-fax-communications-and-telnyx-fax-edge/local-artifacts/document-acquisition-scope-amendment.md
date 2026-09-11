# WI041 scope amendment — managed document acquisition, scan, and cloud import

**Date:** 2026-09-10  
**Status:** Binding scope amendment for WI041  
**Purpose:** Expand the human fax document-input path beyond a local filesystem upload while preserving ForgeLink's local-first, provider-neutral fax architecture.

## Product requirement

A person creating a fax in ForgeLink must be able to acquire the source document from the places people actually keep documents, without needing an agent, ForgeWire, an LLM, or Telnyx-specific knowledge.

The required acquisition families are:

- device camera / multi-page document scan;
- local or device file picker;
- Android/iOS native document-provider surfaces, including cloud-backed providers exposed by the operating system;
- Google Drive;
- OneDrive / SharePoint;
- Dropbox;
- future cloud/document providers through an extensible provider contract.

The user-facing model is intentionally simple:

```text
New Fax
  -> Add document
       -> Scan with camera
       -> Choose from device
       -> Google Drive
       -> OneDrive / SharePoint
       -> Dropbox
       -> More…
  -> prepare / preview exact pages
  -> send
```

The implementation may collapse some entries into the native platform picker when the operating system already exposes those providers. ForgeLink must not force a separate OAuth flow merely to duplicate a secure native picker capability that is already available. Explicit provider integrations remain required as an architectural capability for desktop/web-style use, providers not surfaced by the OS, and workflows requiring provider-native export semantics.

## Architectural boundary

Document origin is an acquisition concern, not a fax-provider concern.

Every acquisition path converges into one ForgeLink-owned managed local artifact before fax preparation or submission:

```text
Camera / scanner
Local file
Native document provider
Google Drive
OneDrive / SharePoint
Dropbox
Other provider
       |
       v
DocumentAcquisitionService
       |
       v
ManagedDocumentRef
  - stable local identity
  - immutable managed local artifact
  - content hash
  - content type
  - byte size
  - page count when known
  - source kind / provenance
  - display name
  - acquisition timestamp
  - retention / deletion state
       |
       v
DocumentPreparation
  - crop / perspective correction
  - rotate
  - reorder pages
  - normalize / convert
  - preview
  - compose fax-ready document
       |
       v
FaxDocumentRef
       |
       v
FaxSubmissionService
       |
       v
TelnyxFaxProvider
```

`TelnyxFaxProvider` must never need to know whether a document came from a phone camera, Google Drive, Dropbox, OneDrive, a native document provider, or local disk.

A remote provider URL, OAuth token, provider file ID, temporary signed download URL, or camera-library URI is not the durable fax document identity. Once acquisition completes, ForgeLink's managed local artifact becomes authoritative for preparation, content identity, approval binding, retention, and submission.

## Provider-neutral acquisition contract

The reusable acquisition layer should follow a contract equivalent to:

```text
DocumentSourceKind
  camera
  local_file
  native_document_provider
  google_drive
  onedrive
  sharepoint
  dropbox
  other

DocumentSourceProvider
  capabilities()
  select()
  inspect()
  import()
  cancel?()

DocumentAcquisitionService
  acquire(source selection)
  validate()
  materializeManagedCopy()
  hash()
  finalize()

ManagedDocumentRef
  id
  contentType
  byteSize
  contentSha256
  pageCount?
  displayName?
  sourceKind
  sourceProvenance?
```

Names may change to match repository conventions. The separation is binding.

The acquisition contract should be reusable outside fax by email attachments, messaging/media workflows, approvals, signatures, and future document-centric ForgeLink capabilities. WI041 may consume the first implementation, but it must not create a fax-only Google Drive client or fax-only camera subsystem if a reusable ForgeLink document layer is practical.

## Camera / scanner path

Camera support is a document-scanning workflow, not merely an image attachment.

The target human flow is:

```text
capture page
  -> detect/confirm page bounds
  -> crop / perspective correction
  -> rotate
  -> optional local contrast / monochrome cleanup
  -> add another page
  -> remove / reorder pages
  -> preview exact page sequence
  -> produce managed fax-ready PDF/document
```

Requirements:

- multi-page capture;
- page add/remove/reorder;
- crop and rotation;
- perspective correction / deskew where practical;
- local image normalization sufficient for readable fax output;
- exact-page preview before send;
- no mandatory OCR;
- no mandatory cloud processing;
- no mandatory LLM/vision model;
- source camera images and temporary renders participate in explicit cleanup/retention policy.

OCR may later be offered as an optional local or explicitly-consented capability, but basic fax must work without it.

## Device and native document pickers

Desktop and mobile must use native platform document/file picking where appropriate rather than exposing arbitrary filesystem paths directly to the renderer.

On Android and iOS, installed cloud-storage applications may appear through native document-provider/file-provider surfaces. When a provider is safely available through the native picker, selecting it through that system surface may satisfy the ordinary user path without ForgeLink independently implementing that provider's OAuth flow.

Acquisition must still materialize a ForgeLink-managed local copy before fax preparation. A transient content URI, security-scoped URL, bookmark, or provider handle may be used only long enough to perform the authorized import unless the platform requires a narrowly scoped durable permission for a documented reason.

## Google Drive

ForgeLink must support Google Drive as an explicit provider integration in addition to any native-picker exposure.

The integration must distinguish ordinary binary Drive files from Google Workspace-native documents.

Ordinary binary files may be downloaded through the provider boundary and imported into ForgeLink's managed document store.

Google Docs, Sheets, Slides, and other Workspace-native files must not be treated as ordinary downloadable file blobs. Where supported, the acquisition provider exports them to a fax-appropriate representation, with PDF preferred when it faithfully represents the document.

The resulting exported bytes are then validated, hashed, and stored as the ForgeLink-managed artifact. The Google access token, Drive file ID, export URL, and temporary network response are not the fax document reference.

## OneDrive / SharePoint and Dropbox

OneDrive / SharePoint and Dropbox follow the same boundary:

```text
provider selection
  -> authorized fetch/export through provider adapter
  -> bounded local import
  -> validate
  -> hash
  -> ForgeLink managed document
```

Provider-specific IDs/tokens/URLs remain acquisition metadata at most; they do not leak into `FaxRequest`, `FaxDocumentRef`, Telnyx request construction, MCP fax projections, or durable evidence unless a separately reviewed minimal provenance field explicitly requires them.

## Security and privacy invariants

All acquisition paths must enforce the following before an artifact becomes fax-sendable:

1. bounded size and resource use;
2. supported type validation using content-aware checks where practical, not extension alone;
3. content hash / immutable identity;
4. path and URI safety;
5. safe handling of symlinks/reparse points for local imports;
6. bounded remote redirects and HTTPS/provider-origin policy for explicit cloud imports;
7. no cloud OAuth tokens in SQLite fax records, logs, evidence, renderer DTOs, MCP responses, or Telnyx payloads;
8. no temporary authenticated cloud URLs as durable document references;
9. explicit cancellation and partial-download cleanup;
10. cleanup of camera originals, temporary conversions, previews, and failed imports according to retention policy;
11. no hidden OCR, AI, LLM, or unrelated cloud egress;
12. content identity must remain stable across preparation/approval/submission; changing the bytes after approval must invalidate or rebind approval under the fax governance phase.

WI040 remains authoritative for regulated-data classification/provider eligibility/retention policy. This amendment adds acquisition mechanics and security boundaries, not a compliance certification.

## Fax integration requirement

FAX-009 now includes acquisition as well as preparation.

The completed fax product must be able to take a source from camera, device/native picker, Google Drive, OneDrive/SharePoint, Dropbox, or another supported provider and converge it into the same managed local fax-document pipeline.

The fax domain may then prepare/compose the exact transmission artifact and pass only a `FaxDocumentRef` into `FaxSubmissionService` / `TelnyxFaxProvider`.

The current Phase 2 Telnyx local-file `contents` resolver remains valid as the final provider-side consumer of a managed local document. This amendment does not authorize Telnyx to fetch directly from a user's cloud drive or camera source.

## Work-item factoring

This capability is intentionally broader than fax. A separate cross-cutting ForgeLink work item may own the reusable Managed Document Acquisition subsystem, with WI041 coordinating/consuming it. At the time of this amendment, work-item ID 043 appears unclaimed, but this amendment does **not** create or activate WI043.

If the work is split later:

- the reusable acquisition subsystem owns source providers, native picker/camera integration, secure cloud auth, managed import, hashing, conversion/export seams, and generic document retention mechanics;
- WI041 remains responsible for the fax-specific preparation/preview requirements, `FaxDocumentRef` binding, send authority, fax UI integration, and proving the end-to-end acquisition-to-fax experience;
- WI041 must not be marked complete merely because a reusable document subsystem exists; the human fax workflow must actually consume it.

## Scope timing

This amendment does not alter the current Phase 2.1 outbound-edge hardening boundary and does not authorize unrelated implementation during that correction slice.

The acquisition architecture must be consumed before FAX-008/FAX-009 and final end-to-end closeout can be considered complete.

FAX-016 remains a separate opt-in live Telnyx acceptance gate.
