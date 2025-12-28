# Credit Committee Voting + Policy Auto-Extraction + Regulator ZIP — Complete

## What This Adds (Net-New)

This completes the **governance ceiling** with three killer features:

1. **Credit Committee Voting UI** - Multi-member voting with quorum logic
2. **Policy Auto-Extraction** - AI extracts enforceable rules from credit policy docs
3. **Regulator ZIP Export** - One-click bundle for regulatory examination

---

## 🏛️ The Complete Stack

### Database (3 new tables)
- **`bank_credit_committee_members`**
  - Defines who can vote (per bank)
  - Roles: chair, member, observer
  
- **`credit_committee_votes`**
  - Immutable vote records (one vote per user per snapshot)
  - Vote types: approve, approve_with_conditions, decline
  - Includes optional comment field
  
- **`policy_extracted_rules`**
  - AI-extracted rules from uploaded credit policy docs
  - Requires human approval before activation
  - Tracks extraction confidence (high/medium/low)

### Business Logic
- **`src/lib/committee/committeeLogic.ts`**
  - `getCommitteeStatus(bankId, snapshotId)` → quorum, tally, outcome, votes
  - `isCommitteeMember(bankId, userId)` → eligibility check
  - Quorum calculation: Math.ceil(members / 2)
  - Outcome logic: decline (veto) > conditional > approve > pending

### API Routes
- **`GET /api/deals/{dealId}/decision/{snapshotId}/committee/status`**
  - Returns quorum progress, vote tally, outcome, vote history
  
- **`POST /api/deals/{dealId}/decision/{snapshotId}/committee/vote`**
  - Submit vote (approve, conditional, decline)
  - Validates committee membership
  - Writes to deal_events for audit trail
  
- **`POST /api/banks/{bankId}/policy/extract-rules`**
  - AI extracts rules from credit policy text
  - Returns suggested rules_json + confidence + explanation
  - Stores in policy_extracted_rules (unapproved)
  
- **`GET /api/deals/{dealId}/decision/{snapshotId}/regulator-zip`**
  - Generates ZIP bundle with 5 files
  - Returns as downloadable attachment

### UI Components
- **`CommitteePanel`** (client component)
  - Shows quorum progress (votes / required)
  - Vote tally badges (approve, conditional, decline)
  - Vote buttons with comment field
  - Vote history with timestamps
  - Auto-refreshes every 5 seconds (SWR)

---

## 🎯 How It Works

### Credit Committee Voting

**Setup:**
1. Bank adds committee members to `bank_credit_committee_members`
2. Committee policy configured (see previous commit)
3. Decision triggers committee requirement

**Voting Flow:**
```
Decision created → Committee required banner appears
                ↓
           CommitteePanel renders
                ↓
      Members submit votes (approve/conditional/decline)
                ↓
         Quorum logic evaluates outcome
                ↓
      Outcome: approve / conditional / decline / pending
```

**Quorum Logic:**
```typescript
quorum = Math.ceil(totalMembers / 2)

if (any decline votes)        → outcome = "decline" (veto)
else if (any conditional)     → outcome = "approve_with_conditions"
else if (votes >= quorum)     → outcome = "approve"
else                          → outcome = "pending"
```

**UI Display:**
```
🏛️ Credit Committee Vote                3 / 5 votes

Outcome: approve_with_conditions

[Approve: 2] [Conditional: 1] [Decline: 0]

Comment (optional):
[textarea: "DSCR is marginal, require quarterly monitoring"]

[Approve] [Conditional] [Decline]

Vote History:
• John Smith - Approve - 12/28/2025 3:45 PM
• Jane Doe - Conditional - 12/28/2025 3:50 PM
  "DSCR is marginal, require quarterly monitoring"
```

---

### Policy Auto-Extraction

**Purpose:** Banks upload credit policy PDFs → AI suggests enforceable rules → Human approves

**Flow:**
```
1. Bank uploads credit policy PDF
      ↓
2. Extract text (OCR or PDF.js)
      ↓
3. POST /api/banks/{bankId}/policy/extract-rules
   - AI analyzes text
   - Extracts structured rules_json
   - Returns confidence + explanation
      ↓
4. Rules stored in policy_extracted_rules (approved=false)
      ↓
5. Human reviews suggested rules in Bank Settings
      ↓
6. If approved → copy to bank_credit_committee_policies.rules_json
      ↓
7. Rules now active (auto-trigger committee requirements)
```

**Example AI Extraction:**

**Input:**
```
"All commercial loans exceeding $500,000 require credit 
committee approval. Loans with DSCR below 1.15 or LTV 
above 85% must be presented to committee..."
```

**Output:**
```json
{
  "rules": {
    "loan_amount_gt": 500000,
    "dscr_lt": 1.15,
    "ltv_gt": 0.85
  },
  "confidence": "high",
  "explanation": "Extracted three clear thresholds: loan amount $500K, DSCR 1.15, LTV 85%. All have explicit numeric values in policy text."
}
```

---

### Regulator ZIP Export

**What's in the ZIP:**
```
decision-abc123-regulator.zip
├── decision_snapshot.json      (full snapshot)
├── attestations.json           (chain of custody)
├── committee_votes.json        (voting records)
├── hash.txt                    (SHA-256 integrity hash)
└── manifest.json               (export metadata)
```

**Manifest Example:**
```json
{
  "export_version": "1.0",
  "export_timestamp": "2025-12-28T20:30:00Z",
  "bank_id": "uuid",
  "deal_id": "uuid",
  "snapshot_id": "uuid",
  "deal_context": {
    "borrower_name": "ABC Manufacturing",
    "loan_amount": 1200000
  },
  "integrity_hash": "a1b2c3...",
  "verification_url": "https://buddy.app/api/verify/a1b2c3...",
  "files": [
    "decision_snapshot.json",
    "attestations.json",
    "committee_votes.json",
    "hash.txt",
    "manifest.json"
  ],
  "note": "This bundle contains a complete, immutable record..."
}
```

**Use Case:**
- Regulatory examination: "Send me the decision file for loan #12345"
- Bank: Clicks "Regulator ZIP" button → sends file
- Examiner: Unzips → reviews JSON files → verifies hash → done

---

## 📊 Complete Governance Infrastructure

### 5-Layer Stack
```
Evidence → Policy → Decision → Override → Attestation → Committee → Export
                                              ↓            ↓          ↓
                                    Chain of Custody  Quorum Vote  ZIP Bundle
                                              ↓            ↓          ↓
                                        (Multi-Party) (Veto Power) (Regulator)
```

### Authority Trail
1. **Decision** - Snapshot-exact, immutable
2. **Attestation** - Who signed off (multi-party)
3. **Committee Vote** - Quorum + tally (democratic)
4. **Verification** - Public endpoint + QR code (transparent)
5. **Export** - Regulator bundle (compliance-ready)

---

## 🚀 What This Achieves

**Most systems:** Record outcomes

**Buddy now:** Records authority + enforces governance + proves it

### The Differentiators
1. ✅ Auto-derives governance from policy (AI-assisted, human-approved)
2. ✅ Enforces committee voting in real-time (quorum logic)
3. ✅ Records votes as immutable ledger entries (audit trail)
4. ✅ Exports regulator bundles with cryptographic hashes (compliance)
5. ✅ Public verification endpoint (transparency)

**No other system does all 5.**

---

## 🎯 Example End-to-End Flow

**Scenario:** $1.2M loan, DSCR 1.08, 3 policy exceptions

### Step 1: Policy Auto-Extraction
```
Bank uploads credit policy PDF
  ↓
AI extracts:
{
  "loan_amount_gt": 500000,
  "dscr_lt": 1.15,
  "exceptions_present": true
}
  ↓
Bank approves rules → Active
```

### Step 2: Decision Triggers Committee
```
Loan: $1.2M (> $500K threshold)
DSCR: 1.08 (< 1.15 threshold)
Exceptions: 3 (exceptions_present = true)
  ↓
Committee required: TRUE
  ↓
Banner appears: "🏛️ Credit Committee Approval Required"
```

### Step 3: Committee Voting
```
5 committee members configured
Quorum: 3 votes

Vote 1: John (Approve) - "Strong collateral"
Vote 2: Jane (Conditional) - "DSCR marginal, require quarterly monitoring"
Vote 3: Bob (Approve) - "Acceptable risk"
  ↓
Quorum met (3/5)
Outcome: approve_with_conditions
```

### Step 4: Attestation
```
Required: 3 attestations (underwriter, credit_chair, CRO)

Attest 1: Alice (underwriter)
Attest 2: Charlie (credit_chair)
Attest 3: Diana (CRO)
  ↓
Attestation complete
```

### Step 5: Export
```
Click "Regulator ZIP"
  ↓
ZIP contains:
- Decision snapshot (full)
- 3 attestations
- 3 committee votes
- SHA-256 hash
- Manifest with verification URL
  ↓
Send to examiner
```

### Step 6: Verification
```
Examiner scans QR code on PDF
  ↓
Public endpoint /api/verify/{hash}
  ↓
Returns:
- Valid: true
- Attestations: [Alice, Charlie, Diana]
- Committee votes: [John (approve), Jane (conditional), Bob (approve)]
- Chain of custody: satisfied
  ↓
Examiner: "Looks good ✓"
```

---

## 📁 Files Modified/Created

### Database
- `supabase/migrations/20251228_credit_committee_voting.sql` (new)

### Business Logic
- `src/lib/committee/committeeLogic.ts` (new)

### API Routes
- `src/app/api/deals/[dealId]/decision/[snapshotId]/committee/status/route.ts` (new)
- `src/app/api/deals/[dealId]/decision/[snapshotId]/committee/vote/route.ts` (new)
- `src/app/api/banks/[bankId]/policy/extract-rules/route.ts` (new)
- `src/app/api/deals/[dealId]/decision/[snapshotId]/regulator-zip/route.ts` (new)

### UI
- `src/components/committee/CommitteePanel.tsx` (new)
- `src/components/decision/DecisionOnePager.tsx` (modified: CommitteePanel + Regulator ZIP button)

### Dependencies
- `package.json` (added: jszip 3.10.1)

---

## 🏗️ Architecture Principles

### "AI Explains, Rules Decide"
- AI suggests rules from policy docs
- Humans approve rules
- Rules are deterministic (no AI in decision path)
- Voting outcome is pure logic (quorum + tally)

### Immutable Audit Trail
- All votes write to `credit_committee_votes` (upsert = update existing vote)
- All votes write events to `deal_events`
- Votes cannot be deleted (only updated)
- Export bundles include full vote history

### Graceful Degradation
- Committee voting disabled if no members configured
- Policy extraction optional (manual config always available)
- ZIP export works even without attestations/votes

### Zero Breaking Changes
- All features additive
- Existing decisions unaffected
- Banks opt-in to committee governance

---

## 🎉 What This Unlocks

### For Banks
- **Governance automation**: Policy → rules → enforcement
- **Committee transparency**: Real-time quorum tracking
- **Compliance confidence**: One-click regulator exports

### For Regulators
- **Instant verification**: Scan QR code → verify decision
- **Complete audit trail**: ZIP bundle with all records
- **Cryptographic proof**: SHA-256 hash integrity

### For Underwriters
- **Clear expectations**: Know when committee required
- **Vote visibility**: See who voted, how, when
- **No manual tracking**: System enforces governance

---

## 🚀 Next Steps (Optional Enhancements)

### 1. Committee Meeting Minutes
- Auto-generate meeting minutes from votes
- Attach to decision snapshot
- Include dissent opinions

### 2. Sequential Voting
- Chair votes first (sets agenda)
- Members vote in order
- Observer votes last (non-binding)

### 3. Dissent Opinion Capture
- Decline votes require detailed explanation
- Dissent attached to export bundle
- Tracked in analytics

### 4. Examiner-Mode UI
- Read-only view for regulators
- No authentication required
- Shows full governance trail

### 5. Policy Diff Tracking
- Track changes to credit policy over time
- Show which rules changed
- Link decisions to policy version

---

## Migration SQL

```sql
-- Run these in Supabase SQL Editor (in order)

-- 1. Credit committee members
create table if not exists public.bank_credit_committee_members (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  user_id text not null,
  role text not null,
  created_at timestamptz not null default now(),
  unique(bank_id, user_id)
);
alter table public.bank_credit_committee_members enable row level security;

-- 2. Credit committee votes
create table if not exists public.credit_committee_votes (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  decision_snapshot_id uuid not null references public.decision_snapshots(id) on delete cascade,
  voter_user_id text not null,
  voter_name text null,
  vote text not null check (vote in ('approve', 'approve_with_conditions', 'decline')),
  comment text null,
  created_at timestamptz not null default now(),
  unique(decision_snapshot_id, voter_user_id)
);
alter table public.credit_committee_votes enable row level security;

-- 3. Policy extracted rules
create table if not exists public.policy_extracted_rules (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  source_upload_id uuid not null references public.uploads(id) on delete cascade,
  extracted_rules_json jsonb not null default '{}'::jsonb,
  extraction_confidence text null,
  extraction_explanation text null,
  approved boolean not null default false,
  approved_by_user_id text null,
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  unique(bank_id, source_upload_id)
);
alter table public.policy_extracted_rules enable row level security;
```

---

**This is no longer software. This is institutional infrastructure.** 🏛️

**Ship it. 🚀**
