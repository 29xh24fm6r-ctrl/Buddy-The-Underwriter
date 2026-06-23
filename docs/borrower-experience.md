# Borrower Experience

## Borrower UX Principles
- Borrower surfaces must feel like a guided SBA concierge experience, not an internal operations console.
- Every borrower screen should translate backend state into calm, plain-English guidance.
- Borrowers should always have one dominant next action or a clear reassurance state.

## Approved Borrower Terminology
- Personal Financial Statement
- Business Tax Returns
- Voided Business Check
- Getting started
- Documents requested
- Documents received
- Buddy reviewing your package
- Additional items needed
- Ready for SBA review
- Buddy received your document
- Looks good
- Needs another file

## Forbidden Internal Terminology
- `readiness_regressed`
- `docs_in_progress`
- `underwriting_score`
- `trident_failure`
- `OCR confidence`
- `lender_match_status`
- `retry_exhausted`
- `provider failure`
- `comms_outbox`
- raw lifecycle enums
- banker notes
- lender routing language

## Trust And Reassurance Philosophy
- Borrowers should feel informed, secure, and not abandoned during SBA waiting periods.
- Trust language must be factual and non-promissory.
- Reassurance should explain what Buddy is doing without exposing internal operations.

## Waiting-State Philosophy
- A waiting state is not an empty state.
- Borrowers must be told when no action is needed.
- Waiting states should explain what happens next and why review may take time.
- Borrowers should never feel their package disappeared into a black hole.

## Upload-State Guidance
- Use borrower-safe states only:
  - `Uploading...`
  - `Buddy received your document`
  - `Buddy is reviewing this file`
  - `Looks good`
  - `Needs another file`
- Never expose parser, provider, storage, or internal processing jargon.

## Activity-Feed Safety Rules
- Allowed borrower-visible events:
  - File uploaded
  - Buddy reviewed your document
  - Additional document requested
  - Package updated
  - SBA package progressing
- Forbidden:
  - internal system events
  - retry queue events
  - internal comms events
  - banker notes
  - provider failures

## Progress-Stage Safety Rules
- Approved borrower progress stages:
  - Getting started
  - Documents requested
  - Documents received
  - Buddy reviewing your package
  - Additional items needed
  - Ready for SBA review
- Do not render internal lifecycle enums, underwriting states, or lender routing concepts.

## Mobile-First Expectations
- Borrower pages must stack in one-column priority order on small screens.
- Borrower pages must preserve a sticky primary CTA on mobile when action is needed.
- Touch targets must be large enough for upload and review actions.

## Security And Privacy Messaging Rules
- Approved trust language:
  - Secure SBA document portal
  - Files encrypted in transit
  - Only your SBA team can access these documents
  - Buddy does not expose storage links or internal review notes here
- Do not expose signed URLs, storage provider details, or internal access patterns.

## One Dominant Next Action
- Every borrower view must answer: what Buddy needs from me right now.
- If action is needed, one primary CTA should lead the experience.
- If no action is needed, replace the CTA with reassurance and expectation guidance.

## Borrower-Safe Error Handling Principles
- Translate raw backend failures into calm, generic borrower-safe explanations.
- Do not render stack traces, storage/provider errors, parser failures, or infrastructure detail.
- Do not imply missed SLA or broken workflow when a safe retry message is enough.

## UX Audit Checklist
- Borrowers must always be able to answer:
  - What Buddy needs from me
  - What Buddy is doing
  - Whether I need to take action
  - What happens next
