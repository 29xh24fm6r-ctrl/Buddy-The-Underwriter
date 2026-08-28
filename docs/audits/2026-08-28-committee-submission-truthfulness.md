# Committee packet and memo submission truthfulness commissioning

Date: 2026-08-28  
Product boundary: Buddy The Underwriter only  
Repository baseline: `be5ee2a382a99711f1b987d833bc3a0b5f251cb3`

## Evidence

- PR 944 remains open, green, mergeable, and independent; this arc does not modify its files.
- No committee-packet or memo-submit requests appeared in the retained production runtime-log window. Source evidence therefore remains the authoritative proof for these deterministic failure paths.
- The committee packet route ignored canonical-memo query errors and allowed no canonical narrative.
- Financial-validation construction failures, stale validation, and decision-unsafe validation were warnings or non-fatal.
- A locked pricing quote set `hasAppendix: true` even when appendix generation returned no bytes or threw.
- The route awaited `writeEvent` but ignored its `{ ok: false }` contract, although that event is what marks the packet ready.
- The shared cockpit executor treated every HTTP 2xx as success without checking `body.ok`.
- Memo submission discarded database errors while loading overrides and the current memo version, silently substituting an empty override object or version 1.
- A failed supersede of prior live snapshots was logged and ignored, allowing multiple actionable versions.
- Unexpected submit failures returned raw exception text.

## Root cause

The committee and memo-submission boundaries treated supporting persistence and provenance dependencies as advisory. Transport success was used as the user-visible completion contract even when Buddy could not prove that the packet was complete, marked ready, or that the submitted memo was the only live version.

## Repair

- Require a successfully queried canonical memo narrative.
- Fail closed when financial validation cannot be built, is stale, or is not decision-safe.
- Require a locked pricing quote's appendix to be generated and attached before success; report actual attachment state.
- Require durable readiness-event acknowledgement before the packet can report success.
- Make the shared cockpit executor honor structured `{ ok: false }` responses even with HTTP 200.
- Fail closed on override and memo-version query failures.
- Sanitize client-visible submission failures while retaining server-side error codes.
- If prior snapshots cannot be superseded, compensate by deleting the newly inserted snapshot and report failure. If compensation also fails, emit a fatal reconciliation signal and never report success.
- Add regression coverage for the server, client executor, and submission state contracts.

## Validation plan

- Focused Node tests for cockpit action execution and committee/submission truthfulness.
- Full repository suite, React-server suite, research evaluation, build, architecture, safety, schema/drift gates, Never-500, Secret Scan, Route Budget, and public Playwright.
- Complete branch diff inspection.
- Exact-head Vercel preview READY, HTTP 200, SHA-matched, and runtime-clean.

## Production closure

After merge:

1. verify the production deployment SHA and public health;
2. run an authorized packet fixture with a canonical memo, fresh decision-safe financial validation, and locked pricing quote;
3. verify the generated packet records actual appendix state and the readiness event;
4. run an authorized resubmission fixture and prove exactly one live snapshot remains;
5. fault-inject memo/version and supersede failures against a verified Buddy-owned Supabase project and confirm no false success.

The connected Supabase resource identifies as a different product and was not accessed.

## Continuing ledger

- PR 878's full Golden Trident seal-to-marketplace-to-lender ceremony still requires an authorized production-safe transaction and verified Buddy-owned Supabase access.
- PR 944 remains the prior independent merge checkpoint.
- Next independent target: inspect committee interrogation and decision-finalization authorization, persistence, citation, and response truthfulness without database mutation.
