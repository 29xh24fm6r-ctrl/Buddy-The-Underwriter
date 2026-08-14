# Borrower Completion Production Audit — 2026-08-14

## Scope and evidence standard

This revision combines production Supabase counts with route/component tracing. A feature is not treated as commissioned merely because an engine or client exists. P0 findings cite a production query result or concrete deal/document ID and the exact code path that fails.

## Production baseline

Queries were run against the Buddy production Supabase project on 2026-08-14.

| Evidence | Result | Interpretation |
| --- | ---: | --- |
| `select count(*) from deal_documents` | 348 | Upload exists and is used; the previous broad “upload is not commissioned” finding is withdrawn. |
| `select count(*) from borrower_identity_verifications` | 0 | No production identity-verification completion is recorded. |
| `select count(*) from buddy_sealed_packages` | 0 | No borrower package has reached sealing. |
| `select count(*) from buddy_trident_bundles where mode = 'full'` | 0 | No full package has been generated. |
| All Trident bundles | 52 preview / 0 full; all 52 failed | Generation is being invoked, but no successful preview exists. |
| `select count(*) from borrower_portal_links` | 0 | The token-only Trident resolver cannot authorize the live `/start` path. |
| `select count(*) from signing_requests` | 0 | No SignWell request has been created. |
| `select count(*) from signed_documents` | 0 | No SBA form has completed signing. |

The zero sealed/full/signing counts keep the completion blockers at P0. The 348 uploads lower the upload finding from a broad P0 to a narrower post-upload pipeline defect.

## P0 findings and changes

### 1. `/start` supplied a deal ID to token-only borrower APIs

Production evidence: `borrower_portal_links = 0`. The live `/start` workspace is authenticated by the HttpOnly `buddy_borrower_session` cookie and does not expose a raw portal token.

Call chain before this change:

`StartConciergeClient` → `IntakeReviewStep(token={dealId})` / `PostSubmitHub(token={dealId})` → `/api/borrower/portal/[token]/*` or `/api/portal/[token]/trident/*` → token lookup only → no matching token row.

Changed:

- `src/lib/borrower/resolvePortalContext.ts::resolvePortalContext`
- `src/lib/brokerage/trident/portalTokenAuth.ts::resolvePortalToken`

Both resolvers now accept a deal ID only when it exactly matches the authenticated borrower session's deal. Normal invite/portal token authentication is unchanged.

### 2. SignWell was reachable, but the UI requested unsupported form codes

Production evidence: `signing_requests = 0`, `signed_documents = 0`, and `borrower_identity_verifications = 0`.

Exact call chain:

`IntakeReviewStep` → `SigningPanel` → `POST /api/brokerage/deals/[dealId]/borrower-actions/esign` → `requestSignature` → `createSignwellDocumentFromFile` → `SIGNWELL_API_KEY`.

The chain is real, but `SigningPanel` sent `SBA_1919`, `SBA_413`, `SBA_912`, and `IRS_4506C`; `resolveFilledPdfForSigning` only accepts `FORM_1919`, `FORM_413`, `FORM_912`, and `FORM_4506C`. The route therefore stopped at `UNSUPPORTED_FORM_CODE` before a SignWell document could be created.

Changed:

- `src/components/brokerage/SigningPanel.tsx` now uses the canonical codes.
- `GET .../borrower-actions/esign` now returns the deal's signed and active signing records.
- The panel restores pending/signed state after refresh and resumes an existing signing URL instead of creating duplicate signing requests.

Identity verification remains the intended server-side prerequisite. The production zero count means live completion still requires the identity vendor path to be exercised successfully.

### 3. No package can seal because Trident has never succeeded

Production evidence: 52 preview bundles, all failed; 0 full bundles; 0 sealed packages. Every recorded failure was `SBA package generation failed: Assumption validation failed`.

Concrete production deal: `44e3ace7-912e-48cf-b3a9-e8610b856de4` generated repeated failed preview attempts on 2026-08-14.

`canSeal()` already exists in `src/lib/brokerage/sealingGate.ts` and is the canonical gate. This audit does not propose another completion gate. The immediate P0 is that its required successful preview can never be satisfied in production while assumption validation fails.

This change repairs authorization to the existing Trident routes from `/start`; it does not suppress or bypass assumption validation. A follow-up must trace the concrete deal's persisted assumptions into the generator and repair the invalid/missing input.

### 4. Post-submit UI read the wrong upload table and wrong success status

`src/app/api/borrower/portal/[token]/hub/route.ts` read legacy `documents`, while borrower uploads are stored in `deal_documents`. It also treated Trident `completed` as success while the generator and sealing gate use `succeeded`.

Changed: the hub now reads `deal_documents` and recognizes `succeeded`, so borrower-facing completion language reflects canonical records.

This is convergence on `canSeal()`, not a replacement for it. Remaining UI completion language should continue to be audited against `seal-status`, whose result is backed by `canSeal()`.

## Narrowed post-upload finding

Upload works. The defect is extraction → correction → borrower acceptance after upload.

Concrete production document: `ba5334de-2860-4704-85c5-82c04308e9d0` on deal `0f9d3174-c107-4a0e-a3d6-484c00060a46` (Omnicare income statement). It reached classification but remained `CLASSIFIED_PENDING_REVIEW`, with `extracted_fields = {}` and document status `pending`.

Across all 348 `deal_documents` rows:

- 290 are `CLASSIFIED_PENDING_REVIEW`.
- 178 have `intake_confirmed = true`.
- 0 have non-empty `extracted_fields`.
- 0 show a terminal borrower acceptance status.

Therefore the remaining defect is not uploading; it is the absence of a demonstrated closed loop from extraction through correction and borrower acceptance. This PR intentionally does not fabricate acceptance or mark these documents complete. The next implementation should trace the cited document through the extraction worker/API and persist both corrected fields and an explicit borrower-accepted state.

## Previously fixed or in flight

The audit was reconciled against current `main` and does not re-open these items:

- T1–T5: entity/NAICS capture, deterministic assumptions confirmation, Plaid chapter-4 credit, identity-verification reachability, and chapters 2–4 persistence.
- T6–T7 are already merged on `main` in `75af9eb3`: solo-owner management fallback and stale-score recompute.
- `canSeal()` is retained as the canonical sealability decision.

## Verification boundary

The production counts and concrete records above are live-driven. A fresh-account browser run was not performed because it would create production account/deal data. The code changes include source-level regression coverage; final end-to-end acceptance still requires a preview deployment with a synthetic borrower, successful identity verification, successful Trident preview, and a SignWell sandbox ceremony.
