---
name: buddy-extraction
version: 1.0.0
author: buddy-system
description: Extract structured financial facts from classified financial documents
tags: [extraction, tax-returns, balance-sheet, financial-facts]
allowed_tools: [gemini_ocr, gemini_flash_structured_assist, irs_knowledge_base]
---

# Extraction Skill

## Trigger
Called after document classification confirms a financial document type.
Entry point: `extractFactsFromDocument()` in src/lib/financialSpreads/extractFactsFromDocument.ts

## Inputs
- dealId: UUID
- bankId: UUID
- documentId: UUID
- docTypeHint: string (e.g. IRS_1065, IRS_1120S, BALANCE_SHEET)

## Outputs
Writes to: `deal_financial_facts` (fact_type, fact_key, fact_value_num, confidence, provenance)
Writes to: `deal_extraction_runs` (run record, status, metrics)

## Document type → canonical fact key mapping
| Document | Key facts produced |
|---|---|
| IRS_1065 | GROSS_RECEIPTS, ORDINARY_BUSINESS_INCOME, TOTAL_ASSETS (SL_), K1_ORDINARY_INCOME |
| IRS_1120S | GROSS_RECEIPTS, ORDINARY_BUSINESS_INCOME, TOTAL_ASSETS (SL_) |
| IRS_1040 | AGI, WAGES_W2, K1_ORDINARY_INCOME, SCH_E_NET |
| BALANCE_SHEET | TOTAL_ASSETS, TOTAL_LIABILITIES, NET_WORTH |
| INCOME_STATEMENT | TOTAL_REVENUE, NET_INCOME, EBITDA |

## Error handling
All failures return { ok: false, error } — never throw.
Failed extractions write to deal_extraction_runs with status='failed'.
Stale running extractions (>10 min) are auto-failed on next run attempt.

## Evolution
Analyst corrections to extracted values are captured in extraction_correction_log.
Patterns with error rate > 5% are flagged for review.
Approved evolutions update PROMPT_VERSION in geminiFlashPrompts.ts.
