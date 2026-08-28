# Committee authorization and decision truthfulness commissioning

Date: 2026-08-28  
Product boundary: Buddy The Underwriter only  
Repository baseline: `be5ee2a382a99711f1b987d833bc3a0b5f251cb3`

## Evidence

- PRs 944 and 945 remain open, green, mergeable, and independent; this arc does not modify their files.
- Production returned HTTP 200 on the baseline build and had no error/fatal logs in the latest one-hour window.
- No committee interrogation, blended evaluation, multi-persona evaluation, or underwriter-decision request appeared in the retained 24-hour production window. Deterministic source paths are therefore the available evidence.
- All three committee interrogation routes accepted deal identifiers without authoritative deal access.
- Blended and multi-persona routes trusted caller-provided bank identifiers, allowing a request to select a different policy corpus.
- Ordinary callers could request debug output containing raw retrieved deal evidence.
- Model citations were accepted even when their chunk identifiers were not among the evidence admitted to the run or their quotes were not present in that evidence.
- Multi-persona evaluation silently accepted malformed model structures and ignored persona-query, event-insert, and citation-insert errors.
- Decision feedback silently discarded malformed requested changes and conditions.
- Decision finalization did not prove the underwriter differed from the submitting banker.
- The snapshot was finalized before the deal-level status mirror. A mirror failure returned an error after leaving the snapshot terminal, preventing a clean retry and allowing read models to disagree.
- Committee and decision routes returned raw exception text to clients.

## Root cause

Committee intelligence and finalization treated authentication, tenant scope, model provenance, and secondary persistence as advisory. Transport completion could therefore be reported without proving the caller owned the deal, the policy corpus belonged to the deal's bank, citations were grounded, trace records were durable, or the final decision converged across canonical read models.

## Repair

- Require authoritative deal access on every committee route.
- Derive policy scope from authenticated deal access and reject caller bank mismatches.
- Restrict raw retrieval debug output to platform super administrators.
- Validate question and persona input and make every response non-cacheable.
- Enforce structured model output and exact admitted-evidence citation grounding.
- Fail closed on missing persona configuration and event/citation persistence.
- Reject malformed underwriter feedback rather than silently deleting entries.
- Prove snapshot submitter provenance and enforce separation of duties.
- Compensate a failed deal-status mirror by restoring the snapshot to `banker_submitted`; emit a fatal reconciliation signal if compensation also fails.
- Sanitize client-visible error contracts while preserving server-side evidence.

## Validation plan

- Behavioral citation-grounding tests.
- Source-contract tests for authorization, tenant binding, persistence acknowledgement, separation of duties, compensation, and error sanitization.
- Full repository suite, React-server suite, research evaluation, build, architecture, safety, schema/drift gates, Never-500, Secret Scan, Route Budget, and public Playwright.
- Complete branch diff inspection.
- Exact-head Vercel preview READY, HTTP 200, SHA-matched, and runtime-clean.

## Production closure

After merge:

1. verify the deployed production SHA and public health;
2. run authorized single-corpus and blended committee questions against a controlled deal;
3. verify every citation resolves to admitted deal or bank-policy evidence and all AI trace rows persist;
4. run authorized approval, decline, and return-for-revision fixtures with distinct submitting and deciding users;
5. fault-inject deal-status mirror failure against a verified Buddy-owned Supabase project and prove snapshot compensation and retryability.

The connected Supabase resource identifies as a different product and was not accessed.

## Continuing ledger

- PR 878's full Golden Trident seal-to-marketplace-to-lender ceremony still requires an authorized production-safe transaction and verified Buddy-owned Supabase access.
- PRs 944 and 945 remain prior independent merge checkpoints.
- Next independent target: inspect committee voting, minutes generation, attestation, dissent, quorum, and immutable-record truthfulness without database mutation.

## CI repair evidence

- Initial broad CI exposed one brittle bank-scope contract and two lifecycle-ownership guard failures.
- The bank-scope contract now accepts the route's authoritative local binding.
- Failed decision mirroring now restores the retryable snapshot through the canonical submission owner, preserving the single-writer lifecycle invariant.
- Replacement exact-head CI and deployment verification are pending.
