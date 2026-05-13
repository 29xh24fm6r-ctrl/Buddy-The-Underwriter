# Financial & Tax Expertise in Buddy

**Purpose.** This document is the definitive catalogue of the financial-domain knowledge encoded into Buddy. It exists so that future engineering work — whether human or AI-assisted — starts from the truth of what already exists rather than rebuilding what's there. If you find yourself thinking "we need a validator for X" or "let's add an extractor for Y," check this document first. The answer is more often "it exists, wire it up" than "it needs to be built."

**Scope.** This is the underwriter's mental model of a business, encoded in TypeScript. It spans IRS tax forms, GAAP accounting identities, cash-flow waterfalls, owner-benefit add-backs, quality-of-earnings analysis, industry-calibrated reasonableness, SBA-specific intelligence, and the gate architecture that ties it all together. Updated when new expertise is added or when wiring gaps are closed.

**How to use this document.** Each section names a competency, describes what Buddy knows, points to the files that encode it, and flags known gaps where the expertise exists but isn't wired through. The "Known Wiring Gaps" section at the bottom is the active backlog — it's where institutional-grade infrastructure is sitting idle because some routing or mapping is missing.

---

## 1. Tax Form Ontology

Buddy has a comprehensive canonical fact ontology covering every commercially-relevant US tax form and accounting statement.

**Location.** `src/lib/irsKnowledge/types.ts`, `src/lib/irsKnowledge/formSpecs/`

**Canonical fact keys** (~250 total) cover:

- **Form 1040** (individual income tax return)
- **Form 1065** (partnership return)
- **Form 1120** (C-corporation return)
- **Form 1120S** (S-corporation return)
- **Schedule C** (sole proprietor income/expense detail) — ~30 line items including advertising, auto, contract labor, depletion, employee benefits, insurance, mortgage interest, legal/professional, pension, vehicle rent, repairs, supplies, taxes/licenses, travel, meals, utilities, wages, home office, net profit
- **Schedule E** (supplemental income from rentals, royalties, K-1 passthroughs) including passive vs nonpassive classification
- **Schedule K-1** (both 1065 and 1120S variants) — owner share of ordinary income, rental income, guaranteed payments, capital account begin/end, distributions, interest/dividends/royalties, §179, capital gains
- **Schedule L** (balance sheet per tax return) — cash, AR (gross + allowance), inventory, US gov obligations, tax-exempt securities, PPE gross + accumulated depreciation, intangibles, total assets/liabilities/equity
- **Schedule M-1** (book-to-tax reconciliation) — book income, federal tax book, excess capital loss, depreciation timing difference, amortization timing difference, depletion difference, meals/entertainment, other nondeductible
- **Schedule M-2** (retained earnings analysis) — RE begin, net income books, increases, distributions, decreases, RE end
- **Form 4562** (depreciation & amortization) — §179 total, bonus depreciation, MACRS total, ACRS total, listed property, amortization total
- **Form 1125-A** (COGS detail) — beginning inventory, purchases, direct labor, §263A costs, other costs, total before closing, ending inventory, computed COGS, inventory method, LIFO election flag
- **Form 1125-E** (officer compensation) — per-officer name, SSN last-4, time percent, common/preferred stock percent, individual compensation, total compensation
- **Form 8825** (partnership/S-corp rental real estate) — per-property: description, kind, fair rental days, personal use days, gross rents, full expense breakdown (advertising, auto/travel, cleaning, commissions, insurance, legal/professional, management fees, mortgage interest, repairs, taxes, utilities, depreciation), net income; plus aggregate totals
- **W-2** — wages, federal tax withheld, SS wages/tax, Medicare wages/tax, dependent care, NQDC, Box 12 detail, checkboxes, employer/employee info
- **1099 variants** — 1099-NEC (nonemployee comp), 1099-MISC (rents, royalties, other income, medical), 1099-INT (interest, US savings, tax-exempt), 1099-DIV (ordinary, qualified, capital gain), 1099-R (gross distribution, taxable, distribution code), SSA-1099 (net benefits)
- **GAAP statements** — accounting basis flag, full income statement, full balance sheet, fixed assets gross/accumulated depreciation/net, intangibles net, all current/noncurrent asset and liability categories, common stock, paid-in capital, retained earnings, partners' capital
- **Quality of Earnings** — reported EBITDA, adjusted EBITDA, total adjustment, confidence
- **9-step cash flow waterfall** — see §6 below
- **7-category owner benefit add-backs** — see §6 below
- **Consolidation keys** — multi-entity revenue/COGS/gross profit/EBITDA/balance sheet/debt service, intercompany elimination totals (revenue, expense, loans), entity count, consolidation method, consolidation confidence, global cash flow, global debt service, global DSCR

**Form specifications** (`src/lib/irsKnowledge/formSpecs/`) define for each form:

- Field-level metadata: canonical key, line numbers (varying by tax year), label, label variants across tax software (ProConnect, UltraTax, Lacerte, Drake), required-for-validation flag, null-as-zero handling, EBITDA add-back classification, notes
- Identity checks (mathematical accounting identities the form must satisfy)
- EBITDA add-back keys for that form type
- Known tax software variants that produce this form

Form specs currently shipped: `form1040.ts`, `form1065.ts`, `form1120.ts` (includes 1120S), `scheduleC.ts`, `scheduleE.ts`.

**Why this matters.** When extraction produces a fact, the form spec tells the system what that fact should look like, where on the form it came from, and how it relates to other facts. The 1120-line-12 → `OFFICER_COMPENSATION` mapping is what lets Buddy reconcile officer comp on page 1 against Form 1125-E. The label-variants list is what lets Buddy handle "Officer compensation" / "Officer salaries" / "Compensation of officers" as the same concept regardless of which tax software produced the return.

---

## 2. GAAP & IRS Accounting Identities

Buddy enforces mathematical identity checks on every classified tax return. These are the equations that must hold for the document to be internally consistent.

**Location.** `src/lib/irsKnowledge/identityValidator.ts`, identity check arrays in each form spec.

**Example identity checks shipped:**

- **Form 1120**:
  - `Gross Receipts − COGS = Gross Profit` (lines 1c, 2, 3, tolerance $1)
  - `Total Income − Total Deductions = Taxable Income` (lines 11, 28, 30, tolerance $1)
  - `Total Assets = Total Liabilities + Total Equity` (Schedule L, tolerance $1)
- **Form 1120S** adds:
  - `Total Income − Total Deductions = Ordinary Business Income` (lines 6, 20, 21, tolerance $1)
- **Form 1065, Form 1040, Schedule C, Schedule E** each have their own identity sets

**Result types.** Each check returns:

- `VERIFIED` — identity holds within tolerance
- `FLAGGED` — required check failed, analyst review required (some checks passed)
- `PARTIAL` — required facts missing, can't verify
- `BLOCKED` — required check(s) failed and nothing else passed, spread generation prohibited

**Spread-generation gating.** The `isSpreadGenerationAllowed()` function in `identityValidator.ts` reads the validation results and decides whether downstream spread generation may proceed:

- `VERIFIED` → allow
- `PARTIAL` → allow with warning
- `FLAGGED` → allow with analyst sign-off requirement
- `BLOCKED` → do not allow

**Why this matters.** This is the math-must-prove-itself layer. A real underwriter does these checks mentally on every return: "does line 1c minus line 2 equal line 3?" Buddy does them mechanically, with audit-grade citation back to the form line. SR 11-7 compliance lives here.

---

## 3. Cross-Document Corroboration

Beyond intra-document identity checks, Buddy cross-references key facts against secondary sources within the same deal's document set.

**Location.** `src/lib/irsKnowledge/corroborationEngine.ts`

**Checks shipped:**

- **Form 1065**:
  - Page 1 gross receipts vs Schedule K aggregated
  - Page 1 OBI vs sum of K-1 ordinary income
  - Page 1 depreciation vs Form 4562 total
  - Schedule L total assets vs reported balance sheet
- **Form 1120 / 1120S**:
  - Schedule L total assets vs balance sheet
  - Page 1 officer compensation vs Form 1125-E total

**Behavior.** Agreement within $1 = PASSED. Disagreement returns both values with a delta. Missing secondary source = SKIPPED (not a failure).

**Why this matters.** A senior underwriter doesn't trust a single number on a single page — they cross-check. If page 1 says officer comp is $310K but Form 1125-E adds up to $325K, something's wrong: either the borrower's accountant made an error, or there's an undisclosed officer, or the borrower is presenting different numbers to different audiences. Buddy catches these silently and routes them to FLAGGED for analyst attention.

---

## 4. Industry-Calibrated Reasonableness

Buddy knows what "normal" looks like by industry, and flags values outside those bands.

**Location.** `src/lib/irsKnowledge/reasonablenessEngine.ts`, `src/lib/industryIntelligence/profiles/`

**Severity tiers:**

- `IMPOSSIBLE` — hard failure. The value violates basic accounting (COGS > revenue, negative total assets, gross margin > 100%, income without revenue).
- `ANOMALOUS` — soft warning. The value is unusual enough to warrant a second look.

**Universal checks (apply to every form):**

- `COGS_EXCEEDS_REVENUE` — IMPOSSIBLE
- `NEGATIVE_TOTAL_ASSETS` — IMPOSSIBLE
- `GROSS_MARGIN_OVER_100` — IMPOSSIBLE
- `INCOME_WITHOUT_REVENUE` (OBI > 0 but gross receipts = 0) — IMPOSSIBLE
- `REVENUE_CHANGE_EXTREME` (|YoY change| > 50%) — ANOMALOUS
- `DEPRECIATION_IMPLAUSIBLE` (depreciation > 50% of gross fixed assets) — ANOMALOUS
- `OFFICER_COMP_EXTREME` (outside industry-calibrated range) — ANOMALOUS
- `INTEREST_IMPLAUSIBLE` (interest expense > 20% of long-term debt) — ANOMALOUS

**Industry profiles shipped** (`src/lib/industryIntelligence/profiles/`):

- `restaurant.ts` — food cost > 42% of revenue, labor > 35% of revenue, prime cost (food + labor) > 70% of revenue (the threshold above which most independent restaurants fail)
- `maritime.ts` — gross margin < 35% is low; flag if COGS present but no separate interest line (maritime often embeds interest in COGS)
- `construction.ts` — gross margin < 12% is concerning
- `medical.ts` — accounts receivable > 1/3 of revenue (collection problems), officer compensation > 65% of revenue (extreme even for professional services)
- `realEstate.ts` — interest expense > 40% of (OBI + interest) (over-leveraged)
- `professionalServices.ts` — DSO > 90 days (billing dysfunction)
- `retail.ts` — inventory > COGS / 4 (stale stock)
- `default.ts` — generic profile when industry can't be determined

Each profile carries red flags with descriptions and threshold logic. The reasonableness engine reads the profile and applies industry-specific checks alongside the universal ones.

**Why this matters.** Restaurants and professional services have radically different financial signatures. Treating them with the same thresholds either misses real problems (a 30% gross margin is concerning for a restaurant, fine for a contractor) or generates noise (90-day DSO is normal for professional services, alarming for a restaurant). Industry calibration is what separates a generic OCR pipeline from an underwriter that knows what business it's looking at.

---

## 5. Document Trust Hierarchy

When the same fact appears across multiple documents (a recurring situation — tax returns include Schedule L, the borrower also provides a CPA-compiled balance sheet, the bank pulled K-1s separately), Buddy decides which one wins.

**Location.** `DOCUMENT_TRUST_LEVEL` in `src/lib/irsKnowledge/types.ts`

**Hierarchy (higher number = higher trust):**

| Source | Trust Level |
|---|---|
| Audited Financials | 100 |
| Reviewed Financials | 80 |
| Form 1120 / 1120S / 1065 | 70 |
| Form 1040 / Schedule C / E / F | 65 |
| Compiled Financials | 60 |
| Schedule K-1 (1065 / 1120S) | 55 |
| Schedule L / M-1 / M-2, Form 1125-A / 4562 / 8825 | 50 |
| Interim Financials | 40 |
| Bank Statements | 30 |

**Why this matters.** This encodes how a real underwriter thinks: "The audited 10-K says $5M revenue, the tax return says $4.8M — go with audited because a CPA put their license on it, and ask the borrower about the delta." Bank statements are evidence but not authority. K-1s are derived from the partnership return, not vice versa. Internal interim financials are management estimates, not signed-off statements. Without a trust hierarchy, conflicting numbers would either silently overwrite each other or require manual resolution every time.

---

## 6. Cash Flow Waterfall

Buddy implements the institutional 9-step cash-flow waterfall: from reported net income all the way to debt service coverage ratio.

**Location.** `src/lib/spreads/cashFlowWaterfall.ts`

**The 9 steps:**

1. **Net Income Base** — `CF_NET_INCOME_BASE`
2. **Non-Cash Addbacks** — depreciation + amortization + **§179 normalized over useful life** + **bonus depreciation normalized over useful life** — `CF_NONCASH_ADDBACKS`
3. **Interest Addback** — interest expense — `CF_INTEREST_ADDBACK`
4. **EBITDA (Reported)** — sum of steps 1–3 — `CF_EBITDA_REPORTED`
5. **QoE Adjustment** — non-recurring expenses added back, non-recurring income deducted — `CF_QOE_ADJUSTMENT`
6. **EBITDA (Adjusted)** — `CF_EBITDA_ADJUSTED`
7. **Owner Benefit Addbacks** — 7-category total (see below) — `CF_OWNER_BENEFIT_ADDBACKS`
8. **EBITDA (Owner-Adjusted)** — `CF_EBITDA_OWNER_ADJUSTED`
9. **Tax Provision Normalized** — **zero for pass-through entities, normalized provision for C-corps** — `CF_TAX_PROVISION_NORMALIZED`
10. **Maintenance CapEx** — `CF_MAINTENANCE_CAPEX`
11. **NCADS** — Net Cash Available for Debt Service — `CF_NCADS`
12. **Annual Debt Service** — `CF_ANNUAL_DEBT_SERVICE`
13. **CAADS** — Cash After Debt Service — `CF_CAADS`
14. **DSCR Final** — `RATIO_DSCR_FINAL`

**Notable correctness details:**

- **§179 and bonus depreciation are normalized, not fully added back.** §179 is an accelerated CapEx deduction, not a true non-cash expense. Treating it as a full addback (like depreciation) overstates EBITDA. Buddy normalizes it over the asset's useful life. This is institutional-grade thinking — a weak pipeline would just add §179 back like depreciation.
- **Pass-through tax provision is explicitly zero.** Pass-throughs (LLCs, partnerships, S-corps) don't pay entity-level federal income tax; the owners do via K-1 flow-through. Buddy's waterfall correctly suppresses the tax provision step for these entities (`input.isPassThrough ? 0 : normalizedTaxProvision`).
- **Null-safe arithmetic throughout.** The helpers `sumNullable`, `addNullable`, `subtractNullable`, `subtractAllNullable` propagate null correctly so missing data doesn't silently become zero in a calculation chain.

---

## 7. Owner Benefit Add-Backs (7 Categories)

For closely-held businesses, owner-benefit normalization is the difference between reported EBITDA and true seller's discretionary earnings (SDE). Buddy systematically identifies and quantifies 7 categories.

**Location.** `src/lib/spreads/ownerBenefitAddbacks.ts`

**The 7 categories:**

1. **Excess Compensation** (`ADDBACK_EXCESS_COMPENSATION`) — owner comp above market rate. Source: Form 1125-E or W-2.
2. **Auto / Vehicle Personal Use** (`ADDBACK_AUTO_PERSONAL_USE`) — personal portion of auto expense. **Default business-use assumption: 65%** (IRS-typical) if no mileage log provided. Source: Schedule C Line 9 / Form 4562. Adds documentation gap when default is used.
3. **Home Office & Cell Phone** (`ADDBACK_HOME_OFFICE`, `ADDBACK_CELL_PHONE`) — owner's home office, cell phone on business. Source: Schedule C Line 30 / operating expenses.
4. **Family Member Salaries** (`ADDBACK_FAMILY_COMPENSATION`) — family comp above market rate. Always requires documentation (no defaults). Source: W-2 / payroll records.
5. **Owner-Paid Insurance** (`ADDBACK_OWNER_INSURANCE`) — life, health, disability insurance for owner. Source: Schedule 1 / S-Corp shareholder benefits.
6. **Related-Party Rent Normalization** (`ADDBACK_RENT_NORMALIZATION`) — adjusts for above-market or below-market rent paid to related parties. **Below-market rent is correctly treated as a negative add-back (increases expense).** Source: lease agreement, rent comps.
7. **Travel, Meals, Entertainment** (`ADDBACK_PERSONAL_TRAVEL_MEALS`) — personal portion. **Default personal-use assumption: 50%** if no breakdown provided. Source: operating expenses / Schedule C.

**Output.** Each addback carries: amount, category, canonical key, description, source citation, documentation-required flag. The summary returns the items, total addbacks, adjusted EBITDA, and a list of documentation gaps that should be discussed with the borrower.

**Why this matters.** Closely-held SBA borrowers routinely take their economic value out as a mix of W-2 wages, distributions, and lifestyle expenses run through the business. A pure tax-return EBITDA understates their true earning power by 15–40%. The 7-category model is the analytical framework an experienced business broker or transaction advisor uses for SDE / Seller's Discretionary Earnings. The `documentationRequired` flag and `documentationGaps` list become the conversation with the borrower: "We're assuming 65% business auto use — is there a mileage log we should use instead?"

---

## 8. Quality of Earnings (QoE) Engine

The QoE engine separates recurring from non-recurring earnings — the same exercise a Big-4 transaction-advisory team performs in due diligence.

**Location.** `src/lib/spreads/qoeEngine.ts`

**Non-recurring income detection (16 patterns):**

- PPP / Paycheck Protection
- EIDL
- SBA grant
- Insurance proceeds (requires documentation)
- Business interruption (requires documentation)
- Gain on sale / disposal
- Casualty gain
- Litigation / settlement proceeds (requires documentation)
- Tax refund
- Debt forgiveness / "forgiven"
- ERC / Employee Retention Credit

**Non-recurring expense detection (9 patterns):**

- Disaster loss / fire / flood (requires documentation)
- Severance / restructuring (requires documentation)
- Moving / relocation
- Start-up / pre-opening costs

**Year-over-year anomaly detection:**

- Bad debt > 2x prior year → flag as non-recurring (requires documentation)
- Legal fees > 1.5x prior year → flag as non-recurring (requires documentation)

**Materiality threshold:**

- Any "other income" or "other expense" line item > 5% of revenue triggers a documentation requirement, even if it doesn't match a known pattern. Catches "miscellaneous" buckets that hide non-recurring items.

**Confidence scoring:**

- `high` — no adjustments
- `medium` — adjustments exist but all are auto-approved
- `low` — material non-recurring (> 20% of reported EBITDA) requires deeper review

**Why this matters.** The 2020–2022 tax returns of nearly every US small business contain PPP forgiveness, EIDL grants, and ERC credits. A naïve EBITDA calculation that doesn't strip these out will project forward income that simply isn't there. Getting QoE wrong is the single most common way underwriting goes badly on COVID-era deals. Buddy handles this systematically rather than by accident.

---

## 9. SBA-Specific Intelligence

Buddy has a substantial body of SBA-specific knowledge spanning eligibility, SOP citations, NAICS benchmarking, eTran readiness, package generation, and borrower-facing deliverables.

**Location.** `src/lib/sba/` (33 files), `src/lib/sbaKnowledge/`, `src/lib/sba7a/`, `src/lib/sbaForms/`, `src/lib/sbaPreflight/`

**Key competencies:**

- **Eligibility engine** (`sba/eligibilityEngine.ts`, `sba/eligibility.ts`) — evaluates SBA eligibility against SOP rules
- **SOP citations** (`sbaKnowledge/sopReferences.ts`) — citations to SOP 50 10 7.1 sections (Subpart B Chapter 2/4/5, Subpart A Chapter 3) for federal debt delinquency, ineligible businesses, criminal history, missing required docs, business name mismatch, 504 owner-occupancy, 504 investment property ineligibility
- **NAICS-benchmarked assumption validation** (`sba/sbaAssumptionBenchmarks.ts`) — **25 of the most common SBA NAICS codes** with industry-median benchmarks for revenue growth, COGS percent, DSO, DPO, fixed-cost escalation. Each with a "max acceptable" threshold above which the system raises a concern. Industries covered include full-service restaurants, limited-service restaurants, snack/beverage bars, commercial building construction, new single-family housing, residential remodelers, plumbing/HVAC contractors, site preparation, custom programming, engineering services, real estate brokerage, physician offices, dentist offices, insurance agencies, landscaping, temp help, automotive repair, barber shops, florists, family clothing stores, medical equipment wholesalers, fitness centers, supermarkets, investment advice, truck/RV rental.
- **Assumption coach + drafter + validator + bootstrap + prefill** (`sbaAssumptionCoach.ts`, `sbaAssumptionDrafter.ts` ~25KB, `sbaAssumptionsValidator.ts`, `sbaAssumptionsBootstrap.ts`, `sbaAssumptionsPrefill.ts`) — the layer that helps borrowers articulate growth assumptions and validates them against industry norms
- **Forward model builder** (`sbaForwardModelBuilder.ts`, ~12KB) — projects revenue, costs, cash flow forward based on validated assumptions
- **Balance sheet projector** (`sbaBalanceSheetProjector.ts`) — projects pro-forma balance sheet through loan term
- **Sources & Uses** (`sbaSourcesAndUses.ts`) — sources and uses of funds table
- **Risk profile** (`sbaRiskProfile.ts`, ~10KB) — risk factor identification and scoring
- **eTran readiness** (`sbaEtranReadiness.ts`, ~20KB) — pre-submission readiness scoring against eTran requirements
- **Global cash flow** (`sbaGlobalCashFlow.ts`) — borrower-level GCF rollup across operating entities and personal cash flow
- **Personal guarantee analysis** (`sbaGuarantee.ts`)
- **Difficulty assessment** (`sba/difficulty.ts`) — deal difficulty classification
- **New business protocol** (`sba/newBusinessProtocol.ts`) — special handling for startups vs operating businesses
- **Borrower-facing deliverables**:
  - **Business plan roadmap** (`sbaBusinessPlanRoadmap.ts`, ~17KB) — roadmap for the borrower's business plan deliverable
  - **Concept explainer** (`sbaConceptExplainer.ts`, ~11KB) — explains SBA concepts in plain language to borrowers
  - **Borrower story narrative** (`sbaBorrowerStory.ts`)
  - **Borrower PDF renderer** (`sbaBorrowerPDFRenderer.ts`, ~36KB) — generates the polished borrower-facing PDF; this is the "feels like a $20K consultant" output layer
  - **Actionable roadmap** (`sbaActionableRoadmap.ts`) — concrete next steps for the borrower
- **Lender-facing deliverables**:
  - **Package orchestrator** (`sbaPackageOrchestrator.ts`, ~31KB) — coordinates the full SBA package generation
  - **Package renderer** (`sbaPackageRenderer.ts`, ~50KB) — renders the final lender-facing package
  - **Package narrative** (`sbaPackageNarrative.ts`, ~34KB) — generates the narrative sections of the credit memo
  - **Form cross-fill** (`sbaFormCrossFill.ts`) — pre-fills SBA forms (1919, 413, 912, 159, 2483, 2484, 3506) from already-extracted data
  - **Committee + God-mode committee** (`committee.ts`, `committeeGodMode.ts`) — credit committee package generation
- **Research projection** (`sbaResearchExtractor.ts`, `sbaResearchProjectionGenerator.ts` ~19KB) — research-driven revenue projections

**SBA evaluator entry point.** `sba/evaluateSba.ts` is the top-level orchestrator that brings these pieces together for a given deal.

---

## 10. Document Classification (3-Tier Pipeline)

Buddy uses a deterministic-first, escalating-confidence classification pipeline to identify what kind of document it's looking at.

**Location.** `src/lib/classification/`

**Tier 1 — Anchor Engine** (`tier1Anchors.ts`)

- Hard regex matches against form headers and titles
- Confidence 0.90–0.99
- If matched, classification is LOCKED — Tier 2 and Tier 3 cannot override
- Form anchors shipped: 1040, 1040-SR, 1120, 1120S, 1065, Schedule K-1, W-2, 1099, Form 4506-C/T (transcript request), Form 8821 / 2848 (tax authorization), SBA Forms 1919 / 413 / 912 / 159 / 2483 / 2484 / 3506, ACORD insurance certificates, articles of incorporation, certificate of formation
- Structural anchors (require multiple signals): personal financial statement, credit memo, commercial lease, balance sheet, income statement, bank statement
- Returns: docType, confidence, anchor ID, form numbers, tax year, entity type (business / personal)

**Tier 2 — Structural** (`tier2Structural.ts`)

- Layout-based and multi-signal pattern matching when Tier 1 doesn't match
- Lower confidence than Tier 1

**Tier 3 — LLM** (`tier3LLM.ts`)

- LLM-based classification as final fallback
- Confusion candidates (`confusionExamples.json`) help the LLM disambiguate similar document types
- Returns entity name, period start/end, issuer, tax year

**Confidence gate** (`confidenceGate.ts`) decides whether each tier's result is accepted or escalated to the next tier.

**Calibration** (`calibrateConfidence.ts`) — confidence score adjustments based on observed accuracy.

**Spine result** (`classifyDocumentSpine.ts`) — the top-level orchestrator that runs the 3 tiers in sequence and returns a `SpineClassificationResult` with full provenance (which tier matched, what evidence, confidence, confusion candidates).

---

## 11. Extraction Pipeline

Buddy has a hybrid extraction pipeline with multiple deterministic extractors plus a Gemini fallback, gated by a four-stage validator with a self-correcting retry loop.

**Location.** `src/lib/extraction/`, `src/lib/extract/`

**Extractors (deterministic-first):**

- `taxReturnExtractor` — handles 1040, 1065, 1120, 1120S
- `personalIncomeExtractor` — handles personal income artifacts (W-2, 1099 variants, Schedule E)
- `incomeStatementExtractor` — handles GAAP income statements
- `balanceSheetExtractor` — handles GAAP balance sheets
- `arAgingTableExtractor` (`extraction/arAgingTableExtractor.ts`, ~15KB) — handles AR aging reports
- `extractFactsFromDocument` (`extraction/index.ts`) — Gemini-primary fallback when deterministic extractors don't match

**Re-extraction orchestrator** (`extraction/reExtractionOrchestrator.ts`, ~11KB) — runs all four gates and retries up to 3 attempts before routing to the exception queue. See §12.

**Post-extraction validator** (`extraction/postExtractionValidator.ts`) — entry point that maps canonical doc type → IRS form type, runs validation, persists results, emits ledger events, and gates spread generation.

**Supporting infrastructure:**

- `geminiFlashPrompts.ts` (~17KB) — prompts library for Gemini extraction
- `geminiFlashStructuredAssist.ts` (~11KB) — Gemini structured output coordination
- `outputCanonicalization.ts` — normalizes extractor output to canonical fact keys
- `entityConflictGuard.ts` — guards against attribution conflicts (which entity does this fact belong to)
- `evidence.ts` — extraction evidence trail
- `failureCodes.ts` — structured extraction failure taxonomy
- `runRecord.ts` (~10KB) — extraction run audit log
- `shadowMode.ts` — shadow-mode extraction for A/B testing extractor changes
- `ledgerContract.ts` — extraction → ledger event contract
- `researchBridge.ts` — bridge to research/intelligence layer
- `detectMachineReadabilitySignals.ts` — detects whether a PDF is machine-readable or needs OCR

---

## 12. The Four-Gate Validation Architecture

Every classified tax return runs through four sequential gates before its facts are accepted as canonical.

**Location.** `src/lib/extraction/reExtractionOrchestrator.ts`, `src/lib/irsKnowledge/`

**Gate 1 — Identity Checks** (`identityValidator.ts`)

- Mathematical accounting identities per form spec (see §2)
- Status: VERIFIED / FLAGGED / PARTIAL / BLOCKED

**Gate 2 — Cross-Document Corroboration** (`corroborationEngine.ts`)

- Page 1 vs Form 1125-E officer comp
- Page 1 vs Form 4562 depreciation
- Schedule L vs reported balance sheet
- Page 1 OBI vs sum of K-1s

**Gate 3 — Industry-Calibrated Reasonableness** (`reasonablenessEngine.ts`)

- IMPOSSIBLE failures (COGS > revenue, etc.)
- ANOMALOUS warnings (officer comp out of range, etc.)
- Industry-specific red flags (per `industryIntelligence/profiles/`)

**Gate 4 — Confidence Aggregation** (`confidenceAggregator.ts`)

- Per-field confidence scores from extraction
- Aggregated against gates 1–3 results
- Status: AUTO_VERIFIED / FLAGGED / BLOCKED

**The retry loop:**

- Attempt 1: run all four gates on existing facts
- Attempt 2–3: re-extraction with adjusted prompts/parameters (placeholder logic currently — full re-extraction engine wired in future spec)
- After max attempts: route to `deal_extraction_exceptions` queue with an audit certificate

**Audit certificate** (`auditCertificate.ts`) — for every gate run, a certificate is generated and persisted to `deal_document_validation_results`. Carries: form type, tax year, status, check results, passed/failed/skipped counts, extraction attempt number, overall status, summary. This is the SR 11-7 paper trail.

**Ledger events** — every gate transition emits an event to the buddy ledger:
- `extraction.identity_validation_complete`
- `extraction.gate_failed`
- `extraction.re_extraction_triggered`
- `extraction.routed_to_exception_queue`

**Aegis findings** — FLAGGED and BLOCKED results are written to `buddy_system_events` as `error_class: "EXTRACTION_ACCURACY"` for analyst attention.

---

## 13. Financial Validation Layer (Exception Surfacing)

Once gates produce validation results, the financial-validation layer surfaces exceptions to the committee and the analyst.

**Location.** `src/lib/financialValidation/`

**Files:**

- `buildCommitteeFinancialValidationSummary.ts` — committee-facing summary of all validation results across a deal
- `buildExceptionNarrative.ts` — generates natural-language narrative for each validation exception
- `buildFinancialExceptions.ts` — builds the exception list for analyst review
- `buildOverrideInsights.ts` — when an analyst overrides a validation result, captures and structures the override rationale
- `exception-types.ts` — exception taxonomy
- `packetPreflight.ts` — pre-submission validation of the full underwriting packet
- `scoreFinancialException.ts` — severity scoring for individual exceptions

---

## 14. Financial Intelligence Layer (Slate-Aware Engines)

The slate-aware financial intelligence engines that consume canonical facts and compute underwriting metrics under different methodology slates.

**Location.** `src/lib/financialIntelligence/`

**Files:**

- `ebitdaEngine.ts` — slate-aware EBITDA computation (B4.1.1)
- `officerCompEngine.ts` — slate-aware officer comp analysis with NORMAL / EXTREME_HIGH / EXTREME_LOW / INSUFFICIENT_DATA flagging
- `scheduleM1Engine.ts` — Schedule M-1 book-tax reconciliation analysis
- `computeGlobalCashFlow.ts` — global cash flow computation across all deal entities (~9KB)
- `globalCashFlowBuilder.ts` — GCF builder
- `persistGlobalCashFlow.ts` — GCF persistence with methodology provenance (~12KB)
- `dscrReconciliation.ts` — DSCR reconciliation across methods (~8KB)
- `spreadCompletenessScore.ts` — scores how complete a spread is (~12KB)

These engines are pure functions — no DB, no server imports — and are consumed by the canonical chain writers (`src/lib/financialFacts/`) and by the picker projection (`src/lib/methodology/projectDscrForVariant.ts`).

---

## 15. Methodology Layer (SR 11-7 Compliance)

The methodology layer makes underwriting choices explicit, defensible, and auditable. Each axis represents a defensible underwriting choice with multiple variants; bankers pick a variant per axis, and Buddy carries methodology provenance through every fact it writes.

**Location.** `src/lib/methodology/`

**Five axes shipped:**

1. **NCADS Source** — `standard` (EBITDA → OBI → NI fallback) / `conservative` (NI only) / `tax_return_basis` (OBI only)
2. **EBITDA Add-Back Stack** — `standard` (all extracted) / `conservative` (D&A + interest only) / `aggressive` (standard + officer comp normalization)
3. **Officer Compensation** — `standard` (10% baseline, 40% threshold) / `conservative` (15% baseline) / `no_normalization`
4. **Affiliate Ownership** — `standard` (assume 100% if unknown) / `conservative` (assume 0%, 50% floor) / `documented_only`
5. **Living Expense** — `standard` (stated obligations) / `sba_sop_minimum` (IRS National Standards floor) / `buffered` (stated × 1.10)

Each variant carries: id, label, description, rationale, conservatism rank.

**Build Principles** (encoded in the methodology layer):

- **#17**: When two surfaces compute the same value via different paths, extract the policy as a pure helper both surfaces import. The METHODOLOGY_AXES registry is the source-of-truth contract; the helper is the single implementation. Replicating the same conditional in two places is a violation regardless of how careful the second copy is. *Precedent: `applyOfficerCompFoldIn.ts`.*

**Why this matters.** Bank examiners under SR 11-7 require that model decisions be explicit, defensible, and reproducible. A spread that says "DSCR = 1.25" is unfalsifiable. A spread that says "DSCR = 1.25 under NCADS=standard / EBITDA=conservative / Officer Comp=standard / Affiliate=conservative / Living Expense=SBA SOP, with alternatives considered and rejected for reasons X/Y/Z" is auditable.

---

## 16. Canonical Facts Pipeline

The persistence layer that ties everything together.

**Location.** `src/lib/financialFacts/`

**Pipeline stages:**

1. **Extraction** → writes facts to `deal_financial_facts` with `source_type: "DOC_EXTRACT"`
2. **Backfill from spreads** (`backfillCanonicalFactsFromSpreads`)
3. **Slate-aware business EBITDA computation** (`computeBusinessEbitdaFacts`, B4.1.2) — per-OPCO EBITDA with Axis 2 methodology provenance; B4.1.4 adds conditional officer-comp fold-in
4. **Slate-aware officer comp analysis** (`analyzeOfficerCompFacts`, B4.1.2) — per-OPCO officer comp with Axis 3 methodology provenance
5. **Cash flow aggregator** (`runCashFlowAggregator`) — reads NCADS, computes DSCR with Axis 1 methodology provenance
6. **Total debt service** (`computeTotalDebtService`)
7. **Global cash flow persistence** (`persistGlobalCashFlow`) — Axes 4 + 5 applied here
8. **GCF computed facts** (`persistGcfComputedFacts`)

Each fact carries:
- `provenance.source_type` (DOC_EXTRACT, STRUCTURAL, etc.)
- `provenance.source_ref` (which writer wrote it)
- `provenance.extractor` (canonical name and version)
- `provenance.calc` (human-readable calculation string)
- `provenance.methodology` (array of `MethodologyProvenance` entries, one per axis that influenced this value)

The methodology provenance carries: axis, chosen variant, alternatives considered, rationale, slate hash, is-default flag.

---

## Known Wiring Gaps

The following gaps exist where institutional-grade expertise is built but not fully wired. These are the active backlog for closing the loop.

### Gap 1 — Classifier output → IRS form mapping

**Symptom.** Business tax returns get classified as the generic `BUSINESS_TAX_RETURN` rather than as `FORM_1120` / `FORM_1120S` / `FORM_1065`. The validator's `DOC_TYPE_TO_IRS_FORM` mapping in `postExtractionValidator.ts` doesn't handle `BUSINESS_TAX_RETURN`, so the validator returns `SKIPPED` and the four gates never fire on the documents that need them most.

**Evidence.** OmniCare deal has 3 business tax returns, all `canonical_type = "BUSINESS_TAX_RETURN"`, with zero rows in `deal_document_validation_results` and zero rows in `deal_extraction_exceptions`. Garbage facts (`WAGES_W2 = 3`, `F4562_BONUS_DEPRECIATION = 11`, `F1125E_COMPENSATION = 100`) persist without being caught.

**Fix.** Either sub-classify at the classifier level using already-detected `formNumbers` from Tier 1 anchors, or add a runtime sub-classifier in `postExtractionValidator.ts` that routes generic `BUSINESS_TAX_RETURN` to the correct form spec.

**Spec.** SPEC-EXTRACT-CLASSIFIER-1 (to be drafted).

### Gap 2 — Multi-OPCO fact scoping

**Symptom.** `computeBusinessEbitdaFacts` and `analyzeOfficerCompFacts` read deal-scoped facts for each OPCO entity. For single-OPCO deals (current universe) this is correct. For multi-OPCO deals it would produce duplicate EBITDA writes from shared input facts, and the aggregator would double-count NCADS.

**Evidence.** Zero multi-OPCO deals in dev as of B4.1.2 merge.

**Fix.** Per-entity fact scoping at extraction time, OR writer-level single-OPCO fallback with explicit warning on multi-OPCO.

### Gap 3 — Post-save methodology preview refresh

**Symptom.** After a banker saves a methodology choice, the picker's preview state stays pointed at the pre-save slate until page refresh. Cosmetic only; data correctness is fine.

**Fix.** 3-line addition: refetch preview in `saveAxis` success path, or add `props.slate` to the useEffect dep array.

### Gap 4 — Per-tenant methodology packs

**Status.** Built infrastructure (methodology axes registry, slate loading, provenance) supports per-tenant overrides via `bank_policy_packs.rules_json.methodology`, but the override-application code path isn't wired yet. Default slate applies to every deal regardless of bank.

**Fix.** Implement per-tenant slate resolution in `loadDealMethodology`.

### Gap 5 — Household-size lookup for SBA SOP living expense floor

**Status.** Axis 5 (living expense) variant `sba_sop_minimum` references IRS National Standards by household size, but the household-size lookup isn't yet implemented in `persistGlobalCashFlow`.

**Fix.** Implement household-size resolver from borrower / guarantor data, apply IRS National Standards floor.

---

## How to Extend This System

When adding a new piece of financial expertise:

1. **Check this document first.** If the competency exists, the work is wiring (probably one of the gaps above), not building.
2. **Add the canonical fact keys** to `src/lib/irsKnowledge/types.ts`. Use the existing naming conventions (form-prefixed keys like `F1125E_*`, statement-prefixed like `SL_*`, etc.).
3. **Add the form specification** if it's a new IRS form. Use `src/lib/irsKnowledge/formSpecs/form1120.ts` as the template.
4. **Add identity checks** to the form spec. Every form should have at least 2–3 mathematical identities that must hold.
5. **Add corroboration checks** to `src/lib/irsKnowledge/corroborationEngine.ts` if there's a secondary source on the same deal.
6. **Add reasonableness checks** to `src/lib/irsKnowledge/reasonablenessEngine.ts` for IMPOSSIBLE values; add to industry profiles for ANOMALOUS values that are industry-specific.
7. **Update document trust hierarchy** in `src/lib/irsKnowledge/types.ts` if the new document type has a trust level different from existing tiers.
8. **Update this document.** When new expertise lands, add it here so the next person (or AI) reading the codebase doesn't reinvent it.

---

## Architectural Principles

A few principles that hold across all the financial-domain work:

- **Engines are pure functions.** No DB, no server-only, no side effects. They take facts in, return analysis out. This makes them composable, testable, and reusable across the canonical writer (for persistence) and the picker projection (for preview).
- **Canonical facts are the contract.** Every piece of financial data passes through `deal_financial_facts` with explicit provenance. Downstream consumers (memo, PDF, committee package, picker, advisor) read canonical facts, not raw extractions.
- **Methodology is explicit.** No silent defaults. Every methodology decision carries axis, variant, rationale, alternatives considered, slate hash. SR 11-7 audit trail is structural, not retrofitted.
- **Gates are gates.** A document that fails identity checks does not generate a spread. Period. The four-gate architecture means bad data has to be explicitly waived by an analyst, not silently propagated.
- **Industry calibration beats universal thresholds.** A 30% gross margin is concerning for a restaurant and fine for a contractor. The industry-intelligence profiles encode this; reasonableness checks apply the right thresholds.
- **Trust hierarchies, not coin flips.** When sources disagree, the higher-trust source wins. Audited > Reviewed > Tax Return > Compiled > K-1 > Schedule L > Interim > Bank Statement.
- **Pass-throughs are not C-corps.** Tax provision is zero for pass-throughs. §179 is normalized, not fully added back. These aren't edge cases; they're the most common entity structures in SBA lending.

---

*This document is a living artifact. When you add new expertise to Buddy or close a wiring gap, update the relevant section so this document remains the truth.*
