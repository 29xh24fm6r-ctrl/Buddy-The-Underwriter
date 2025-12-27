# 🎯 SBA God Mode - Quick Reference

**Jump to:** [Phase 1](#phase-1) | [Phase 2](#phase-2) | [Phase 3](#phase-3) | [API Routes](#api-routes) | [Database](#database) | [Testing](#testing)

---

## Phase 1: Multi-Agent Foundation

**What:** 4 core agents with dependency-aware orchestration  
**Docs:** [`SBA_GOD_MODE_PHASE_1_COMPLETE.md`](./SBA_GOD_MODE_PHASE_1_COMPLETE.md)

**Agents:**
- SBA Policy (compliance checker)
- Eligibility (gatekeeper)
- Cash Flow (DSCR calculator)
- Risk Synthesis (consensus voting)

**Test:** `./scripts/test-phase-1.sh`

---

## Phase 2: Arbitration + Overlays + Delight

**What:** Deterministic conflict resolution + bank policies as code + borrower UX  
**Docs:** [`SBA_GOD_MODE_PHASE_2_COMPLETE.md`](./SBA_GOD_MODE_PHASE_2_COMPLETE.md)

**Key Systems:**
- Agent arbitration (R0-R5 rules)
- Bank overlay DSL (validated policies)
- Readiness score (TurboTax-style progress)
- Borrower delight components

**Test:** `./scripts/verify-phase-2.sh`

---

## Phase 3: E-Tran Ready Autopilot

**What:** One-click pipeline that makes deals submission-ready  
**Docs:** [`ETRAN_READY_AUTOPILOT_COMPLETE.md`](./ETRAN_READY_AUTOPILOT_COMPLETE.md)

**Pipeline Stages:**
1. Intake normalize
2. Run agents
3. Claims ingest
4. Apply overlays
5. Arbitration reconcile
6. Materialize truth
7. Generate conditions
8. Generate narrative
9. Assemble package

**Test:** `./scripts/verify-etran-autopilot.sh`  
**Demo:** `./scripts/demo-etran-autopilot.sh`

---

## API Routes

### Agents (Phase 1)
- `POST /api/deals/{dealId}/agents/execute` - Run agent swarm
- `GET /api/deals/{dealId}/agents/status` - Query execution status
- `GET /api/deals/{dealId}/agents/findings` - Retrieve findings

### Arbitration (Phase 2)
- `POST /api/deals/{dealId}/arbitration/ingest` - Normalize findings → claims
- `POST /api/deals/{dealId}/arbitration/reconcile` - Resolve conflicts
- `POST /api/deals/{dealId}/arbitration/materialize` - Create truth snapshot
- `GET /api/deals/{dealId}/arbitration/status` - Query arbitration state

### Borrower (Phase 2)
- `GET /api/deals/{dealId}/borrower/readiness-score` - Calculate progress
- `GET /api/deals/{dealId}/explain?topic=...` - Plain-English explanations

### Autopilot (Phase 3)
- `POST /api/deals/{dealId}/autopilot/run` - Start E-Tran Ready pipeline
- `GET /api/deals/{dealId}/autopilot/status` - Live pipeline status + punchlist

---

## Database

### Tables (12 total)

**Phase 1:**
- `agent_findings`

**Phase 2:**
- `agent_claims`
- `claim_conflict_sets`
- `arbitration_decisions`
- `deal_truth_snapshots`
- `bank_overlays`
- `overlay_application_log`
- `overlay_generated_claims`
- `deal_truth_events`

**Phase 3:**
- `deal_pipeline_runs`

**Existing (referenced):**
- `deals`
- `borrower_files`
- `deal_conditions`
- `deal_required_documents`

### Migrations
```bash
supabase/migrations/
├── 20251227000001_create_agent_findings.sql      # Phase 1
├── 20251227000002_agent_arbitration.sql          # Phase 2
├── 20251227000003_bank_overlays.sql              # Phase 2
├── 20251227000004_deal_truth_events.sql          # Phase 2
└── 20251227000005_deal_pipeline_runs.sql         # Phase 3
```

**Apply:**
```bash
psql $DATABASE_URL -f supabase/migrations/*.sql
```

---

## Testing

### Verification Scripts
```bash
# Phase 1 (11 files)
./scripts/verify-phase-1.sh

# Phase 2 (21 files)  
./scripts/verify-phase-2.sh

# Phase 3 (21 files with dependencies)
./scripts/verify-etran-autopilot.sh
```

### Demo Scripts
```bash
# Full autopilot demo
./scripts/demo-etran-autopilot.sh

# Manual stage testing
./test-pricing-memo.sh <dealId>
./test-pdf-generation.sh
./test-upload-intel.sh
```

### Guard Scripts (Pre-commit)
```bash
npm run guard:admin          # Verify admin route protection
npm run guard:canonical      # Check canonical patterns
npm run guard:tenant-rls     # Validate RLS policies
```

---

## UI Components

### Banker Components
- `AgentCockpit.tsx` - Agent status grid (Phase 1)
- `TruthConflictsPanel.tsx` - Arbitration viewer (Phase 2)
- `AutopilotConsole.tsx` - E-Tran Ready button + live console (Phase 3)

### Borrower Components
- `ReadinessScoreCard.tsx` - Progress visualization
- `NextBestActionCard.tsx` - Single clear CTA
- `SmartUploadDropzone.tsx` - Auto-detecting uploader
- `MilestoneToast.tsx` - Celebration toasts
- `ExplainWhyDrawer.tsx` - Plain-English explanations

---

## Core Libraries

### Phase 1
- `src/lib/agents/types.ts` - Type definitions
- `src/lib/agents/base.ts` - Abstract Agent class
- `src/lib/agents/orchestrator.ts` - Dependency graph executor
- `src/lib/agents/sba-policy.ts` - SBA compliance agent
- `src/lib/agents/eligibility.ts` - Gatekeeper agent
- `src/lib/agents/cash-flow.ts` - DSCR calculator
- `src/lib/agents/risk.ts` - Risk synthesis agent

### Phase 2
- `src/lib/agents/claim-normalization.ts` - Agent findings → claims
- `src/lib/agents/arbitration.ts` - R0-R5 reconciliation
- `src/lib/agents/bank-overlay.ts` - DSL evaluator
- `src/lib/borrower/readiness-score.ts` - Progress calculator
- `src/lib/events/deal-truth.ts` - Event emitter

### Phase 3
- `src/lib/autopilot/orchestrator.ts` - 9-stage pipeline
- `src/lib/autopilot/punchlist.ts` - Punchlist generator
- `src/lib/autopilot/package-bundle.ts` - Bundle assembler

---

## Key Concepts

### Agent Arbitration Rules (R0-R5)
- **R0:** SBA hard rules (highest priority)
- **R1:** Evidence completeness
- **R2:** Weighted agent voting
- **R3:** Freshness
- **R4:** Bank overlays
- **R5:** Close-call detection

### Readiness Scoring (E-Tran Ready)
- **Eligibility:** 25%
- **Docs Present:** 20%
- **Docs Verified:** 20%
- **Cash Flow:** 15%
- **Credit:** 10%
- **Evidence:** 10%

### Pipeline Stages (S1-S9)
1. Intake → 2. Agents → 3. Claims → 4. Overlays → 5. Arbitration → 6. Truth → 7. Conditions → 8. Narrative → 9. Package

---

## Development Workflow

### 1. Setup
```bash
npm install
npm run dev
```

### 2. Apply Migrations
```bash
psql $DATABASE_URL -f supabase/migrations/*.sql
```

### 3. Test Implementation
```bash
# Verify all files
./scripts/verify-etran-autopilot.sh

# Run demo
./scripts/demo-etran-autopilot.sh
```

### 4. Build for Production
```bash
npm run build
npm run lint
npm run guard:canonical
```

---

## Troubleshooting

### Common Issues

**1. Pipeline stuck at S2 (Agents)**
- Check agent execution logs: `GET /api/deals/{id}/agents/status`
- Verify agent dependencies resolved correctly

**2. Readiness score capped at 20%**
- Eligibility gate triggered
- Check: `GET /api/deals/{id}/arbitration/status` for eligibility blockers

**3. Open conflicts not resolving**
- R5 close-call detection flagged for human
- Review in TruthConflictsPanel, provide override with rationale

**4. Package bundle failing at S9**
- Check truth snapshot exists: Pipeline run should have `truth_snapshot_id`
- Verify readiness ≥ 100%

---

## Environment Variables

**Required:**
```bash
NEXT_PUBLIC_SUPABASE_URL=https://xyz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
CLERK_SECRET_KEY=sk_...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
OPENAI_API_KEY=sk-...
NEXT_PUBLIC_APP_URL=http://localhost:3000  # For autopilot internal fetch calls
```

**Optional:**
```bash
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://...
AZURE_DOCUMENT_INTELLIGENCE_KEY=...
RESEND_API_KEY=re_...
SBA_LENDER_ID=...
SBA_SERVICE_CENTER=...
```

---

## Next Steps

### Immediate (Phase 4)
Implement remaining 6 agents:
- Credit Agent
- Collateral Agent
- Management Agent
- Narrative Agent
- Evidence Agent
- Banker Copilot Agent

### Short-term (Phase 5)
E-Tran XML generator:
- Map truth snapshot → SBA XML format
- Human approval workflow
- Schema validation

### Medium-term (Phase 6)
Borrower "Connect Accounts":
- Plaid (bank statements)
- QuickBooks (financials)
- Payroll integrations
- IRS transcript pull

---

## Support & Documentation

**Full Documentation:**
- [Complete Architecture Summary](./SBA_GOD_MODE_COMPLETE_SUMMARY.md)
- [Phase 1 Details](./SBA_GOD_MODE_PHASE_1_COMPLETE.md)
- [Phase 2 Details](./SBA_GOD_MODE_PHASE_2_COMPLETE.md)
- [Phase 3 Details](./ETRAN_READY_AUTOPILOT_COMPLETE.md)

**Legacy Docs (Reference):**
- [Tenant System](./TENANT_SYSTEM_COMPLETE.md)
- [Conditions Engine](./CONDITIONS_README.md)
- [Reminder System](./BULLETPROOF_REMINDER_SYSTEM.md)
- [Ownership Tracking](./OWNERSHIP_SYSTEM_COMPLETE.md)

---

**Built with:** Next.js 16 • Supabase • Clerk • OpenAI • TypeScript  
**Status:** Phase 1 ✅ | Phase 2 ✅ | Phase 3 ✅  
**Version:** SBA God Mode v1.0
