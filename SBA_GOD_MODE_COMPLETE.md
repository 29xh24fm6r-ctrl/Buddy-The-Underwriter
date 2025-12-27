# SBA God-Mode - Complete Implementation

## Overview

**Date**: 2024-12-27  
**Branch**: `feat/post-merge-upgrades`  
**Vision**: Transform Buddy from "AI underwriting assistant" into "world-changing SBA copilot"

This document covers the "God-Mode" architecture that turns SBA policy from text into executable logic, making Buddy understand SBA the way examiners do — and explain it like a friend.

---

## 🎯 Core Vision

Buddy is no longer answering questions. Buddy:

✅ **Explains SBA rules in human language**  
✅ **Anticipates borrower confusion**  
✅ **Pre-emptively fixes eligibility problems**  
✅ **Builds the credit memo as a side-effect of helping**  
✅ **Never asks the borrower to understand SBA**

> **Borrowers never "apply" — they are guided through inevitability.**

---

## 🏗️ Architecture

### The Moat: Machine-Readable SBA Rules

**Anyone can RAG PDFs. Only Buddy can understand SBA the way examiners do.**

Instead of:
```typescript
// ❌ Embeddings-only approach
const chunks = await retrievePolicyChunks("eligibility requirements");
// Hope LLM figures it out...
```

We do:
```typescript
// ✅ God-Mode approach
const rules = await evaluateSBAEligibility({ dealId, dealData });
// Deterministic pass/fail + suggested fixes
```

---

## 📊 Database Schema

### 1. `sba_policy_rules` - Canonical SBA Knowledge

Machine-readable SBA rules with JSON Logic conditions:

```sql
CREATE TABLE public.sba_policy_rules (
  id UUID PRIMARY KEY,
  program TEXT CHECK (program IN ('7A', '504', 'BOTH')),
  rule_key TEXT NOT NULL, -- ELIGIBILITY.BUSINESS_AGE
  category TEXT NOT NULL, -- ELIGIBILITY, FINANCIAL, COLLATERAL, etc.
  
  -- Evaluable condition
  condition_json JSONB NOT NULL,
  
  -- Human explanations
  title TEXT NOT NULL,
  explanation TEXT NOT NULL,
  borrower_friendly_explanation TEXT,
  
  -- Fix suggestions
  fix_suggestions JSONB, -- [{ issue, fix, example }]
  
  -- SBA references
  sop_reference TEXT NOT NULL,
  severity TEXT CHECK (severity IN ('HARD_STOP', 'REQUIRES_MITIGATION', 'ADVISORY'))
);
```

**Example Rule**:
```json
{
  "rule_key": "ELIGIBILITY.BUSINESS_AGE",
  "condition_json": {
    "field": "business_age_years",
    "gte": 2
  },
  "title": "Minimum 2 Years in Business",
  "fix_suggestions": [
    {
      "issue": "Business less than 2 years old",
      "fix": "Wait until business reaches 2 years OR apply for SBA Express",
      "example": "Founded in Jan 2023 → eligible in Jan 2025"
    }
  ],
  "severity": "REQUIRES_MITIGATION"
}
```

### 2. `deal_sba_rule_evaluations` - Audit Trail

Stores every rule evaluation result per deal:

```sql
CREATE TABLE public.deal_sba_rule_evaluations (
  id UUID PRIMARY KEY,
  deal_id UUID REFERENCES deals(deal_id),
  rule_id UUID REFERENCES sba_policy_rules(id),
  
  passes BOOLEAN NOT NULL,
  field_values JSONB, -- Actual values used
  failure_reason TEXT,
  suggested_fixes JSONB,
  
  evaluated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3. `committee_personas` - Multi-Angle Evaluation

4 hard-coded personas with different risk tolerances:

```sql
CREATE TABLE public.committee_personas (
  persona_key TEXT UNIQUE, -- credit, sba_compliance, risk, relationship_manager
  display_name TEXT NOT NULL,
  focus_areas TEXT[], -- ["cash_flow", "collateral", ...]
  risk_tolerance TEXT, -- CONSERVATIVE, MODERATE, AGGRESSIVE
  system_prompt TEXT NOT NULL,
  evaluation_template TEXT NOT NULL
);
```

**Pre-seeded personas:**
- **Credit Officer** - Focus: DSCR, cash flow, financial trends (MODERATE)
- **SBA Compliance Officer** - Focus: Eligibility, SOP adherence (CONSERVATIVE)
- **Risk Officer** - Focus: Collateral, guarantees, downside protection (CONSERVATIVE)
- **Relationship Manager** - Focus: Customer value, cross-sell opportunities (AGGRESSIVE)

### 4. `deal_sba_difficulty_scores` - Gamified Progress

The "holy sh*t" moment:

```sql
CREATE TABLE public.deal_sba_difficulty_scores (
  deal_id UUID REFERENCES deals(deal_id),
  
  difficulty_score NUMERIC(5,2), -- 0-100 (internal score)
  readiness_percentage INT, -- User-facing % (nonlinear scaling)
  
  -- Component scores
  eligibility_score NUMERIC,
  financial_score NUMERIC,
  collateral_score NUMERIC,
  documentation_score NUMERIC,
  
  -- Blockers
  hard_stops INT,
  mitigable_issues INT,
  advisory_items INT,
  
  -- Actionable guidance
  top_fixes JSONB, -- [{ priority, fix, impact: "+15% readiness" }]
  estimated_time_to_ready TEXT -- "2 days", "1 week", etc.
);
```

---

## 🔍 Unified Retrieval Architecture

All AI features use **one retrieval interface**:

```typescript
const context = await retrieveContext({
  dealId,
  bankId,
  query: "Is this deal SBA eligible?",
  sources: ["DEAL_DOC", "BANK_POLICY", "SBA_POLICY"],
  topK: 20
});
```

**Returns blended results:**
```typescript
{
  content: string,
  source_type: "DEAL_DOC" | "BANK_POLICY" | "SBA_POLICY",
  citation: {
    chunk_id, source_id, doc_name, page_num, rule_key
  },
  similarity: number
}
```

**Parallel retrieval** from all sources:
1. **Deal docs** (50% of k) - Uploaded files
2. **Bank policies** (25% of k) - Internal guidelines
3. **SBA policies** (25% of k) - Structured rules

---

## 🎭 Committee Simulation Engine

### How It Works

```typescript
const result = await runCommittee({
  dealId,
  question: "Is this deal approvable?",
  personas: ["credit", "sba_compliance", "risk", "relationship_manager"]
});
```

**Each persona:**
1. Gets same retrieved context
2. Evaluates with different rubric
3. Returns structured output:

```typescript
{
  persona: "sba_compliance",
  display_name: "SBA Compliance Officer",
  stance: "APPROVE_WITH_CONDITIONS",
  concerns: [
    "DSCR of 1.12 is below 1.15 minimum",
    "Business only 18 months old (requires 2 years)"
  ],
  required_fixes: [
    "Demonstrate improving DSCR trend",
    "Obtain waiver for business age OR wait 6 months"
  ],
  citations: [
    { i: 3, reason: "2023 financial statements" },
    { i: 7, reason: "SBA SOP Section 2.3.1 - Business Age" }
  ]
}
```

**Consensus calculation:**
- **Most conservative wins** (1 DECLINE → overall DECLINE)
- **Critical fixes** = mentioned by 2+ personas
- **Total concerns** = aggregated across all personas

**Traceability:**
- Stored in `ai_run_events` (kind: `COMMITTEE`)
- Citations stored in `ai_run_citations`
- Full audit trail for compliance

---

## ⚖️ SBA Eligibility Engine

### JSON Logic Evaluation

Machine-evaluable conditions:

```typescript
{
  "all": [
    { "field": "business_age_years", "gte": 2 },
    { "field": "dscr", "gte": 1.15 }
  ]
}
```

Supports:
- **Logical operators**: `all`, `any`
- **Comparisons**: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`
- **Arrays**: `in`, `not_in`
- **Nested conditions**: Recursive evaluation

### Evaluation Flow

```typescript
const report = await evaluateSBAEligibility({
  dealId,
  program: "7A",
  dealData: {
    business_age_years: 1.5,
    dscr: 1.28,
    use_of_proceeds_category: "working_capital",
    owner_equity_percentage: 12
  }
});
```

**Returns:**
```typescript
{
  overall_eligible: false,
  hard_stops: [
    {
      rule: { title: "Minimum 2 Years in Business", ... },
      passes: false,
      field_values: { business_age_years: 1.5 },
      failure_reason: "business age years is 1.5, must be >= 2",
      suggested_fixes: [
        {
          issue: "Business less than 2 years old",
          fix: "Wait until business reaches 2 years OR apply for SBA Express",
          example: "Founded in Jan 2023 → eligible in Jan 2025"
        }
      ]
    }
  ],
  mitigations_required: [],
  advisories: [],
  passed_rules: [...]
}
```

---

## 🎮 SBA Difficulty Index (Gamification)

### The Magic Formula

```typescript
difficulty_score = 
  eligibility_score * 0.4 +
  financial_score * 0.3 +
  collateral_score * 0.2 +
  documentation_score * 0.1
```

**Nonlinear readiness scaling** (UX psychology):
- 80+ difficulty → 100% readiness ("You're ready!")
- 60-79 → 70-99% ("Almost there!")
- 40-59 → 40-69% ("Needs work")
- <40 → <40% ("Major issues")

### User Experience

**Instead of:**
> "Your deal fails 3 SBA rules and needs more collateral"

**Buddy says:**
> "You're 87% SBA-ready. Two small fixes unlock approval:
> 1. Improve DSCR from 1.12 to 1.15 (+15% readiness)
> 2. Add equipment as collateral (+8% readiness)
> 
> Estimated time: 1 week"

---

## 🚀 API Endpoints

### 1. Committee Evaluation

**`POST /api/deals/:dealId/committee/evaluate`**

```json
{
  "question": "Is this deal approvable?",
  "bankId": "uuid",
  "personas": ["credit", "sba_compliance", "risk", "relationship_manager"]
}
```

**Response:**
```json
{
  "ok": true,
  "run_id": "uuid",
  "evaluations": [
    {
      "persona": "credit",
      "stance": "APPROVE_WITH_CONDITIONS",
      "concerns": [...],
      "required_fixes": [...]
    }
  ],
  "consensus": {
    "overall_stance": "APPROVE_WITH_CONDITIONS",
    "total_concerns": 7,
    "critical_fixes": ["Improve DSCR to 1.15", "Add collateral"]
  }
}
```

### 2. SBA Eligibility Check

**`POST /api/deals/:dealId/sba/eligibility`**

```json
{
  "program": "7A",
  "dealData": {
    "business_age_years": 3,
    "dscr": 1.28,
    "use_of_proceeds_category": "equipment"
  }
}
```

**Response:**
```json
{
  "ok": true,
  "overall_eligible": true,
  "hard_stops": 0,
  "mitigations_required": 1,
  "advisories": 2,
  "passed_rules": 7,
  "report": "✅ ELIGIBLE - No hard stops detected\n\n⚠️ Mitigations Required:...",
  "details": { ... }
}
```

### 3. SBA Difficulty Score

**`POST /api/deals/:dealId/sba/difficulty`**

```json
{
  "program": "7A",
  "dealData": { ... }
}
```

**Response:**
```json
{
  "ok": true,
  "readiness_percentage": 87,
  "difficulty_score": 78,
  "hard_stops": 0,
  "estimated_time": "1 week",
  "top_fixes": [
    {
      "priority": 2,
      "fix": "Improve DSCR from 1.12 to 1.15",
      "impact": "+15% readiness"
    }
  ]
}
```

---

## 📚 Seeded SBA Rules (10 Core Rules)

### 7(a) Program Rules

1. **Business Age** - Minimum 2 years in business (REQUIRES_MITIGATION)
2. **Prohibited Uses** - No gambling, lending, speculation (HARD_STOP)
3. **DSCR Minimum** - 1.15x debt service coverage (REQUIRES_MITIGATION)
4. **Size Standards** - Max 500 employees (HARD_STOP)
5. **Equity Injection** - Minimum 10% owner cash (REQUIRES_MITIGATION)
6. **Personal Guarantee** - Required for 20%+ owners (HARD_STOP)
7. **Credit Elsewhere** - Cannot obtain conventional credit (ADVISORY)
8. **Collateral** - Secure to extent available (ADVISORY)

### 504 Program Rules

9. **Job Creation** - Create/retain jobs OR meet public policy goal (REQUIRES_MITIGATION)
10. **Owner Occupancy** - Minimum 51% owner-occupied (HARD_STOP)

Each rule includes:
- ✅ Machine-evaluable condition
- ✅ Human explanation
- ✅ Borrower-friendly language
- ✅ 2-3 fix suggestions with examples
- ✅ SOP reference

---

## 🔧 Technical Implementation

### Files Created

**Database:**
- `supabase/migrations/20251227_sba_god_mode_foundation.sql` - Schema (6 tables)
- `supabase/migrations/20251227_seed_sba_rules.sql` - 10 core SBA rules

**Retrieval:**
- `src/lib/retrieval/unified.ts` - Single retrieval interface

**SBA Logic:**
- `src/lib/sba/committee.ts` - Multi-persona evaluation engine
- `src/lib/sba/eligibility.ts` - Rule evaluation engine (JSON Logic)
- `src/lib/sba/difficulty.ts` - Gamified scoring system

**API Routes:**
- `src/app/api/deals/[dealId]/committee/evaluate/route.ts`
- `src/app/api/deals/[dealId]/sba/eligibility/route.ts`
- `src/app/api/deals/[dealId]/sba/difficulty/route.ts`

**Documentation:**
- `SBA_GOD_MODE_COMPLETE.md` - This file

---

## 🎨 UX Patterns

### 1. Invisible Fix Engine

**Instead of:**
> "❌ Error: Business age requirement not met"

**Buddy says:**
> "This is very common — here are 2 ways lenders usually fix this:
> 
> 1. **Wait 6 months** - You'll hit 2 years in June 2025
> 2. **Show industry experience** - You managed a similar company for 8 years
> 
> Which makes more sense for you?"

### 2. Progressive Disclosure

**Level 1 (Borrower):**
> "You're 87% ready. Fix DSCR → instant approval"

**Level 2 (Banker):**
> "DSCR: 1.12 (need 1.15). Options: extend term, pay down debt, or demonstrate trend"

**Level 3 (Auditor):**
> "Rule FINANCIAL.DSCR_MINIMUM failed. Field values: {dscr: 1.12}. SOP 50 10 7(K) Section 4.2.2"

### 3. Counterfactual Explanations

> "Your DSCR is 1.12. If you:
> - Extended loan term from 10 to 15 years → DSCR would be 1.22 ✅
> - Paid off $50K equipment loan → DSCR would be 1.18 ✅
> - Increased revenue 10% → DSCR would be 1.23 ✅"

---

## 🧠 Why This is the Moat

### What Everyone Else Does
```typescript
// RAG approach (every AI tool)
const chunks = await vectorSearch("SBA eligibility requirements");
const answer = await llm.complete(`Based on: ${chunks}\n\nQuestion: ${q}`);
// 🚨 Hallucinations possible
// 🚨 No structured fixes
// 🚨 Not auditable
```

### What Buddy Does
```typescript
// Rules-first approach (only Buddy)
const rules = await evaluateSBAEligibility({ dealId, dealData });
// ✅ Deterministic pass/fail
// ✅ Structured fix suggestions
// ✅ Full audit trail
// ✅ Then use LLM to explain in human language
const explanation = await llm.complete(`Explain rule failure in borrower-friendly terms`);
```

**The difference:**
- **AI explains, rules decide** = Trust + Magic
- **Machine-readable SBA** = Competitive moat
- **Borrower psychology** = World-changing UX

---

## 📈 Next Steps

### Immediate (Production-Ready)
- [ ] Run migrations on staging database
- [ ] Test all 3 API endpoints with real deal data
- [ ] Add 20 more SBA rules (cover 80% of common issues)
- [ ] Build UI components (Difficulty Score widget, Eligibility Panel)

### Phase 2 (Borrower Experience)
- [ ] Conversational flow API ("life questions" instead of doc uploads)
- [ ] Invisible fix suggestions in upload flow
- [ ] Real-time eligibility checker ("You just hit 87%!")
- [ ] Onboarding wizard with progress bar

### Phase 3 (Advanced)
- [ ] SBA policy RAG (embed SOP PDFs for LLM context)
- [ ] What-if scenario modeling ("If I wait 6 months...")
- [ ] Historical approval rate predictor
- [ ] Bank-specific overlays (stricter than SBA minimums)

---

## 🎯 Success Metrics

**For Borrowers:**
- Time to understand eligibility: 60s (vs 2 hours reading SOPs)
- Fixes implemented per suggestion: 75%+
- "This feels achievable": 90%+ sentiment

**For Bankers:**
- Time to pre-screen deal: 2 min (vs 30 min manual)
- False positives (ineligible deals approved): <5%
- Compliance audit pass rate: 100%

**For Buddy:**
- Moat = Machine-readable SBA knowledge
- Virality = "87% ready" becomes shareable metric
- Revenue = Subscription tiers based on rule library depth

---

## 🚀 The Vision

**Borrowers never "apply" for SBA loans.**

They have a **conversation** with Buddy:
1. "What are you trying to accomplish?"
2. "You're 23% ready — here's your roadmap"
3. *2 weeks of guided fixes*
4. "You're 94% ready — let's submit"

**Banks never "underwrite" deals.**

They **review** Buddy's committee simulation:
- Credit Officer: Approve with conditions
- SBA Compliance: Approved
- Risk: Approve with additional collateral
- RM: Strong advocate

**SBA never "examines" files.**

They **audit** Buddy's traceability:
- Every decision has rule citation
- Every fix has SOP reference
- Every approval defensible

---

**This is the future of commercial lending.**

**Ship it. 🚀**
