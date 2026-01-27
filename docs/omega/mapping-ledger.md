# Omega Mapping Ledger

> Single canonical table. Every mapped item in `mapping.json` has exactly one row here.
> No other tables exist for this mapping.

| kind | buddy_ref | omega_ref | links | redaction_profile | evidence | status |
|------|-----------|-----------|-------|-------------------|----------|--------|
| entity | deals (deals.id) | omega://entity/deal/{dealId} | dealId | — | supabase/migrations/20251228_borrower_portal_e2e.sql | mapped |
| entity | borrowers (borrowers.id) | omega://entity/borrower/{borrowerId} | borrowerId | — | supabase/migrations/20260120_borrowers_table.sql | mapped |
| entity | borrower_owners (borrower_owners.id) | omega://entity/borrower_owner/{ownerId} | ownerId, borrowerId | — | supabase/migrations/20260127_borrower_owners_and_naics.sql | mapped |
| entity | deal_documents (deal_documents.id) | omega://entity/document/{documentId} | documentId, dealId | — | supabase/migrations/20251228_borrower_portal_e2e.sql | mapped |
| entity | deals (deals.id) | omega://entity/underwriting_case/{dealId} | dealId | — | supabase/migrations/20251228_borrower_portal_e2e.sql | mapped |
| entity | financial_snapshots (financial_snapshots.id) | omega://entity/financial_snapshot/{snapshotId} | snapshotId, dealId | — | supabase/migrations/20260116150000_financial_snapshots_v1.sql | mapped |
| entity | decision_snapshots (decision_snapshots.id) | omega://entity/credit_decision/{snapshotId} | snapshotId, dealId | — | supabase/migrations/20251229_decision_os_safe.sql | mapped |
| entity | bank_policy_packs (bank_policy_packs.id) | omega://entity/policy_context/{bankId}/{policyVersion} | bankId, policyVersion | — | supabase/migrations/20260127_examiner_access_grants.sql | mapped |
| entity | decision_snapshots (decision_snapshots.id) | omega://entity/examiner_drop/{dealId}/{snapshotId} | dealId, snapshotId | — | src/lib/audit/buildExaminerDropZip.ts | mapped |
| event | deal.document.uploaded | buddy.document.uploaded | dealId, documentId? | audit_safe | src/buddy/signals.ts | mapped |
| event | deal.underwriting.started | buddy.underwriting.started | dealId | audit_safe | src/buddy/signals.ts | mapped |
| event | borrower.completed | buddy.borrower.completed | borrowerId, dealId? | audit_safe | src/buddy/signals.ts | mapped |
| event | borrower.owners.attested | buddy.borrower.owners.attested | borrowerId, dealId? | audit_safe | src/buddy/signals.ts | mapped |
| event | borrower.audit.snapshot.created | buddy.borrower.audit.snapshot.created | borrowerId, dealId? | examiner_safe | src/buddy/signals.ts, src/lib/audit/buildBorrowerAuditSnapshot.ts | mapped |
| event | decision.audit.snapshot.created | buddy.credit.decision.audit.snapshot.created | dealId, snapshotId | examiner_safe | src/buddy/signals.ts, src/lib/audit/buildCreditDecisionAuditSnapshot.ts | mapped |
| event | examiner.drop.created | buddy.examiner.drop.generated | dealId | examiner_safe | src/buddy/signals.ts, src/lib/audit/buildExaminerDropZip.ts | mapped |
| event | model.governance.exported | buddy.model.governance.exported | dealId? | audit_safe | src/buddy/signals.ts, src/lib/modelGovernance/modelRegistry.ts | mapped |
| event | examiner.playbooks.exported | buddy.examiner.playbooks.exported | dealId? | audit_safe | src/buddy/signals.ts, src/lib/examiner/playbookGenerator.ts | mapped |
| event | policy.pack.created | buddy.policy.pack.created | bankId | audit_safe | src/buddy/signals.ts | mapped |
| event | policy.pack.resolved | buddy.policy.pack.resolved | dealId, bankId | audit_safe | src/buddy/signals.ts, src/lib/policy/resolvePolicyContext.ts | mapped |
| event | policy.frozen.validated | buddy.policy.frozen.validated | dealId, bankId | audit_safe | src/buddy/signals.ts | mapped |
| event | bank.decision.compared | buddy.bank.decision.compared | dealId | audit_safe | src/buddy/signals.ts, src/lib/audit/compareBankDecisions.ts | mapped |
| event | api.degraded | buddy.api.degraded | — | internal_debug | src/buddy/signals.ts | mapped |
| event | deal.ignited | buddy.deal.ignited | dealId | audit_safe | src/buddy/signals.ts | mapped |
| event | deal.lifecycle | buddy.deal.lifecycle | dealId | audit_safe | src/buddy/signals.ts | mapped |
| event | examiner.access.granted | buddy.examiner.access.granted | dealId? | examiner_safe | src/buddy/signals.ts, src/lib/examiner/examinerAccessGrants.ts | mapped |
| event | examiner.access.revoked | buddy.examiner.access.revoked | dealId? | examiner_safe | src/buddy/signals.ts, src/lib/examiner/examinerAccessGrants.ts | mapped |
| event | examiner.verified.integrity | buddy.examiner.verified.integrity | dealId? | examiner_safe | src/buddy/signals.ts | mapped |
| state | underwriting_case composite | omega://state/underwriting_case/{dealId} | dealId | — | buildCreditDecisionAuditSnapshot, buildExaminerDropZip | mapped |
| state | borrower composite | omega://state/borrower/{borrowerId} | borrowerId | — | buildBorrowerAuditSnapshot | mapped |
| state | credit_decision composite | omega://state/credit_decision/{dealId} | dealId | — | buildCreditDecisionAuditSnapshot | mapped |
| state | examiner_drop composite | omega://state/examiner_drop/{dealId} | dealId | — | buildExaminerDropZip | mapped |
| state | policy_context composite | omega://state/policy_context/{bankId} | bankId | — | bank_policy_packs table | mapped |
| constraint | src/lib/policy/*, src/lib/underwrite/* | omega://constraints/buddy/underwriting | underwriting_case | — | src/lib/policy/types.ts | mapped |
| constraint | src/lib/modelGovernance/* | omega://constraints/buddy/model_governance | underwriting_case, borrower | — | src/lib/modelGovernance/modelRegistry.ts | mapped |
