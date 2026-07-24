# Porting Brokerage identity/e-sign onto Didit/SignWell (pre-merge-to-main)

**Date:** 2026-07-16
**Why:** preparing to merge this branch to `main` (per the user's request to
deploy and actually run the system), `origin/main` had moved independently
while this branch was in flight — 9 other PRs landed, including commit
`396104a0` ("Swap DocuSeal/Persona for SignWell/Didit in the SBA e-sign +
KYC stack", PR #701). That's a real vendor swap for the Underwriter
tenant's shared `kyc/service.ts`/e-sign service layer — not a simple text
conflict. This branch's entire Brokerage-side identity/e-sign build
(Ticket 2, the mock-vendor harness, `SigningPanel`) was written against
the old Persona/DocuSeal interfaces, which no longer exist on `main`.

Rather than force a merge that would either silently regress main's vendor
swap or drop this branch's Brokerage work, ported the Brokerage-side code
onto the new Didit/SignWell interfaces before merging.

## What changed on main (researched before touching anything)

- `src/lib/identity/kyc/service.ts` — `PersonaClient` → `DiditClient`
  (`createDiditSession`/`fetchDiditSession`/`getDiditSessionDecision`).
  Didit's session-create response already returns a usable `url` — no
  separate one-time-link round trip like Persona needed.
  `handlePersonaWebhook` → `handleDiditWebhook`, keyed on `session_id`
  instead of an inquiry id. New `mapDiditStatus()` bridges Didit's status
  vocabulary (`Not Started`/`Approved`/`Declined`/etc.) onto Buddy's
  internal enum. `hasValidIal2()` — **unchanged**, still the same
  cross-module invariant `requestSignature` calls.
- `src/lib/esign/docuseal/` → `src/lib/esign/signwell/` (renamed
  directory). `requestSignature()`/`handleDocusealWebhook()` →
  `requestSignature()` (same name)/`handleSignwellWebhook()`. IAL2 gate
  logic is byte-for-byte the same invariant, just calling into the same
  `hasValidIal2`. `resolveTemplateId()` still reads
  `SIGNWELL_TEMPLATE_<FORM_CODE>` directly from `process.env` — same
  non-injectable-dependency problem the old DocuSeal version had, so the
  same "can't just swap the docuseal dep, need a parallel mock initiation
  function" design from the original mock harness still applies.
  SignWell has no separate audit-trail artifact (it's embedded in the
  completed PDF itself), so `SignwellClient` has one fewer method than
  `DocusealClient` did.
- Migration `20260715_signwell_didit_vendor_swap.sql` renamed
  `signed_documents.docuseal_submission_id`/`docuseal_submitter_id` to
  `esign_document_id`/`esign_signer_id` **in place** (zero rows existed in
  either environment, so this was a rename, not a backfill) and added
  `esign_provider` as the vendor discriminator column.
  `borrower_identity_verifications.vendor`'s CHECK constraint kept
  `'persona'` for "vendor neutrality" but changed its default to `'didit'`.
- Confirmed via research (not touched by 396104a0 at all): zero
  Brokerage-tenant awareness of this swap existed anywhere before this
  pass — the Underwriter tenant and Brokerage tenant share these same
  tables/service functions, so Brokerage was simply behind, not immune.

## What was ported

- `src/lib/identity/kyc/service.ts` — re-applied this branch's
  `InitiateKycArgs.vendorOverride` (optional, test-mode-only vendor tag)
  on top of main's Didit-based rewrite; default changed from `"persona"`
  to `"didit"` to match main's real default.
- `src/lib/identity/kyc/mockPersona.ts` → **deleted**, replaced by new
  `src/lib/identity/kyc/mockDidit.ts` matching `DiditClient` exactly.
  Simpler than its predecessor: since Didit's session-create response
  already carries a usable `url`, the mock's `createDiditSession` builds
  the mock-completion URL directly (parsing `dealId` out of the
  `vendorData` string `deal:<dealId>:owner:<ownershipEntityId>`) — no
  closure trick needed to thread `dealId` through a separate one-time-link
  call the way the old Persona mock required.
- `src/lib/esign/docuseal/mockClient.ts`/`mockService.ts` → moved to
  `src/lib/esign/signwell/` and rewritten against `SignwellClient` (3
  methods, not 4 — no mock audit-trail download needed).
  `mockRequestSignature()` still reimplements just the initiation step
  (reusing the real `hasValidIal2` gate) since `resolveTemplateId()`
  remains non-injectable; completion still delegates to the real
  `handleSignwellWebhook()` with the mock client injected.
- `src/app/api/brokerage/deals/[dealId]/borrower-actions/[action]/route.ts`
  — full port: Didit deps/`workflowId` (env var `DIDIT_WORKFLOW_ID`,
  matching main's Underwriter route) for `kyc`; SignWell deps for `esign`;
  `signed_documents` lookup column renamed
  `docuseal_submission_id`→`esign_document_id`; response field names
  (`oneTimeLink`, `submission_id`, `embed_url`) kept **unchanged** at the
  API boundary — main's own Underwriter route does the same thing
  (`oneTimeLink: result.sessionUrl` for backward compat), so no changes
  were needed in `IdentityVerificationCard.tsx` or `SigningPanel.tsx` at
  all. The vendor swap is entirely internal to the route/service layer.
- Migration: deleted the now-obsolete `20260715_add_mock_persona_vendor.sql`
  (a "mock_persona" CHECK-constraint value with no callers left) and
  replaced it with `20260716_add_mock_didit_vendor.sql` adding
  `'mock_didit'` to the CHECK constraint's *current* (post-swap) value
  list. Applied live; verified via `pg_constraint`.
- Test files ported: `mockDidit.test.ts` (renamed from
  `mockPersona.test.ts`), `signwell/__tests__/mockClient.test.ts` and
  `mockService.test.ts` (moved + rewritten), and the cross-function
  integration test `mockVendorE2eChain.test.ts` (same call sequence,
  Didit/SignWell functions and payload shapes). One assertion needed a
  real fix, not just a rename: the integration test asserted
  `deal_events.kind === "kyc.verification_completed"`, but Didit's
  `"Approved"` status maps to Buddy's `"approved"` (a different, but
  equally valid, terminal-success string than `"completed"`) — caught by
  actually running the test, not just by inspection.

## Everything else in the merge

Two straightforward conflicts (`scripts/discover-tests.mjs`'s quarantine
set, an import-ordering conflict in `StartConciergeClient.tsx`) were
simple keep-both resolutions. `marketplace/pick/route.ts` had a genuine
concurrent addition on both sides — main added final trident-bundle
generation at pick time; this branch added the SBA-forms-prepare trigger —
git's 3-way merge resolved this correctly on its own (confirmed both
blocks survived by grepping the merged file). The other ~215 changed files
are main's own independent work (borrower portal retirement, voice
platform swap, RLS hardening migrations, etc.) — untouched by this port.

## Verification

`npx tsc -p tsconfig.json --noEmit` clean on the fully merged tree. Full
`pnpm test:unit`: 11,643 passed, 0 failed (one real failure found and
fixed during this pass — the stale `"kyc.verification_completed"`
assertion described above). `routeConsolidationGuard.test.ts` still passes
— the port touched no route.ts files (net), just their contents.
