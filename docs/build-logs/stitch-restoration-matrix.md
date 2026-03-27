# Stitch Restoration Matrix — Phase 62

**Date**: 2026-03-27
**Status**: Complete

## Summary

Restored all 29 saved Stitch exports into the canonical Stitch routing system.
Registry expanded from 6 surfaces to 32 (29 required + 3 optional recovery).

## Surface Matrix

### Existing (kept as-is) — 6 surfaces

| Surface Key | Slug | Route | Mode |
|---|---|---|---|
| deal_command | command-center-latest | /deals/[dealId]/command | panel |
| underwrite | underwrite | /deals/[dealId]/underwrite | iframe |
| credit_committee | deal-summary | /deals/[dealId]/committee | iframe |
| borrower_portal | borrower-document-upload-review | /borrower/portal | iframe |
| portfolio | portfolio-command-bridge | /portfolio | iframe |
| deal_intake | deal-intake-console | /intake | iframe |

### Class 1: Direct Page Restoration — 16 surfaces

| Surface Key | Slug | Route |
|---|---|---|
| pipeline_analytics_command_center | pipeline-analytics-command-center | /analytics |
| loan_servicing_command_center | loan-servicing-command-center | /servicing |
| workout_command_center | workout-command-center | /workout |
| workout_case_file | workout-case-file | /workout/case-file |
| workout_committee_packet | workout-committee-packet | /workout/committee-packet |
| workout_legal_execution_tracker | workout-legal-execution-tracker | /workout/legal |
| reo_command_center | reo-command-center | /workout/reo |
| chargeoff_recovery_command_center | chargeoff-recovery-command-center | /workout/chargeoff |
| audit_compliance_ledger | audit-compliance-ledger | /compliance/audit-ledger |
| document_template_vault | document-template-vault | /templates/vault |
| exceptions_change_review | exceptions-change-review | /exceptions |
| ocr_review_data_validation | ocr-review-data-validation | /ocr/review |
| roles_permissions_control | roles-permissions-control | /admin/roles |
| merge_field_registry | merge-field-registry | /admin/merge-fields |
| borrower_control_record | borrower-control-record | /borrowers/control-record |
| credit_committee_view | credit-committee-view | /credit/committee |

### Class 2: Deal-Scoped Restoration — 7 surfaces

| Surface Key | Slug | Route |
|---|---|---|
| deals_command_bridge | deals-command-bridge | /deals/[dealId]/underwriter |
| borrower_task_inbox | borrower-task-inbox | /deals/[dealId]/portal-inbox |
| borrower_document_upload_inbox | borrower-document-upload-review | /deals/[dealId]/borrower-inbox |
| borrower_profile | borrower-profile | /deals/[dealId]/borrower |
| pricing_memo_command_center | pricing-memo-command-center | /deals/[dealId]/pricing-memo |
| credit_memo_pdf_template | credit-memo-pdf-template | /deals/[dealId]/memo-template |
| deal_output_credit_memo_spreads | deal-output-credit-memo-spreads | /deals/[dealId]/memos/new |

### Class 3: Recovery Routes — 3 surfaces (optional)

| Surface Key | Slug | Route |
|---|---|---|
| deals_pipeline_recovery | deals-pipeline-command-center | /stitch-recovery/deals |
| deal_intake_recovery | deal-intake-console | /stitch-recovery/deals-new |
| stitch_login | stitch_buddy_login_page | /stitch-login |

## Known Missing Exports

| Slug | Reason |
|---|---|
| underwrite | Pre-existing surface, no stitch_exports/underwrite/code.html |
| deal-summary | Pre-existing surface used by credit_committee, no code.html in export dir |

## Test Coverage

- **stitchSurfaceRegistryGuard.test.ts** — 7 guards (routes, slugs, pagePaths, exports, tracing)
- **stitchExportCoverage.test.ts** — 4 guards (orphan detection, ignore list validation)
- **stitchAuditRoute.test.ts** — 6 guards (orphans, wrappers, collisions, tracing, recovery)
- **stitchSurfacesRequired.test.ts** — 1 guard (pre-existing, still passing)
- **Total**: 18 tests, all passing
