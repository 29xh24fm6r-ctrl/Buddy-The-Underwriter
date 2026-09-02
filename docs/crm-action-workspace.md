# CRM action workspace

Second delivery on the existing production-enabled CRM experience flag.

## Changes

- Today offers quick capture for any company in the loaded directory: note,
  call log, meeting log, or dated follow-up. Record pages offer the same controls.
- Uses the existing authenticated activities POST handler and one organization
  target. No new endpoint, schema, outbound communication, or calendar service.
- A confirmed activity ID is required before clearing a draft. Save is locked
  while pending; uncertain responses retain the draft and warn users to inspect
  history before retrying. This is not server-side idempotency.
- Follow-up dates use browser-local input and serialize to an ISO instant.
- Record history displays full note text and task due/completion state.
- Non-lender records omit bank setup, appetite, marketplace, and distribution
  panels. Existing profiles or placements retain lending capabilities even on
  multi-role companies. Editing organization type remains available.
- Directory backlink fixed. Reduced heading/banner spacing, removed redundant
  header/spacer, and changed the enabled CRM shell to document scrolling.
  Legacy flag-off layout remains unchanged.

## Verification and release

Focused model/render tests, lint, TypeScript, API-auth and internal-link guards
run locally. These do not prove live writes, responsive layout, or recovery.
Production-only acceptance after merge: load Today; filter/reset companies;
open a referral and a lender; inspect action forms and history; confirm ordinary
staff access. With an explicitly designated test company, save each activity,
reload to prove persistence, and verify the task appears in Today. Do not use
customer records for synthetic writes. Check desktop and narrow layouts.

No production deployment or test-data write is performed by this PR. Existing
production flag means the experience becomes active when the PR is deployed.
Rollback is the previous production artifact or disabling the experience flag
and rebuilding. Neither rollback deletes already saved CRM activity.

## Still outside this delivery

Task completion/editing, assignment, calendar invitations, actual email/calling,
universal search, and a unified lead/lender task queue are not implemented here.
Overview retains its existing 500-activity and 8-suggestion limits. Changing
pages or switching the selected company discards an unsaved local draft; there
is no durable draft store. Full powerhouse CRM acceptance remains unfinished.
