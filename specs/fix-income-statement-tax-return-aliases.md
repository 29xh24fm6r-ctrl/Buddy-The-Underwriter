# Fix: Income Statement Multi-Period — Tax Return Alias Mapping

## Problem

The multi-period Income Statement and Debt Coverage tables in the credit memo show "—" for Revenue and Net Income in 2024 and 2023 years even though facts exist.

**Root cause:** `buildCanonicalCreditMemo.ts` queries `deal_financial_facts` for a fixed key list that only covers `INCOME_STATEMENT` fact type naming conventions. Business tax return documents store the same data under different key names:

| Credit memo needs | Tax return fact key |
|---|---|
| `TOTAL_REVENUE` | `GROSS_RECEIPTS` |
| `NET_INCOME` | `ORDINARY_BUSINESS_INCOME` or `M2_NET_INCOME` |

The 2025 YTD document is an `INCOME_STATEMENT` type and uses the canonical keys, so it renders correctly. The 2024 and 2023 tax returns use `GROSS_RECEIPTS` and `ORDINARY_BUSINESS_INCOME` — these are never fetched, so those columns show all "—".

**Verified in DB for deal `0279ed32`:**
- 2025: `TOTAL_REVENUE = 1,360,479` ✅ (INCOME_STATEMENT)
- 2024: `GROSS_RECEIPTS = 1,502,871` (TAX_RETURN) — never fetched, shows "—"  
- 2023: `GROSS_RECEIPTS = 1,227,085` (TAX_RETURN) — never fetched, shows "—"
- 2024: `ORDINARY_BUSINESS_INCOME = 269,816` (TAX_RETURN) — never fetched, shows "—"
- 2023: `ORDINARY_BUSINESS_INCOME = 328,324` (TAX_RETURN) — never fetched, shows "—"

EBITDA also shows "—" for 2025 even though components exist (Net Income + D&A + Interest).

---

## Fix

**File:** `src/lib/creditMemo/canonical/buildCanonicalCreditMemo.ts`

### Change 1 — Expand the `periodFactsResult` query key list

Find the `periodFactsResult` query (inside the second `Promise.all` block, labelled `// Phase 33`). It currently fetches:

```typescript
.in("fact_key", [
  "TOTAL_REVENUE", "NET_INCOME", "DEPRECIATION", "INTEREST_EXPENSE", "RENT_EXPENSE",
  "COST_OF_GOODS_SOLD", "GROSS_PROFIT", "TOTAL_OPERATING_EXPENSES", "OPERATING_INCOME", "EBITDA",
])
```

**Replace with:**

```typescript
.in("fact_key", [
  // Canonical income statement keys (YTD/interim statements)
  "TOTAL_REVENUE", "NET_INCOME", "DEPRECIATION", "INTEREST_EXPENSE", "RENT_EXPENSE",
  "COST_OF_GOODS_SOLD", "GROSS_PROFIT", "TOTAL_OPERATING_EXPENSES", "OPERATING_INCOME", "EBITDA",
  // Tax return aliases — same data, different key names
  "GROSS_RECEIPTS",           // maps to TOTAL_REVENUE
  "ORDINARY_BUSINESS_INCOME", // maps to NET_INCOME (Schedule K/M2)
  "M2_NET_INCOME",            // alternate net income from M2 reconciliation
  "SK_ORDINARY_INCOME",       // S-corp K-1 ordinary income (fallback for net income)
])
```

Also increase the limit from `60` to `100` to accommodate the extra keys across multiple periods.

### Change 2 — Apply alias normalization in the `factsByPeriod` grouping loop

Find the loop that groups period facts (immediately after the `periodFactsResult` query resolves):

```typescript
// Group period facts by period_end
const factsByPeriod: Record<string, Record<string, number>> = {};
for (const f of ((periodFactsResult.data ?? []) as any[])) {
  if (!factsByPeriod[f.fact_period_end]) factsByPeriod[f.fact_period_end] = {};
  factsByPeriod[f.fact_period_end][f.fact_key] = Number(f.fact_value_num);
}
```

**Replace with:**

```typescript
// Tax return key aliases → canonical income statement keys.
// Business tax returns store the same metrics under different fact_key names.
// We normalize here so the income statement and debt coverage table builders
// can use a single consistent key set regardless of document type.
const TAX_RETURN_KEY_ALIASES: Record<string, string> = {
  GROSS_RECEIPTS:           "TOTAL_REVENUE",   // gross receipts = total revenue
  ORDINARY_BUSINESS_INCOME: "NET_INCOME",       // Schedule K ordinary income
  M2_NET_INCOME:            "NET_INCOME",       // M2 book income reconciliation
  SK_ORDINARY_INCOME:       "NET_INCOME",       // S-corp K-1 (lower priority fallback)
};

// Group period facts by period_end, applying tax return aliases
const factsByPeriod: Record<string, Record<string, number>> = {};
for (const f of ((periodFactsResult.data ?? []) as any[])) {
  if (!factsByPeriod[f.fact_period_end]) factsByPeriod[f.fact_period_end] = {};
  const canonicalKey = TAX_RETURN_KEY_ALIASES[f.fact_key] ?? f.fact_key;
  // Only set the canonical value if not already populated by a more authoritative source
  // (e.g. don't overwrite TOTAL_REVENUE from INCOME_STATEMENT with GROSS_RECEIPTS from TAX_RETURN)
  if (!(canonicalKey in factsByPeriod[f.fact_period_end])) {
    factsByPeriod[f.fact_period_end][canonicalKey] = Number(f.fact_value_num);
  }
}
```

### Change 3 — Derive EBITDA when not directly available

In the `incomeStatementTable` build loop, after reading `ebitda`:

```typescript
const ebitda = facts["EBITDA"] ?? null;
```

**Replace with:**

```typescript
const ebitda = facts["EBITDA"] ??
  (ni !== null ? (ni + (dep ?? 0) + (interest ?? 0)) : null);
```

Apply the same derived EBITDA to the `debtCoverageTable` build loop — update the `cfa` computation there to use EBITDA-derived cash flow when available:

In the `debtCoverageTable` loop, find:
```typescript
const cfa = ni !== null ? (dep !== null ? ni + dep : ni) : null;
```

**Replace with:**
```typescript
// Cash flow available = Net Income + Depreciation + Interest (EBITDA proxy)
// Use all addbacks that are available — don't require all three
const cfa = ni !== null
  ? ni + (dep ?? 0) + (interest ?? 0)
  : null;
```

---

## Verification

After implementing, regenerate the credit memo for deal `0279ed32-c25c-4919-b231-5790050331dd` (ChatGPT Fix 15) and confirm:

- [ ] Income Statement 2025 column: Revenue $1.36M, Net Income $204K, EBITDA ~$368K (NI + Dep $83K + Int $80K)
- [ ] Income Statement 2024 column: Revenue $1.50M (from GROSS_RECEIPTS), Net Income $270K (from ORDINARY_BUSINESS_INCOME), Gross Profit $1.05M, COGS $449K, Depreciation $287K
- [ ] Income Statement 2023 column: Revenue $1.23M, Net Income $328K (from ORDINARY_BUSINESS_INCOME), Gross Profit $1.23M, Depreciation $30K, Interest $116K
- [ ] Debt Coverage table shows revenue and net income for all 3 periods
- [ ] `tsc --noEmit` passes clean

## Commit message

```
fix: income statement multi-period — add tax return key aliases (GROSS_RECEIPTS, ORDINARY_BUSINESS_INCOME)
```
