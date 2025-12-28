# Credit Committee Governance — Complete

## What This Adds (Net-New)

**Credit Committee Governance** is the final piece of the governance infrastructure. This feature allows banks to configure **deterministic rules** that automatically determine when a loan decision requires credit committee approval.

---

## 🏛️ The Stack

### Database
- **`bank_credit_committee_policies`** table
  - `enabled` (boolean): Toggle committee governance on/off per bank
  - `rules_json` (jsonb): Structured rules (loan_amount_gt, dscr_lt, ltv_gt, risk_rating_gte, exceptions_present, etc.)
  - `derived_from_upload_id` (uuid): Optional reference to uploaded credit policy document
  - Default policies created for all existing banks (disabled by default)

### Business Logic
- **`src/lib/decision/creditCommittee.ts`**
  - `requiresCreditCommittee(bankId, decisionSnapshot)` → evaluates rules, returns {required, reasons, policy}
  - `extractCommitteeRulesFromPolicy(bankId, uploadId, policyText)` → AI-assisted extraction (future)
  - All rule evaluation is **deterministic** (not AI-driven)

### API Routes
- **`GET /api/deals/{dealId}/decision/{snapshotId}/committee-status`**
  - Returns whether committee approval is required for this decision
  - Returns reasons (e.g., "Loan amount exceeds threshold")
  - Returns policy configuration

### UI Integration
- **Decision One-Pager** (DecisionOnePager.tsx)
  - Purple banner: "🏛️ Credit Committee Approval Required"
  - Lists reasons (e.g., "DSCR below threshold", "3 policy exceptions")
  - Shows "Rules derived from uploaded credit policy" if auto-extracted

---

## 🎯 How It Works

### Example Policy Configuration
```json
{
  "loan_amount_gt": 500000,
  "dscr_lt": 1.15,
  "ltv_gt": 0.85,
  "risk_rating_gte": 7,
  "exceptions_present": true,
  "collateral_shortfall_gt": 0
}
```

### Evaluation Logic (Deterministic)
```typescript
// Rule: Loan amount exceeds threshold
if (rules.loan_amount_gt && snapshot.inputs_json?.loan_amount > rules.loan_amount_gt) {
  reasons.push("Loan amount ($1.2M) exceeds committee threshold ($500K)");
}

// Rule: DSCR below policy minimum
if (rules.dscr_lt && snapshot.policy_eval_json?.dscr < rules.dscr_lt) {
  reasons.push("DSCR (1.08) below committee threshold (1.15)");
}

// Rule: Policy exceptions present
if (rules.exceptions_present && snapshot.exceptions_json?.length > 0) {
  reasons.push("3 policy exception(s) require committee review");
}
```

### Display
When a decision triggers any rule, the UI shows:

```
🏛️ Credit Committee Approval Required

• Loan amount ($1,200,000) exceeds committee threshold ($500,000)
• DSCR (1.08) below committee threshold (1.15)
• 3 policy exception(s) require committee review

Rules derived from uploaded credit policy
```

---

## 🚀 Complete Governance Stack

This completes the **4-layer governance infrastructure**:

### Layer 1: Official PDFs (commit 415406d)
- Regulator-grade exports with cryptographic hash
- Bank letterhead support (convention-based)
- Immutable snapshots

### Layer 2: Multi-Party Attestation (commit 90dbacd)
- Bank-configurable attestation policies
- Required roles + counts
- Chain of custody tracking
- Progress UI

### Layer 3: External Verification (commit 2f856de)
- Public `/api/verify/{hash}` endpoint
- QR codes in PDFs
- Instant regulator verification

### Layer 4: Credit Committee Governance (this commit)
- Bank-defined rules (deterministic)
- Auto-extraction from credit policy docs (future)
- Policy-driven committee triggers

---

## 📊 The Authority Stack

```
Evidence → Policy → Decision → Override → Attestation → Verification → Committee
                                                                            ↓
                                                                   Governance Rules
                                                                            ↓
                                                                  (Policy-Driven)
```

---

## 🎯 Next Steps (Optional)

### Immediate
1. Run migration: `20251228_credit_committee_policies.sql` in Supabase
2. Deploy to production
3. Test: Configure policy in Bank Settings → Create decision → See committee banner

### Future Enhancements
1. **Credit Committee Voting UI**
   - Bulk attestation (committee members vote in one session)
   - Vote tracking (approved/rejected/abstain)
   - Meeting minutes attached to decision

2. **Policy Auto-Extraction**
   - Upload credit policy PDF → AI extracts rules_json
   - Human reviews + approves suggested rules
   - Rules saved to bank_credit_committee_policies

3. **Sequential Attestation**
   - Ordered flow: underwriter → credit_chair → CRO
   - Each role unlocks next step
   - Email notifications to next required role

4. **Analytics Dashboard**
   - Committee approval rates
   - Time to committee approval
   - Most common committee triggers
   - Policy compliance metrics

5. **Regulator Export Bundles**
   - ZIP: PDF + JSON + CSV of attestations
   - One-click "Export for Examiner"
   - Includes committee vote history

---

## 🏗️ Architecture Principles

### "AI Explains, Rules Decide"
- AI can **suggest** rules from credit policy docs
- Humans **approve** suggested rules
- Rules are stored as **structured data** (rules_json)
- Evaluation is **deterministic** (no AI in decision path)

### Convention-Based
- Reuses existing `uploads` table for letterhead
- Reuses existing `decision_snapshots` for evaluation
- No new document types or workflows

### Graceful Degradation
- Committee governance disabled by default
- Decisions work without committee policies
- Manual configuration always available

### Zero Breaking Changes
- All features additive
- Existing decisions unaffected
- Banks opt-in to governance layers

---

## 📁 Files Modified/Created

### Database
- `supabase/migrations/20251228_credit_committee_policies.sql` (new)

### Business Logic
- `src/lib/decision/creditCommittee.ts` (new)

### API Routes
- `src/app/api/deals/[dealId]/decision/[snapshotId]/committee-status/route.ts` (new)

### UI
- `src/components/decision/DecisionOnePager.tsx` (modified: committee banner)
- `src/app/(app)/deals/[dealId]/decision/page.tsx` (modified: fetch committee status)

---

## 🎉 What This Achieves

Most underwriting systems **record outcomes**.

Buddy now **records authority**:
- ✅ Who decided (attestation chain)
- ✅ Under what policy (snapshot-exact)
- ✅ With what exceptions (immutable)
- ✅ With how much governance (committee rules)
- ✅ With what verification (public endpoint)

**This is no longer software. This is infrastructure.**

---

## Migration SQL

```sql
-- Run this in Supabase SQL Editor
create table if not exists public.bank_credit_committee_policies (
  bank_id uuid primary key references public.banks(id) on delete cascade,
  enabled boolean not null default false,
  rules_json jsonb not null default '{}'::jsonb,
  derived_from_upload_id uuid null references public.uploads(id) on delete set null,
  last_evaluated_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bank_credit_committee_policies enable row level security;

-- Insert defaults for existing banks
insert into public.bank_credit_committee_policies (bank_id, enabled, rules_json)
select id, false, '{}'::jsonb
from public.banks
on conflict (bank_id) do nothing;
```

---

**Ship it. 🚀**
