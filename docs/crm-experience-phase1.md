# CRM experience — Phase 1

## Scope

Presentation-only foundation: Today, Pipeline, Relationships, Lender network,
and Tools. Existing URLs, record identities, write handlers, and brokerage staff
authorization remain canonical. No migration, new endpoint, new dependency,
message sending, automatic completion, or production activation.

The server-only `BUDDY_CRM_EXPERIENCE_V2_ENABLED` flag accepts exactly `true`.
Missing, false, and malformed values retain the legacy interface. The example
configuration is false. Reviewers can opt into a local or separately authorized
preview environment. Removing the flag restores the legacy rendering.

## Navigation

- Today: `/admin/brokerage/crm` (opt-in only).
- Companies: `/admin/brokerage/crm?view=relationships`.
- People and Deal connections remain canonical subviews of Relationships.
- Pipeline retains the existing Leads workflow; it is not the underwriting deal pipeline.
- Lender network retains the existing Bank Buyers workflow.
- Message templates and Duplicate review live under Tools.

Companies support combinable quick filters, explicit result counts, reset,
distinguished empty/filter/error states, and a horizontally scrollable table.
These are built-in filters, not persisted custom saved views. The relationship
data model is not merged or duplicated.

## Data and truth boundaries

Today reuses the existing organizations overview response. That handler reads
up to 500 recent CRM activities and returns up to eight health suggestions.
Today states those limits explicitly; zero returned tasks is not an assertion
that all brokerage work is complete. Lead and lender follow-ups remain in their
existing workflows. Due labels are UTC and use the successful response time.
Refresh updates the overview. Loading and failed reads do not show success or
empty-work claims. Actions navigate to existing records; they do not send,
schedule, dismiss, or complete anything.

## Acceptance and verification

- Flag off: legacy seven-tab overview still renders.
- Flag on: five primary workspaces and correct record-detail parent selection.
- Today: pending, failed, empty, populated, missing-date and unlinked-task states.
- Directory: search and combined quick filters, reset, creation flow retained.
- Keyboard focus, wrapping navigation, narrow-screen cards, reduced-motion support.
- No new page route/function budget consumption (layout only).

Automated model and rendered-component coverage lives in `experience.test.ts`
and `crmToday.test.ts`. Full authenticated browser certification of the enabled
experience is a separate release gate; unit tests and CI do not establish live
production readiness. Phase 2 record redesign, persisted saved views, universal
search, bulk actions, and intelligent recommendations are deliberately deferred.

Local verification: TypeScript and focused ESLint pass; 10 model/render tests
pass. Current API-auth, tenant-RLS, and internal-link guards pass. Desktop and
390px-wide synthetic visual fixtures were inspected; the narrow page reported
390px content width (no horizontal overflow). Reproduce the static fixture with
`node --import tsx scripts/crm-experience-preview.ts`; it binds only to loopback
and has no real data or functional write controls.

Pre-existing standalone guard limitations: `guard:admin` assumes only
requireSuperAdmin and flags existing brokerage-staff routes; legacy reminder
guards flag unchanged reminder files; the old deal-files guard fails with a
Windows shell quoting error. No listed failure is in a changed application
file. The current CI guard suite and build remain the PR gates. A route-manifest
budget check requires a completed production build; no local budget pass is claimed.
