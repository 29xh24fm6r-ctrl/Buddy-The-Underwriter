# BUSINESS PLAN GOD TIER — PHASE 3: THE CONSULTANT EXPERIENCE

**Status:** ACTIVE — implementation guide for Claude Code  
**Created:** April 21, 2026  
**Depends on:** Phase 1 (COMPLETE), Phase 2 (COMPLETE)  
**Goal:** Make the borrower feel like they're sitting across the table from the world's #1 business plan writer who already knows everything about their business

---

## Philosophy

Phases 1 and 2 built the engine. Phase 3 builds the experience.

The test for every feature in this phase: **would a borrower tell their spouse, "you won't believe what just happened — this thing wrote my entire business plan and it's better than what my buddy paid $5,000 for"?**

Three principles:
1. **Buddy does the work, the borrower approves the work.** The borrower should never feel like they're filling out a form. They should feel like Buddy is presenting them with a completed draft that they review and tweak.
2. **Every number comes with an explanation.** If the borrower doesn't understand why a number is there, the system has failed.
3. **The output is something the borrower is proud to hand to a bank.** Not just correct — impressive.

---

## Priority 1 — AI-Drafted Assumptions (The Magic Moment)

### The Problem

Even with NAICS prefill, the borrower still faces ~30 form fields they must understand and fill. NAICS benchmarks give generic industry medians. But Buddy already has deal-specific intelligence:

- **Financial facts:** actual revenue, COGS, operating expenses, depreciation, net income, ADS
- **Research mission (82KB):** industry outlook, competitive landscape, management intelligence, 3-5 year outlook, market intelligence with local economic context
- **Ownership entities:** names, titles, ownership percentages
- **Loan intake:** amount, purpose, entity type
- **Borrower application:** NAICS, industry description, business legal name

A $20,000 consultant would synthesize ALL of this into a complete first draft. Buddy should too.

### Solution: Gemini-Powered Assumption Drafting

**New file:** `src/lib/sba/sbaAssumptionDrafter.ts`

One Gemini Pro call that takes all available deal context and generates a COMPLETE `SBAAssumptions` draft — not generic defaults, but intelligent, deal-specific assumptions with reasoning.

```typescript
import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { MODEL_SBA_NARRATIVE, isGemini3Model } from "@/lib/ai/models";
import { extractResearchForBusinessPlan } from "./sbaResearchExtractor";
import { findBenchmarkByNaics } from "./sbaAssumptionBenchmarks";
import type { SBAAssumptions } from "./sbaReadinessTypes";

const GEMINI_MODEL = MODEL_SBA_NARRATIVE; // Pro model for quality

export interface DraftedAssumptions {
  assumptions: SBAAssumptions;
  reasoning: {
    revenueRationale: string;      // "Based on your $1.4M current revenue and industry growth of 4-6%, we project..."
    costRationale: string;         // "Your COGS of 32% is in line with full-service restaurant benchmarks..."
    growthRationale: string;       // "The 3-5 Year Outlook from our research suggests..."
    managementRationale: string;   // "We've pre-filled your team from deal records. Please add experience details."
    workingCapitalRationale: string;
    equityRationale: string;
  };
}

export async function draftAssumptionsFromContext(
  dealId: string,
): Promise<DraftedAssumptions>
```

**What this function does:**

1. Loads ALL available context in parallel:
   - `deal_financial_facts` (all keys, not just revenue/COGS)
   - `borrower_applications` (NAICS, industry, business name)
   - `deals` (loan_amount, deal_type, city, state, name)
   - `deal_ownership_entities` + `deal_ownership_interests` (people + ownership %)
   - `deal_builder_sections` where section_key = 'structure' (term, rate)
   - `deal_proceeds_items` (existing use-of-proceeds entries)
   - `extractResearchForBusinessPlan()` (all 9 research sections)
   - `findBenchmarkByNaics()` (NAICS benchmark data)

2. Constructs a single Gemini Pro prompt with ALL of this context:

```
You are the world's #1 SBA business plan consultant. You have been given comprehensive intelligence about a business seeking an SBA loan. Your task is to draft the complete set of financial assumptions for their 3-year business plan.

You must generate SPECIFIC, DEFENSIBLE assumptions — not generic defaults. Every number you produce should be grounded in the data provided. Where data is insufficient, use the industry benchmark AND explain your reasoning.

=== BUSINESS CONTEXT ===
Business: {dealName}
Legal name: {businessLegalName}
Location: {city}, {state}
Industry: {industryDescription}
NAICS: {naicsCode}
Loan type: {dealType}
Loan amount: ${loanAmount}
Years in business: {yearsInBusiness}

=== CURRENT FINANCIALS (from tax returns/financial statements) ===
Revenue: ${revenue}
COGS: ${cogs} ({cogsPercent}% of revenue)
Operating Expenses: ${opex}
EBITDA: ${ebitda}
Net Income: ${netIncome}
Depreciation: ${depreciation}
Annual Debt Service: ${ads}

=== OWNERSHIP & MANAGEMENT ===
{ownershipEntities with names, types, percentages}

=== LOAN STRUCTURE ===
Requested amount: ${loanAmount}
Proposed term: {termMonths} months
Proposed rate: {interestRate}%
Use of proceeds: {proceedsItems}

=== INDUSTRY BENCHMARKS (NAICS {naicsCode}: {naicsLabel}) ===
Median revenue growth: {benchmarkGrowth}%
Median COGS: {benchmarkCOGS}%
Median DSO: {benchmarkDSO} days
Median DPO: {benchmarkDPO} days

=== RESEARCH INTELLIGENCE ===
Industry Overview: {industryOverview}
Industry Outlook: {industryOutlook}
Competitive Landscape: {competitiveLandscape}
Market Intelligence: {marketIntelligence}
Borrower Profile: {borrowerProfile}
Management Intelligence: {managementIntelligence}
3-5 Year Outlook: {threeToFiveYearOutlook}

=== YOUR TASK ===
Generate a complete SBAAssumptions JSON object with reasoning for each major decision.

For revenue growth: Use the research intelligence outlook to set rates that are SPECIFIC to this business, not generic. If the outlook mentions expansion plans, factor that in. If it mentions market saturation, moderate growth accordingly.

For COGS: Use the actual ratio from financials. Only adjust if the research suggests cost structure changes (new suppliers, scale economies, etc.)

For management team: Use the ownership entity names. Set title based on ownership percentage (>=50% = "Owner/CEO", >=20% = "Partner/VP", else "Manager"). Set yearsInIndustry to 0 (borrower must confirm) but write a draft bio using ANY information from Management Intelligence research. If research found LinkedIn profiles, public bios, or industry associations, incorporate that.

For working capital: Use industry benchmarks UNLESS the business is cash-based (restaurants, retail) in which case DSO should be 1-5 days.

Return ONLY valid JSON with this exact shape:
{
  "assumptions": { ...complete SBAAssumptions object... },
  "reasoning": {
    "revenueRationale": "2-3 sentences explaining WHY you set these growth rates for this specific business",
    "costRationale": "Why these COGS and operating expense assumptions",
    "growthRationale": "What the research says about this business's growth trajectory",
    "managementRationale": "What we know about the team and what the borrower needs to fill in",
    "workingCapitalRationale": "Why these DSO/DPO values for this industry",
    "equityRationale": "Suggested equity injection based on loan size and SBA requirements"
  }
}
```

3. Parses the response and returns the `DraftedAssumptions` with both the assumptions AND the reasoning.

### New API Route: `src/app/api/deals/[dealId]/sba/draft-assumptions/route.ts`

```typescript
// POST: Generates AI-drafted assumptions from all available deal context
// Returns: { assumptions: SBAAssumptions, reasoning: {...}, prefillMeta: PrefillMeta }
// Takes 10-20 seconds (Gemini Pro with full context)
// Uses streaming SSE for progress feedback

export async function POST(req: NextRequest, ctx: { params: Params }) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: 403 });

  const drafted = await draftAssumptionsFromContext(dealId);
  return NextResponse.json({ ok: true, ...drafted });
}
```

### UI Integration: The "Magic Moment"

**File:** `src/components/sba/AssumptionInterview.tsx` (MODIFY)

Before the form steps load, add a new Step 0: "Buddy Drafts Your Assumptions"

```tsx
// When the interview first loads:
// 1. Show a branded loading screen: "Buddy is analyzing your business..."
//    with the same progress overlay style as generation
// 2. Call POST /api/deals/{dealId}/sba/draft-assumptions
// 3. When it returns, show a REVIEW screen — not a form

// The review screen shows each assumption section as a card:
// ┌─────────────────────────────────────────────────────┐
// │ 📊 Revenue Projection                               │
// │                                                     │
// │ Primary Revenue: $1,400,000/year                    │
// │ Year 1 Growth: 4%  Year 2: 3.5%  Year 3: 3%       │
// │                                                     │
// │ 💡 WHY: Based on your current revenue of $1.4M      │
// │ and the industry outlook suggesting moderate         │
// │ growth in full-service restaurants, we've set        │
// │ conservative growth rates aligned with the NAICS     │
// │ 722511 median of 4%.                                │
// │                                                     │
// │ [Edit] [Looks Good ✓]                               │
// └─────────────────────────────────────────────────────┘

// Each card has:
// - The assumption values displayed in plain English (not "growthRateYear1: 0.04")
// - The reasoning from the AI drafter explaining WHY
// - An "Edit" button that expands to show the editable fields
// - A "Looks Good ✓" button that confirms that section
// - A small "Explain This" link that opens a plain-English explanation of the concept

// When ALL sections are confirmed, show a single "Generate My Business Plan" button
// that confirms assumptions + triggers generation in one action
```

### The Experience Difference

**Before (current):**
1. Open assumption interview
2. See 7 form steps with 30+ fields
3. Figure out what COGS means
4. Look up industry benchmarks yourself
5. Fill in every field
6. Click confirm
7. Wait for generation

**After (Phase 3):**
1. Open assumption interview
2. See "Buddy is analyzing your business..." (10 seconds)
3. See a complete draft with explanations for every number
4. Read each section: "Looks Good" or "Edit" for the few things you'd change
5. Click "Generate My Business Plan"
6. Watch the progress overlay
7. Done

That's the $20,000 consultant experience. You sat down, they already knew everything, they presented their work, you made a couple tweaks, they produced the plan.

---

## Priority 2 — Contextual Explanations (The Education Layer)

### New file: `src/lib/sba/sbaConceptExplainer.ts`

Pure function. For every financial concept in the assumption interview AND the generated plan, provide a plain-English explanation, why it matters for SBA, and what "good" looks like.

```typescript
export interface ConceptExplanation {
  term: string;
  plainEnglish: string;        // 1 sentence a non-finance person understands
  whyItMatters: string;        // 1 sentence about why SBA lenders care
  goodRange: string;           // what range is typical for their industry
  yourValue: string | null;    // their specific value in context
}

const CONCEPTS: Record<string, Omit<ConceptExplanation, 'yourValue'>> = {
  dscr: {
    term: "Debt Service Coverage Ratio (DSCR)",
    plainEnglish: "How many dollars of cash flow your business generates for every $1 of loan payments.",
    whyItMatters: "SBA lenders require at least $1.25 for every $1 of debt payments. Below this, the loan is considered too risky.",
    goodRange: "1.25x is the SBA minimum. 1.50x+ is strong. 2.0x+ is excellent.",
  },
  cogs: {
    term: "Cost of Goods Sold (COGS)",
    plainEnglish: "The direct costs to produce what you sell — ingredients for a restaurant, materials for a contractor, inventory for a retailer.",
    whyItMatters: "This determines your gross margin — how much money is left after direct costs to cover everything else (rent, salaries, loan payments).",
    goodRange: "", // filled from NAICS benchmark at runtime
  },
  dso: {
    term: "Days Sales Outstanding (DSO)",
    plainEnglish: "How many days it takes, on average, for your customers to pay you after you deliver your product or service.",
    whyItMatters: "Longer collection times mean more cash tied up in receivables. If customers take 90 days to pay but you need to pay suppliers in 30, you have a cash flow gap.",
    goodRange: "",
  },
  dpo: {
    term: "Days Payable Outstanding (DPO)",
    plainEnglish: "How many days you take to pay your suppliers after receiving their invoice.",
    whyItMatters: "Paying too fast uses cash you might need. Paying too slow can damage supplier relationships or trigger penalties.",
    goodRange: "",
  },
  grossMargin: {
    term: "Gross Margin",
    plainEnglish: "The percentage of each dollar of revenue that's left after paying for the direct costs of what you sold.",
    whyItMatters: "Higher gross margin means more room to cover operating expenses and debt payments. Low margins make loan repayment much harder.",
    goodRange: "",
  },
  equityInjection: {
    term: "Equity Injection",
    plainEnglish: "The cash you're putting into this deal from your own pocket — not borrowed money.",
    whyItMatters: "SBA requires you to have 'skin in the game.' Minimum 10% for existing businesses, 20% for startups. It proves you're personally invested in the outcome.",
    goodRange: "10% minimum for existing businesses. 20% minimum for startups. Higher equity = stronger application.",
  },
  breakEven: {
    term: "Break-Even Revenue",
    plainEnglish: "The minimum amount of revenue your business needs to cover all costs — before you make any profit.",
    whyItMatters: "If your projected revenue is close to break-even, there's very little margin for error. Lenders want to see significant cushion above break-even.",
    goodRange: "A 'margin of safety' of 20%+ above break-even is strong. Below 10% is a red flag.",
  },
  sensitivity: {
    term: "Sensitivity Analysis",
    plainEnglish: "What happens to your ability to repay the loan if things don't go as planned — if revenue drops 15% or costs rise unexpectedly.",
    whyItMatters: "Lenders want to know that even in a bad year, the business can still make loan payments. This shows resilience.",
    goodRange: "The downside scenario should still show DSCR above 1.0x. If it drops below 1.0x, that means the business can't cover payments in a bad year.",
  },
  globalCashFlow: {
    term: "Global Cash Flow",
    plainEnglish: "Your total financial picture — business income PLUS your personal income, minus business debt PLUS personal debt (mortgage, car, etc).",
    whyItMatters: "SBA requires lenders to look at the whole picture, not just the business. Your personal finances can strengthen (or weaken) the overall application.",
    goodRange: "Global DSCR above 1.25x is the SBA target.",
  },
  sourcesAndUses: {
    term: "Sources & Uses of Funds",
    plainEnglish: "A summary of where all the money for this project is coming from (loan, your equity, seller financing) and exactly how it will be spent.",
    whyItMatters: "SBA needs to see that every dollar of the loan has a specific purpose and that sources equal uses — no unexplained gaps.",
    goodRange: "Sources must equal Uses (balanced). SBA won't approve if there's an unexplained shortfall.",
  },
};

export function getConceptExplanation(
  conceptKey: string,
  naicsCode: string | null,
  borrowerValue?: number,
): ConceptExplanation {
  const base = CONCEPTS[conceptKey];
  if (!base) return {
    term: conceptKey,
    plainEnglish: "Financial metric used in the business plan.",
    whyItMatters: "Relevant to your SBA loan application.",
    goodRange: "Varies by industry.",
    yourValue: borrowerValue != null ? String(borrowerValue) : null,
  };

  // Enrich goodRange with NAICS benchmark if available
  const bench = findBenchmarkByNaics(naicsCode);
  let enrichedRange = base.goodRange;
  if (bench) {
    if (conceptKey === 'cogs') enrichedRange = `Typical for ${bench.label}: ${(bench.cogsMedian * 100).toFixed(0)}%-${(bench.cogsHigh * 100).toFixed(0)}%`;
    if (conceptKey === 'dso') enrichedRange = `Typical for ${bench.label}: ${bench.dsoMedian}-${bench.dsoHigh} days`;
    if (conceptKey === 'dpo') enrichedRange = `Typical for ${bench.label}: ${bench.dpoMedian} days`;
  }

  return {
    ...base,
    goodRange: enrichedRange,
    yourValue: borrowerValue != null ? String(borrowerValue) : null,
  };
}
```

### UI Integration

Every financial metric in the AssumptionInterview AND the SBAPackageViewer gets a small (?) icon that opens a tooltip/popover with `ConceptExplanation`:

```tsx
// Component: ExplainButton
function ExplainButton({ conceptKey, naicsCode, value }: { conceptKey: string; naicsCode: string | null; value?: number }) {
  const [open, setOpen] = useState(false);
  const explanation = getConceptExplanation(conceptKey, naicsCode, value);

  return (
    <>
      <button onClick={() => setOpen(!open)} className="ml-1 text-blue-400/60 hover:text-blue-400">
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>help_outline</span>
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-sm">
          <div className="font-semibold text-blue-300">{explanation.term}</div>
          <p className="mt-1 text-white/70">{explanation.plainEnglish}</p>
          <p className="mt-1 text-white/60"><strong>Why it matters:</strong> {explanation.whyItMatters}</p>
          <p className="mt-1 text-white/60"><strong>Typical range:</strong> {explanation.goodRange}</p>
          {explanation.yourValue && (
            <p className="mt-1 text-white/80"><strong>Your value:</strong> {explanation.yourValue}</p>
          )}
        </div>
      )}
    </>
  );
}
```

### PDF Integration: Insight Callout Boxes

**File:** `src/lib/sba/sbaPackageRenderer.ts` (MODIFY)

Before every major financial table, add an insight callout box that interprets the numbers for the reader:

```typescript
function renderInsightCallout(s: DocState, text: string) {
  const { doc } = s;
  const maxWidth = doc.page.width - PAGE_MARGIN * 2;
  const boxPadding = 12;

  // Blue-tinted callout box
  doc.rect(PAGE_MARGIN, s.y, maxWidth, 50).fill('#f0f7ff').stroke('#2563eb');
  doc.fillColor('#1e40af').font(FONT_BOLD).fontSize(8);
  doc.text('KEY INSIGHT', PAGE_MARGIN + boxPadding, s.y + boxPadding, { width: maxWidth - boxPadding * 2 });
  doc.fillColor('#1e3a5f').font(FONT_NORMAL).fontSize(FONT_SIZE_BODY);
  doc.text(text, PAGE_MARGIN + boxPadding, s.y + boxPadding + 14, { width: maxWidth - boxPadding * 2 });
  doc.fillColor('#000000');
  s.y += 60;
}

// Usage in renderSection2_Projections, BEFORE the table:
const insightText = dscrYear1Base >= 1.5
  ? `${input.dealName} generates $${fmtCurrency(Math.round(annualProjections[0].ebitda))} in annual cash flow against $${fmtCurrency(Math.round(annualProjections[0].totalDebtService))} in debt service — a ${fmtDscr(dscrYear1Base)} coverage ratio providing ${((dscrYear1Base - 1) * 100).toFixed(0)}% cushion above the SBA minimum.`
  : dscrYear1Base >= 1.25
  ? `${input.dealName} meets the SBA 1.25x DSCR threshold at ${fmtDscr(dscrYear1Base)}. The margin of safety is ${fmtPct(input.breakEven.marginOfSafetyPct)} above break-even revenue.`
  : `${input.dealName}'s projected DSCR of ${fmtDscr(dscrYear1Base)} is below the SBA 1.25x minimum threshold. Assumptions should be reviewed before submission.`;

renderInsightCallout(s, insightText);
```

Add similar insight callouts before:
- Break-even section: "Your business needs ${breakEvenRevenue} in annual revenue to cover all costs. Your projected Year 1 revenue of ${projectedRevenue} gives you a ${marginOfSafety}% safety cushion."
- Sources & Uses: "Your equity injection of ${equityPct}% [meets/falls short of] the SBA ${minimumPct}% minimum."
- Global Cash Flow: "Including personal cash flow, your global coverage ratio is ${globalDscr}x."
- Monthly Cash Flow: "Your tightest cash month is Month ${tightestMonth} with a cumulative cash position of ${minCash}."

---

## Priority 3 — Borrower Refinement Loop

### The Problem

After generation, the borrower sees the plan but can't interact with it. If the marketing section doesn't accurately describe their approach, they're stuck. The CCO can inline-edit in the review dashboard, but the *borrower* can't.

### Solution: Section-Level Regeneration

**New API Route:** `src/app/api/deals/[dealId]/sba/refine-section/route.ts`

```typescript
// POST: Regenerate a single narrative section with borrower feedback
// Body: { section: 'executive_summary' | 'industry_analysis' | ..., feedback: string }
// Example: { section: 'marketing_strategy', feedback: "We focus primarily on corporate catering, not dine-in. Our main channel is LinkedIn outreach to office managers." }
//
// This calls the relevant Gemini generator with:
// 1. All the original context (same as initial generation)
// 2. The PREVIOUS output (so the model knows what to improve)
// 3. The borrower's feedback
//
// Returns the updated section text
// Updates buddy_sba_packages with the new text
// Does NOT regenerate the PDF immediately — that happens on explicit "Regenerate PDF" action
```

### UI: Feedback Cards in Package Viewer

**File:** `src/components/sba/SBAPackageViewer.tsx` (MODIFY)

Each narrative section in the viewer gets a "This isn't quite right" button:

```tsx
<div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
  <div className="flex items-center justify-between">
    <h3 className="text-sm font-semibold text-white/80">Marketing Strategy</h3>
    <button onClick={() => setRefiningSection('marketing_strategy')} className="text-xs text-blue-400 hover:text-blue-300">
      This isn't quite right →
    </button>
  </div>
  <p className="mt-2 text-sm text-white/60 line-clamp-4">{pkg.marketingStrategy}</p>
</div>

{refiningSection === 'marketing_strategy' && (
  <div className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
    <label className="text-sm font-medium text-amber-300">Tell Buddy what to change:</label>
    <textarea
      value={feedback}
      onChange={(e) => setFeedback(e.target.value)}
      placeholder="We actually focus on corporate catering, not dine-in. Our main sales channel is LinkedIn outreach to office managers."
      className="mt-2 w-full rounded-lg bg-white/5 border border-white/10 p-3 text-sm text-white placeholder:text-white/30"
    />
    <button onClick={handleRefineSection} className="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
      Rewrite This Section
    </button>
  </div>
)}
```

---

## Priority 4 — Premium PDF Design

### File: `src/lib/sba/sbaPackageRenderer.ts` (MODIFY)

Upgrade the PDF from functional to premium:

**Typography hierarchy:**
- Section titles: 16pt bold, navy (#0f1e3c)  
- Subsection titles: 12pt bold, dark gray (#374151)
- Body text: 10pt regular (upgrade from 9pt), line height 1.5 (upgrade from 1.2)
- Table headers: 9pt bold, white on navy background row
- Numbers: 10pt monospace for financial tables

**Table styling:**
- Alternating row backgrounds (white / #f8fafc)
- Header row: navy background (#0f1e3c), white text
- Subtotal rows: light blue background (#eff6ff), bold
- DSCR cells: green background when ≥1.25, red background when <1.25

**Insight callout boxes** (as described in Priority 2)

**Key metrics dashboard on page 3** (after Executive Summary):
Before the full projections table, render a 4-metric dashboard at the top:

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  DSCR Y1     │  │  Break-Even  │  │  Equity      │  │  Global      │
│  1.87x ✓     │  │  Margin      │  │  Injection   │  │  DSCR        │
│              │  │  45.5%       │  │  15.2% ✓     │  │  2.14x ✓     │
│  SBA Min:    │  │              │  │              │  │              │
│  1.25x       │  │  Strong      │  │  Min: 10%    │  │  SBA Min:    │
│              │  │  cushion     │  │              │  │  1.25x       │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

**Monthly Cash Flow mini-chart in executive summary:**
Embed a small sparkline-style bar chart showing monthly cash position (cumulative cash) as visual context within the executive summary page. Green bars for positive months, red for negative.

---

## Priority 5 — Conversational Alternative to the Form

### New Component: `src/components/sba/SBAConversationalInterview.tsx`

A chat-style UI that uses the existing voice schema questions but in a text chat format. This is an ALTERNATIVE to the form-based `AssumptionInterview.tsx` — the borrower can choose which mode they prefer.

```typescript
// The chat interface:
// 1. Buddy sends the first message: "Hi! I'm going to help you build your business plan.
//    I've already analyzed your financial statements and done market research on your
//    industry. Let me show you what I've drafted so far, and then we can refine anything
//    that needs adjustment."
//
// 2. Buddy presents each assumption section as a message card (same as the AI-drafted
//    review cards from Priority 1) in the chat flow
//
// 3. The borrower responds in natural language: "That growth rate seems too low,
//    we just signed a major contract that should boost revenue 20% next year"
//
// 4. Buddy responds: "Got it — I've updated Year 1 growth to 20% based on the
//    new contract. Year 2 and 3 I've kept at 8% and 5% assuming the contract
//    contribution normalizes. Does that look right?"
//
// 5. This continues until all sections are confirmed
//
// Under the hood:
// - Each borrower message is sent to Gemini with the current assumption state
// - Gemini extracts structured updates and returns both:
//   a) The updated assumption fields (JSON patch)
//   b) A conversational response confirming the change
// - The assumption state is updated in real-time
// - When all sections are confirmed, the "Generate" button appears

// The chat uses the existing PUT /api/deals/{dealId}/sba/assumptions
// endpoint for persistence — same data model, different input method
```

**New API Route:** `src/app/api/deals/[dealId]/sba/chat-refine/route.ts`

```typescript
// POST: Process a natural language assumption update
// Body: { message: string, currentAssumptions: SBAAssumptions }
// Returns: {
//   reply: string,                        // Buddy's conversational response
//   patches: Array<{ path: string, value: any }>,  // JSON patches to apply to assumptions
//   sectionConfirmed: string | null,       // which section this message confirmed
// }
```

### Mode Switcher

At the top of the SBA Package tab, add a toggle:

```tsx
<div className="flex items-center gap-2 rounded-full bg-white/5 p-1">
  <button className={mode === 'guided' ? 'active' : ''} onClick={() => setMode('guided')}>
    <span className="material-symbols-outlined">smart_toy</span>
    Guided (Buddy leads)
  </button>
  <button className={mode === 'form' ? 'active' : ''} onClick={() => setMode('form')}>
    <span className="material-symbols-outlined">edit_note</span>
    Form (I'll fill it in)
  </button>
</div>
```

Default mode: **Guided** (the AI-drafted review experience from Priority 1). The form mode is there for power users or bankers who want to directly input numbers.

---

## Implementation Order

1. **`sbaConceptExplainer.ts`** — pure function, no dependencies
2. **`sbaAssumptionDrafter.ts`** — Gemini Pro call, depends on research extractor + benchmarks
3. **`POST /api/deals/[dealId]/sba/draft-assumptions`** — API route for AI drafting
4. **Update `AssumptionInterview.tsx`** — Add "Buddy Drafts" Step 0 with review cards, explain buttons, auto-generate on confirm
5. **`POST /api/deals/[dealId]/sba/refine-section`** — API route for section-level regeneration
6. **Update `SBAPackageViewer.tsx`** — Add "This isn't quite right" feedback cards for each narrative section
7. **Update `sbaPackageRenderer.ts`** — Premium typography, table styling, insight callout boxes, key metrics dashboard, sparkline charts
8. **`SBAConversationalInterview.tsx`** — Chat-style alternative interview UI
9. **`POST /api/deals/[dealId]/sba/chat-refine`** — API route for conversational assumption updates
10. **Mode switcher** — Toggle between Guided/Form modes in the SBA tab

---

## Verification

Test with a deal that has:
- Financial facts (revenue, COGS, etc.)
- A completed BIE research mission with 10+ sections
- Ownership entities with at least 2 individuals
- Borrower application with NAICS code matching a benchmark

Expected experience:
1. Open SBA tab → "Buddy is analyzing your business..." (10-15 seconds)
2. See complete drafted assumptions with reasoning for each section
3. Every number has a (?) explain button that opens plain-English explanation
4. "Looks Good" on most sections, "Edit" on one or two
5. Click "Generate My Business Plan" → progress overlay → 45 seconds
6. See the generated plan with insight callout boxes before each financial table
7. Click "This isn't quite right" on marketing section → type feedback → section regenerates
8. Download PDF — verify insight boxes, key metrics dashboard, premium table styling
9. CCO reviews → approves → submit

The borrower's total active time should be under 10 minutes. The feeling should be: "Buddy already knew my business better than I could have explained it."

---

*End of Phase 3 spec. This is the experience layer that makes the borrower say "this was worth $20,000."*
