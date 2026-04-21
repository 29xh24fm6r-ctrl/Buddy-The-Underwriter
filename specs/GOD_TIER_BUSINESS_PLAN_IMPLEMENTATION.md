# GOD TIER BUSINESS PLAN — Implementation Instructions for Claude Code

**Read `specs/GOD_TIER_BUSINESS_PLAN_SYSTEM.md` FIRST. That document defines WHAT we're building and WHY. This document tells you HOW.**

---

## CONTEXT REMINDERS

- Repo: `29xh24fm6r-ctrl/Buddy-The-Underwriter`, branch `main`
- MODEL_SBA_NARRATIVE = GEMINI_PRO = `"gemini-3.1-pro-preview"` — use `callGeminiJSON` from `sbaPackageNarrative.ts` (already exported)
- `isGemini3Model()` — gemini-3.x models MUST NOT have temperature set; `thinkingBudget: 1024` for JSON calls
- `sbaResearchExtractor.ts` returns `ExtractedResearch` with 9 sections — this is the research intelligence
- `sbaAssumptionDrafter.ts` already loads ALL deal context (facts, ownership, research, benchmarks, proceeds) — reuse its patterns
- `sbaActionableRoadmap.ts` already exists — a Gemini call that produces plain-English roadmap from projection data
- `sbaBorrowerPDFRenderer.ts` already exists — a 6-page borrower-friendly PDF. This is the BORROWER's PDF. `sbaPackageRenderer.ts` is the BANKER's PDF.
- Financial facts: column is `fact_value_num`, keys may have `_IS` suffix, use fallback chains
- `ownership_entities` uses `display_name` not `name`
- All existing orchestrator gates are NON-NEGOTIABLE
- `buddy_research_narratives` joins through `buddy_research_missions` (NOT by deal_id directly)

---

## IMPLEMENTATION ORDER — 8 STEPS

### STEP 1: Database — Create `buddy_borrower_stories` table

Apply a migration that creates the borrower story table. This stores the discovery conversation output — the borrower's voice, vision, and personal narrative that informs the business plan.

```sql
CREATE TABLE IF NOT EXISTS buddy_borrower_stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  
  -- The six discovery answers
  origin_story TEXT,            -- "Why did you decide to start this business?"
  competitive_insight TEXT,     -- "What do you know about this industry that most people don't?"
  ideal_customer TEXT,          -- "Who is your ideal customer and why do they choose you?"
  growth_strategy TEXT,         -- "How specifically will you grow this business?"
  biggest_risk TEXT,            -- "What's the biggest risk you see?"
  personal_vision TEXT,         -- "What does success look like for you in 3 years?"
  
  -- Voice characteristics extracted from how they communicate
  voice_formality TEXT CHECK (voice_formality IN ('casual', 'professional', 'technical')),
  voice_metaphors JSONB DEFAULT '[]'::jsonb,    -- phrases they use naturally
  voice_values JSONB DEFAULT '[]'::jsonb,       -- what they emphasize repeatedly
  
  -- Metadata
  captured_via TEXT CHECK (captured_via IN ('voice', 'chat', 'form')) DEFAULT 'chat',
  captured_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(deal_id)  -- one story per deal, upserted on update
);

ALTER TABLE buddy_borrower_stories ENABLE ROW LEVEL SECURITY;

-- Add borrower_story columns to buddy_sba_packages for the new narrative sections
ALTER TABLE buddy_sba_packages
  ADD COLUMN IF NOT EXISTS plan_thesis TEXT,
  ADD COLUMN IF NOT EXISTS milestone_timeline JSONB,
  ADD COLUMN IF NOT EXISTS kpi_dashboard JSONB,
  ADD COLUMN IF NOT EXISTS risk_contingency_matrix JSONB;
```

Commit: "feat(sba): add buddy_borrower_stories table and plan enhancement columns"

---

### STEP 2: Create `src/lib/sba/sbaBorrowerStory.ts` — Story loader

A server-side module that loads the borrower's story for a deal. Simple CRUD.

```typescript
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface BorrowerStory {
  dealId: string;
  originStory: string | null;
  competitiveInsight: string | null;
  idealCustomer: string | null;
  growthStrategy: string | null;
  biggestRisk: string | null;
  personalVision: string | null;
  voiceFormality: 'casual' | 'professional' | 'technical' | null;
  voiceMetaphors: string[];
  voiceValues: string[];
  capturedVia: 'voice' | 'chat' | 'form';
  capturedAt: string;
}

export async function loadBorrowerStory(dealId: string): Promise<BorrowerStory | null> {
  // Load from buddy_borrower_stories, return null if no story captured yet
}

export async function saveBorrowerStory(dealId: string, story: Partial<BorrowerStory>): Promise<void> {
  // Upsert into buddy_borrower_stories
}

export function hasCompleteBorrowerStory(story: BorrowerStory | null): boolean {
  // Returns true if at least origin_story + competitive_insight + growth_strategy are non-empty
  // These three are the minimum needed for a god-tier narrative
}
```

Commit: "feat(sba): add borrower story loader and saver"

---

### STEP 3: Create API routes for borrower story

**`src/app/api/deals/[dealId]/sba/borrower-story/route.ts`**

- GET: loads the borrower's story for this deal. Returns `{ ok: true, story: BorrowerStory | null }`
- PUT: saves/updates the borrower's story. Body is `Partial<BorrowerStory>`. Upserts.

Use `ensureDealBankAccess()` for auth. Set `runtime = "nodejs"`.

Commit: "feat(sba): add borrower-story API route"

---

### STEP 4: Create the Discovery Interview UI

**`src/components/sba/SBADiscoveryInterview.tsx`**

This is the MOST IMPORTANT new component. It captures the borrower's voice and story BEFORE any financial assumptions are collected.

The design: a focused, one-question-at-a-time conversational interface. NOT a form with 6 text boxes. Each question appears on its own screen with a text area, a "why we're asking" explanation, and a "Next" button.

**The six screens:**

1. **"Tell us your story"**
   - Question: "What led you to this business? What moment, experience, or insight made you decide this was the path for you?"
   - Helper text: "There's no wrong answer. Whether it was a lifelong dream, an opportunity you spotted, or a skill you've perfected — your story is the foundation of your business plan."
   - Maps to: `originStory`

2. **"What's your edge?"**
   - Question: "What do you know about this industry or market that most people don't? What insight or advantage do you bring that your competitors are missing?"
   - Helper text: "Think about what you've seen from the inside. Maybe it's a relationship, a process, a geographic advantage, or an underserved customer group."
   - Maps to: `competitiveInsight`

3. **"Who is your customer?"**
   - Question: "Describe your ideal customer. Not demographics — the actual person. Who are they, what's their problem, and why do they choose you?"
   - Helper text: "The more specific you are, the sharper your marketing plan will be. 'Office managers who are tired of unreliable vendors' is better than 'businesses.'"
   - Maps to: `idealCustomer`

4. **"How will you grow?"**
   - Question: "What specific actions will you take to grow this business over the next 1-3 years? Think about new customers, new services, new locations, partnerships, or marketing channels."
   - Helper text: "Your financial projections will be built from these specific actions. '8% growth' doesn't help you — 'add 2 new clients per quarter through broker referrals' does."
   - Maps to: `growthStrategy`

5. **"What keeps you up at night?"**
   - Question: "What's the biggest risk to this business? What could go wrong, and what would you do about it?"
   - Helper text: "Every business has risks. The best business plans don't hide them — they confront them with specific contingency plans. This honesty builds trust."
   - Maps to: `biggestRisk`

6. **"What does success look like?"**
   - Question: "Imagine it's 3 years from now and everything went right. What does your business look like? What does your life look like?"
   - Helper text: "This isn't just for the plan — this is your north star. Financial independence? Building something to pass to your children? This is what you're working toward."
   - Maps to: `personalVision`

**UI implementation notes:**

- Full-width, centered layout. One question at a time with smooth transitions.
- Large text area (6-8 rows, auto-expanding) with character count (suggest 100-500 characters but don't enforce).
- Progress indicator showing 1/6, 2/6, etc.
- "Skip for now" option on each screen — the borrower can come back later. But clearly indicate that completing the discovery makes the business plan dramatically better.
- On the final screen, show a summary of all 6 answers with edit buttons, and a "Generate My Business Plan" call-to-action.
- Saves each answer to the API as the borrower progresses (don't wait for the end — save each screen on "Next").
- At the top of each screen, show a Buddy avatar/icon with a speech-bubble-style framing for the question to make it feel conversational.

**Where it lives in the flow:**

The Discovery Interview appears BEFORE the assumption interview in the SBA Package tab. The flow is now:

1. Discovery Interview (capture the story) → saves to `buddy_borrower_stories`
2. AI-Drafted Assumptions (Buddy drafts numbers using story + context) → saves to `buddy_sba_assumptions`  
3. Generation (produces the plan using story + assumptions + research)
4. Review & Refine

If a borrower has already completed the discovery (story exists), show a compact summary card with an "Edit" button instead of the full interview. They can jump straight to assumptions.

Commit: "feat(sba): add discovery interview — captures borrower's voice and story"

---

### STEP 5: Rewrite the narrative prompts — `sbaPackageNarrative.ts`

This is the hardest and most important step. Every narrative generator must be rewritten to:

A) Accept a `BorrowerStory | null` parameter alongside the existing financial data
B) Use the borrower's own words and insights when available
C) Produce prose that reads like a human consultant wrote it, not a compliance template
D) Demand specificity — no generic sentences allowed
E) Cross-reference other sections for coherence

**REWRITE `generateExecutiveSummary()`:**

The prompt must change from "Write in third person, professional, factual" to something like:

```
You are the world's greatest business plan writer. You've just spent hours with {borrowerName}, learning their story and vision. Now write an executive summary that makes a reader — whether it's a bank officer, a spouse, or the borrower themselves — immediately understand and care about this business.

THE BORROWER'S STORY (in their own words):
Why they started this business: {originStory}
Their competitive edge: {competitiveInsight}
Their ideal customer: {idealCustomer}
Their growth plan: {growthStrategy}

CRITICAL RULES FOR THE EXECUTIVE SUMMARY:
1. The FIRST SENTENCE must be a hook — something that makes the reader want to continue. NOT "Company X operates in the Y sector." Instead, lead with the borrower's specific competitive insight, their specific opportunity, or a surprising fact about their market.
2. The borrower's name, city/state, loan amount, and DSCR must appear in the first paragraph.
3. Every growth projection must be tied to a specific action from the borrower's growth strategy.
4. Every dollar of loan proceeds must be tied to a specific business outcome.
5. The reader should be able to tell within 3 sentences that this plan was NOT generated from a template.
6. Write in third person but with warmth — like a consultant who genuinely believes in this business.
7. Maximum 500 words.
```

If BorrowerStory is null, fall back to the existing prompt style but add a note: "The borrower has not yet completed their discovery interview. Write a professional but generic executive summary using only the available financial and research data."

**REWRITE `generateBusinessOverviewNarrative()`:**

Add the borrower's origin story as the opening of the company description. The borrower's competitive insight should anchor the market opportunity section. The borrower's ideal customer description should inform the products & services framing.

**REWRITE `generateMarketingAndOperations()`:**

The growth strategy from BorrowerStory should be the backbone of the marketing section. If the borrower said "we'll grow through referral partnerships with commercial real estate brokers," the marketing section should detail that specific channel — not generic marketing tactics.

**REWRITE `generateSWOTAnalysis()`:**

The borrower's biggest risk should appear in the Threats section. Their competitive insight should anchor Strengths. Their growth strategy should inform Opportunities.

**REWRITE `generateSensitivityNarrative()`:**

The risk contingency actions should reference the borrower's own stated risk and their planned response.

**ADD a new function `generatePlanThesis()`:**

Before generating individual sections, generate a single "plan thesis" — a 2-3 sentence statement that captures the core argument of the entire plan. Every section should support this thesis.

```typescript
export async function generatePlanThesis(params: {
  dealName: string;
  story: BorrowerStory | null;
  loanAmount: number;
  dscrYear1: number;
  projectedRevenueYear1: number;
  industryDescription: string;
}): Promise<string> {
  // Returns something like:
  // "Samaritus Management is positioned to grow from $1.36M to $1.72M in revenue 
  //  over three years by adding 2-3 management contracts annually through broker 
  //  referral partnerships. The $500K loan eliminates the company's largest cost 
  //  vulnerability — maintenance equipment — while Test Borrower's 15 years of 
  //  operational expertise provide the management depth to execute."
}
```

This thesis gets stored in `buddy_sba_packages.plan_thesis` and is passed to ALL subsequent narrative generators as context, ensuring cross-section coherence.

Commit: "feat(sba): rewrite all narrative prompts with borrower story integration and plan thesis"

---

### STEP 6: Create new narrative generators for the roadmap sections

**`src/lib/sba/sbaBusinessPlanRoadmap.ts`**

Three new generators that produce the "roadmap" sections — the pieces that transform the plan from "a document you submit" to "a document you USE."

```typescript
// 1. Milestone Timeline
export interface Milestone {
  month: number;          // 1-12 for Year 1, 13-24 for Year 2, etc.
  title: string;          // "Equipment installed and operational"
  description: string;    // "Complete installation of new equipment per vendor quote. Expected to reduce maintenance response time from 48h to 12h."
  category: 'funding' | 'operations' | 'hiring' | 'revenue' | 'growth';
  successMetric: string;  // "Equipment fully operational, first job completed using new tools"
  tiedToProceeds: boolean; // true if this milestone is funded by loan proceeds
}

export async function generateMilestoneTimeline(params: {
  dealName: string;
  story: BorrowerStory | null;
  useOfProceeds: Array<{ category: string; description: string; amount: number }>;
  plannedHires: Array<{ role: string; startMonth: number; annualSalary: number }>;
  growthStrategy: string | null;  // from BorrowerStory
  projectedRevenueYear1: number;
  projectedRevenueYear2: number;
  loanAmount: number;
}): Promise<Milestone[]>
```

The Gemini prompt should:
- Produce 8-12 milestones across months 1-24
- Tie every use-of-proceeds item to a specific milestone with a month
- Tie every planned hire to a milestone
- Use the borrower's growth strategy to create revenue/growth milestones
- Include success metrics that the borrower can actually measure
- Return structured JSON, not prose

```typescript
// 2. KPI Dashboard
export interface KPITarget {
  name: string;           // "Revenue per Property"
  description: string;    // "Average monthly management fee revenue per property under management"
  frequency: 'weekly' | 'monthly' | 'quarterly';
  targetValue: string;    // "$4,500/month"
  warningThreshold: string; // "Below $3,800/month"
  relevance: string;      // "This is your primary revenue driver. Falling below target means contracts are underpriced or properties are underperforming."
}

export async function generateKPIDashboard(params: {
  dealName: string;
  industryDescription: string;
  naicsCode: string | null;
  story: BorrowerStory | null;
  revenueStreams: Array<{ name: string; baseAnnualRevenue: number }>;
  cogsPercent: number;
  dscrYear1: number;
  monthlyDebtService: number;
  breakEvenRevenue: number;
}): Promise<KPITarget[]>
```

The Gemini prompt should:
- Select 5-7 KPIs that are SPECIFIC to this industry and business model
- Derive target values from the financial model (not generic benchmarks)
- Include plain-English descriptions of why each KPI matters
- Include warning thresholds that trigger the risk contingency matrix
- NOT include banking jargon (no "DSCR" — say "loan payment coverage" or similar)

```typescript
// 3. Risk Contingency Matrix
export interface RiskContingency {
  risk: string;           // "Revenue drops 15% from plan"
  trigger: string;        // "Monthly revenue below $95,000 for two consecutive months"
  impact: string;         // "Annual cash shortfall of approximately $180,000. DSCR drops from 1.87x to 1.15x."
  actions: string[];      // ["Defer assistant manager hire by 90 days (saves $13,000)", "Reduce discretionary maintenance to critical-only (saves $8,000/month)", ...]
  severity: 'low' | 'medium' | 'high';
}

export async function generateRiskContingencyMatrix(params: {
  dealName: string;
  story: BorrowerStory | null;
  biggestRisk: string | null;  // from BorrowerStory
  dscrYear1: number;
  dscrDownside: number;
  breakEvenRevenue: number;
  projectedRevenueYear1: number;
  monthlyDebtService: number;
  fixedCosts: Array<{ name: string; annualAmount: number }>;
  plannedHires: Array<{ role: string; annualSalary: number }>;
  sensitivityScenarios: Array<{ name: string; dscrYear1: number; revenueYear1: number }>;
}): Promise<RiskContingency[]>
```

The Gemini prompt should:
- Include the borrower's own stated biggest risk as the first item
- Derive 2-4 additional risks from the sensitivity analysis
- Use SPECIFIC dollar amounts for triggers and impact (not percentages)
- Provide SPECIFIC, ACTIONABLE contingency actions with dollar savings
- Reference actual cost line items and planned hires that can be deferred/cut

Commit: "feat(sba): add milestone timeline, KPI dashboard, and risk contingency generators"

---

### STEP 7: Wire into the orchestrator

**`src/lib/sba/sbaPackageOrchestrator.ts`** — MODIFY

The orchestration pipeline must now:

1. Load `BorrowerStory` alongside assumptions (add to the parallel-load block)
2. Generate `planThesis` FIRST, before any narrative sections
3. Pass `story` and `planThesis` to ALL narrative generators
4. Generate the 3 new roadmap sections (milestone timeline, KPI dashboard, risk contingency matrix)
5. Store the new fields in `buddy_sba_packages` (plan_thesis, milestone_timeline, kpi_dashboard, risk_contingency_matrix)

The generation order should be:

```
1. Load all data (existing) + load BorrowerStory (new)
2. Run financial model (existing — untouched)
3. Generate plan thesis (NEW — depends on story + financials)
4. Generate all narratives in parallel (existing but REWRITTEN — now receive story + thesis)
5. Generate roadmap sections in parallel (NEW — milestone, KPI, risk matrix)
6. Store everything (existing + new columns)
7. Render PDF (existing + new sections)
```

DO NOT change the existing gate logic (validation pass, assumption confirmation, completeness). Those are non-negotiable.

The BorrowerStory is OPTIONAL — if no story has been captured, all narrative generators use their fallback prompts (which should still produce decent output, just not god-tier). The system degrades gracefully.

Commit: "feat(sba): wire borrower story and roadmap sections into orchestrator"

---

### STEP 8: Update the borrower PDF — `sbaBorrowerPDFRenderer.ts`

The existing borrower PDF already has a good structure (cover, industry overview, projections, monthly cash flow, break-even, risk scenarios, roadmap narrative). Extend it with the new sections:

**Add to `BorrowerPDFInput`:**
```typescript
planThesis?: string;
milestoneTimeline?: Milestone[];
kpiDashboard?: KPITarget[];
riskContingencyMatrix?: RiskContingency[];
borrowerStory?: BorrowerStory | null;
```

**New pages/sections to add:**

A) **After the cover page, before industry overview:** If BorrowerStory exists, add a "Your Vision" page that renders the borrower's origin story and competitive insight in a clean, prominent layout. This is the borrower reading THEIR OWN WORDS back in a professionally formatted document. It should feel like a personal letter at the front of the plan.

B) **After the roadmap narrative:** Add a "Your First-Year Milestones" section. Render the milestone timeline as a visual timeline — a vertical sequence of milestone cards showing Month, Title, Description, and Success Metric. Use category-based color coding (blue for operations, green for revenue, amber for hiring, etc.).

C) **After milestones:** Add a "Numbers to Watch" section. Render the KPI dashboard as 5-7 metric cards in a 2-column layout, each showing the KPI name, target value, measurement frequency, and a one-sentence explanation of why it matters.

D) **After KPIs:** Add a "Your Safety Net" section. Render the risk contingency matrix as a clean table with color-coded severity. Each risk shows the trigger, impact, and numbered action items.

Commit: "feat(sba): extend borrower PDF with vision, milestones, KPIs, and contingency matrix"

---

## AFTER ALL STEPS

1. Verify `buddy_borrower_stories` table exists with all columns
2. Verify `buddy_sba_packages` has `plan_thesis`, `milestone_timeline`, `kpi_dashboard`, `risk_contingency_matrix` columns
3. Verify `sbaBorrowerStory.ts` exports `loadBorrowerStory`, `saveBorrowerStory`, `hasCompleteBorrowerStory`
4. Verify borrower-story API route exists at `src/app/api/deals/[dealId]/sba/borrower-story/route.ts`
5. Verify `SBADiscoveryInterview.tsx` exists with 6 screens
6. Verify `sbaPackageNarrative.ts` — ALL generators now accept `story: BorrowerStory | null` parameter
7. Verify `generatePlanThesis` function exists and is called by the orchestrator before other narratives
8. Verify `sbaBusinessPlanRoadmap.ts` exports `generateMilestoneTimeline`, `generateKPIDashboard`, `generateRiskContingencyMatrix`
9. Verify orchestrator loads BorrowerStory and passes it through the pipeline
10. Verify `sbaBorrowerPDFRenderer.ts` renders milestone timeline, KPI dashboard, and risk contingency sections
11. Run `tsc --noEmit` — must be clean
12. Push all commits to `origin/main`

Report back with: file list, commit SHAs, verification results, any issues encountered.

DO NOT skip verification. DO NOT report completion without pushing to `origin/main`.
