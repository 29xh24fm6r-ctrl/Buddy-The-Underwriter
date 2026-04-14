# Phase: Credit Memo Spreads — Balance Sheet Fix + T12 Removal + Debt Service Coverage

## Background

Two persistent problems with the Credit Memo `SpreadsAppendix`:

1. **Balance Sheet is blank** — The balance sheet spread template (`balanceSheet.ts`) looks for bare canonical keys (`CASH_AND_EQUIVALENTS`, `TOTAL_ASSETS`, etc.) but extracted facts are stored with `SL_` prefix (`SL_CASH`, `SL_TOTAL_ASSETS`, etc.). Template finds facts of the right `fact_type = "BALANCE_SHEET"` but drops them because `valuesByRow["SL_CASH"]` doesn't exist in the row registry.

2. **T12 Operating Performance is meaningless** — T12 requires month-by-month operating data that commercial borrowers almost never provide. In 25 years of commercial banking practice, T12 is essentially never received from clients and is not required by banks. Displaying an empty T12 table degrades the memo quality and wastes space.

## What to build

### Part A — Balance Sheet: Add SL_ Key Alias Map

**File to edit:** `src/lib/financialSpreads/templates/balanceSheet.ts`

Add a key alias map near the top of the file (before the template function):

```typescript
/**
 * Alias map: fact_key variants → canonical row registry key.
 *
 * Extraction stores balance sheet facts under SL_ prefixed keys (Schedule L
 * from tax returns and balance sheet documents). The row registry uses bare
 * canonical keys. This map bridges the two without changing either system.
 *
 * Verified against deal_financial_facts for production deals:
 * SL_CASH           → CASH_AND_EQUIVALENTS
 * SL_AR_GROSS        → ACCOUNTS_RECEIVABLE
 * SL_INVENTORY       → INVENTORY
 * SL_PPE_GROSS       → PROPERTY_PLANT_EQUIPMENT
 * SL_ACCUMULATED_DEPRECIATION → ACCUMULATED_DEPRECIATION
 * SL_LAND            → (no direct row; absorbed into PPE or OTHER_NON_CURRENT_ASSETS)
 * SL_OTHER_CURRENT_ASSETS → OTHER_CURRENT_ASSETS
 * SL_TOTAL_ASSETS    → TOTAL_ASSETS (source value; formulas will also compute it)
 * SL_ACCOUNTS_PAYABLE → ACCOUNTS_PAYABLE
 * SL_MORTGAGES_NOTES_BONDS → LONG_TERM_DEBT
 * SL_LOANS_FROM_SHAREHOLDERS → LONG_TERM_DEBT (fallback if no dedicated row)
 * SL_RETAINED_EARNINGS → RETAINED_EARNINGS
 * SL_CAPITAL_STOCK   → COMMON_STOCK
 * SL_TOTAL_LIABILITIES → TOTAL_LIABILITIES (source value)
 * SL_TOTAL_EQUITY    → TOTAL_EQUITY (source value)
 */
const SL_KEY_ALIAS: Record<string, BalanceSheetRowKey> = {
  SL_CASH:                        "CASH_AND_EQUIVALENTS",
  SL_AR_GROSS:                    "ACCOUNTS_RECEIVABLE",
  SL_INVENTORY:                   "INVENTORY",
  SL_OTHER_CURRENT_ASSETS:        "OTHER_CURRENT_ASSETS",
  SL_PPE_GROSS:                   "PROPERTY_PLANT_EQUIPMENT",
  SL_LAND:                        "PROPERTY_PLANT_EQUIPMENT",   // roll into PP&E
  SL_ACCUMULATED_DEPRECIATION:    "ACCUMULATED_DEPRECIATION",
  SL_ACCOUNTS_PAYABLE:            "ACCOUNTS_PAYABLE",
  SL_MORTGAGES_NOTES_BONDS:       "LONG_TERM_DEBT",
  SL_LOANS_FROM_SHAREHOLDERS:     "LONG_TERM_DEBT",
  SL_MORTGAGE_LOANS:              "MORTGAGE_PAYABLE",
  SL_RETAINED_EARNINGS:           "RETAINED_EARNINGS",
  SL_CAPITAL_STOCK:               "COMMON_STOCK",
  SL_SHAREHOLDER_LOANS_RECEIVABLE: "OTHER_NON_CURRENT_ASSETS",
  // Totals — allow source-provided totals to pre-populate cells; formulas will
  // recompute them but source values serve as a fallback if components are missing.
  SL_TOTAL_ASSETS:                "TOTAL_ASSETS",
  SL_TOTAL_LIABILITIES:           "TOTAL_LIABILITIES",
  SL_TOTAL_EQUITY:                "TOTAL_EQUITY",
};
```

Then in the **fact mapping loop** inside the `render` function, change:

```typescript
// BEFORE:
for (const fact of bsFacts) {
  const rowKey = fact.fact_key;
  if (!valuesByRow[rowKey]) continue;
```

```typescript
// AFTER:
for (const fact of bsFacts) {
  const rowKey = (SL_KEY_ALIAS[fact.fact_key] ?? fact.fact_key) as BalanceSheetRowKey;
  if (!valuesByRow[rowKey]) continue;
```

Also extend the `bsFacts` filter to include `TAX_RETURN_BALANCE_SHEET` facts, since many `SL_` facts come from tax return balance sheets:

```typescript
// BEFORE:
const bsFacts = args.facts.filter((f) => f.fact_type === "BALANCE_SHEET");

// AFTER:
const bsFacts = args.facts.filter(
  (f) => f.fact_type === "BALANCE_SHEET" || f.fact_type === "TAX_RETURN_BALANCE_SHEET"
);
```

**That's the entire balance sheet fix.** No schema changes needed.

---

### Part B — Remove T12, Add Debt Service Coverage Section

#### Step 1: Remove T12 from SpreadsAppendix

**File:** `src/components/creditMemo/SpreadsAppendix.tsx`

Remove `"T12"` from the `SPREAD_LABELS` map and from the `typeOrder` sort array:

```typescript
// BEFORE:
const SPREAD_LABELS: Record<string, string> = {
  T12: "Operating Performance",
  BALANCE_SHEET: "Balance Sheet",
  ...
};

// AFTER:
const SPREAD_LABELS: Record<string, string> = {
  BALANCE_SHEET: "Balance Sheet",
  RENT_ROLL: "Rent Roll Summary",
  GLOBAL_CASH_FLOW: "Global Cash Flow",
  PERSONAL_INCOME: "Personal Income",
  PERSONAL_FINANCIAL_STATEMENT: "Personal Financial Statement",
};
```

```typescript
// BEFORE:
const typeOrder = ["T12", "BALANCE_SHEET", "RENT_ROLL", "PERSONAL_INCOME", "PERSONAL_FINANCIAL_STATEMENT", "GLOBAL_CASH_FLOW"];

// AFTER:
const typeOrder = ["BALANCE_SHEET", "RENT_ROLL", "PERSONAL_INCOME", "PERSONAL_FINANCIAL_STATEMENT", "GLOBAL_CASH_FLOW"];
```

T12 spreads still exist in the DB — this just stops rendering them. No migration needed.

---

#### Step 2: Add Debt Service Coverage Section (replaces T12)

This section is **computed from `deal_financial_facts`** — no new spread generation pipeline required. It reads facts that already exist and presents them in a format bankers actually use for credit decisions.

**Create new file:** `src/components/creditMemo/DebtServiceCoverageSection.tsx`

```tsx
import "server-only";

import React from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";

type FactRow = {
  fact_key: string;
  fact_value_num: number | null;
  fact_period_end: string | null;
};

function fmt(v: number | null, opts?: { isRatio?: boolean; isDollar?: boolean }): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (opts?.isRatio) return v.toFixed(2) + "x";
  if (opts?.isDollar !== false) {
    return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

type DataRow = {
  label: string;
  value: number | null;
  isTotal?: boolean;
  isRatio?: boolean;
  isSubtotal?: boolean;
  isDollar?: boolean;
  indent?: boolean;
};

function Row({ row }: { row: DataRow }) {
  const val = fmt(row.value, { isRatio: row.isRatio, isDollar: row.isDollar ?? true });
  const base = "flex justify-between items-baseline px-3 py-1 text-xs border-b border-gray-50";
  const rowClass = row.isTotal
    ? `${base} font-bold bg-gray-50 text-gray-900`
    : row.isSubtotal
    ? `${base} font-semibold text-gray-800`
    : row.isRatio
    ? `${base} italic text-gray-500`
    : `${base} text-gray-700`;

  return (
    <div className={rowClass}>
      <span className={row.indent ? "pl-3" : ""}>{row.label}</span>
      <span className="tabular-nums">{val}</span>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400 border-b border-gray-50">
      {label}
    </div>
  );
}

export default async function DebtServiceCoverageSection({
  dealId,
  bankId,
}: {
  dealId: string;
  bankId: string;
}) {
  const sb = supabaseAdmin();

  // Pull all relevant income statement + DSCR facts for this deal
  // Uses the most recent value per fact_key (order by fact_period_end DESC)
  const { data: factRows } = await (sb as any)
    .from("deal_financial_facts")
    .select("fact_key, fact_value_num, fact_period_end")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .not("fact_value_num", "is", null)
    .in("fact_key", [
      "NET_INCOME",
      "DEPRECIATION",
      "AMORTIZATION",
      "INTEREST_EXPENSE",
      "EBITDA",
      "TOTAL_REVENUE",
      "GROSS_PROFIT",
      "TOTAL_OPERATING_EXPENSES",
      "OPERATING_INCOME",
      "CASH_FLOW_AVAILABLE",
      "ANNUAL_DEBT_SERVICE",
      "DSCR",
      "DSCR_STRESSED_300BPS",
      "EXCESS_CASH_FLOW",
      "ANNUAL_DEBT_SERVICE_STRESSED_300BPS",
      // PFS income for global cash flow
      "PFS_TOTAL_ANNUAL_INCOME",
      "PFS_REAL_ESTATE_INCOME",
      "PFS_NET_INVESTMENT_INCOME",
    ])
    .order("fact_period_end", { ascending: false });

  if (!factRows || factRows.length === 0) return null;

  // Build a map of most-recent value per key
  const facts: Record<string, number | null> = {};
  for (const row of factRows as FactRow[]) {
    if (!(row.fact_key in facts)) {
      facts[row.fact_key] = row.fact_value_num;
    }
  }

  // Get the as-of date for the most recent income facts
  const asOfDate = (factRows as FactRow[]).find(
    (r) => r.fact_key === "NET_INCOME" && r.fact_value_num !== null
  )?.fact_period_end?.slice(0, 10) ?? null;

  // Determine most-recent period end for display
  const allDates = (factRows as FactRow[])
    .map((r) => r.fact_period_end)
    .filter(Boolean)
    .sort()
    .reverse();
  const latestDate = allDates[0]?.slice(0, 10) ?? null;

  // Build EBITDA if not directly available
  const ebitda =
    facts["EBITDA"] ??
    (facts["NET_INCOME"] !== null || facts["DEPRECIATION"] !== null || facts["INTEREST_EXPENSE"] !== null
      ? (facts["NET_INCOME"] ?? 0) + (facts["DEPRECIATION"] ?? 0) + (facts["AMORTIZATION"] ?? 0) + (facts["INTEREST_EXPENSE"] ?? 0)
      : null);

  // Cash flow available = EBITDA minus adjustments (or direct fact)
  const cashFlowAvailable = facts["CASH_FLOW_AVAILABLE"] ?? ebitda;

  // Global cash flow: business + personal income sources
  const personalIncome =
    (facts["PFS_TOTAL_ANNUAL_INCOME"] ?? 0) +
    (facts["PFS_REAL_ESTATE_INCOME"] ?? 0) +
    (facts["PFS_NET_INVESTMENT_INCOME"] ?? 0);
  const showGlobalCashFlow = personalIncome > 0;
  const globalCashFlow = cashFlowAvailable !== null && personalIncome > 0
    ? cashFlowAvailable + personalIncome
    : cashFlowAvailable;

  const annualDebtService = facts["ANNUAL_DEBT_SERVICE"] ?? null;
  const dscr = facts["DSCR"] ?? null;
  const dscrStressed = facts["DSCR_STRESSED_300BPS"] ?? null;
  const excessCashFlow = facts["EXCESS_CASH_FLOW"] ?? (
    globalCashFlow !== null && annualDebtService !== null
      ? globalCashFlow - annualDebtService
      : null
  );

  // Don't render if we have no meaningful DSCR data
  if (dscr === null && annualDebtService === null && cashFlowAvailable === null) return null;

  return (
    <div className="border border-gray-200 rounded-md overflow-hidden">
      <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
        <div className="text-xs font-semibold text-gray-700">Debt Service Coverage Analysis</div>
        {latestDate && (
          <div className="text-[10px] text-gray-400">
            As of: {latestDate} (most recent period)
          </div>
        )}
      </div>

      <div className="text-xs">
        {/* Income → Cash Flow */}
        <SectionHeader label="Cash Flow Build-Up" />
        {facts["NET_INCOME"] !== null && <Row row={{ label: "Net Income", value: facts["NET_INCOME"], indent: true }} />}
        {facts["DEPRECIATION"] !== null && <Row row={{ label: "Add: Depreciation & Amortization", value: facts["DEPRECIATION"], indent: true }} />}
        {facts["AMORTIZATION"] !== null && facts["AMORTIZATION"] !== facts["DEPRECIATION"] && (
          <Row row={{ label: "Add: Amortization", value: facts["AMORTIZATION"], indent: true }} />
        )}
        {facts["INTEREST_EXPENSE"] !== null && <Row row={{ label: "Add: Interest Expense", value: facts["INTEREST_EXPENSE"], indent: true }} />}
        {ebitda !== null && <Row row={{ label: "EBITDA", value: ebitda, isSubtotal: true }} />}
        {cashFlowAvailable !== null && cashFlowAvailable !== ebitda && (
          <Row row={{ label: "Business Cash Flow Available", value: cashFlowAvailable, isSubtotal: true }} />
        )}

        {/* Global cash flow if personal income present */}
        {showGlobalCashFlow && (
          <>
            <SectionHeader label="Global Cash Flow" />
            <Row row={{ label: "Business Cash Flow Available", value: cashFlowAvailable, indent: true }} />
            {(facts["PFS_TOTAL_ANNUAL_INCOME"] ?? 0) > 0 && (
              <Row row={{ label: "Add: Personal Income", value: facts["PFS_TOTAL_ANNUAL_INCOME"], indent: true }} />
            )}
            {(facts["PFS_REAL_ESTATE_INCOME"] ?? 0) > 0 && (
              <Row row={{ label: "Add: Rental Income", value: facts["PFS_REAL_ESTATE_INCOME"], indent: true }} />
            )}
            {(facts["PFS_NET_INVESTMENT_INCOME"] ?? 0) > 0 && (
              <Row row={{ label: "Add: Investment Income", value: facts["PFS_NET_INVESTMENT_INCOME"], indent: true }} />
            )}
            <Row row={{ label: "Global Cash Flow Available", value: globalCashFlow, isSubtotal: true }} />
          </>
        )}

        {/* Debt Service */}
        <SectionHeader label="Debt Service" />
        {annualDebtService !== null && (
          <Row row={{ label: "Total Annual Debt Service", value: annualDebtService, isTotal: true }} />
        )}
        {excessCashFlow !== null && (
          <Row row={{ label: "Net Cash Flow After Debt Service", value: excessCashFlow, isSubtotal: true }} />
        )}

        {/* Coverage Ratios */}
        <SectionHeader label="Coverage Ratios" />
        {dscr !== null && (
          <Row row={{ label: "DSCR (as underwritten)", value: dscr, isRatio: true }} />
        )}
        {dscrStressed !== null && (
          <Row row={{ label: "DSCR (stressed +300 bps)", value: dscrStressed, isRatio: true }} />
        )}

        {/* Thresholds reference */}
        <div className="px-3 py-2 text-[10px] text-gray-400 italic border-t border-gray-100">
          Policy minimums: 1.25x standard · 1.15x with mitigants · SBA: 1.25x projected / 1.10x historical
        </div>
      </div>
    </div>
  );
}
```

---

#### Step 3: Wire DebtServiceCoverageSection into SpreadsAppendix

**File:** `src/components/creditMemo/SpreadsAppendix.tsx`

Add the import at the top:
```typescript
import DebtServiceCoverageSection from "./DebtServiceCoverageSection";
```

Insert the component **before** the existing spread tables (at the top of the returned JSX, before the `uniqueSpreads.map(...)` loop):

```tsx
// BEFORE:
return (
  <div className="border-t border-gray-200 pt-4 mt-6">
    <div className="text-xs font-semibold uppercase text-gray-600 mb-3">Appendix: Financial Spreads</div>
    <div className="space-y-4">
      {uniqueSpreads.map(...)}
    </div>
  </div>
);

// AFTER:
return (
  <div className="border-t border-gray-200 pt-4 mt-6">
    <div className="text-xs font-semibold uppercase text-gray-600 mb-3">Appendix: Financial Spreads</div>
    <div className="space-y-4">
      <DebtServiceCoverageSection dealId={dealId} bankId={bankId} />
      {uniqueSpreads.map(...)}
    </div>
  </div>
);
```

Also add the Spreads on File summary at the top of the appendix (before DebtServiceCoverageSection) showing which spread types are ready:

```tsx
// Add before <DebtServiceCoverageSection>:
{uniqueSpreads.length > 0 && (
  <div className="text-[10px] text-gray-500 mb-1">
    <span className="font-semibold">SPREADS ON FILE</span>
    <div className="mt-1 flex flex-wrap gap-x-6 gap-y-0.5">
      {uniqueSpreads.map((s) => (
        <span key={`${s.spread_type}-${s.owner_entity_id ?? ""}`}>
          {SPREAD_LABELS[s.spread_type] ?? s.spread_type}&nbsp;
          <span className="text-gray-400">{s.status}</span>
        </span>
      ))}
    </div>
  </div>
)}
```

---

## What the appendix looks like after this change

```
APPENDIX: FINANCIAL SPREADS

SPREADS ON FILE
Balance Sheet  ready    Global Cash Flow  ready    Personal Income  ready
Personal Financial Statement  ready

┌─ Debt Service Coverage Analysis ──────────────── As of: 2025-12-31 ─┐
│ CASH FLOW BUILD-UP                                                    │
│   Net Income                                            $204,096      │
│   Add: Depreciation & Amortization                      $83,883      │
│   Add: Interest Expense                                  $80,520      │
│ EBITDA                                                  $368,499      │
│ DEBT SERVICE                                                          │
│ Total Annual Debt Service                                $67,368      │
│ Net Cash Flow After Debt Service                        $300,731      │
│ COVERAGE RATIOS                                                       │
│ DSCR (as underwritten)                                     3.03x      │
│ Policy minimums: 1.25x standard · SBA: 1.25x proj / 1.10x hist      │
└───────────────────────────────────────────────────────────────────────┘

┌─ Balance Sheet ─────────────────────────── 2025-12-31 ─┐
│ Cash & Equivalents                           $93,087    │
│ Property, Plant & Equipment               $2,519,000    │
│ Accumulated Depreciation                    ($83,883)   │
│ Total Assets                              $2,571,777    │
│ Long-Term Debt                            $1,192,032    │
│ Total Liabilities                         $1,129,636    │
│ Total Equity                              $1,238,045    │
│ Current Ratio                                   —       │
│ Debt-to-Equity                                0.91      │
└────────────────────────────────────────────────────────┘

... Global Cash Flow ... Personal Income ... Personal Financial Statement ...
```

---

## Files to change

| File | Change |
|---|---|
| `src/lib/financialSpreads/templates/balanceSheet.ts` | Add `SL_KEY_ALIAS` map + apply alias in render loop + extend bsFacts filter to include `TAX_RETURN_BALANCE_SHEET` |
| `src/components/creditMemo/SpreadsAppendix.tsx` | Remove T12 from `SPREAD_LABELS` and `typeOrder`; import and render `DebtServiceCoverageSection` before spread tables |
| `src/components/creditMemo/DebtServiceCoverageSection.tsx` | **Create new** — server component that reads from `deal_financial_facts` and renders the DSCR analysis |

**Note on STANDARD spread (income statement multi-year):** The STANDARD spread currently has 0 rows because the income statement facts (`TOTAL_REVENUE`, `NET_INCOME`, etc.) likely have `fact_type` values like `TAX_RETURN` or `INCOME_STATEMENT` rather than what the STANDARD template expects. This is a separate issue tracked separately — the canonical income statement IS rendering correctly via `snapshot_json` in the main memo template, so this doesn't block the credit memo.

---

## Verification checklist

- [ ] `GET /credit-memo/[dealId]/canonical` renders Balance Sheet with values populated for Samaritus (total assets $2.57M, total liabilities $1.13M, total equity $1.24M)
- [ ] T12 section no longer appears anywhere in the credit memo appendix
- [ ] Debt Service Coverage Analysis section renders at top of appendix for Samaritus showing DSCR 3.03x, annual debt service $67,368, EBITDA ~$368K
- [ ] Global Cash Flow spread still renders (it's preserved, not removed)
- [ ] Personal Financial Statement spread still renders
- [ ] `tsc --noEmit` passes clean
- [ ] No changes to `deal_spreads` DB table or any migration needed

## Commit message

```
feat: fix balance sheet SL_ key mapping, remove T12, add debt service coverage section
```
