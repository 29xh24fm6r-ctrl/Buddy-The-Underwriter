# Memo input load truthfulness commissioning arc

Date: 2026-08-29  
Product boundary: Buddy The Underwriter only

## Evidence

The banker submission path builds an immutable credit-memo input package before
underwriting. Required Supabase reads discarded their error objects and converted
database failures into empty borrower, management, collateral, financial,
research, snapshot, and override state. The two hard readiness gates were more
dangerous: required-document failures returned zero missing documents and policy
exception failures returned “reviewed.”

## Root cause

The input assembler treated authoritative underwriting evidence like optional UI
enrichment. Its public result type already declared a structured `load_failed`
outcome, but the implementation never used that outcome for these reads.

## Repair

- Require explicit database success for every authoritative memo-input query.
- Keep not-found and genuinely empty results distinct from query failure.
- Convert thrown query failures into deterministic, non-sensitive
  `load_failed` results.
- Make required-document and policy-exception gates fail closed instead of
  reporting healthy state.
- Add architectural regression coverage for the complete source set and the two
  hard gates.

## Production verification

This repair is not in production until its pull request is merged and deployed.
Closure requires an authorized banker-submission fixture plus a controlled
database-read failure proving no snapshot is created and the API returns
`input_readiness_failed`.

## Continuation

The complete Golden Trident transaction still requires a verified Buddy-owned
Supabase connection and authorized sealed fixture. Signing-request idempotency
remains adjacent work and must not conflict with the open signed-PDF branch.
