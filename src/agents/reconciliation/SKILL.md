---
name: buddy-reconciliation
version: 1.0.0
author: buddy-system
description: Cross-document mathematical consistency checks for commercial lending deals
tags: [reconciliation, balance-sheet, k1, cross-document]
allowed_tools: [supabase_read]
---

# Reconciliation Skill

## Trigger
Called after underwriting state is loaded, or on demand via POST /api/deals/[dealId]/reconcile.
Entry point: `reconcileDeal()` in src/lib/reconciliation/dealReconciliator.ts

## Inputs
- dealId: UUID
- industryProfile?: IndustryProfile (optional NAICS-calibrated thresholds)

## Outputs
Writes to: `deal_reconciliation_results` (overall_status, hard_failures, soft_flags)
Emits: deal.reconciliation_complete ledger event

## Status values
- CLEAN: all checks passed or skipped (no failures)
- FLAGS: soft warnings present (banker judgment allows approve)
- CONFLICTS: hard failures present (blocks approve until resolved)

## Fact key fallback chains
The reconciliator reads from deal_financial_facts with these fallbacks:
- TOTAL_ASSETS → SL_TOTAL_ASSETS
- TOTAL_LIABILITIES → SL_TOTAL_LIABILITIES
- NET_WORTH → TOTAL_EQUITY → SL_TOTAL_EQUITY

## Check skip conditions
A check is SKIPPED (not FAILED) when prerequisite facts are absent.
checksSkipped > 0 is normal for deals with incomplete Schedule L extraction.
