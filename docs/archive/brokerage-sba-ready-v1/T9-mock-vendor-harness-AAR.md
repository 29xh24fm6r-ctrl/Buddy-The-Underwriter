# Mock Persona/DocuSeal vendor harness — unblocks a full E2E walkthrough

**Date:** 2026-07-15
**Why:** Persona and DocuSeal credentials are not provisioned in this
environment (confirmed multiple times this session), and the official
SBA/IRS PDF templates can't be ingested either (proxy policy explicitly
denies sba.gov/irs.gov). That's blocked a full end-to-end walkthrough of
the Brokerage borrower flow. This harness lets identity verification and
e-signature complete for real — exercising every real gate, DB write, and
state transition — without touching either vendor or needing network
access.

## Design principle: fake the vendor call, never fake the business logic

Every real invariant still runs in mock mode:
- The IAL2-gates-signing hard gate (principle #17) — checked at request
  time (`hasValidIal2`) and re-checked at completion time
  (`handleDocusealWebhook`'s defense-in-depth check) — is the exact same
  code path real DocuSeal traffic uses. A test walkthrough that tries to
  sign before verifying identity gets the same `IAL2_NOT_COMPLETED` a real
  attempt would.
- Completion (`handlePersonaWebhook`, `handleDocusealWebhook`) is the real
  function, not a mock of the webhook handler — only the vendor HTTP calls
  it depends on (`fetchPersonaInquiry`, `fetchDocusealSubmission`,
  `downloadDocusealSignedPdf`/`downloadDocusealAuditTrail`) are swapped for
  fakes. Real DB writes (`borrower_identity_verifications`, `deal_events`,
  `signed_documents`), real storage uploads, and the real audit trail all
  happen.
- The one function that ISN'T a thin reuse: `requestSignature()`
  (e-signature initiation) calls `resolveTemplateId()`/`buildEmbedUrl()`
  internally, which read `DOCUSEAL_TEMPLATE_<FORM_CODE>`/
  `DOCUSEAL_BASE_URL_PUBLIC` directly from `process.env` — not injected
  dependencies, so no mock client swap can reach them. `mockService.ts`'s
  `mockRequestSignature()` reimplements just the initiation step (still
  calling the real `hasValidIal2` for the gate), and hands off to the same
  real `handleDocusealWebhook` for completion.

## Safety: a fake identity verification or signature must never look real

Double-gated: `isMockVendorsEnabled()` requires `BUDDY_MOCK_VENDORS ===
"true"` **and** `NODE_ENV !== "production"` — either check alone is a
single point of failure. Mock KYC rows are tagged `vendor: "mock_persona"`
(a new migration extends the CHECK constraint; `initiateKyc` got an
optional `vendorOverride` param, defaulting to `"persona"` for every real
caller). Mock-complete endpoints unconditionally 404 when the flag is off,
regardless of what query params are supplied. Every mock-mode HTML
confirmation page is labeled `[TEST MODE]` and states outright it isn't a
real verification/signature.

## What shipped

- `src/lib/testMode/mockVendors.ts` — the gate.
- `src/lib/identity/kyc/mockPersona.ts` — mock `createPersonaInquiry`/
  `fetchPersonaInquiry` (always reports "completed") /
  `buildMockPersonaOneTimeLink` (points at a new `mock-complete-kyc`
  action instead of a hosted Persona page).
- `src/lib/esign/docuseal/mockClient.ts` — mock DocuSeal fetch/download
  functions; `mockDownloadDocusealSignedPdf` generates a real, loadable
  one-page PDF via `pdf-lib` (not garbage bytes) so downstream storage/
  assembly code never chokes on it.
- `src/lib/esign/docuseal/mockService.ts` — `mockRequestSignature`, the
  parallel initiation function described above.
- `src/app/api/brokerage/deals/[dealId]/borrower-actions/[action]/route.ts`
  — `postKyc`/`postEsign` now branch on `isMockVendorsEnabled()` (kyc route
  reuses the real `initiateKyc` with mock deps; esign route calls
  `mockRequestSignature` instead of the real `requestSignature`). Two new
  GET actions, `mock-complete-kyc`/`mock-complete-esign` — what the mock
  one-time-link/embed_url actually open, returning a real HTML
  confirmation page so a browser-driving test can click through instead of
  the flow silently completing itself. Folded into the existing dispatcher
  rather than new route files — route count is unaffected (765, same
  1902/1904 slot budget as before).
- `src/lib/identity/kyc/service.ts` — added `InitiateKycArgs.vendorOverride`
  (optional, defaults to `"persona"` — no behavior change for real
  callers).
- `supabase/migrations/20260715_add_mock_persona_vendor.sql` — extends
  `borrower_identity_verifications`'s vendor CHECK constraint to allow
  `mock_persona`. Applied live and verified.
- `src/components/brokerage/SigningPanel.tsx` — new borrower-facing e-sign
  trigger, mirroring the Underwriter tenant's `SbaSigningPanel.tsx` (owner
  × form grid). Not test-mode-specific — it calls the same generic esign
  action real traffic would, and functions identically whether DocuSeal is
  real or mocked; the server decides that transparently. Wired into
  `/start` after `IdentityVerificationCard`. This is a genuine, if minimal,
  piece of the Ticket 2 e-sign UI that was previously deferred — deferred
  because Brokerage has no per-owner SBA form *generation* pipeline yet
  (a separate concern, still true), but the signing *action* itself never
  actually depended on that pipeline (see the T7 AAR's corrected framing) —
  so building this doesn't contradict that earlier deferral.

## Verification

Beyond per-module unit tests (14 new: gate logic, mock Persona shape, mock
DocuSeal shape including a real-PDF-bytes check, mock signature-request
gate enforcement), wrote one integration test
(`src/lib/brokerage/__tests__/mockVendorE2eChain.test.ts`) that chains the
REAL functions together in the order a borrower would actually trigger
them: initiate KYC → attempt to sign before verification (confirms it's
blocked) → complete KYC via the real webhook handler → sign successfully →
complete signing via the real webhook handler → assert `signed_documents`
got a real row with a real storage upload and the full `deal_events` audit
trail is present. This is the one that actually de-risks the harness — the
per-module tests alone wouldn't have caught a wiring mismatch between the
pieces.

`npx tsc -p tsconfig.json --noEmit` clean. Full `pnpm test:unit`: 11,604
passed, 0 failed (up from 11,589 — 15 new tests). Route count and slot
budget unchanged.

## How to actually run the E2E walkthrough

Set `BUDDY_MOCK_VENDORS=true` in the environment running the dev server
(and confirm `NODE_ENV` isn't `production` — it won't be in a normal `next
dev` run). From there, the `/start` borrower flow works exactly as it
would with real vendors, end to end: intake → identity verification (click
"Verify identity," a same-tab-domain confirmation page opens instead of a
real Persona hosted flow) → seal → marketplace claim/pick → sign (click
"Sign \<form\>," same pattern). Nothing else needs to change — no seed
data requirements beyond what the concierge flow already produces, no new
accounts, no deployment.
