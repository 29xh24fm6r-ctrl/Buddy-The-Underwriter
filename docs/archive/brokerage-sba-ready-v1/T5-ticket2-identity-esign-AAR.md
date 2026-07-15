# Ticket 2 — Identity verification (Persona IAL2) + e-signature (DocuSeal) for Brokerage borrowers

**Date:** 2026-07-15
**Status:** identity verification — closed. E-signature — API layer shipped,
borrower-facing signing UI explicitly deferred (see below). No written spec
existed for Ticket 2 before this pass (confirmed via repo search — the
roadmap and an earlier AAR both note "Ticket 2, which doesn't exist yet").

## What existed already (ARC-00, Underwriter tenant)

`src/lib/identity/kyc/persona.ts`, `src/lib/identity/kyc/service.ts`,
`src/lib/esign/docuseal/client.ts`, `src/lib/esign/docuseal/service.ts` —
all tenant-agnostic pure functions/HTTP wrappers, parameterized by
`dealId`/`bankId`/`ownershipEntityId`, not hardcoded to a specific tenant.
The IAL2-gates-signing invariant (principle #17 of
`specs/sba-30min-package/SPEC-S3-identity-and-esign.md`) lives entirely in
`esign/docuseal/service.ts`'s `requestSignature()` (request-time gate) and
`handleDocusealWebhook()` (completion-time re-check) — both reusable
unchanged.

What was **not** reusable: `/api/deals/[dealId]/kyc` and
`/api/deals/[dealId]/esign`, the two routes that expose those libraries.
Both call `assertDealAccess()` → Clerk session + `bank_user_memberships`
row. A Brokerage borrower authenticates via a cookie session
(`getBorrowerSession()`, `src/lib/brokerage/sessionToken.ts`) with no
Clerk user and no bank membership — a genuine auth-model mismatch, not
just missing wiring. DB tables (`borrower_identity_verifications`,
`signed_documents`) needed no schema change; RLS is banker-only but every
route (old and new) uses `supabaseAdmin()`, so this doesn't block.

## What shipped this pass

1. **`src/app/api/brokerage/deals/[dealId]/identity/[action]/route.ts`** —
   a single consolidated dispatcher (`action` = `"kyc" | "esign"`) rather
   than two separate route files, to stay under the route/page slot budget
   (`routeConsolidationGuard.test.ts` — adding two new route files pushed
   the total to exactly the 1904-slot warning threshold; consolidating
   into one `[action]` file, the same pattern already used for
   `model-v2/[action]` and `research/[action]`, kept it at 1902). Cookie-
   authed via `getBorrowerSession()`, mirroring `seal/route.ts` and
   `marketplace/pick/route.ts` (`session.deal_id !== dealId` → 404, not
   403 — same invariant as every other Brokerage route). Every owner
   lookup additionally checks `ownership_entities.deal_id = dealId` before
   acting, so a borrower on deal A cannot request a KYC/esign action
   against an `ownershipEntityId` belonging to deal B — a defensive check
   the Underwriter-tenant route doesn't need (Clerk + bank-membership
   already scopes it) but a cookie-session route does.
   - `kyc` GET (no query) returns every owner at/above the 20% ownership
     threshold (`requiresPersonalPackage()`, `src/lib/ownership/rules.ts`)
     plus their IAL2 status; GET `?ownershipEntityId=` returns one owner's
     latest verification record; POST initiates a Persona inquiry via the
     unchanged `initiateKyc()`.
   - `esign` GET `?submissionId=` returns submission status; POST calls
     the unchanged `requestSignature()` — deliberately generic on
     `form_code`, same as the Underwriter route (see "deferred" below for
     why there's no fixed form list).
2. **`src/lib/brokerage/identityVerificationGate.ts`** — new shared helper,
   `ownersNeedingIal2(dealId, sb)`, used by both the sealing gate and (in
   spirit) the status route, so there's one definition of "which owners
   need IAL2" instead of two that could drift.
3. **`src/lib/brokerage/sealingGate.ts`** — added gate #6: every owner
   returned by `ownersNeedingIal2` blocks `canSeal()`, with one
   human-readable reason per unverified owner (e.g. "Jane Doe has not
   completed identity verification yet.").
4. **`src/components/brokerage/IdentityVerificationCard.tsx`** — new
   borrower-facing card, same visual grammar as `SealPackageCard.tsx`.
   Lists majority owners, shows IAL2 status, "Verify identity" button opens
   the Persona one-time link in a new tab (same UX as the Underwriter
   tenant's `SbaSigningPanel.tsx`). Renders nothing if there are no owners
   yet or every majority owner is already verified. Wired into
   `src/app/(borrower)/start/StartConciergeClient.tsx`, immediately before
   `SealPackageCard`.
5. Tests: `src/lib/brokerage/__tests__/identityVerificationGate.test.ts`
   (5 cases — threshold boundary, verified/unverified, mixed roster) and 4
   new cases added to `src/lib/brokerage/__tests__/sealingGate.test.ts`
   (below-threshold owner doesn't block, unverified majority owner blocks
   with the right name in the reason, verified majority owner doesn't
   block, multiple unverified owners each get their own reason). The
   existing stub in `sealingGate.test.ts` needed extending — it had no
   `ownership_entities`/`borrower_identity_verifications` table support
   and no thenable fallback for non-`.maybeSingle()`-terminated queries
   (`ownersNeedingIal2`'s owner-list lookup doesn't end in
   `.maybeSingle()`) — without that extension the new gate call would have
   thrown a `TypeError` on `owners.filter` against an un-awaited query
   builder. Caught by running the suite, not by inspection.

## Default sequencing decision (documented, not Matt's sign-off — see rationale)

No written spec exists for Ticket 2, and nothing in the repo (specs,
AARs, master plan) addresses whether Brokerage e-signing should happen
before sealing/listing, before the borrower picks a lender, or only after.
Since "finish all remaining work" requires a decision to build against,
here is the default this pass implemented, with reasoning, flagged for
Matt to override:

- **Identity verification (IAL2) gates sealing.** A borrower cannot list
  their package on the marketplace until every majority owner has
  completed IAL2. Rationale: this establishes the package's authenticity
  for every matched lender viewing a blind listing, independent of which
  lender eventually wins — the same "prove this deal is real before we
  show it to lenders" role the existing score/eligibility/validation gates
  already play in `canSeal()`.
- **E-signature of the actual SBA forms happens after the borrower picks a
  winning lender**, not before or during the blind marketplace phase.
  Rationale: signing lender-facing disclosure forms before knowing which
  lender wins invites re-signing/voided-form churn if the deal changes
  hands during claiming, and the marketplace model is explicitly blind
  until pick. This is *not* wired into a gate yet (see below) since the
  form-generation pipeline it would gate doesn't exist for Brokerage.

## What's deliberately deferred, and why

**Brokerage does not generate per-owner SBA forms (1919, 413, etc.) at
all** — confirmed by grep: zero references to `buildForm1919Input`,
`sbaFormDispatch`, `FORM_1919`, or `FORM_413` anywhere under
`src/lib/brokerage/` or `src/app/api/brokerage/`. The Underwriter tenant's
`SbaSigningPanel.tsx` has a `TRACKED_FORMS` grid to sign against because
`sbaFormDispatch.ts` actually produces those forms for that tenant.
Brokerage's package today is the Trident bundle (business plan,
projections, Sources & Uses, balance sheet — see Ticket 5) — a different
kind of artifact, not a per-owner SBA form set.

Building a borrower-facing signing UI now would mean fabricating a grid of
forms that don't exist yet for this tenant — the same "never fabricate,
fail closed" convention this session has followed elsewhere. Instead, the
`esign` action of the new dispatcher route is generic on `form_code` (not
hardcoded to a fixed list), so it is immediately usable the moment
Brokerage's own form-generation pipeline exists — no further route changes
needed. That form-generation work is out of scope for Ticket 2 as written
and is its own, larger ticket.

**The principal-residence certification attestation** (referenced in
`specs/follow-ups/SPEC-BROKERAGE-SBA-READY-V1-principal-residence-certification.md:26`
as deferred into "the e-signature ceremony") is likewise blocked on that
same signing UI not existing yet — tracked, not forgotten.

## Verification

`npx tsc -p tsconfig.json --noEmit` clean. Full `pnpm test:unit`: 11,577
passed, 0 failed (up from 11,568 before this ticket — 9 new tests: 5 in
`identityVerificationGate.test.ts`, 4 new cases added to
`sealingGate.test.ts`). `routeConsolidationGuard.test.ts`'s slot-budget
check passes at 1902/1904 (route count unchanged net — two candidate
route files consolidated into one).

## Environmental blockers (unchanged from ARC-00)

Neither Persona nor DocuSeal is provisioned in this environment
(`PERSONA_API_KEY`/`DOCUSEAL_API_TOKEN` unset — both clients throw clear
config errors, same as the Underwriter tenant). This ticket is code/route
wiring only, not live vendor testing, same constraint as the rest of
ARC-00 and every other vendor-gated item in this backlog.
