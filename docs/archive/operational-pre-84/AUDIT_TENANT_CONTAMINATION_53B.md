# Audit: Tenant Contamination — Phase 53B

Date: 2026-03-26
Status: Remediated

## Summary

Found **11 instances** of legacy "Old Glory Bank" / "OGB" branding contamination.
**3 runtime-blocking** issues were fixed. Remaining are seed/docs/test-only (allowlisted).

## Findings

| File | Line | Match | Category | Severity | Status |
|------|------|-------|----------|----------|--------|
| `src/lib/packs/requirements/requestEmail.ts` | 26 | `Old Glory Bank` hardcoded in email signoff | runtime-blocking | HIGH | **FIXED** — now uses `bankName` param with fallback `Your Lending Team` |
| `src/lib/forms/registry.ts` | 8, 44 | `OGB_SBA_INTAKE_V1` form identifier | runtime-blocking | HIGH | **FIXED** — renamed to `SBA_INTAKE_V1` |
| `src/app/api/borrower/[token]/forms/recompute/route.ts` | 28 | `OGB_SBA_INTAKE_V1` | runtime-blocking | HIGH | **FIXED** — `SBA_INTAKE_V1` |
| `src/app/api/borrower/[token]/package/build/route.ts` | 80 | `OGB_SBA_INTAKE_V1` | runtime-blocking | HIGH | **FIXED** — `SBA_INTAKE_V1` |
| `src/lib/tenant/getCurrentBankId.ts` | 105, 117 | `"OGB"` default bank code, `Octagon Bank (Default)` | runtime-blocking | HIGH | **FIXED** — `DEV_DEFAULT` code, `Dev Bank (Auto-Provisioned)` name; backwards-compat lookup finds existing OGB rows |
| `src/lib/banks/ensureDealHasBank.ts` | 8 | `defaultBankCode = "OGB"` | runtime-blocking | HIGH | **FIXED** — removed default, now requires explicit bank code |
| `supabase/migrations/20251219000002_banks_table.sql` | 13 | `'Old Glory Bank'` seed | seed-only | MEDIUM | Allowlisted — migration already applied, idempotent |
| `supabase/migrations/20251219000006_bulletproof_banks.sql` | 35 | `'Old Glory Bank'` seed | seed-only | MEDIUM | Allowlisted — migration already applied, idempotent |
| `docs/SUPABASE_STORAGE_SETUP.md` | 11, 17 | `old-glory-bank` paths | docs-only | LOW | Allowlisted — examples marked historical |
| `docs/BANK_FORMS_SYSTEM.md` | 72, 78 | `old-glory-bank` paths | docs-only | LOW | Allowlisted — examples marked historical |
| `src/lib/financialSpreads/extractors/deterministic/__tests__/realOcrExtraction.test.ts` | 235, 285 | `OLD GLORY BANK` | test-only | LOW | Allowlisted — authentic OCR fixture data |

## CI Guard

Test: `src/lib/server/__tests__/authTenantGuard.test.ts`
- Scans all `.ts`/`.tsx` files for legacy bank name and form identifiers
- Allowlist: migrations, docs, test fixtures, this test file
- Fails CI on any new runtime contamination
