# THE GOD TIER BUSINESS PLAN SYSTEM

**Status:** DESIGN — architectural vision for the Business Plan prong of the Borrower Trident  
**Created:** April 21, 2026  
**Audience:** Matt + Claude Code  
**Purpose:** Define what "god tier" actually means for the business plan, independent of SBA compliance, infrastructure, or previous phases

---

## What This Document Is

This is not a spec with file paths and commit steps. This is the philosophical and structural blueprint for what the Buddy Business Plan must become. Implementation specs will follow once this vision is locked.

---

## The Standard We're Building To

A borrower finishes the business plan process and says one of these things:

> "I understand my own business better now than I did before."

> "This is exactly what I see in my head, but I could never have written it this clearly."

> "I'm going to use this to actually run my business."

> "My spouse read it and finally understands what I'm trying to build."

> "The bank officer said it was one of the best plans she'd ever seen."

If the borrower doesn't feel at least one of those, the system has failed. Compliance is a side effect of excellence. A business plan that makes a borrower proud will satisfy any SBA lender. The reverse is not true.

---

## What a God Tier Business Plan Actually Is

### It's a Mirror

The borrower reads it and sees THEIR vision, THEIR voice, THEIR story — articulated more clearly than they could have expressed it themselves. It doesn't read like it was generated. It reads like it was written by someone who spent 40 hours interviewing them and researching their market.

This means the system must CAPTURE the borrower's voice before it generates anything. Not just their numbers — their WHY. Why are they starting this business? What do they see that nobody else sees? What specific experience or insight gives them an edge? What keeps them up at night?

The current system captures financial assumptions. It doesn't capture the person.

### It's a Thinking Tool

The process of creating the plan should teach the borrower something about their own business they didn't know before. The best business plans in the world — the ones that win Harvard and MIT competitions — are great because the ACT of creating them forced the entrepreneur to confront assumptions, discover blind spots, and sharpen their strategy.

This means the system shouldn't just ask "what's your Year 1 growth rate?" It should say "Based on the competitive landscape in your market, here are three ways businesses like yours typically grow. Which one matches your strategy?" And then the plan should reflect THAT specific growth driver, not an abstract percentage.

### It's a Roadmap

After reading the plan, the borrower should be able to answer: What do I do on Day 1? Week 1? Month 1? Quarter 1? Year 1? The plan shouldn't be an abstract document about the future — it should be a concrete sequence of actions tied to specific outcomes.

This means the plan needs sections that don't exist today:
- A milestone timeline: what happens when, and what success looks like at each stage
- A KPI dashboard: the 5-7 specific numbers the borrower should track monthly
- A risk contingency matrix: IF this happens, THEN do this specific thing

### It's Honest

The best plans confront risk head-on. They don't hide behind "we project consistent growth." They say "here's what happens if we lose our biggest customer, and here's exactly what we'll do about it." This builds credibility with the lender AND protects the borrower by forcing them to think through failure modes before they happen.

### It's a Story

Humans don't connect with spreadsheets. They connect with narratives. The executive summary isn't a list of financial metrics — it's the story of a person who identified a specific opportunity, has the specific skills and experience to execute on it, and has a specific plan to build something meaningful. The reader — whether it's a bank officer, a spouse, or the borrower themselves — should CARE about this business by the time they finish the executive summary.

---

## What's Wrong With What We Have Today

### The Narrative Problem

The prompts tell Gemini to write like a commercial banker: "professional, third person, factual." That produces: "ChatGPT Fix 15 operates within the real estate and property management sector, providing professional oversight and operational management for commercial assets."

That sentence could describe any property management company on Earth. It contains zero information about THIS specific business. It's the business plan equivalent of elevator music — technically correct, emotionally dead.

A god tier executive summary for this same business would read something like:

"Test Borrower has spent 15 years learning something most property owners never figure out: the difference between a building that makes money and one that quietly bleeds it is almost never the location or the tenant — it's the 47 small operational decisions a property manager makes every week that most owners never see. That insight is the foundation of Samaritus Management. Based in [city], [state], Samaritus manages a portfolio generating $1.36 million in annual revenue by doing one thing exceptionally well: treating every property as if the manager's own money were at stake. The $500,000 SBA loan will fund an equipment upgrade that eliminates the company's single largest cost vulnerability — the $274,000 annual maintenance line — and positions the business to add 2-3 new management contracts per year without proportionally increasing overhead."

That paragraph tells a STORY. It names the person, their insight, their city, their revenue, their loan purpose, their growth plan, and their competitive advantage — all in 140 words. The reader meets a real human being, not a corporate entity.

### The Missing Voice Problem

The system captures the borrower's NUMBERS but not their STORY. The assumption interview asks about COGS percentages and DSO days — it doesn't ask:

- "Why did you decide to start this business?"
- "What do you know about this industry that most people don't?"
- "Who is your ideal customer and why do they choose you over the competition?"
- "What's the biggest risk you see, and what's your plan if it happens?"
- "What does success look like for you in 3 years — not just financially, but personally?"

These aren't soft questions. The answers are the CORE of the business plan. Without them, the plan is a financial model wrapped in generic prose.

### The Disconnected Projections Problem

The projections say "8% growth Year 1" but the plan doesn't explain HOW. Growth doesn't come from percentages — it comes from specific business actions:

- "We'll add 2 new management contracts per quarter through referral partnerships with commercial real estate brokers"
- "The equipment upgrade will reduce maintenance response time from 48 hours to 12 hours, which is our #1 competitive disadvantage vs. ABC Property Management"
- "We'll hire an assistant manager in Month 4 to handle the operational load from the new contracts"

Every growth rate, every cost change, every hire should be traceable to a specific business action that the borrower can describe and execute. If they can't explain where the growth comes from, the projection isn't a plan — it's a wish.

### The Missing Roadmap Problem

The current plan ends with financial tables. There's no:
- 90-day action plan with specific milestones
- Monthly KPI targets derived from the projections
- Risk contingency actions ("If revenue is 15% below plan by Month 6, take these 3 specific actions")
- Milestone timeline showing the sequence of events from loan closing to Year 3

Without these, the plan is something the borrower submits and files away. With them, it's something they use every month.

---

## The God Tier Business Plan Architecture

### Phase A: The Discovery Conversation

Before a single number is drafted, Buddy needs to understand the PERSON and their VISION. This is the missing piece that separates a $500 template from a $20,000 consultant.

**What Buddy must learn:**

1. **The Origin Story** — Why this business? What moment, experience, or insight led to this? For a franchise buyer: why THIS franchise? For an existing business: what was the founding vision?

2. **The Competitive Insight** — What does this person know about their market that most people don't? What have they seen from the inside that gives them an edge? This could be a specific operational insight, a relationship, a geographic advantage, or an underserved customer segment they've identified.

3. **The Customer** — Who specifically buys from them (or will buy from them), and why? Not demographics — the actual human being. "Office managers at mid-size companies who are tired of dealing with unreliable property managers" is infinitely better than "commercial property owners."

4. **The Growth Vision** — How specifically will they grow? Not "we'll grow 8%" — what specific actions will produce growth? New locations? New services? New customers? Referral partnerships? Online marketing?

5. **The Worry** — What keeps them up at night about this business? What's the thing that could go wrong? The best business plans address this directly, and the borrower respects the plan MORE for acknowledging it, not less.

6. **The Personal Stakes** — What does success mean to them personally? Financial independence? Building something to pass to their children? Proving something to themselves? This humanizes the plan in a way that makes the reader root for the borrower.

**How this gets captured:**

This is where Side Buddy / Buddy Voice becomes essential. The discovery conversation is a CONVERSATION, not a form. Buddy asks these questions naturally, the borrower responds in their own words, and those words become the raw material for the narrative. The borrower's actual language — their metaphors, their way of describing their business, their specific vocabulary — should echo through the final plan.

For text-mode: the Chat interview (SBAConversationalInterview) is the right venue, but the questions need to shift from "what's your COGS percentage?" to "tell me about your business."

For voice-mode: the Side Buddy panel with Buddy Voice is the ideal experience. The borrower talks, Buddy listens, and the plan captures their voice.

**Data output:**

The discovery conversation produces a `BorrowerStory` object that is stored alongside (not replacing) the financial assumptions:

```typescript
interface BorrowerStory {
  dealId: string;
  originStory: string;           // In the borrower's own words
  competitiveInsight: string;    // What they know that others don't
  idealCustomer: string;         // Specific customer description
  growthStrategy: string;        // Specific actions that will produce growth
  biggestRisk: string;           // What keeps them up at night
  personalVision: string;        // What success means personally
  voiceCharacteristics: {        // Captured from how they speak/write
    formality: 'casual' | 'professional' | 'technical';
    metaphors: string[];         // Phrases they use naturally
    values: string[];            // What they emphasize repeatedly
  };
  capturedAt: string;
  capturedVia: 'voice' | 'chat' | 'form';
}
```

### Phase B: The Intelligent Draft

This is where the current AI-drafted assumptions system (Phase 3) combines with the BorrowerStory to produce a plan that's both financially rigorous AND narratively compelling.

**The narrative prompts must fundamentally change.** Instead of:

> "Write in third person, professional, factual."

The prompt should be:

> "You are writing a business plan for {borrowerName}. You have spent hours learning about their business and you deeply understand their vision. Write as if you are the world's best business plan consultant who is genuinely invested in this person's success. Use the borrower's own language and insights where appropriate. Every sentence should demonstrate that you understand THIS specific business — a reader should be able to tell within 3 sentences that this plan was not generated from a template."

**The executive summary prompt must demand a HOOK:**

The first sentence of the executive summary should make the reader want to keep reading. Not "Company X operates in the Y sector" — that's a sleep aid. Instead, the prompt should require that the opening sentence contains the borrower's specific competitive insight or their specific market opportunity, drawn from the BorrowerStory.

**Every growth projection must be tied to a specific action:**

The narrative doesn't say "we project 8% growth." It says "we will grow revenue by [specific amount] through [specific action described in the borrower's own words from the discovery conversation]." The growth rate in the financial model is a CONSEQUENCE of the actions described in the narrative, not a standalone input.

### Phase C: The Roadmap Sections

These are the sections that transform the plan from "a document you submit" to "a document you USE." They don't exist in the current system.

**1. Milestone Timeline (Visual)**

A month-by-month timeline for Year 1 showing:
- Loan closing → Equipment delivery → Hire #1 → Service expansion → Revenue target milestones
- Each milestone tied to a specific use-of-proceeds item or growth action
- Clear checkpoints: "By Month 6, we should have X customers/revenue/employees. If we're below Y, activate contingency plan."

In the PDF: rendered as a horizontal timeline graphic, not a table.

**2. KPI Dashboard**

The 5-7 specific metrics this business should track monthly, derived from the financial model:

For a property management company:
- Properties under management (target: X by month Y)
- Revenue per property (target: $X/month)
- Maintenance cost per property (target: $X/month)
- Accounts receivable aging (target: < 30 days)
- DSCR (actual vs. projected)
- Client retention rate (target: 95%+)
- New client acquisition rate (target: X per quarter)

For a restaurant:
- Revenue per seat per day
- Food cost percentage
- Labor cost percentage
- Table turnover rate
- Average check size
- Monthly cash balance vs. projection

These aren't generic — they're derived from the borrower's specific business model and financial assumptions. The system should select the right KPIs for the industry and business type.

In the PDF: rendered as a dashboard graphic with target values and measurement frequency.

**3. Risk Contingency Matrix**

For the top 3-5 risks identified in the sensitivity analysis, provide specific IF/THEN actions:

| Risk | Trigger | Impact | Contingency Action |
|------|---------|--------|-------------------|
| Revenue 15% below plan | Month 6 actual < $X | DSCR drops to X.Xx | 1. Defer assistant manager hire 90 days. 2. Reduce discretionary maintenance to critical-only. 3. Accelerate referral outreach to commercial brokers. |
| Major equipment failure | Unplanned capex > $25K | Monthly cash drops below $X | 1. Draw on equipment maintenance reserve. 2. Negotiate extended payment terms with vendor. 3. Apply for SBA Express line for working capital. |
| Key client loss | Client representing >20% revenue gives notice | Annual revenue loss of $X | 1. Immediately activate new client acquisition plan (target 2 replacements in 90 days). 2. Reduce variable costs proportionally. 3. Review lease commitments for right-sizing options. |

These aren't generic — they reference the borrower's actual financial numbers, their actual clients, and their actual cost structure. The borrower should read this and think "yes, if that happened, that's exactly what I would do."

In the PDF: rendered as a clean matrix with color-coded severity.

### Phase D: The Narrative Voice

The entire plan should read like one consistent voice — the voice of a consultant who deeply understands this specific business. Every section should reference specifics from the borrower's story, their financials, their market research, and their growth plan.

**Cross-section coherence rules:**

- If the executive summary says "growth through referral partnerships with commercial real estate brokers," the marketing section must detail that specific channel
- If the use-of-proceeds says "$150K for equipment upgrade," the operations section must explain what that equipment does and how it reduces costs
- If the SWOT lists "key man risk" as a weakness, the risk contingency matrix must address it
- If the projections show a hire in Month 4, the milestone timeline must show it, the operations section must describe the role, and the KPI dashboard must show the efficiency gain

The current system generates each section independently. A god tier plan reads like one continuous argument where every piece supports every other piece.

### Phase E: The Output

**The PDF is not a report. It's a presentation.**

When the borrower downloads their business plan, it should look like something they paid $20,000 for. Not because of fancy graphics — because of:

- Typographic hierarchy that guides the eye
- Insight callouts that interpret numbers in plain English before every table
- The key metrics dashboard on page 3 that gives the reader the full picture in 10 seconds
- The milestone timeline that shows the plan is ACTIONABLE, not theoretical
- Professional but warm tone throughout — not cold corporate, not casual blog
- The borrower's name and business name on every page header
- A cover page that feels branded and purposeful

---

## What Must Change in the Codebase

This section maps the architectural vision above to the concrete changes required. Not implementation-level detail — that goes in a separate Claude Code spec.

### New Data Model: BorrowerStory

A new table `buddy_borrower_stories` that captures the discovery conversation output. This is NOT part of `buddy_sba_assumptions` — it's a separate concern. The story informs the narrative; the assumptions inform the math. They join at generation time.

### New Discovery Interview

Either a new step in the SBA flow (before assumptions) or an extension of the conversational interview that prioritizes voice/story capture before financial details. The voice schema needs a "discovery" phase with the 6 questions from Phase A.

### Rewritten Narrative Prompts

Every prompt in `sbaPackageNarrative.ts` must be rewritten to:
1. Accept the BorrowerStory as input alongside financial data
2. Use the borrower's own language and insights
3. Demand specificity — no generic prose allowed
4. Require cross-section coherence
5. Produce prose that reads like a human consultant wrote it

### New Narrative Generators

Three new narrative sections that don't exist today:
1. `generateMilestoneTimeline()` — produces a structured milestone array from use-of-proceeds, planned hires, and growth actions
2. `generateKPIDashboard()` — selects industry-appropriate KPIs and sets targets from the financial model
3. `generateRiskContingencyMatrix()` — produces specific IF/THEN actions for the top risks from sensitivity analysis

### New PDF Sections

The renderer must add:
- Milestone timeline (visual, horizontal, Month 1-12)
- KPI dashboard (metrics cards with targets and frequency)
- Risk contingency matrix (color-coded severity table)
- Insight callouts before EVERY financial section (Phase 3 started this — expand it)

### Orchestrator Changes

The generation pipeline must:
1. Load BorrowerStory alongside assumptions
2. Pass story context to ALL narrative generators
3. Enforce cross-section coherence (generate a plan-level "thesis" first, then generate sections that support it)
4. Include the 3 new sections in the output

---

## The Test

Generate a business plan for the Samaritus Management / ChatGPT Fix 15 deal. Compare the current output to the new output. The new output should:

1. Open with a sentence that makes you want to read the next sentence
2. Name the borrower, their city, and their specific competitive insight within the first paragraph
3. Explain specifically HOW the business will grow (not just "8% growth")
4. Include a 12-month milestone timeline with specific checkpoints
5. Include 5-7 KPIs with targets that the borrower can actually track
6. Include at least 3 risk contingencies with specific dollar-denominated triggers and actions
7. Tie every dollar of loan proceeds to a specific business outcome
8. Read like one continuous argument, not a collection of independent sections
9. Be something the borrower would proudly show to their spouse and say "this is my plan"

If the output passes all 9 tests, the system is god tier. If any test fails, iterate until it passes.

---

*This document defines WHAT we're building. Implementation specs with file paths, prompts, and commit steps will follow in a separate document once this vision is confirmed.*
