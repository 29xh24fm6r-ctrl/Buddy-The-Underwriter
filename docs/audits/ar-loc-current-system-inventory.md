# AR LOC Current System Inventory

Generated: 2026-05-26  
Base commit: 67822200

## System Classification

| System | File/Table | Classification | Notes |
|--------|------------|----------------|-------|
| `ar_aging_reports` | Supabase table | **canonical** | Populated — stores parsed AR aging data per deal |
| `ar_aging_customers` | Supabase table | **canonical** | Populated — customer-level AR detail |
| `ar_aging_invoices` | Supabase table | **schema exists / not wired** | 0 rows — invoice-level parsing not active |
| `borrowing_base_calculations` | Supabase table | **canonical** | Populated — computed from AR aging + policy |
| `deal_financial_facts` (AR_BORROWING_BASE) | Supabase table | **canonical** | Populated — canonical memo-facing AR facts |
| `deal_financial_facts` (AR_AGING) | Supabase table | **raw/legacy supporting** | Extraction summary facts (TOTAL_AR, OVER_90_AR, ELIGIBLE_AR) |
| `bank_policy_rules` (AR) | Supabase table | **canonical** | AR collateral policy defaults + bank overrides |
| `arCollateralProcessor.ts` | `src/lib/processors/arCollateralProcessor.ts` | **canonical but needs guard** | Checks document_type only; has TEMP logs |
| `arCollateralPolicy.ts` | `src/lib/policy/arCollateralPolicy.ts` | **canonical** | 80% advance, 20% concentration, 5% reserves |
| `processDocExtractionOutbox.ts` (AR hook) | `src/lib/workers/processDocExtractionOutbox.ts:165` | **canonical but needs guard** | Checks `extractResult.doc.type` — should also check canonical_type |
| `extractProcessor.ts` (AR hook) | `src/lib/jobs/processors/extractProcessor.ts:102` | **partially wired** | Legacy path; checks document_type only |
| `ENABLE_AR_COLLATERAL` | env var | **canonical** | Feature gate for AR collateral processing |
| `docTypeRouting.ts` (AR_AGING) | `src/lib/documents/docTypeRouting.ts:115` | **canonical** | Maps AR_AGING to GEMINI_STRUCTURED routing |
| `classifyDocument.ts` (checklist) | `src/lib/artifacts/classifyDocument.ts:377` | **gap** | AR_AGING NOT in mapDocTypeToChecklistKeys |
| `conditions/rules.ts` (AR_AGING) | `src/lib/conditions/rules.ts:45` | **canonical but needs guard** | appliesWhen: () => true — applies to ALL deals |
| `loan_product_types` (LOC_SECURED) | Supabase seed | **gap** | requires_collateral=false for LOC products |
| `buildCanonicalCreditMemo` (AR) | memo builder | **canonical** | Loads ar_aging_reports + borrowing_base_calculations |

## Prioritized Gaps

### P0: AR Checklist/Readiness Bridge Missing
- `AR_AGING` canonical_type is set during classification
- `checklist_key` is NOT set because AR_AGING is not in `mapDocTypeToChecklistKeys`
- Result: AR documents are uploaded and finalized but invisible to readiness/checklist

### P0: AR Collateral Hook Should Key Off canonical_type
- Outbox worker checks `extractResult.doc.type === "AR_AGING"` (from extraction router)
- Legacy worker checks `doc.document_type === "AR_AGING"`
- Neither checks `canonical_type` — if document_type is OTHER but canonical_type is AR_AGING, the hook doesn't fire

### P1: AR Fact Namespace Boundary
- `arCollateralProcessor` writes AR_AGING facts (TOTAL_AR, OVER_90_AR, ELIGIBLE_AR)
- `runCanonicalUnderwritingSynthesis` writes AR_BORROWING_BASE facts (AR_TOTAL, AR_ELIGIBLE, etc.)
- Boundary is not documented; risk of future confusion

### P1: AR Expected-Doc Applicability Too Broad
- `appliesWhen: () => true` on AR_AGING means every deal expects AR aging
- Should only apply to LOC/AR-backed products

### P1: Product Collateral Metadata Under-Specified
- LOC_SECURED and ACCOUNTS_RECEIVABLE both have `requires_collateral=false`

### P2: Customer Parsing Quality
- Some customer names include trailing numeric values from OCR
- No validation guard

### P2: Invoice-Level AR Unused
- ar_aging_invoices exists with 0 rows
- Customer-level is sufficient for borrowing base v1

### P2: Temp Logging in arCollateralProcessor
- 4 TEMP console.log lines should be removed or guarded
