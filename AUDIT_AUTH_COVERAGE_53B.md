# Audit: Auth Coverage — Phase 53B

Date: 2026-03-26
Status: Inventoried + Access Layer Shipped

## Summary

Audited authentication and authorization coverage across all protected surfaces.
Created unified access layer (`src/lib/server/authz.ts`) as the canonical import path.
Existing helpers are strong — the new layer standardizes the interface.

## Auth Architecture

```
proxy.ts (middleware)
  └─ Redirects unauthenticated users to /sign-in
  └─ Public routes bypass: /, /pricing, /borrower-portal, /upload, /sign-in, /sign-up
  └─ API routes: NEVER protected in middleware (must return JSON 401/403)

Pages/Layouts
  └─ requireRole() — page/layout role guard (redirects on failure)
  └─ clerkAuth() + ensureDealBankAccess() — deal pages
  └─ getCurrentBankId() — bank context resolution

API Routes
  └─ requireDealCockpitAccess() — canonical deal+role guard
  └─ requireRoleApi() — API-safe role guard
  └─ requireUser() — basic auth check
  └─ hasValidWorkerSecret() — worker/cron auth
```

## New Access Layer (Phase 53B)

| File | Exports | Purpose |
|------|---------|---------|
| `src/lib/server/authz.ts` | `requireUser`, `requireProfile`, `requireBankMembership`, `requireDealAccess`, `requireRole` | Unified auth helpers — single import path |
| `src/lib/server/access-errors.ts` | `AuthenticationRequiredError`, `ProfileRequiredError`, `BankMembershipRequiredError`, `DealAccessDeniedError`, `RoleAccessDeniedError`, `isAccessError` | Typed errors for controlled failure |
| `src/lib/server/deal-access.ts` | `resolveDealAccess`, `assertDealAccess`, `resolveDealBankId` | Deal access resolution — never trusts caller-supplied bankId |

## Auth Coverage by Surface

### Protected Pages (via middleware + page-level checks)

| Page | Auth Method | Tenant Check | Status |
|------|-----------|--------------|--------|
| `/deals/[dealId]/cockpit` | `clerkAuth()` + `ensureDealBankAccess()` | bank_id match | OK |
| `/deals/[dealId]/pricing` | `tryGetCurrentBankId()` + bank_id eq | bank_id match | OK |
| `/deals/[dealId]/spreads` | Server client (RLS) | Implicit | OK (non-sensitive) |
| `/deals/[dealId]/sba` | `clerkAuth()` | None explicit | LOW RISK — read-only |
| `/deals/[dealId]/conditions` | `ensureDealBankAccess()` via buildDealIntelligence | bank_id match | OK |
| `/deals/[dealId]/underwrite-console` | `requireRole(["super_admin","bank_admin","underwriter"])` | Role-gated | OK |
| `/credit-memo/*` | `requireRole(["super_admin","bank_admin","underwriter"])` | Role-gated | OK |
| `/(admin)/*` | `requireRole(["super_admin"])` | Role-gated | OK |

### API Routes (must enforce auth explicitly)

| Route | Auth Method | Tenant Check | Status |
|------|-----------|--------------|--------|
| `/api/deals/[dealId]/documents` | `requireDealCockpitAccess(COCKPIT_ROLES)` | Full | OK |
| `/api/deals/[dealId]/pricing-assumptions` | `requireDealCockpitAccess(COCKPIT_ROLES)` | Full | OK |
| `/api/deals/[dealId]/gap-queue` | `requireDealCockpitAccess(COCKPIT_ROLES)` | Full | OK |
| `/api/deals/[dealId]/pipeline-status` | `requireDealCockpitAccess(COCKPIT_ROLES)` | Full | OK |
| `/api/deals/[dealId]/credit-memo/*` | `requireDealCockpitAccess(COCKPIT_ROLES)` | Full | OK |
| `/api/deals` (POST) | `getCurrentBankId()` | Implicit via bank context | OK |
| `/api/mcp` | Bearer token (`BUDDY_MCP_API_KEY`) | bankId param | OK |

### Intentionally Public

| Route | Purpose | Risk |
|------|---------|------|
| `/api/ping` | Health check | None |
| `/api/health` | Service status | None |
| `/api/build-meta` | Deployment info | None |
| `/api/contact` | Contact form | None (rate-limited) |
| `/api/generate` | Screen artifact gen | LOW — public feature |
| `/api/deals/bootstrap` | Upload session init | LOW — creates minimal record |
| `/api/deals/seed` | Demo data | MEDIUM — should be gated by env |

### Known Gaps

| Surface | Issue | Severity | Recommendation |
|---------|-------|----------|----------------|
| `/api/deals/seed` | No auth check, usable in production | MEDIUM | Gate behind `NODE_ENV === 'development'` or admin role |
| `/deals/[dealId]/sba` | No tenant check — only userId verified | LOW | Add `ensureDealBankAccess()` |
| `requireAdmin()` in `requireAdmin.ts` | Comment says "HARDEN LATER" — only checks signed-in | LOW | Replace with `requireRole(["super_admin","bank_admin"])` |
| `requireUnderwriterOnDeal` | Does NOT check deal assignment — only signed-in | MEDIUM | Add deal_participants/deal_assignees check |

## CI Guard

Test: `src/lib/server/__tests__/authTenantGuard.test.ts`
- Validates access layer file existence and exports
- Validates `server-only` imports
- Validates structured tenant mismatch logging
- Validates deal access derives bankId from server context (never caller-supplied)
