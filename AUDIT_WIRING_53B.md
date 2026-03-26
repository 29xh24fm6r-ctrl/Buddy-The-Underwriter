# Audit: Product Wiring — Phase 53B

Date: 2026-03-26
Status: Inventoried

## Summary

Audited end-to-end wiring of 9 major product flows.
**1 critical**, **1 high**, **3 medium** issues found.
All working flows confirmed functional.

## Findings

### CRITICAL

| Flow | Entrypoint | Issue | Evidence | Fix |
|------|-----------|-------|----------|-----|
| Borrower portal file upload → record | `src/app/(app)/borrower/portal/[token]/page.tsx:165` | Auth mismatch: calls `/api/deals/${dealId}/files/record` which requires Clerk auth, but borrower portal users authenticate via token only | File sign works (token-authed endpoint) but record step returns 401 | Create token-authed file record endpoint OR proxy through portal API |

### HIGH

| Flow | Entrypoint | Issue | Evidence | Fix |
|------|-----------|-------|----------|-----|
| Condition upload | `src/components/deals/BorrowerConditionsCard.tsx:~105` | `alert('Upload flow for condition ${c.id} - coming soon')` — no actual upload handler | Button visible to users, no backend | Implement condition document upload or hide button |

### MEDIUM

| Flow | Entrypoint | Issue | Evidence | Fix |
|------|-----------|-------|----------|-----|
| Entity creation | `src/components/deals/EntitySelector.tsx:103` | `alert('Entity creation UI coming soon!')` — no modal or form | Button visible to users | Implement entity creation form or hide button |
| Loan type persistence | `src/components/deals/DealSetupCard.tsx:18` | `// TODO: Persist to API` — loan type changes not saved | Changes lost on refresh | Wire to deal update API |
| Generate Docs | `src/components/builder/BuilderHeader.tsx`, `ReviewWorkspace.tsx` | Button permanently disabled with "Coming Soon" badge | Visible but non-functional | Gate behind feature flag or remove until implemented |

### WORKING FLOWS (Confirmed)

| Flow | Status | Evidence |
|------|--------|----------|
| Document upload → classification → pipeline | Fully wired | Endpoints exist, classification triggers spread recompute |
| Document matching engine | Fully wired | 129 tests, slot matching + entity resolution |
| Message approval → send | Fully wired | ConditionsMessagingCard endpoints functional |
| Pricing scenarios → decision | Fully wired | Scenario generation + decision recording complete |
| Spreads / financial tabs | Fully wired | Standard + classic spreads, PDF export |
| SBA preflight | Fully wired | Score card, issues, actions panels |
| Borrower nudges | Fully wired | Endpoints exist and callable |
| Loan products management | Fully wired | CRUD endpoints functional |
| Credit memo generation | Fully wired | Canonical builder + narrative sections |

## CI Guard

Test: `src/lib/server/__tests__/authTenantGuard.test.ts` — "Wiring markers guard" suite
- Scans components for `alert()` calls with "coming soon" text
- Known placeholders tracked in explicit allowlist (BorrowerConditionsCard, EntitySelector)
- New placeholder additions fail CI
