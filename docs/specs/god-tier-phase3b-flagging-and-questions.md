# GOD TIER PHASE 3B — INTELLIGENT FLAGGING & BORROWER QUESTION ENGINE
## Every Irregularity Caught. Every Question Prepared. Nothing Left on the Table.

**Classification:** Internal — Architectural Specification
**Version:** 1.0
**Date:** 2026-03-06
**Prerequisite:** God Tier Phases 1, 2, 2C, 2D complete
**Status:** SPECIFICATION — Ready for Claude Code

---

## THE CORE THESIS

A spread is only as valuable as what you do with it. Buddy already detects every irregularity in the financial data. This spec defines what happens next: every flag becomes either a **banker insight** (something they need to know) or a **borrower question** (something they need to explain) — and both are automatically prepared, prioritized, and ready to send.

The banker reviews the flags, approves the questions, and sends them. Or they review the questions, make edits, and send them. Either way, they aren't writing questions from scratch at 9pm before a credit committee.

---

## SECTION 1: FLAG TAXONOMY

Every flag Buddy generates belongs to one of four categories. The category determines routing — who needs to act on it, and how urgently.

### Category 1: FINANCIAL IRREGULARITY
Something in the numbers doesn't add up, looks inconsistent, or represents a material deviation from what's expected.

**Examples:**
- Revenue on the tax return doesn't match revenue on the financial statement (>3% variance)
- Schedule L balance sheet doesn't reconcile to the financial statement
- Gross margin dropped >500bps year-over-year with no apparent explanation
- Owner compensation exceeds 40% of gross revenue
- DSO has increased >15 days year-over-year (receivables collecting slower)
- Inventory has grown faster than revenue for 2+ consecutive years
- Tax return shows a loss but financial statement shows profit (or vice versa)
- Net income doesn't roll forward to retained earnings correctly
- Large "other income" or "other expense" line with no description
- Non-recurring income > 20% of reported EBITDA

**Default routing:** Banker review first; forward to borrower with explanation context

### Category 2: MISSING OR INCOMPLETE DATA
A document was expected but not provided, a key field extracted as null, or a required analysis cannot be completed due to insufficient data.

**Examples:**
- Personal tax return provided but Schedule E is missing (has rental properties on balance sheet)
- K-1 received from entity not in the deal package (undisclosed related business)
- YTD financials are more than 90 days old
- Rent roll provided but lease agreements not uploaded
- Personal financial statement is more than 90 days old
- Form 4562 shows large Section 179 but amortization schedule not provided
- Construction deal but no project budget uploaded
- SBA deal but personal financial statements for all 20%+ owners not received

**Default routing:** Always sent to borrower as a document request

### Category 3: COVENANT / POLICY PROXIMITY
The borrower is currently passing policy minimums, but is close enough to a threshold that the banker should know about it and potentially structure protections.

**Examples:**
- DSCR is between 1.15x and 1.30x (passes 1.25x minimum but limited cushion)
- Current ratio is between 1.10x and 1.25x (passes 1.10x minimum but thin)
- LTV is between 70% and 75% (passes 75% LTV max but a minor value decline triggers a breach)
- Debt/EBITDA is between 4.0x and 4.5x (approaching 4.5x maximum)
- TNW is positive but less than 10% of total assets
- Post-close liquidity is between 10% and 15% of loan amount

**Default routing:** Banker only — used for covenant structuring, not borrower communication

### Category 4: QUALITATIVE RISK SIGNAL
Not a number irregularity but a structural characteristic of the deal or borrower that warrants attention.

**Examples:**
- Single customer represents >25% of revenue (customer concentration)
- Single provider represents >80% of professional practice revenue (key-man risk)
- Business is in its first 3 years of operation (limited operating history)
- Owner has personally guaranteed more than 3 other business loans (guarantee fatigue)
- Entity was formed within 12 months of the loan application
- NAICS code is on the bank's heightened scrutiny list
- Lease on primary operating location expires within the loan term
- Business has changed its primary revenue model in the last 2 years

**Default routing:** Banker review; some forwarded to borrower as context questions

---

## SECTION 2: FLAG DATA MODEL

```typescript
interface SpreadFlag {
  flag_id: string;
  deal_id: string;
  
  // Classification
  category: 'financial_irregularity' | 'missing_data' | 'policy_proximity' | 'qualitative_risk';
  severity: 'critical' | 'elevated' | 'watch' | 'informational';
  
  // What triggered it
  trigger_type: string;              // e.g. "revenue_variance", "dscr_proximity", "dso_trend"
  canonical_keys_involved: string[]; // which extracted fields are part of this flag
  
  // The numbers
  observed_value: number | string | null;
  expected_range?: { min?: number; max?: number; description: string };
  year_observed?: number;
  
  // Plain-English explanation for banker
  banker_summary: string;            // one sentence: what happened
  banker_detail: string;             // full explanation with numbers
  banker_implication: string;        // why does this matter for the credit?
  
  // Question generated for borrower
  borrower_question: BorrowerQuestion | null;  // null if banker-only
  
  // Resolution
  status: 'open' | 'banker_reviewed' | 'sent_to_borrower' | 'answered' | 'resolved' | 'waived';
  banker_note?: string;              // banker adds context after review
  borrower_response?: string;        // borrower's answer
  resolution_note?: string;          // how it was resolved
  waived_by?: string;                // banker who waived it
  waived_reason?: string;
  
  // Metadata
  auto_generated: boolean;
  created_at: string;
  updated_at: string;
}

interface BorrowerQuestion {
  question_id: string;
  flag_id: string;
  
  // The actual question
  question_text: string;             // ready to send — complete, professional
  question_context: string;         // why we're asking (shown to banker, optional for borrower)
  
  // Supporting data attached to question
  attachments: QuestionAttachment[]; // pages/numbers from the spread Buddy is referencing
  
  // Document request (if category = missing_data)
  document_requested?: string;       // specific document name
  document_format?: string;          // what format is acceptable
  document_urgency: 'required_before_approval' | 'required_before_closing' | 'preferred';
  
  // Routing
  recipient_type: 'borrower' | 'accountant' | 'attorney' | 'appraiser';
  send_method?: 'email' | 'portal' | 'manual';
  
  // Status
  sent_at?: string;
  answered_at?: string;
  answer_text?: string;
}
```

---

## SECTION 3: FLAG GENERATION ENGINE

### 3A. Triggered by Ratio Computation (`flagFromRatios.ts`)

Every ratio computed by the spread engine runs through a flag evaluation after computation. The flag rules are the same red flag system from the God Tier spec but now produce structured `SpreadFlag` objects with full context.

```typescript
interface RatioFlagRule {
  canonical_key: string;
  condition: 'below' | 'above' | 'trend_down' | 'trend_up' | 'variance';
  threshold: number;
  severity: Severity;
  category: FlagCategory;
  message_template: NarrativeTemplate;
  generate_question: boolean;
  question_template?: QuestionTemplate;
}
```

**Ratio flag rules — high priority:**

| Ratio | Condition | Threshold | Severity | Question Generated |
|---|---|---|---|---|
| ratio_dscr_final | below | 1.00 | critical | Yes — explain shortfall |
| ratio_dscr_final | below | 1.25 | elevated | Yes — if close to policy min |
| ratio_dscr_final | trend_down | 2-yr decline | elevated | Yes — revenue or expense driver |
| ratio_debt_ebitda | above | 5.0 | critical | Yes — deleveraging plan |
| ratio_debt_ebitda | above | 4.0 | elevated | Banker only |
| ratio_dso | above | 90 | elevated | Yes — AR aging explanation |
| ratio_dso | trend_up | 15+ day increase | watch | Yes — collection policy change? |
| ratio_current | below | 1.00 | critical | Yes — liquidity explanation |
| ratio_current | below | 1.25 | watch | Banker only |
| ratio_ltv | above | 0.80 | critical | Banker only — structure issue |
| ratio_gross_margin | trend_down | 500+ bps | elevated | Yes — pricing or cost driver |
| ratio_revenue_growth | below | -0.10 | elevated | Yes — revenue decline explanation |

### 3B. Triggered by Cross-Document Reconciliation (`flagFromReconciliation.ts`)

After all documents are extracted, Buddy runs cross-document consistency checks. Failures generate flags.

**Reconciliation checks:**

```typescript
// Revenue reconciliation
if (Math.abs(tax_revenue - fs_revenue) / fs_revenue > 0.03) {
  // Flag: "Tax return revenue of $X differs from financial statement revenue of $Y 
  // by $Z (N%). This discrepancy requires explanation — common causes include 
  // cash-basis vs. accrual timing, excluded entities, or reporting errors."
  // Question: "Your [Year] tax return reports gross revenue of $X, while your 
  // financial statements for the same period report $Y. Can you explain the 
  // difference of $Z?"
}

// Schedule L reconciliation
if (Math.abs(sch_l_total_assets - fs_total_assets) / fs_total_assets > 0.03) {
  // Flag: Schedule L total assets differ from financial statement total assets
}

// Net income rollforward
if (Math.abs(prior_retained_earnings + net_income - dividends - current_retained_earnings) > 1000) {
  // Flag: Retained earnings don't roll forward correctly — missing distribution or restatement
}

// K-1 orphan detection
k1_entities_not_in_deal_scope.forEach(entity => {
  // Flag: K-1 received from entity not in deal package — undisclosed related business
  // Question: "Your personal tax return includes K-1 income from [Entity Name] 
  // (EIN: XX-XXXXXXX). Please provide financial statements and tax returns for 
  // this entity so we can include it in our analysis."
})

// Large unexplained items
if (other_income > 0.05 * total_revenue) {
  // Flag: "Other income" represents >5% of total revenue with no description
  // Question: "Your [Year] tax return includes $X of 'other income'. 
  // Please describe the nature and source of this income."
}
```

### 3C. Triggered by QoE Engine (`flagFromQoE.ts`)

The Quality of Earnings engine already identifies non-recurring items. Each identified item generates a flag and an automatic question if the confidence is below "high."

```typescript
// For each QoE adjustment:
if (adjustment.confidence !== 'high') {
  // Flag: "Non-recurring adjustment of $X applied for [description]. 
  // Confidence is [medium/low] — banker should verify before finalizing spread."
  // Question (if medium confidence): "Your [Year] financial results include 
  // $X described as [item]. Please confirm whether this is a one-time item 
  // or whether it recurs in your business, and provide supporting documentation."
}

// If total non-recurring adjustments > 20% of reported EBITDA:
// Flag critical: "QoE adjustments total $X (N% of reported EBITDA). 
// Normalized EBITDA of $Y may not reflect true earning power — 
// verify all adjustments before relying on this figure."
```

### 3D. Triggered by Trend Engine (`flagFromTrends.ts`)

Three-year trends that show consistent deterioration or acceleration generate flags with narrative context.

```typescript
// Declining EBITDA margin for 2+ consecutive years
if (ebitda_margin_trend === 'declining' && trend_years >= 2) {
  // Flag: "EBITDA margin has declined from X% (Year 3) to Y% (Year 2) to Z% (Year 1). 
  // This represents a N bps cumulative compression over 2 years. 
  // If this trend continues, DSCR will fall below 1.0x in approximately X months."
  // Question: "Your EBITDA margin has declined over the past 2 years from X% to Z%. 
  // What factors are driving this trend, and what steps are you taking to address it?"
}

// Revenue growth with margin compression (revenue growing but profitability shrinking)
if (revenue_growth > 0 && ebitda_margin_trend === 'declining') {
  // Flag: "Revenue is growing but EBITDA margin is compressing — 
  // growth may not be profitable. Review cost structure before approving expansion credit."
  // Question: "Your revenue has grown X% while your operating margins have declined. 
  // Are there temporary costs driving this pattern (new hires, facility expansion, etc.) 
  // or structural pricing/cost pressures?"
}
```

### 3E. Triggered by Document Analysis (`flagFromDocuments.ts`)

Structural deal characteristics that create risk.

```typescript
// Lease expiration within loan term
if (primary_lease_expiration_date < loan_maturity_date) {
  // Flag: "Primary operating location lease expires [Date], 
  // which is [N months] before loan maturity. Lease renewal risk exists."
  // Question: "Your current lease at [Address] expires on [Date], 
  // before the proposed loan maturity. Do you have a renewal option? 
  // What are the expected renewal terms?"
}

// Customer concentration
if (largest_customer_pct > 0.25) {
  // Flag: "Single customer represents X% of revenue — concentration risk"
  // Question: "Your largest customer represents approximately X% of your revenue. 
  // How long have you had this relationship? Do you have a long-term contract? 
  // What would the impact be on your business if this customer reduced their volume by 50%?"
}

// Undisclosed guarantees (from personal financial statement)
pfs_contingent_liabilities.forEach(item => {
  if (!item.disclosed_in_application) {
    // Flag: "Personal financial statement discloses contingent liability of $X 
    // for [description] not referenced in loan application."
    // Question: "Your personal financial statement lists a contingent liability 
    // of $X for [description]. Please provide detail on this obligation."
  }
})
```

---

## SECTION 4: BORROWER QUESTION ENGINE

### 4A. Question Quality Standards

Every auto-generated borrower question must meet these standards before it's shown to the banker for review:

1. **Professional and neutral in tone** — never accusatory, never implies wrongdoing
2. **Specific** — references the actual numbers, the actual form, the actual year
3. **Self-contained** — the borrower knows exactly what's being asked without needing to see the flag
4. **Actionable** — tells the borrower specifically what to provide (a number, a document, an explanation)
5. **Appropriate length** — never more than 3 sentences plus a document list if applicable

**Good question example:**
> "Your 2023 federal tax return reports gross receipts of $4,187,000, while your 2023 financial statements prepared by your accountant show net sales of $3,941,000 — a difference of $246,000. Could you help us understand the source of this difference? If this relates to timing (accrual vs. cash basis), a brief note from your accountant confirming the reconciliation would be sufficient."

**Bad question example (DO NOT GENERATE):**
> "There is a discrepancy in your revenues." ← Not specific enough
> "Why doesn't your tax return match your financials?" ← Accusatory tone
> "Please explain the $246,000 difference between your 2023 gross receipts on Form 1120 Line 1a ($4,187,000) and your audited financial statement revenue ($3,941,000) noting that this represents a 6.2% variance which exceeds our 3% reconciliation threshold as defined in our underwriting policy." ← Too long, too technical

### 4B. Question Templates by Flag Type

```typescript
// REVENUE_VARIANCE
template: "Your {year} tax return reports {tax_revenue_label} of {tax_revenue_formatted}, 
while your {year} financial statements show {fs_revenue_label} of {fs_revenue_formatted} — 
a difference of {variance_formatted}. Could you explain this difference? 
If this is a timing or accounting basis difference, a brief note from your accountant would suffice."

// DSO_ELEVATED
template: "Your accounts receivable balance has grown relative to your revenue, 
suggesting your average collection period is approximately {dso_days} days 
(up from {prior_dso_days} days in the prior year). 
Could you describe your current collections process and whether any specific 
customers or invoices are contributing to the increase? 
Please also provide your current AR aging report."

// K1_ORPHAN (undisclosed entity)
template: "Your {year} personal tax return includes K-1 income of {k1_income_formatted} 
from {entity_name}. In order to complete our analysis, we'll need to include 
this entity in our review. Could you provide {entity_name}'s last 2 years of 
tax returns and most recent financial statements?"

// LEASE_EXPIRATION
template: "We noticed your lease at {address} expires on {expiration_date}, 
which falls before the proposed loan maturity of {loan_maturity}. 
Do you have a renewal option in place? If so, could you share the relevant 
lease clause, or describe the anticipated renewal terms?"

// CUSTOMER_CONCENTRATION
template: "Based on your financial information, it appears that a significant portion 
of your revenue comes from a small number of customers. Could you provide a 
summary of your top 5 customers by revenue, the length of each relationship, 
and whether you have contracts in place? 
We ask because customer concentration is a standard part of our credit review."

// LARGE_OTHER_INCOME
template: "Your {year} tax return includes {other_income_formatted} of '{other_income_label}'. 
Could you describe the source of this income and whether it is expected to recur 
in future years? If this is related to a one-time event, documentation of that 
event would be helpful."

// OWNER_COMP_ELEVATED
template: "Your {year} return reflects total compensation to {officer_name} of 
{comp_formatted}. For our analysis, we apply a market-rate adjustment to officer 
compensation. Could you confirm the primary responsibilities of this position 
and whether the compensation includes any one-time bonuses or distributions 
that are not expected to recur?"
```

### 4C. Document Request Templates

When the flag category is `missing_data`, the borrower question becomes a formal document request.

```typescript
interface DocumentRequestTemplate {
  trigger: string;
  document_name: string;
  description: string;
  acceptable_formats: string[];
  urgency: DocumentUrgency;
  request_text: string;
}

// Examples:
{
  trigger: 'schedule_e_missing',
  document_name: '2023 Schedule E (Supplemental Income and Loss)',
  description: 'Required because your personal tax return shows rental property income/loss',
  acceptable_formats: ['PDF of complete signed tax return including Schedule E'],
  urgency: 'required_before_approval',
  request_text: "To complete our personal cash flow analysis, we need a copy of Schedule E 
    from your 2023 personal tax return. If your return was filed electronically, 
    your accountant can provide a PDF of the complete return including all schedules."
}

{
  trigger: 'ydt_financials_stale',
  document_name: 'Current YTD Financial Statements',
  description: 'YTD financials provided are more than 90 days old',
  acceptable_formats: ['PDF or Excel', 'Accountant-prepared or internally prepared'],
  urgency: 'required_before_approval',
  request_text: "The year-to-date financial statements we have on file are dated {statement_date}, 
    which are more than 90 days old. Could you provide updated financial statements 
    through {target_date}? These can be internally prepared — they do not need to 
    be accountant-reviewed."
}
```

---

## SECTION 5: BANKER REVIEW WORKFLOW

### 5A. The Flag Review Interface

When a banker opens a spread, they see a Flag Review panel alongside the spread panels. The flag panel shows:

```
REQUIRES ATTENTION — 7 flags (2 critical, 3 elevated, 2 watch)

┌──────────────────────────────────────────────────────────────────┐
│ [CRITICAL] Revenue Variance — $246K gap between return and FS   │
│ Tax return: $4,187,000  │  Financial statement: $3,941,000       │
│ Variance: $246,000 (6.2%)  │  Threshold: 3.0%                    │
│                                                                   │
│ Question ready to send:                                          │
│ "Your 2023 tax return reports gross receipts of $4,187,000,     │
│ while your 2023 financial statements show net sales of           │
│ $3,941,000 — a difference of $246,000. Could you explain..."    │
│                                                                   │
│ [Edit Question]  [Send to Borrower]  [Mark Resolved]  [Waive]   │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ [ELEVATED] DSCR Proximity — 1.31x (policy minimum 1.25x)        │
│ Cushion: $37,000 annual cash flow above debt service            │
│ Stress scenario: 9% revenue decline → breach 1.25x             │
│                                                                   │
│ Banker only. Suggest: Annual DSCR covenant ≥ 1.20x             │
│ [Add to Covenant List]  [Note]  [Dismiss]                       │
└──────────────────────────────────────────────────────────────────┘
```

### 5B. Batch Actions

The banker can:
- Review all flags in one session before sending any
- Edit any auto-generated question before sending
- Send all approved questions to borrower in one action (email or portal)
- Mark individual flags as "waived" with a reason (regulatory requirement — all waivers logged)
- Add a banker note to any flag (appears in the credit memo and audit trail)
- Assign flags to specific team members for resolution

### 5C. Send Package

When the banker clicks "Send Questions to Borrower," Buddy assembles:

1. A professional cover message: "As part of our credit review of [Deal Name], we have a few items we'd like to clarify. Please review the questions below and respond at your earliest convenience."
2. All approved questions, numbered and organized by priority
3. Document request list (if any), clearly separated and formatted as a checklist
4. A portal link where the borrower can upload documents and respond

The send package is reviewable before sending and saved to the deal record permanently.

---

## SECTION 6: RESPONSE TRACKING & RESOLUTION

### 6A. Borrower Response Loop

When a borrower responds to a question or uploads a document:

1. Buddy parses the response and attempts auto-resolution:
   - If it's a document upload, re-runs the relevant extraction
   - If it's a text response, checks whether it resolves the specific flag condition
2. If auto-resolution is possible: flag moves to "pending banker confirmation"
3. If not: flag stays open with borrower's response attached for banker review
4. Banker confirms resolution or re-opens with follow-up

### 6B. Spread Re-Computation on Response

When a document is uploaded in response to a question (e.g., a Schedule E that was missing):
- Buddy re-runs extraction on the new document
- Recalculates affected ratios
- Updates the spread automatically
- Notifies the banker: "Schedule E processed — personal cash flow updated. DSCR unchanged. New flag: rental property at [address] has negative cash flow of $8,400/yr."

The spread is always current. The banker never has to manually recalculate after receiving new documents.

### 6C. Flag Resolution Audit Trail

Every flag carries a full audit trail:
- When it was generated and what triggered it
- What question was sent (including any edits the banker made)
- When it was sent and to whom
- What the borrower responded
- How it was resolved (auto, banker, or waived)
- Who waived it and the stated reason

This audit trail is part of the credit file and satisfies examiner requirements for documenting how exceptions were identified and resolved.

---

## SECTION 7: INTEGRATION WITH PHASE 3 OUTPUT LAYER

The flagging system feeds directly into the Phase 3 spread output panels:

- **Panel 4 (Risk Dashboard):** All active flags displayed by severity, with one-click access to the question prepared for each
- **Panel 5 (Story Panel):** The top 3 flags are incorporated into the narrative with their resolution status
- **Panel 1 (Executive Summary):** Flags with "sent to borrower — awaiting response" status shown as "pending" items that will update when resolved
- **Credit Memo Export:** All resolved flags included with resolution documentation; open flags shown as "pending — borrower response requested on [date]"

---

## IMPLEMENTATION PLAN FOR CLAUDE CODE

### Module List

1. **`flagEngine/flagRegistry.ts`** — all flag rules with thresholds, templates, severity, routing
2. **`flagEngine/flagFromRatios.ts`** — evaluate all computed ratios against flag rules
3. **`flagEngine/flagFromReconciliation.ts`** — cross-document consistency checks
4. **`flagEngine/flagFromQoE.ts`** — QoE adjustment flags and confidence checks
5. **`flagEngine/flagFromTrends.ts`** — multi-year deterioration pattern detection
6. **`flagEngine/flagFromDocuments.ts`** — structural deal risk flags (lease, concentration, entities)
7. **`flagEngine/questionGenerator.ts`** — generate BorrowerQuestion from SpreadFlag using templates
8. **`flagEngine/documentRequestGenerator.ts`** — generate document requests for missing_data flags
9. **`flagEngine/flagComposer.ts`** — orchestrates all flag modules, deduplicates, prioritizes
10. **`flagEngine/sendPackageBuilder.ts`** — assembles banker-reviewed questions into send package
11. **`flagEngine/responseProcessor.ts`** — parse borrower responses, attempt auto-resolution, trigger re-extraction

### Supabase Tables

```sql
deal_flags              -- all flags with full context and status
deal_borrower_questions -- all questions with send/receive tracking
deal_flag_audit         -- immutable audit trail for every flag state change
```

### Test Coverage Requirements

- Every flag rule must have a test case that triggers it (input data that produces the flag)
- Every flag rule must have a negative test case (input data that does NOT trigger it)
- All 7 question templates must produce output that meets quality standards
- The send package assembler must correctly order and format questions
- Auto-resolution must correctly close flags when qualifying documents are received

---

## THE RESULT

A banker uploads a loan package. Buddy runs the full God Tier analysis — extraction, normalization, QoE, consolidation, ratios, benchmarks — and simultaneously generates a complete flag set with:

- Every irregularity identified and explained in plain English
- Every missing document named and requested
- Every covenant proximity flagged with a suggested protection
- Every qualitative risk surfaced with context

Questions are written, professional, and ready to send. The banker reviews, edits if needed, and clicks send. The borrower responds through the portal. Documents are re-ingested automatically. The spread updates.

No irregularity goes unaddressed. No question gets forgotten. No document slips through the cracks.

**This is what it means to have Buddy in the room.**
