# Buddy SBA staff workspace: entry and navigation repair

## What this change does

- Both existing public staff gateways (`/go/admin` and `/brokerage/admin`)
  default to `/admin/brokerage`, not lender setup. Explicit admin subpaths
  remain supported and still require their existing access checks.
- The CRM exposes brokerage home, brokerage deals, billing, and team access
  without a disclosure menu. Bank-facing tools remain explicitly labeled
  secondary destinations; the bank `/deals` list is not the brokerage pipeline.
- Brokerage home provides guided links into the existing CRM, deal intake,
  brokerage pipeline, lender placement ledger, billing, and team workflows.
- The brokerage shell replaces the global bank navigation, keeps profile and
  sign-out available, and provides a collapsible mobile menu. No static user
  initials or owner role are presented as the current person's identity.

## Important boundary: this is not a domain migration

`src/lib/navigation/clerkHosts.ts` and `src/proxy.ts` currently require protected
staff pages to use `app.buddytheunderwriter.com`. This PR leaves that security
boundary intact. BuddySBA staff gateway links still change hostname. Keeping the
workspace on BuddySBA requires approved production authentication/domain work,
verification of actual provider configuration, and staff sign-in/session tests.
Do not remove host redirects or enable Clerk on BuddySBA just for appearance.

## Preserved and remaining work

No data migrations, permissions changes, tenant switching, or production writes.
Canonical deal/document records and CRM submission ledgers remain authoritative.
Existing operational page contents and legacy overview metrics are not rebuilt
or certified by this navigation repair. Owner reporting and the deal cockpit
still have their own layouts. This is not completion of a whole-brokerage redesign.

## Verification / release gate

- Focused navigation and render regression tests cover the default admin entry,
  explicit destinations, real route resolution (including the buyers dynamic
  router), and preservation of the staff layout gate.
- Type checking, focused lint, internal-link, API-auth and tenant guards.
- Offline real-component browser fixture; no preview deployment and no customer
  records. This proves layout/navigation behavior only, not production persistence.
- Before release acceptance: verify exact merged production identity, authenticated
  staff navigation from BuddySBA, ordinary team access, mobile menu, CRM-to-pipeline
  links, and the canonical deal/document handoff. Real mutation checks require an
  explicitly designated test record. Do not claim end-to-end readiness from CI.

Rollback: revert this PR; it changes no database state or authentication configuration.
