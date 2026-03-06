# GOD TIER PHASE 2C — MULTI-ENTITY CONSOLIDATION SPECIFICATION

**Classification:** Internal — Architectural Specification  
**Version:** 1.0  
**Date:** 2026-03-06  
**Prerequisite:** Phase 1 + Phase 2 complete  
**Status:** REQUIRED FOR COMPLEX DEAL COVERAGE

---

## THE REAL-WORLD PROBLEM

Commercial borrowers almost never walk in as a single clean entity. The typical structure looks like this:

```
Owner (Guarantor)
├── ABC Manufacturing LLC          ← Operating Company (the borrower)
│   └── Pays $180K/yr rent to ↓
├── ABC Real Estate Holdings LLC   ← RE Holding (owns the building)
│   └── Pays $60K/yr mgmt fee to ↓
└── ABC Management Corp            ← Management Company
    └── Files separate 1120-S, issues K-1s to owner
```

Without consolidation:
- ABC Manufacturing shows rent expense of $180K → depressed EBITDA
- ABC Real Estate shows $180K rental income → inflated income
- ABC Management shows $60K management fee income → double-counted
- The banker sees THREE P&Ls that don't represent economic reality

With consolidation:
- Intercompany rent eliminated → $0 net impact
- Intercompany management fee eliminated → $0 net impact  
- One consolidated P&L reflects the TRUE economic performance of the enterprise
- Global DSCR computed on the consolidated entity, not artificially segmented

**Buddy must support unlimited entities per deal — 2, 3, 5, 10 — and produce one consolidated spread.**

---

## SECTION 1: ENTITY RELATIONSHIP MAP

### 1A. EntityMap Data Model

```typescript
interface EntityMap {
  deal_id: string;
  entities: BorrowerEntity[];
  relationships: EntityRelationship[];
  intercompany_transactions: IntercompanyTransaction[];
  consolidation_scope: ConsolidationScope;
  created_at: string;
  version: number; // bump on every change
}

interface BorrowerEntity {
  entity_id: string;               // internal UUID
  legal_name: string;
  ein: string;
  entity_type: EntityType;
  tax_form: TaxForm;               // 1120 | 1120-S | 1065 | 1040-Sch-C
  role: EntityRole;
  ownership_structure: OwnershipEntry[];
  primary_naics: string;
  accounting_basis: 'cash' | 'accrual' | 'tax_basis' | 'unknown';
  fiscal_year_end: string;         // MM-DD
  is_primary_borrower: boolean;
  is_guarantor_entity: boolean;
  documents: string[];             // document IDs linked to this entity
}

type EntityType = 
  | 'c_corp' 
  | 's_corp' 
  | 'partnership' 
  | 'llc_single_member'
  | 'llc_multi_member' 
  | 'sole_proprietor' 
  | 'individual';

type TaxForm = '1120' | '1120-S' | '1065' | '1040' | 'none';

type EntityRole = 
  | 'operating_company'       // primary business operations
  | 'real_estate_holding'     // owns property, collects rent
  | 'management_company'      // charges management fees
  | 'ip_holding'              // holds intellectual property, collects royalties
  | 'investment_holding'      // passive investment vehicle
  | 'personal_holding'        // owner's personal financial vehicle
  | 'subsidiary'              // controlled by another entity in the deal
  | 'affiliate';              // common ownership but not parent/sub

interface OwnershipEntry {
  owner_name: string;             // name of owner (person or entity)
  owner_entity_id?: string;       // if owner is another entity in the deal
  ownership_pct: number;          // 0–100
  ownership_type: 'common' | 'preferred' | 'membership' | 'partnership';
  is_guarantor: boolean;
}
```

### 1B. Entity Relationship Model

```typescript
interface EntityRelationship {
  relationship_id: string;
  parent_entity_id: string;
  child_entity_id: string;
  relationship_type: RelationshipType;
  ownership_pct: number;          // parent's ownership of child
  control_type: 'majority' | 'minority' | 'common_control' | 'affiliated';
  consolidation_required: boolean; // true if >50% owned OR common control
}

type RelationshipType = 
  | 'parent_subsidiary'           // >50% owned
  | 'common_control'              // same owner(s) control both
  | 'affiliated'                  // related but separate control
  | 'guarantor_relationship';     // personal guarantee connection
```

### 1C. Consolidation Scope Rules

```typescript
interface ConsolidationScope {
  method: ConsolidationMethod;
  entities_in_scope: string[];     // entity_ids to consolidate
  entities_excluded: string[];     // entity_ids excluded with reason
  exclusion_reasons: Record<string, string>;
}

type ConsolidationMethod = 
  | 'full_consolidation'          // 100% of all entities combined
  | 'proportionate'               // consolidate at ownership %
  | 'equity_method'               // minority interests — equity method only
  | 'global_cash_flow'            // personal + business (non-GAAP)
  | 'combined';                   // common control without legal parent-sub

// RULE: Use full_consolidation when ownership > 50% OR common control exists
// RULE: Use proportionate when ownership 20-50% and no common control
// RULE: Use equity_method when ownership < 20%
// RULE: Always use global_cash_flow for personal guarantor analysis
```

---

## SECTION 2: INTERCOMPANY TRANSACTION DETECTION

### 2A. Transaction Types to Detect and Eliminate

| Transaction Type | Paying Entity Line | Receiving Entity Line | Canonical Key |
|---|---|---|---|
| **Rent** | `is_rent_expense` | `is_net_revenue` or Sch E `sch_e_rents_received` | `ic_rent` |
| **Management fees** | `is_professional_fees` or `is_other_opex` | `is_net_revenue` | `ic_mgmt_fee` |
| **Royalties / IP fees** | `is_other_opex` | `is_royalty_income` or K-1 Box 7 | `ic_royalties` |
| **Intercompany loans** | `bs_notes_receivable_current` or `bs_lt_investments` | `bs_notes_payable_current` or `bs_lt_debt` | `ic_loan` |
| **Interest on IC loans** | `is_interest_expense` | `is_interest_income` | `ic_interest` |
| **Guarantee fees** | `is_other_opex` | `is_other_revenue` | `ic_guarantee_fee` |
| **Services / labor** | `is_salaries_total` or `is_professional_fees` | `is_net_revenue` | `ic_services` |
| **Inventory / goods** | `is_cogs` | `is_net_revenue` | `ic_goods` |

### 2B. Detection Rules — Automated

Buddy automatically detects intercompany transactions via these signals:

**Signal 1: Related Party Disclosures on Tax Returns**
- Schedule L: `sl_shareholder_loans_receivable` or `sl_loans_to_officers` > $0 → intercompany loan
- 1065: Guaranteed payments from one entity to another entity in the deal → intercompany service
- 1120-S Schedule K Line 7: Loans between S-Corp and shareholders

**Signal 2: Matching Revenue/Expense Amounts**
- If Entity A's rent expense ≈ Entity B's rental income within 5% → flag as intercompany rent
- If Entity A's management fee expense ≈ Entity B's revenue within 5% → flag as intercompany mgmt fee
- Tolerance: ±5% or ±$5,000 whichever is greater (accounts for minor timing differences)

**Signal 3: Shared Address / EIN Prefix**
- Same street address across entities → flag for review
- Same first two digits of EIN → same IRS district, often same filer

**Signal 4: Schedule E Cross-Reference**
- Owner's Schedule E Part I shows rental income from an address
- That same address appears on a related entity's balance sheet (PP&E)
- → Flag as owner receives rent from entity they control = intercompany if entity is in deal scope

**Signal 5: K-1 Income from Entities in Deal Scope**
- Owner receives K-1 from Entity A and Entity B (both in deal)
- K-1 Box 1 income already captured at entity level
- → Must not double-count in personal income (flag for global DSCR exclusion)

### 2C. IntercompanyTransaction Model

```typescript
interface IntercompanyTransaction {
  transaction_id: string;
  transaction_type: ICTransactionType;
  paying_entity_id: string;
  receiving_entity_id: string;
  annual_amount: number;
  detection_method: 'tax_return_disclosure' | 'amount_match' | 'address_match' | 'manual';
  confidence: 'high' | 'medium' | 'low';
  paying_line_item: string;       // canonical key on paying entity
  receiving_line_item: string;    // canonical key on receiving entity
  elimination_required: boolean;
  documentation: string;          // how detected
  banker_confirmed: boolean;      // true once banker reviews
  years: Record<string, number>;  // annual amounts by tax year
}
```

---

## SECTION 3: CONSOLIDATION ENGINE

### 3A. Consolidation Methodology — Step by Step

**Step 1: Align Fiscal Years**
Before any aggregation, all entities must be on the same reporting period. If Entity A has a December 31 fiscal year and Entity B has a June 30 fiscal year:
- Use calendar year as the consolidation period
- For off-cycle entities: use the fiscal year ending within the consolidation year
- Flag any entities with >6 months offset from the consolidation period

```typescript
interface FiscalYearAlignment {
  consolidation_year: number;      // e.g., 2024
  entity_alignments: {
    entity_id: string;
    tax_year_used: number;
    fiscal_year_end: string;
    offset_months: number;
    flag: boolean;               // true if >6 month offset
  }[];
}
```

**Step 2: Standardize Accounting Basis**
All entities must be on the same accounting basis before consolidation. If Entity A is accrual and Entity B is cash:
- Convert Entity B to accrual using Layer 1 normalization (Phase 2)
- Flag the conversion in the consolidation output
- Note: some banks allow mixed basis consolidation with disclosure

**Step 3: Aggregate All Line Items**

```typescript
// For each income statement line:
consolidated_revenue = sum(entity.is_net_revenue for entity in scope)
consolidated_cogs    = sum(entity.is_cogs for entity in scope)
// ... repeat for every canonical key

// For each balance sheet line:
consolidated_assets  = sum(entity.bs_total_assets for entity in scope)
// ... repeat for every canonical key
```

**Step 4: Eliminate Intercompany Transactions**

```typescript
interface EliminationEntry {
  transaction_id: string;
  debit_entity_id: string;
  debit_line: string;            // line item being reduced
  debit_amount: number;
  credit_entity_id: string;
  credit_line: string;           // line item being reduced
  credit_amount: number;
}

// Revenue eliminations:
consolidated_revenue -= sum(ic_transactions where type=revenue)

// Expense eliminations (reverse — expenses add back to income):
// Nothing to add back — both sides eliminated

// Loan eliminations:
consolidated_assets      -= sum(ic_loans receivable)
consolidated_liabilities -= sum(ic_loans payable)

// Interest on IC loans:
consolidated_interest_income  -= ic_interest_income
consolidated_interest_expense -= ic_interest_expense
```

**Step 5: Minority Interest Adjustment** (when ownership < 100%)
If Entity A owns 70% of Entity B, and both are in scope:
- Include 100% of Entity B's financials in consolidation
- Create minority interest entry for the 30% not owned
- Minority interest reduces consolidated equity
- Minority interest share of income reduces consolidated net income

```typescript
interface MinorityInterest {
  entity_id: string;
  minority_pct: number;          // 1 - ownership_pct
  minority_interest_equity: number;
  minority_interest_income: number;
}
```

**Step 6: Produce Consolidated Financial Statements**

Output three consolidated statements:

1. **Consolidated Income Statement** — single P&L for all entities
2. **Consolidated Balance Sheet** — single balance sheet, IC loans eliminated
3. **Consolidated Cash Flow Statement** (if source data available)

Plus the **consolidation bridge** — a table showing:
- Each entity's standalone figures
- Each elimination entry
- The consolidated total
- This is what the banker shows the credit committee

### 3B. Consolidation Output Model

```typescript
interface ConsolidatedSpread {
  deal_id: string;
  consolidation_date: string;
  consolidation_method: ConsolidationMethod;
  tax_year: number;
  
  // Consolidated financials
  income_statement: ConsolidatedIncomeStatement;
  balance_sheet: ConsolidatedBalanceSheet;
  
  // Elimination detail
  eliminations: EliminationEntry[];
  total_revenue_eliminated: number;
  total_expense_eliminated: number;
  total_intercompany_loans_eliminated: number;
  
  // Key consolidated ratios
  ratios: ConsolidatedRatios;
  
  // Consolidation bridge (entity-by-entity breakdown)
  bridge: ConsolidationBridge;
  
  // Quality indicators
  confidence: 'high' | 'medium' | 'low';
  flags: ConsolidationFlag[];
}

interface ConsolidationBridge {
  line_items: BridgeLineItem[];
}

interface BridgeLineItem {
  label: string;                  // e.g., "Net Revenue"
  entities: Record<string, number>; // entity_id → amount
  eliminations: number;           // total eliminated (negative)
  consolidated_total: number;
}

interface ConsolidationFlag {
  severity: 'critical' | 'elevated' | 'info';
  code: string;
  description: string;
  entity_ids: string[];
}
```

---

## SECTION 4: GLOBAL CASH FLOW ANALYSIS

Global cash flow analysis is distinct from entity consolidation. It combines:
- Business cash flows from ALL entities (operating, real estate, management co.)
- Personal income from ALL personal sources (W-2, other K-1s, investments)
- ALL debt service — business AND personal

This is the number that determines whether the guarantor can actually service the debt.

### 4A. Global Cash Flow Waterfall

```
BUSINESS CASH FLOWS (per entity, then sum):
  Entity 1 (Operating Co):    NCADS from cashFlowWaterfall.ts
+ Entity 2 (RE Holding LLC):  Net rental income after mortgage (NOI − debt service on RE)
+ Entity 3 (Mgmt Co):         NCADS from cashFlowWaterfall.ts
− Intercompany eliminations:  Remove revenue that Entity 1 already paid to Entity 2/3
= Consolidated Business NCADS

PERSONAL CASH FLOWS (guarantor):
+ W-2 income (from W-2s NOT already captured in business entities)
+ Non-business investment income (interest, dividends, capital gains)
+ Other personal income (Social Security, pension, rental from outside deal)
− Personal living expenses (if bank policy requires — typically 2% of assets or $36K minimum)
= Net Personal Cash Flow Available

TOTAL GLOBAL CASH FLOW:
  Consolidated Business NCADS
+ Net Personal Cash Flow Available
= Gross Global Cash Flow

GLOBAL DEBT SERVICE:
− All business debt P+I (across ALL entities)
− All personal debt P+I (mortgage, car, student loans, credit cards)
− Proposed new debt service
= Net Cash After All Obligations

GLOBAL DSCR = Gross Global Cash Flow ÷ Global Debt Service
```

### 4B. K-1 Double-Count Prevention

**Critical rule:** When consolidating multiple entities, K-1 income from entities IN the deal scope must NOT be added to personal income — it's already captured at the entity level.

```typescript
interface GlobalCashFlowInput {
  // Business entities — use consolidated NCADS
  consolidated_business_ncads: number;
  
  // Personal income — EXCLUDE K-1s from entities already in consolidation scope
  personal_income: PersonalIncomeItem[];
  k1_exclusions: string[];         // entity_ids whose K-1 income to exclude
  
  // All debt service — both business and personal
  business_debt_service: DebtServiceItem[];
  personal_debt_service: DebtServiceItem[];
  proposed_debt_service: number;
}

interface PersonalIncomeItem {
  source: string;
  annual_amount: number;
  is_recurring: boolean;
  entity_id_if_k1?: string;        // if from K-1, which entity
  exclude_if_in_scope: boolean;    // true for K-1 from deal entities
}
```

---

## SECTION 5: REAL-WORLD CONSOLIDATION SCENARIOS

### Scenario A: Operating Co + Real Estate Holding (Most Common)

```
XYZ Restaurant LLC (1065)         ← Borrower: Needs $2M equipment loan
  Revenue: $3.2M
  Rent expense: $240K/yr → to ↓
  EBITDA: $420K
  
XYZ Properties LLC (1065)         ← Guarantor entity
  Rental income: $240K/yr ← from XYZ Restaurant
  Mortgage debt service: $180K/yr
  Net cash from RE: $60K

Owner Personal
  K-1 from XYZ Restaurant: $380K  ← Box 1 ordinary income
  K-1 from XYZ Properties: $52K   ← Net rental income
  Personal mortgage: $36K/yr
```

**Without consolidation:**
- Analyze XYZ Restaurant alone → DSCR = 1.18x (below minimum)
- Bank declines or requires guaranty

**With consolidation:**
- Eliminate $240K intercompany rent (expense + income cancel)
- Consolidated EBITDA = $420K + $240K eliminated = $660K (restaurant EBITDA pre-rent)
- Add RE entity net cash: $60K
- Total enterprise cash: $720K
- Global DSCR = $720K / ($proposed + $180K RE mortgage) = much stronger picture

### Scenario B: Three-Entity Structure

```
ABC Manufacturing Inc (1120-S)    ← Primary borrower
  Revenue: $8.5M, EBITDA: $1.1M
  Pays $300K mgmt fee → to ↓
  Pays $420K rent → to ↓

ABC Management LLC (1065)         ← Management company
  Revenue: $300K (mgmt fees from ABC Mfg)
  Expenses: $180K (salaries, etc.)
  Net income: $120K → K-1 to owner

ABC Real Estate LLC (1065)        ← RE holding
  Revenue: $420K (rent from ABC Mfg)
  Mortgage P+I: $320K/yr
  Net cash: $100K → K-1 to owner
```

**Consolidation:**
1. Eliminate $300K mgmt fee (revenue for Mgmt LLC, expense for Mfg)
2. Eliminate $420K rent (revenue for RE LLC, expense for Mfg)
3. Consolidated revenue: $8.5M (only Mfg — mgmt and RE revenues eliminated)
4. Consolidated EBITDA: $1.1M + $300K + $420K = $1.82M (eliminations add back the expenses)
5. Consolidated debt service: Mfg debt + RE mortgage + proposed
6. Global DSCR: much stronger than standalone Mfg DSCR

### Scenario C: Parent-Subsidiary

```
HoldCo Inc (1120)                 ← 100% owner of ↓
  Owns 100% of OpCo, PassiveCo
  
OpCo LLC (1065)                   ← Primary operations
  Revenue: $5M, EBITDA: $800K
  Intercompany loan payable: $1.2M to HoldCo

PassiveCo LLC (1065)              ← Royalty/IP vehicle
  Royalty income: $200K from OpCo
  No operations
```

**Consolidation:**
1. Full consolidation — HoldCo owns 100% of both
2. Eliminate OpCo → HoldCo intercompany loan ($1.2M)
3. Eliminate $200K royalty (OpCo expense, PassiveCo income)
4. Consolidated: $5M revenue, ($800K + $200K) = $1M EBITDA, no IC loans on BS

---

## SECTION 6: BANKER INTERFACE REQUIREMENTS

### 6A. Entity Map UI

The banker must be able to:
1. **Add entities to a deal** — upload tax returns for each entity; Buddy auto-classifies entity type and role
2. **Define relationships** — drag-and-drop entity relationship builder, or accept Buddy's auto-detected relationships
3. **Review intercompany transactions** — see each detected IC transaction, confirm or reject
4. **Set consolidation scope** — include/exclude entities; override method (full vs. proportionate)
5. **View consolidation bridge** — expandable table showing entity-by-entity amounts and eliminations

### 6B. Consolidation Bridge Display

The bridge table must show, for each key line item:

| Line Item | Entity 1 (Mfg) | Entity 2 (Mgmt) | Entity 3 (RE) | Eliminations | Consolidated |
|---|---|---|---|---|---|
| Net Revenue | $8,500,000 | $300,000 | $420,000 | ($720,000) | $8,500,000 |
| COGS | $5,200,000 | — | — | — | $5,200,000 |
| Gross Profit | $3,300,000 | $300,000 | $420,000 | ($720,000) | $3,300,000 |
| Operating Expenses | $2,200,000 | $180,000 | $100,000 | — | $2,480,000 |
| EBITDA | $1,100,000 | $120,000 | $320,000 | ($720,000 + addback) | $1,820,000 |
| Total Debt | $3,500,000 | — | $2,800,000 | ($1,200,000 IC loan) | $5,100,000 |
| **DSCR** | **1.18x** | — | — | — | **1.52x** |

### 6C. Required Flags and Warnings

| Condition | Flag | Action Required |
|---|---|---|
| Intercompany transaction detected but not confirmed by banker | AMBER | Banker must confirm before consolidation runs |
| Fiscal year mismatch > 6 months between entities | AMBER | Note in spread; flag for examiner |
| Accounting basis mismatch (one cash, one accrual) | AMBER | Auto-normalize; disclose method |
| Minority interest present (ownership 50-99%) | INFO | Show minority interest calculation |
| Circular ownership detected (A owns B owns A) | RED | Cannot auto-consolidate; require manual |
| Entity in scope has incomplete tax data | RED | Block consolidation; require document |
| Elimination > 30% of any entity's revenue | AMBER | High elimination ratio; banker review required |

---

## SECTION 7: CANONICAL KEYS — CONSOLIDATION LAYER

All consolidated figures use the `cons_` prefix to distinguish from standalone entity figures:

| Canonical Key | Description |
|---|---|
| `cons_revenue` | Consolidated net revenue (post-elimination) |
| `cons_cogs` | Consolidated COGS |
| `cons_gross_profit` | Consolidated gross profit |
| `cons_ebitda` | Consolidated EBITDA |
| `cons_ebitda_adjusted` | Consolidated QoE-adjusted EBITDA |
| `cons_total_assets` | Consolidated total assets (IC loans eliminated) |
| `cons_total_liabilities` | Consolidated total liabilities (IC loans eliminated) |
| `cons_total_equity` | Consolidated equity (incl. minority interest) |
| `cons_total_funded_debt` | Consolidated interest-bearing debt |
| `cons_annual_debt_service` | All entity debt P+I combined |
| `cons_ncads` | Consolidated Net Cash Available for Debt Service |
| `cons_dscr` | Consolidated DSCR |
| `global_cash_flow` | Business NCADS + personal income |
| `global_debt_service` | All debt obligations, business + personal |
| `global_dscr` | Global DSCR (the master number) |
| `ic_elimination_total_revenue` | Total intercompany revenue eliminated |
| `ic_elimination_total_expense` | Total intercompany expense eliminated |
| `ic_elimination_total_loans` | Total intercompany loans eliminated |
| `entity_count` | Number of entities in consolidation scope |
| `consolidation_method` | full / proportionate / equity_method / combined |
| `consolidation_confidence` | high / medium / low |

---

## IMPLEMENTATION NOTES FOR CLAUDE CODE

### Priority Order

1. **EntityMap data model + Supabase schema** — foundation everything else builds on
2. **Intercompany detection engine** — automated detection from extracted data
3. **Consolidation arithmetic engine** — the line-by-line aggregation + elimination math
4. **GlobalCashFlow module** — K-1 dedup logic + personal income combination
5. **ConsolidationBridge output** — the banker-facing summary table
6. **Fiscal year alignment + accounting basis normalization** — edge cases

### Schema Requirements (New Supabase Tables)

```sql
-- Entity registry per deal
CREATE TABLE deal_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id),
  legal_name TEXT NOT NULL,
  ein TEXT,
  entity_type TEXT NOT NULL,
  tax_form TEXT,
  role TEXT,
  is_primary_borrower BOOLEAN DEFAULT false,
  is_guarantor_entity BOOLEAN DEFAULT false,
  fiscal_year_end TEXT,
  accounting_basis TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Entity relationships
CREATE TABLE deal_entity_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id),
  parent_entity_id UUID REFERENCES deal_entities(id),
  child_entity_id UUID REFERENCES deal_entities(id),
  relationship_type TEXT NOT NULL,
  ownership_pct NUMERIC(5,2),
  consolidation_required BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Intercompany transactions
CREATE TABLE deal_intercompany_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id),
  transaction_type TEXT NOT NULL,
  paying_entity_id UUID REFERENCES deal_entities(id),
  receiving_entity_id UUID REFERENCES deal_entities(id),
  annual_amount NUMERIC(15,2),
  detection_method TEXT,
  confidence TEXT,
  banker_confirmed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Consolidation snapshots (versioned)
CREATE TABLE deal_consolidations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id),
  tax_year INTEGER NOT NULL,
  consolidation_method TEXT,
  consolidated_facts JSONB,     -- all cons_ canonical keys
  bridge JSONB,                 -- ConsolidationBridge
  eliminations JSONB,           -- EliminationEntry[]
  confidence TEXT,
  flags JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### The Key Invariant

**At no point should any income or asset appear twice in the consolidated spread.**

Every consolidation must satisfy:
```
cons_revenue = sum(entity revenues) - ic_elimination_total_revenue
cons_assets  = sum(entity assets) - ic_elimination_total_loans
cons_equity  = sum(entity equities) - minority_interest_adjustments

// Verify balance sheet still balances:
assert cons_assets = cons_liabilities + cons_equity
```

If the balance sheet does not balance after consolidation, the elimination entries are wrong. This is a hard error — block the consolidation and surface the discrepancy to the banker.

---

## DEFINITION OF COMPLETE

Multi-entity consolidation is complete when:

1. ✅ Buddy accepts N entities per deal (no limit)
2. ✅ Intercompany transactions auto-detected across all entity pairs
3. ✅ Consolidated P&L, balance sheet produced with all eliminations applied
4. ✅ Consolidation bridge shows entity-by-entity breakdown
5. ✅ Global DSCR computed without double-counting K-1 income
6. ✅ Consolidated DSCR substantially different from (and more accurate than) standalone DSCR
7. ✅ Balance sheet balances after consolidation (hard invariant)
8. ✅ Banker can review, confirm, and override any intercompany transaction

**When a banker hands Buddy a 3-entity deal package, Buddy returns one consolidated spread — the same spread their most experienced underwriter would produce after two days of manual work.**
