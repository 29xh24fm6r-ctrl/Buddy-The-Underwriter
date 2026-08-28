# Memo wizard persistence truthfulness commissioning

Date: 2026-08-28  
Product boundary: Buddy The Underwriter only  
Repository baseline: `be5ee2a382a99711f1b987d833bc3a0b5f251cb3`

## Evidence

- The previously recorded authenticated `/memo-inputs` production 500 did not recur in the current four-hour Vercel window.
- Source inspection found a deterministic failure-suppression path in `POST /api/deals/:dealId/memo-inputs` for `kind: "from-wizard"`:
  - the ownership lookup discarded its Supabase error;
  - borrower-story and management upsert failures were converted to counters;
  - the audit writer's `{ ok: false }` result was ignored;
  - the handler still returned HTTP 200 with `ok: true`.
- `MemoCompletionWizard` treated transport success as save success without checking the JSON contract and displayed no failure.
- `BankerReviewPanel.saveOverrides` caught failed canonical writes and resolved normally. `flushPendingTextSave` therefore allowed underwriting submission to continue after an unsaved memo edit.
- The only current production 5xx cluster was on a shared-looking route whose Buddy ownership could not be proven. It was not inspected or modified.

## Root cause

The canonical wizard pipeline treated database and audit outcomes as informational counters rather than as the commit contract. Its two UI callers also had no end-to-end acknowledgement requirement. This allowed a partial or failed qualitative save to appear complete and, from the review panel, to proceed into a frozen underwriting snapshot.

## Repair

- Resolve and validate requested management inputs before beginning canonical writes.
- Fail closed on owner lookup, borrower-story persistence, management persistence, or audit persistence.
- Return a sanitized HTTP 500 contract with operation-level failure codes and partial-write counts; do not expose database details.
- Mark successful and failed wizard-save outcomes in audit metadata when the ledger is available.
- Require both HTTP success and `data.ok` in the completion wizard and render an accessible retry message.
- Return an explicit boolean from banker-review saves and block submission when the latest canonical save failed.
- Publish `Cache-Control: no-store` on wizard-write responses.
- Add source-contract regression coverage for the server failure gate, audit contract, completion-wizard acknowledgement, and submission interlock.

## Validation plan

- Focused Node tests for memo wizard truthfulness and the existing dual-write guards.
- Full repository test suite, React-server suite, research evaluation, build, architecture, schema/security, route-budget, Never-500, secret scan, and public Playwright.
- Inspect the complete branch diff.
- Verify the exact-head Vercel preview is READY, HTTP 200, SHA-matched, and free of error/fatal runtime logs.

## Production closure

After merge, verify the deployed SHA and public runtime health. Transactional closure requires an authorized Buddy-owned authenticated memo fixture capable of exercising:

1. borrower-story success and forced persistence failure;
2. management-profile success and forced persistence failure;
3. ledger failure handling;
4. review submission remaining blocked after a failed save.

The connected Supabase resource identifies as a different product and was not accessed. A verified Buddy-owned Supabase connection is required for database-backed fault injection.

## Continuing ledger

- PR 878's complete Golden Trident seal-to-marketplace-to-lender ceremony still requires an authorized production-safe transaction and verified Buddy-owned Supabase access.
- Open repair PRs remain independent merge checkpoints and were not merged here.
- Next independent target: continue the authenticated API truthfulness sweep, prioritizing committee-packet and memo-submission read/write dependencies that can be proven from source and production logs without database mutation.
