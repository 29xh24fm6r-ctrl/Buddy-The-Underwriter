# Finengine — Live Full-Spread Validation Report

**Spec:** SPEC-FINENGINE-LIVE-SPREAD-1 (Phase 3)
**Mode:** READ-ONLY — no canonical fact written, no flag flipped, no cutover (NG1).
**Run date:** 2026-06-28 · **Deals:** OmniCare 365 (primary) + the 3 sibling OmniCare deals (every deal with facts on file).
**Engine:** `computeDealSpread` (full metric library wired to Phase 1 certified snapshots) vs an **independent** golden-set derived from the filed 1120 line items (NG4).

This is the first time the finengine has produced a fully-explained spread on live deal data. The run is the evidence that gates any future cutover. One material bug was surfaced and is **not masked** — it correctly blocks cutover for the affected deals.

---

## Headline result

| Deal | rows | cells | biz periods | ZERO | INTENDED | UNEXPECTED | cutover |
|---|---|---|---|---|---|---|---|
| OmniCare 365 (primary) `80fe6f7a` | 368 | 166 | 5 | 14 | 1 | 0 | **clear** |
| OmniCare Deal Review `dc52c626` | 241 | 163 | 5 | 15 | 0 | 0 | **clear** |
| New Omnicare `e62eda2a` | 194 | 148 | 5 | 13 | 0 | **1** | **BLOCKED** |
| Omnicare 6-18-2026 `1d7e7c1b` | 201 | 144 | 5 | 13 | 0 | **1** | **BLOCKED** |

All four deals run end-to-end with no crash; snapshots build for every entity scope and period (**V3.1 ✓**).

---

## V3.2 — entity partition proven on live data

The `TAXABLE_INCOME` key on OmniCare collides: the **business** 2023 loss (−457,567, `BUSINESS_TAX_RETURN`, conf 0.5) shares the key+period with a **guarantor's personal** income (249,968, `PERSONAL_TAX_RETURN`, conf 0.8). The correct value carries the *lower* confidence, so the certified layer's entity-partition-before-ranking is what makes this come out right.

Business EBITDA per year (engine) on the **primary** deal:

| period | engine EBITDA | independent golden | derivation |
|---|---|---|---|
| 2022-12-31 | 151,226 | 151,225 | M1 taxable 0 + dep 151,225 (see INTENDED below) |
| **2023-12-31** | **−395,911** | **−395,911** | **M1 taxable −457,567 (business loss) + dep 61,656** |
| 2024-12-31 | 411,132 | 411,132 | M1 taxable 200,925 + dep 210,207 |
| 2025-12-31 | 1,057,974 | 1,057,974 | net income 663,200 + interest 394,774 |
| 2026-03-31 | 299,449 | 299,449 | net income 205,112 + interest 94,336 |

The 2023 base is the **−457,567 business loss, never the 249,968 personal income** — and this holds on **all four** deals (every deal's 2023 business EBITDA = −395,911). The entity partition works on live data. ✓

Note also (NG3): `INTEREST_EXPENSE` exists only on 2025/2026 (`INCOME_STATEMENT`); it is **never borrowed** into a tax year — the 2022–2024 EBITDAs add back $0 of interest, each carrying a "missing INTEREST_EXPENSE — not borrowed (NG3)" warning.

---

## INTENDED divergence (immaterial)

**Primary deal, 2022 EBITDA: engine 151,226 vs golden 151,225 (Δ $1).**
Root cause: on 2022 the engine reconstructs a *pre-tax* base from after-tax `NET_INCOME=0` and adds back $1 of federal income tax; the independent golden uses the M1 pre-tax taxable-income line (0). The $1 is an immaterial source-rounding artifact. Registered as INTENDED — does not block cutover.

---

## V3.3 — UNEXPECTED divergence (material; blocks cutover) — NOT masked

**Deals `e62eda2a` and `1d7e7c1b`, 2024 EBITDA: engine 210,207 vs golden 411,132 (Δ $200,925).**

Root cause, traced to the line item:

| deal | `M1_TAXABLE_INCOME` 2024 | `TAXABLE_INCOME` 2024 | `NET_INCOME` 2024 | engine base used | engine EBITDA |
|---|---|---|---|---|---|
| primary `80fe6f7a` | 200,925 | **200,925 (present)** | 0 | `TAXABLE_INCOME` (200,925) | 411,132 ✓ |
| `e62eda2a` | 200,925 | **— (absent)** | 0 | `NET_INCOME` (0) | 210,207 ✗ |

The engine's EBITDA base-selection (`computeEbitda`) priority **omits `M1_TAXABLE_INCOME`**. When a deal carries `M1_TAXABLE_INCOME` but not the plain `TAXABLE_INCOME` key, the base falls through to `NET_INCOME` — which is 0 here — and EBITDA is **understated by $200,925** (it captures only the depreciation add-back). The independent golden's base priority *does* include `M1_TAXABLE_INCOME`, so it is correct.

This is a genuine engine bug, surfaced only because the spread ran on live data with an independent check. It is left **UNEXPECTED** and **cutover-blocking** (NG4 — not masked).

**Recommended fix (out of scope for this read-only spec — a behavior change to the EBITDA method):** add `M1_TAXABLE_INCOME` to the `computeEbitda` base-income priority, between `ORDINARY_BUSINESS_INCOME`/`TAXABLE_INCOME` and `NET_INCOME` (mirroring the independent `goldenBase` order). This is filed as the follow-on to this spec; it should ship behind the existing shadow harness with its own golden-set entry.

---

## Spread coverage (what the engine now produces, per period × scope)

For each certified snapshot the engine emits, with an interpretation attached to each: **method** (EBITDA), **liquidity** (current/quick/cash ratio, NWC), **leverage** (D/E, D/worth, D/assets, liab/assets, equity ratio/multiplier, debt/ETNW), **profitability** (gross/operating/net/pretax margins, ROA/ROE), **activity** (AR/inventory/AP turnover, DSO/DIO/DPO, asset turnover), **adjustments** (TNW, ETNW, net-worth reconciliation, fixed-asset age, net-to-gross PP&E), **distress** (Altman Z′/Z″), and **structural** (common-size income, YoY growth, trend, CAGR).

Selected interpretations the spread surfaced (primary deal):

- **Profitability flags** — 2024 net margin 0.0 (flag), gross margin 0.123 (flag): thin/zero bottom line on a high-revenue, high-COGS medical-services borrower.
- **Distress** — 2023 Altman Z″ in the **distress** zone (the loss year), recovering thereafter.
- **Leverage** — 2023 debt-to-ETNW 1.44 **breaches** the registry `debt_to_etnw_max` (1.30).
- **Net-worth reconciliation** — large 2024 residual (−$3.29M) flagged as a possible undisclosed-distribution / equity-walk break for analyst follow-up.

These are diagnostic signals, surfaced read-only for the credit file — not yet written as canonical facts.

---

## V3.4 — read-only invariants

- No canonical fact written; no `deal_financial_facts` slot touched; no flag flipped (NG1). The runner only `select`s.
- `pnpm guard:all` + `pnpm typecheck` green.
- The live findings above are locked as regression tests in `src/lib/finengine/__tests__/fullSpreadValidation.test.ts`.

## How to reproduce

```
pnpm tsx --conditions=react-server scripts/finengine-full-spread.ts
# (requires SUPABASE_URL + a service key in the environment)
```

The runner loads each deal's facts, runs `computeDealSpread` alongside the independent golden-set, and prints the ZERO/INTENDED/UNEXPECTED validation. In an MCP-only environment, the same `computeDealSpread` was run against rows fetched read-only via the Supabase MCP — producing the numbers above.
