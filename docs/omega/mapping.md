# Buddy to Omega Prime Schema Mapping

> Version 1.0 | Generated from `docs/omega/mapping.json`

## Ownership Model

| Concern | Owner |
|---------|-------|
| Source of truth | Omega (belief) |
| Operational storage | Buddy DB |
| Event bus | Omega events |
| Audit artifacts | Buddy exports |

**Invariant**: Buddy DB is operational storage, never truth. Omega state is belief.
No secrets, raw document bytes, or unmasked PII transit to Omega.

---

## Entity Mapping

Buddy entities map to `omega://entity/{type}/{id}` URIs.

### deal
- **URI**: `omega://entity/deal/{dealId}`
- **Buddy PK**: `deals.id`
- **Sources**: deals, deal_events, deal_pipeline_ledger
- **PII rules**: none

### borrower
- **URI**: `omega://entity/borrower/{borrowerId}`
- **Buddy PK**: `borrowers.id`
- **Sources**: borrowers, borrower_owners, borrower_owner_attestations
- **PII rules**: mask_ein, no_ssn

### borrower_owner
- **URI**: `omega://entity/borrower_owner/{ownerId}`
- **Buddy PK**: `borrower_owners.id`
- **Sources**: borrower_owners, borrower_owner_attestations
- **PII rules**: no_ssn, ssn_last4_only

### document
- **URI**: `omega://entity/document/{documentId}`
- **Buddy PK**: `deal_documents.id`
- **Sources**: deal_documents
- **PII rules**: no_raw_bytes

### underwriting_case
- **URI**: `omega://entity/underwriting_case/{dealId}`
- **Buddy PK**: `deals.id`
- **Sources**: deals, deal_events, deal_pipeline_ledger, financial_snapshots, decision_snapshots
- **PII rules**: none
- **Note**: Composite view aliasing deal with full lifecycle context

### financial_snapshot
- **URI**: `omega://entity/financial_snapshot/{snapshotId}`
- **Buddy PK**: `financial_snapshots.id`
- **Sources**: financial_snapshots, financial_snapshot_decisions
- **PII rules**: none
- **Note**: Immutable after insert (trigger-enforced)

### credit_decision
- **URI**: `omega://entity/credit_decision/{snapshotId}`
- **Buddy PK**: `decision_snapshots.id`
- **Sources**: decision_snapshots, decision_overrides, decision_attestations, credit_committee_votes, credit_committee_minutes, credit_committee_dissent
- **PII rules**: none
- **Note**: Immutable when status=final

### policy_context
- **URI**: `omega://entity/policy_context/{bankId}/{policyVersion}`
- **Buddy PK**: `bank_policy_packs.id`
- **Sources**: bank_policy_packs, policy_extracted_rules
- **PII rules**: none

### examiner_drop
- **URI**: `omega://entity/examiner_drop/{dealId}/{snapshotId}`
- **Buddy PK**: `decision_snapshots.id`
- **Sources**: decision_snapshots, financial_snapshots, borrowers, borrower_owners, borrower_owner_attestations, bank_policy_packs
- **PII rules**: mask_ein, no_ssn, no_raw_bytes

---

## Event Mapping

Buddy events map to `omega://events/write`. Each Buddy signal/ledger event has a canonical Omega event type prefixed with `buddy.`.

| Buddy Event | Omega Event | Redaction |
|-------------|-------------|-----------|
| deal.document.uploaded | buddy.document.uploaded | audit_safe |
| deal.underwriting.started | buddy.underwriting.started | audit_safe |
| borrower.completed | buddy.borrower.completed | audit_safe |
| borrower.owners.attested | buddy.borrower.owners.attested | audit_safe |
| borrower.audit.snapshot.created | buddy.borrower.audit.snapshot.created | examiner_safe |
| decision.audit.snapshot.created | buddy.credit.decision.audit.snapshot.created | examiner_safe |
| examiner.drop.created | buddy.examiner.drop.generated | examiner_safe |
| model.governance.exported | buddy.model.governance.exported | audit_safe |
| examiner.playbooks.exported | buddy.examiner.playbooks.exported | audit_safe |
| policy.pack.created | buddy.policy.pack.created | audit_safe |
| policy.pack.resolved | buddy.policy.pack.resolved | audit_safe |
| policy.frozen.validated | buddy.policy.frozen.validated | audit_safe |
| bank.decision.compared | buddy.bank.decision.compared | audit_safe |
| api.degraded | buddy.api.degraded | internal_debug |
| deal.ignited | buddy.deal.ignited | audit_safe |
| deal.lifecycle | buddy.deal.lifecycle | audit_safe |
| examiner.access.granted | buddy.examiner.access.granted | examiner_safe |
| examiner.access.revoked | buddy.examiner.access.revoked | examiner_safe |
| examiner.verified.integrity | buddy.examiner.verified.integrity | examiner_safe |

---

## State Views

Omega state views replace direct DB reads for AI/agent consumers.

| State URI | Key Events | Must Match Exports |
|-----------|------------|-------------------|
| omega://state/underwriting_case/{dealId} | deal.ignited, deal.lifecycle, underwriting.started, document.uploaded, borrower.completed, borrower.owners.attested, credit.decision.audit.snapshot.created, examiner.drop.generated | buildCreditDecisionAuditSnapshot, buildExaminerDropZip |
| omega://state/borrower/{borrowerId} | borrower.completed, borrower.owners.attested, borrower.audit.snapshot.created, document.uploaded | buildBorrowerAuditSnapshot |
| omega://state/credit_decision/{dealId} | credit.decision.audit.snapshot.created, policy.pack.resolved, policy.frozen.validated, bank.decision.compared | buildCreditDecisionAuditSnapshot |
| omega://state/examiner_drop/{dealId} | examiner.drop.generated, examiner.access.granted, examiner.access.revoked, examiner.verified.integrity | buildExaminerDropZip |
| omega://state/policy_context/{bankId} | policy.pack.created, policy.pack.resolved, policy.frozen.validated | (none) |

---

## Constraint Namespaces

| Namespace | Resource | Applies To | Source Files |
|-----------|----------|------------|-------------|
| buddy/underwriting | omega://constraints/buddy/underwriting | underwriting_case | src/lib/policy/*, src/lib/underwrite/* |
| buddy/model_governance | omega://constraints/buddy/model_governance | underwriting_case, borrower | src/lib/modelGovernance/* |

---

## Redaction Profiles

| Profile | Description | Denied | Masked |
|---------|-------------|--------|--------|
| audit_safe | No PII, hashed IDs ok, masked EIN ok | ssn, ein_raw, document_bytes, raw_tax_return | ein |
| examiner_safe | audit_safe + snapshot hashes | ssn, ein_raw, document_bytes, raw_tax_return | ein |
| internal_debug | No raw SSN/EIN; allows diagnostics | ssn, ein_raw, document_bytes, raw_tax_return | ein |

---

## Code References

- URI builders: `src/lib/omega/uri.ts`
- Typed accessors: `src/lib/omega/mapping.ts`
- Redaction utilities: `src/lib/omega/redaction.ts`
- Validation script: `scripts/omega/validate-mapping.mjs`
- Canonical machine source: `docs/omega/mapping.json`
- Canonical ledger table: `docs/omega/mapping-ledger.md`
