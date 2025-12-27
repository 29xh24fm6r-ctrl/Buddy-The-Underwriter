# SBA God Mode - Phase 2 Complete

## Overview
Phase 2 extends the multi-agent underwriting system with **arbitration logic**, **bank-specific policy overlays**, and **borrower delight UX**. This transforms Buddy from a document processor into a full SBA underwriting operating system.

---

## A. Agent Arbitration System

### Architecture
When multiple agents disagree on the same fact (e.g., "What is the global DSCR?"), the arbitration engine resolves conflicts deterministically using rules R0-R5.

### Database Schema

#### 1. `agent_claims`
Normalized atomic claims extracted from agent findings.

```sql
CREATE TABLE agent_claims (
  id uuid PRIMARY KEY,
  deal_id uuid NOT NULL,
  bank_id uuid NOT NULL,
  agent_name text NOT NULL,
  finding_id uuid NOT NULL,
  
  topic text NOT NULL,           -- e.g., "cash_flow", "eligibility"
  field_path text NOT NULL,      -- JSONPath, e.g., "cash_flow.dscr_global"
  claim_value jsonb NOT NULL,
  
  claim_hash text NOT NULL,      -- Stable hash for conflict detection
  confidence_score decimal,
  
  created_at timestamptz DEFAULT now()
);
```

#### 2. `claim_conflict_sets`
Groups of claims with same topic + field_path but different values.

```sql
CREATE TABLE claim_conflict_sets (
  id uuid PRIMARY KEY,
  deal_id uuid NOT NULL,
  bank_id uuid NOT NULL,
  
  topic text NOT NULL,
  field_path text NOT NULL,
  claim_ids uuid[] NOT NULL,
  
  status text CHECK (status IN ('open', 'resolved', 'human_override')),
  
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);
```

#### 3. `arbitration_decisions`
Final resolution of each conflict set.

```sql
CREATE TABLE arbitration_decisions (
  id uuid PRIMARY KEY,
  conflict_set_id uuid NOT NULL,
  deal_id uuid NOT NULL,
  bank_id uuid NOT NULL,
  
  topic text NOT NULL,
  field_path text NOT NULL,
  chosen_value jsonb NOT NULL,
  chosen_claim_id uuid,
  
  rule_trace_json jsonb NOT NULL,  -- Full audit trail
  confidence_score decimal,
  requires_human_review boolean DEFAULT false,
  
  created_at timestamptz DEFAULT now()
);
```

#### 4. `deal_truth_snapshots`
Versioned single source of truth compiled from all decisions.

```sql
CREATE TABLE deal_truth_snapshots (
  id uuid PRIMARY KEY,
  deal_id uuid NOT NULL,
  bank_id uuid NOT NULL,
  
  truth_json jsonb NOT NULL,         -- Complete deal truth
  version integer NOT NULL,
  
  total_claims integer,
  resolved_claims integer,
  needs_human integer,
  overall_confidence decimal,
  
  bank_overlay_id uuid,
  bank_overlay_version integer,
  
  created_at timestamptz DEFAULT now()
);
```

### Arbitration Rules (R0-R5)

**R0: SBA Hard Rules** (highest priority)
- SOP 50 10 rules are non-negotiable
- Examples: Business size standards, ineligible businesses, max loan amounts
- Agent: `sba-policy` with `severity: blocker`

**R1: Evidence Completeness**
- Claims backed by uploaded/verified documents win
- Example: Tax-return-derived DSCR beats pro-forma DSCR

**R2: Weighted Agent Voting**
- Agents vote with confidence scores
- Weights: SBA Policy = 3.0, Risk = 2.0, Cash Flow = 2.0, Others = 1.0

**R3: Freshness**
- Newer agent runs win ties (timestamp-based)

**R4: Bank Overlays**
- Bank-specific policies can ONLY tighten SBA requirements, never loosen

**R5: Close Call Detection**
- If top 2 scores within 10%, flag for human review
- Example: DSCR of 1.18 vs 1.22 → needs underwriter judgment

### API Workflow

```bash
# Step 1: Run agents
POST /api/deals/{dealId}/agents/execute
# Returns: 4 agent findings

# Step 2: Normalize findings → claims → conflict sets
POST /api/deals/{dealId}/arbitration/ingest
# Returns: {claims: 47, conflict_sets: 3}

# Step 3: Reconcile conflicts using R0-R5
POST /api/deals/{dealId}/arbitration/reconcile
# Returns: {decisions: 3, human_review_needed: 1}

# Step 4: Materialize truth snapshot
POST /api/deals/{dealId}/arbitration/materialize
# Returns: {snapshot_id, version: 2, truth: {...}}

# Step 5: Check status
GET /api/deals/{dealId}/arbitration/status
# Returns: {conflict_sets, decisions, latest_truth}
```

### Key Files

| Path | Purpose |
|------|---------|
| `src/lib/agents/claim-normalization.ts` | Extract atomic claims from agent findings |
| `src/lib/agents/arbitration.ts` | Reconciliation engine (R0-R5 implementation) |
| `src/app/api/deals/[dealId]/arbitration/ingest/route.ts` | Normalize findings API |
| `src/app/api/deals/[dealId]/arbitration/reconcile/route.ts` | Resolve conflicts API |
| `src/app/api/deals/[dealId]/arbitration/materialize/route.ts` | Create truth snapshot API |
| `src/app/api/deals/[dealId]/arbitration/status/route.ts` | Query arbitration state API |
| `supabase/migrations/20251227000002_agent_arbitration.sql` | Arbitration schema |

---

## B. Bank Overlay System

### Purpose
Banks can add their own requirements **on top of** SBA rules without editing code. Overlays are validated to ensure they never loosen SBA compliance (policy-as-code).

### Database Schema

#### 1. `bank_overlays`
Bank-specific policy configurations.

```sql
CREATE TABLE bank_overlays (
  id uuid PRIMARY KEY,
  bank_id uuid NOT NULL,
  
  overlay_name text NOT NULL,
  version integer NOT NULL,
  is_active boolean DEFAULT true,
  
  rules jsonb NOT NULL,  -- DSL for bank policies
  
  created_at timestamptz DEFAULT now()
);
```

#### 2. `overlay_application_log`
Audit trail of when overlays were applied.

```sql
CREATE TABLE overlay_application_log (
  id uuid PRIMARY KEY,
  deal_id uuid NOT NULL,
  bank_id uuid NOT NULL,
  overlay_id uuid NOT NULL,
  
  trigger_condition_met boolean,
  claims_generated integer,
  
  applied_at timestamptz DEFAULT now()
);
```

#### 3. `overlay_generated_claims`
Claims produced by bank overlays.

```sql
CREATE TABLE overlay_generated_claims (
  id uuid PRIMARY KEY,
  deal_id uuid NOT NULL,
  bank_id uuid NOT NULL,
  overlay_id uuid NOT NULL,
  
  topic text NOT NULL,
  field_path text NOT NULL,
  claim_value jsonb NOT NULL,
  
  created_at timestamptz DEFAULT now()
);
```

### DSL Structure

```typescript
interface BankOverlay {
  overlay_name: string;
  rules: BankOverlayRule[];
}

interface BankOverlayRule {
  rule_id: string;
  trigger_condition: string;  // JSONPath expression
  policy_constraints: PolicyConstraint[];
  generated_claims: ClaimTemplate[];
}

interface PolicyConstraint {
  type: "min_dscr" | "max_ltv" | "require_document" | "exclude_naics";
  params: Record<string, any>;
}

interface ClaimTemplate {
  topic: string;
  field_path: string;
  value: any;
  severity: "blocker" | "warning";
}
```

### Example: Conservative Bank Overlay

```json
{
  "overlay_name": "Conservative Commercial Bank v1",
  "rules": [
    {
      "rule_id": "min-dscr-1.5",
      "trigger_condition": "deal.loan_amount > 500000",
      "policy_constraints": [
        {
          "type": "min_dscr",
          "params": { "threshold": 1.5 }
        }
      ],
      "generated_claims": [
        {
          "topic": "cash_flow",
          "field_path": "cash_flow.min_required_dscr",
          "value": 1.5,
          "severity": "blocker"
        }
      ]
    },
    {
      "rule_id": "exclude-restaurants",
      "trigger_condition": "deal.naics_code.startsWith('722')",
      "policy_constraints": [
        {
          "type": "exclude_naics",
          "params": { "naics_prefix": "722" }
        }
      ],
      "generated_claims": [
        {
          "topic": "eligibility",
          "field_path": "eligibility.bank_exclusions",
          "value": "Restaurants excluded per bank policy",
          "severity": "blocker"
        }
      ]
    }
  ]
}
```

### Validation Rules
Bank overlays are validated before activation:

1. **No Loosening**: Cannot reduce SBA requirements (e.g., can't lower DSCR from 1.25 to 1.0)
2. **Additive Only**: Can add documents, tighten thresholds, exclude industries
3. **Severity Constraints**: Bank overlays can create `blocker` or `warning` claims
4. **Trigger Logic**: Triggers must be deterministic JSONPath expressions

### API Workflow

```bash
# Create bank overlay
POST /api/admin/banks/{bankId}/overlays
Body: { overlay_name, rules }
# Validates overlay, creates version, sets active

# Apply overlay during reconciliation
POST /api/deals/{dealId}/arbitration/reconcile
# Automatically applies active bank overlay, generates claims, logs application

# Query overlay history
GET /api/deals/{dealId}/arbitration/status
# Returns: overlay_logs with trigger conditions + claims generated
```

### Key Files

| Path | Purpose |
|------|---------|
| `src/lib/agents/bank-overlay.ts` | DSL evaluator + validation |
| `supabase/migrations/20251227000003_bank_overlays.sql` | Bank overlay schema |

---

## C. Borrower Delight System

### Readiness Score
TurboTax-style progress tracker that shows borrowers how close they are to underwriting review.

#### Components (Sum to 100%)
1. **Identity Verification** (10%): Borrower verified via Plaid/SSO
2. **Business Profile Complete** (10%): Required fields filled (EIN, address, industry)
3. **Documents Uploaded** (30%): All required docs in system
4. **Documents Verified** (25%): OCR + human review complete
5. **Underwriting Confidence** (25%): Agent consensus confidence from truth snapshot

#### Rules
- **Eligibility Gate**: If any `eligibility` claim has `severity: blocker` and `status: fail`, cap score at 20%
- **Milestones**: Toast celebrations at 25%, 50%, 75%, 100%
- **Next Best Action**: One clear CTA, not a laundry list

### UI Components

#### 1. ReadinessScoreCard
Circular progress indicator with component breakdown.

```tsx
<ReadinessScoreCard
  overallScore={0.68}
  components={{
    identity_verification: 1.0,
    business_profile_complete: 0.9,
    documents_uploaded: 0.7,
    documents_verified: 0.5,
    underwriting_confidence: 0.6,
  }}
  milestones={{
    '25': true,
    '50': true,
    '75': false,
    '100': false,
  }}
/>
```

#### 2. NextBestActionCard
Single CTA based on current state.

```tsx
<NextBestActionCard
  action={{
    type: 'upload_document',
    title: 'Upload 2023 tax return',
    description: 'We need your most recent business tax return',
    eta_minutes: 3,
    priority: 'high',
  }}
/>
```

#### 3. SmartUploadDropzone
Auto-detects document type from filename, suggests missing docs.

```tsx
<SmartUploadDropzone
  dealId="..."
  onUploadComplete={() => refreshReadinessScore()}
/>
```

#### 4. MilestoneToast
Celebratory toast when milestones are hit.

```tsx
<MilestoneToast
  milestone="50"
  onDismiss={() => setMilestone(null)}
/>
```

#### 5. ExplainWhyDrawer
Plain-English explanations of underwriting requirements.

```tsx
<ExplainWhyDrawer
  isOpen={drawerOpen}
  onClose={() => setDrawerOpen(false)}
  topic="Why do you need 3 years of tax returns?"
  dealId="..."
/>
```

### API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/deals/{dealId}/borrower/readiness-score` | Calculate readiness score |
| `GET /api/deals/{dealId}/explain?topic=<topic>` | AI-generated plain-English explanation |

### Key Files

| Path | Purpose |
|------|---------|
| `src/lib/borrower/readiness-score.ts` | Score calculation logic |
| `src/components/borrower/ReadinessScoreCard.tsx` | Progress visualization |
| `src/components/borrower/NextBestActionCard.tsx` | Single CTA component |
| `src/components/borrower/SmartUploadDropzone.tsx` | Intelligent document uploader |
| `src/components/borrower/MilestoneToast.tsx` | Celebration toasts |
| `src/components/borrower/ExplainWhyDrawer.tsx` | Explanation side drawer |
| `src/app/api/deals/[dealId]/borrower/readiness-score/route.ts` | Readiness API |
| `src/app/api/deals/[dealId]/explain/route.ts` | Explanation API |

---

## D. Eventing System

### Purpose
When truth snapshots are created/updated, fire events to trigger downstream consumers.

### Event Types
- `deal.truth.updated`: Truth snapshot created/refreshed
- `deal.truth.conflict_resolved`: Human override applied

### Consumers

#### 1. Narrative Agent
Regenerates executive summary when risks/eligibility/credit change.

#### 2. Evidence Agent
Verifies uploaded documents against truth claims.

#### 3. Borrower Tasks
Recalculates readiness score and updates next best action.

### Database Schema

```sql
CREATE TABLE deal_truth_events (
  id uuid PRIMARY KEY,
  deal_id uuid NOT NULL,
  bank_id uuid NOT NULL,
  
  event_type text CHECK (event_type IN ('deal.truth.updated', 'deal.truth.conflict_resolved')),
  truth_snapshot_id uuid NOT NULL,
  
  trigger text CHECK (trigger IN ('agent_run', 'manual_override', 'bank_overlay', 'periodic_refresh')),
  changed_topics text[],
  
  created_at timestamptz DEFAULT now()
);
```

### Usage

```typescript
import { fireDealTruthEvent } from '@/lib/events/deal-truth';

// After materializing truth
await fireDealTruthEvent({
  type: 'deal.truth.updated',
  deal_id: dealId,
  bank_id: bankId,
  truth_snapshot_id: snapshot.id,
  trigger: 'agent_run',
  changed_topics: ['eligibility', 'cash_flow'],
  timestamp: new Date(),
});

// Triggers:
// - Narrative Agent regeneration (if risks/eligibility changed)
// - Evidence Agent verification (if documents changed)
// - Borrower readiness score update
```

### Key Files

| Path | Purpose |
|------|---------|
| `src/lib/events/deal-truth.ts` | Event emitter + consumer orchestration |
| `supabase/migrations/20251227000004_deal_truth_events.sql` | Event log schema |

---

## E. Truth & Conflicts UI

### UnderwriterCockpit: TruthConflictsPanel
Displays current deal truth, open conflicts, and resolved claims.

#### Features
1. **Deal Truth Summary**: Version, confidence, key values (eligibility, DSCR, top risk)
2. **Open Conflicts**: Conflicts requiring human review, with suggested resolutions
3. **Provenance Viewer**: See which agents contributed to each claim, rule trace
4. **Override Capability**: Underwriters can override decisions with rationale
5. **Resolved Claims**: Show finalized decisions with winning rule
6. **Bank Overlays Applied**: Log of bank-specific policies that fired

### Usage

```tsx
import { TruthConflictsPanel } from '@/components/agents/TruthConflictsPanel';

<TruthConflictsPanel
  dealId="..."
  bankId="..."
/>
```

### Key Files

| Path | Purpose |
|------|---------|
| `src/components/agents/TruthConflictsPanel.tsx` | Underwriter UI for truth + conflicts |

---

## Testing

### Manual Test Workflow

```bash
# 1. Create a deal
POST /api/deals
Body: { business_name: "Test Coffee Shop", loan_amount: 500000 }

# 2. Run agents
POST /api/deals/{dealId}/agents/execute

# 3. Ingest findings
POST /api/deals/{dealId}/arbitration/ingest

# 4. Reconcile conflicts
POST /api/deals/{dealId}/arbitration/reconcile

# 5. Materialize truth
POST /api/deals/{dealId}/arbitration/materialize

# 6. Check status
GET /api/deals/{dealId}/arbitration/status

# 7. Get borrower readiness
GET /api/deals/{dealId}/borrower/readiness-score

# 8. Explain a requirement
GET /api/deals/{dealId}/explain?topic=Why do you need tax returns?
```

### Expected Outputs

**After ingest:**
```json
{
  "ok": true,
  "data": {
    "claims_created": 47,
    "conflict_sets_created": 3
  }
}
```

**After reconcile:**
```json
{
  "ok": true,
  "data": {
    "decisions_created": 3,
    "conflicts_resolved": 2,
    "human_review_needed": 1
  }
}
```

**After materialize:**
```json
{
  "ok": true,
  "data": {
    "snapshot_id": "...",
    "version": 2,
    "total_claims": 47,
    "resolved_claims": 46,
    "needs_human_review": 1,
    "overall_confidence": 0.83,
    "truth": {
      "eligibility": { "is_eligible": true },
      "cash_flow": { "dscr_global": 1.42 },
      "risks": { "top_risks": [...] }
    }
  }
}
```

---

## Migration Checklist

✅ **Database Migrations**
- [x] `20251227000002_agent_arbitration.sql` (4 tables: claims, conflicts, decisions, snapshots)
- [x] `20251227000003_bank_overlays.sql` (3 tables: overlays, logs, generated claims)
- [x] `20251227000004_deal_truth_events.sql` (1 table: event log)

✅ **Arbitration System**
- [x] Claim normalization (`src/lib/agents/claim-normalization.ts`)
- [x] Reconciliation engine (`src/lib/agents/arbitration.ts`)
- [x] Bank overlay evaluator (`src/lib/agents/bank-overlay.ts`)
- [x] Ingest API route
- [x] Reconcile API route
- [x] Materialize API route
- [x] Status API route

✅ **Borrower Delight**
- [x] Readiness score calculator (`src/lib/borrower/readiness-score.ts`)
- [x] ReadinessScoreCard component
- [x] NextBestActionCard component
- [x] SmartUploadDropzone component
- [x] MilestoneToast component
- [x] ExplainWhyDrawer component
- [x] Readiness score API route
- [x] Explain API route

✅ **Eventing**
- [x] Event emitter (`src/lib/events/deal-truth.ts`)
- [x] Consumer orchestration (narrative, evidence, borrower tasks)
- [x] Materialize route updated to fire events

✅ **UI Components**
- [x] TruthConflictsPanel for underwriters

---

## Next Steps (Phase 3)

### Remaining 6 Agents
1. **Credit Agent** - Pulls credit reports, calculates risk scores
2. **Collateral Agent** - Appraises real estate/equipment, calculates LTV
3. **Management Agent** - Evaluates owner experience, succession plans
4. **Narrative Agent** - Generates executive summary for credit committee
5. **Evidence Agent** - Verifies document authenticity, cross-references claims
6. **Banker Copilot Agent** - Suggests optimal loan structure, pricing

### E-Tran Package Generator
- XML generation per SBA E-Tran spec
- Human approval required before submission
- Auto-population from deal truth snapshot

### Acceptance Tests
- End-to-end workflow test (deal creation → E-Tran package)
- Conflict resolution edge cases
- Bank overlay validation tests
- Borrower readiness score accuracy tests

---

## Architecture Decisions

### Why Deterministic Arbitration?
AI is non-deterministic. For audit/compliance, we need provenance: "Why did we choose this value?" Arbitration rules (R0-R5) are explainable and repeatable.

### Why Separate Claims from Findings?
Agents produce complex outputs (narratives, charts, lists). Claims are atomic facts (field-value pairs). This separation enables conflict detection and resolution.

### Why Bank Overlays as Code?
Hard-coding bank policies creates tech debt. DSL approach allows banks to configure policies without code changes, while validation ensures SBA compliance.

### Why Readiness Score ≠ Approval Likelihood?
Progress proxies are psychologically different from approval predictions. Borrowers understand "You've completed 68% of the application" better than "You have a 68% chance of approval."

---

## Metrics to Track

1. **Arbitration Effectiveness**
   - % of conflicts resolved by rules (vs. human review)
   - Average confidence score of final truth
   - Human override rate

2. **Borrower Engagement**
   - Time to 100% readiness score
   - Drop-off rate by milestone
   - Upload response time after "Next Best Action" prompt

3. **Bank Overlay Usage**
   - # of active overlays per bank
   - % of deals affected by overlays
   - Overlay rule trigger frequency

4. **Agent Performance**
   - Average confidence score by agent
   - % of claims that win arbitration by agent
   - Human review request rate by agent

---

**Phase 2 Status: ✅ COMPLETE**

Total Files Created: 19  
Total Lines of Code: ~2,800  
Database Migrations: 3  
API Routes: 6  
UI Components: 7  
Libraries: 5
