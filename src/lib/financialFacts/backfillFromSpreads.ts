import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { RenderedSpread, SpreadType } from "@/lib/financialSpreads/types";
import { CANONICAL_FACTS } from "@/lib/financialFacts/keys";
import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";

function norm(s: string) {
  return s.trim().toLowerCase();
}

function cellToNumber(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object" && "value" in v) {
    const inner = (v as any).value;
    if (typeof inner === "number" && Number.isFinite(inner)) return inner;
  }
  return null;
}

function tryFindRowNumberForCol(spread: RenderedSpread, args: { rowKey: string; colKey: string }): number | null {
  const wantRow = norm(args.rowKey);
  const wantCol = String(args.colKey);

  for (const r of spread.rows ?? []) {
    if (norm(r.key) !== wantRow) continue;
    if (!Array.isArray(r.values) || r.values.length === 0) return null;

    const cell = r.values[0] as any;
    if (cell && typeof cell === "object") {
      const byCol = cell.valueByCol?.[wantCol];
      if (typeof byCol === "number" && Number.isFinite(byCol)) return byCol;
    }

    // Back-compat: legacy spreads may store a single value.
    const legacy = cellToNumber(cell);
    if (typeof legacy === "number" && Number.isFinite(legacy)) return legacy;
  }
  return null;
}

function tryFindRowCellValueForCol(spread: RenderedSpread, args: { rowKey: string; colKey: string }): any {
  const wantRow = norm(args.rowKey);
  const wantCol = String(args.colKey);

  for (const r of spread.rows ?? []) {
    if (norm(r.key) !== wantRow) continue;
    if (!Array.isArray(r.values) || r.values.length === 0) return null;

    const cell = r.values[0] as any;
    if (cell && typeof cell === "object") {
      if (cell.valueByCol && Object.prototype.hasOwnProperty.call(cell.valueByCol, wantCol)) {
        return cell.valueByCol[wantCol];
      }
    }
    return cell;
  }
  return null;
}

function tryFindRowNumber(spread: RenderedSpread, opts: { key?: string; labelIncludes?: string[] }) {
  const key = opts.key ? norm(opts.key) : null;
  const includes = (opts.labelIncludes ?? []).map(norm);

  for (const r of spread.rows ?? []) {
    if (key && norm(r.key) === key) {
      const n = Array.isArray(r.values)
        ? (cellToNumber(r.values[0]) ?? (r.values.map(cellToNumber).find((x) => typeof x === "number") as number | undefined))
        : undefined;
      if (typeof n === "number" && Number.isFinite(n)) return n;
    }

    const label = norm(r.label ?? "");
    if (includes.length && includes.every((inc) => label.includes(inc))) {
      const n = Array.isArray(r.values)
        ? (r.values.map(cellToNumber).find((x) => typeof x === "number") as number | undefined)
        : undefined;
      if (typeof n === "number" && Number.isFinite(n)) return n;
    }
  }

  return null;
}

function extractAsOfDate(spread: any): string | null {
  const asOf = spread?.asOf ?? spread?.as_of ?? spread?.as_of_date;
  if (!asOf) return null;
  const s = String(asOf);
  // accept YYYY-MM-DD prefix
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

type SpreadRow = {
  spread_version: number;
  updated_at: string | null;
  owner_type: string;
  owner_entity_id: string | null;
  rendered_json: RenderedSpread | null;
};

async function getLatestSpreadRow(args: {
  dealId: string;
  bankId: string;
  spreadType: SpreadType;
}): Promise<SpreadRow | null> {
  const sb = supabaseAdmin();
  const res = await (sb as any)
    .from("deal_spreads")
    .select("spread_version, updated_at, owner_type, owner_entity_id, rendered_json")
    .eq("deal_id", args.dealId)
    .eq("bank_id", args.bankId)
    .eq("spread_type", args.spreadType)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (res.error || !res.data) return null;

  return {
    spread_version: Number(res.data.spread_version ?? 1),
    updated_at: res.data.updated_at ?? null,
    owner_type: res.data.owner_type ?? "DEAL",
    owner_entity_id: res.data.owner_entity_id ?? null,
    rendered_json:
      res.data.rendered_json && typeof res.data.rendered_json === "object" ? (res.data.rendered_json as any) : null,
  };
}

async function getAllSpreadsForType(args: {
  dealId: string;
  bankId: string;
  spreadType: SpreadType;
}): Promise<SpreadRow[]> {
  const sb = supabaseAdmin();
  const res = await (sb as any)
    .from("deal_spreads")
    .select("spread_version, updated_at, owner_type, owner_entity_id, rendered_json")
    .eq("deal_id", args.dealId)
    .eq("bank_id", args.bankId)
    .eq("spread_type", args.spreadType)
    .eq("status", "ready");

  if (res.error || !res.data) return [];

  return (res.data as any[]).map((d: any) => ({
    spread_version: Number(d.spread_version ?? 1),
    updated_at: d.updated_at ?? null,
    owner_type: d.owner_type ?? "DEAL",
    owner_entity_id: d.owner_entity_id ?? null,
    rendered_json:
      d.rendered_json && typeof d.rendered_json === "object" ? (d.rendered_json as any) : null,
  }));
}

export async function backfillCanonicalFactsFromSpreads(args: {
  dealId: string;
  bankId: string;
}): Promise<{ ok: true; factsWritten: number; notes: string[] } | { ok: false; error: string }> {
  try {
    const notes: string[] = [];
    let factsWritten = 0;

    const writes: Array<Promise<any>> = [];
    const baseConfidence = 0.85;

    const gcf = await getLatestSpreadRow({ dealId: args.dealId, bankId: args.bankId, spreadType: "GLOBAL_CASH_FLOW" });
    if (!gcf?.rendered_json) {
      notes.push("GLOBAL_CASH_FLOW spread missing (no spreads-to-facts backfill possible for DSCR/CFA/ADS). ");
    } else {
      const asOfDate = extractAsOfDate(gcf.rendered_json);
      const sourceRef = `deal_spreads:GLOBAL_CASH_FLOW:v${gcf.spread_version}`;

      const cashFlowAvailable =
        tryFindRowNumber(gcf.rendered_json, { key: "CASH_FLOW_AVAILABLE" }) ??
        tryFindRowNumber(gcf.rendered_json, { key: "cash_flow_available" }) ??
        tryFindRowNumber(gcf.rendered_json, { labelIncludes: ["cash flow", "available"] });

      const annualDebtService =
        tryFindRowNumber(gcf.rendered_json, { key: "ANNUAL_DEBT_SERVICE" }) ??
        tryFindRowNumber(gcf.rendered_json, { key: "annual_debt_service" }) ??
        tryFindRowNumber(gcf.rendered_json, { key: "debt_service" }) ??
        tryFindRowNumber(gcf.rendered_json, { labelIncludes: ["debt", "service"] });

      const dscr =
        tryFindRowNumber(gcf.rendered_json, { key: "DSCR" }) ??
        tryFindRowNumber(gcf.rendered_json, { key: "dscr" }) ??
        tryFindRowNumber(gcf.rendered_json, { labelIncludes: ["dscr"] });

      const dscrStressed =
        tryFindRowNumber(gcf.rendered_json, { key: "DSCR_STRESSED_300BPS" }) ??
        tryFindRowNumber(gcf.rendered_json, { key: "dscr_stressed_300bps" }) ??
        tryFindRowNumber(gcf.rendered_json, { key: "dscr_stressed" }) ??
        tryFindRowNumber(gcf.rendered_json, { labelIncludes: ["dscr", "stressed"] });

      const excessCashFlow =
        tryFindRowNumber(gcf.rendered_json, { key: "EXCESS_CASH_FLOW" }) ??
        tryFindRowNumber(gcf.rendered_json, { key: "excess_cash_flow" }) ??
        tryFindRowNumber(gcf.rendered_json, { labelIncludes: ["excess", "cash"] });

    // FACT: CASH_FLOW_AVAILABLE
    writes.push(
      upsertDealFinancialFact({
        dealId: args.dealId,
        bankId: args.bankId,
        sourceDocumentId: null,
        factType: CANONICAL_FACTS.CASH_FLOW_AVAILABLE.fact_type,
        factKey: CANONICAL_FACTS.CASH_FLOW_AVAILABLE.fact_key,
        factValueNum: cashFlowAvailable ?? null,
        confidence: cashFlowAvailable === null ? null : baseConfidence,
        provenance: {
          source_type: "SPREAD",
          source_ref: sourceRef,
          as_of_date: asOfDate,
          extractor: "backfillCanonicalFactsFromSpreads:v1",
          confidence: cashFlowAvailable === null ? null : baseConfidence,
        },
      }),
    );

    // FACT: ANNUAL_DEBT_SERVICE
    writes.push(
      upsertDealFinancialFact({
        dealId: args.dealId,
        bankId: args.bankId,
        sourceDocumentId: null,
        factType: CANONICAL_FACTS.ANNUAL_DEBT_SERVICE.fact_type,
        factKey: CANONICAL_FACTS.ANNUAL_DEBT_SERVICE.fact_key,
        factValueNum: annualDebtService ?? null,
        confidence: annualDebtService === null ? null : baseConfidence,
        provenance: {
          source_type: "SPREAD",
          source_ref: sourceRef,
          as_of_date: asOfDate,
          extractor: "backfillCanonicalFactsFromSpreads:v1",
          confidence: annualDebtService === null ? null : baseConfidence,
        },
      }),
    );

    // FACT: DSCR
    writes.push(
      upsertDealFinancialFact({
        dealId: args.dealId,
        bankId: args.bankId,
        sourceDocumentId: null,
        factType: CANONICAL_FACTS.DSCR.fact_type,
        factKey: CANONICAL_FACTS.DSCR.fact_key,
        factValueNum: dscr ?? null,
        confidence: dscr === null ? null : baseConfidence,
        provenance: {
          source_type: "SPREAD",
          source_ref: sourceRef,
          as_of_date: asOfDate,
          extractor: "backfillCanonicalFactsFromSpreads:v1",
          confidence: dscr === null ? null : baseConfidence,
        },
      }),
    );

    // FACT: DSCR_STRESSED_300BPS (optional)
    writes.push(
      upsertDealFinancialFact({
        dealId: args.dealId,
        bankId: args.bankId,
        sourceDocumentId: null,
        factType: CANONICAL_FACTS.DSCR_STRESSED_300BPS.fact_type,
        factKey: CANONICAL_FACTS.DSCR_STRESSED_300BPS.fact_key,
        factValueNum: dscrStressed ?? null,
        confidence: dscrStressed === null ? null : baseConfidence,
        provenance: {
          source_type: "SPREAD",
          source_ref: sourceRef,
          as_of_date: asOfDate,
          extractor: "backfillCanonicalFactsFromSpreads:v1",
          confidence: dscrStressed === null ? null : baseConfidence,
        },
      }),
    );

    // FACT: EXCESS_CASH_FLOW (prefer spread row; otherwise compute)
    let excessValue: number | null = excessCashFlow ?? null;
    let excessCalc: string | undefined = undefined;
    if (excessValue === null && cashFlowAvailable !== null && annualDebtService !== null) {
      excessValue = cashFlowAvailable - annualDebtService;
      excessCalc = "CASH_FLOW_AVAILABLE - ANNUAL_DEBT_SERVICE";
    }

    writes.push(
      upsertDealFinancialFact({
        dealId: args.dealId,
        bankId: args.bankId,
        sourceDocumentId: null,
        factType: CANONICAL_FACTS.EXCESS_CASH_FLOW.fact_type,
        factKey: CANONICAL_FACTS.EXCESS_CASH_FLOW.fact_key,
        factValueNum: excessValue,
        confidence: excessValue === null ? null : baseConfidence,
        provenance: {
          source_type: "SPREAD",
          source_ref: sourceRef,
          as_of_date: asOfDate,
          extractor: "backfillCanonicalFactsFromSpreads:v1",
          calc: excessCalc,
          confidence: excessValue === null ? null : baseConfidence,
        },
      }),
    );
    }

    // Optional: T12 TTM-derived memo inputs
    const t12 = await getLatestSpreadRow({ dealId: args.dealId, bankId: args.bankId, spreadType: "T12" });
    if (!t12?.rendered_json) {
      notes.push("Operating performance spread missing (no spreads-to-facts backfill possible for NOI_TTM/TOTAL_INCOME_TTM/OPEX_TTM). ");
    } else {
      const asOfDate = extractAsOfDate(t12.rendered_json);
      const sourceRef = `deal_spreads:T12:v${t12.spread_version}`;

      const totalIncomeTtm =
        tryFindRowNumberForCol(t12.rendered_json, { rowKey: "TOTAL_INCOME", colKey: "TTM" }) ??
        tryFindRowNumber(t12.rendered_json, { key: "TOTAL_INCOME" });
      const opexTtm =
        tryFindRowNumberForCol(t12.rendered_json, { rowKey: "TOTAL_OPEX", colKey: "TTM" }) ??
        tryFindRowNumber(t12.rendered_json, { key: "TOTAL_OPEX" });
      const noiTtm =
        tryFindRowNumberForCol(t12.rendered_json, { rowKey: "NOI", colKey: "TTM" }) ?? tryFindRowNumber(t12.rendered_json, { key: "NOI" });

      writes.push(
        upsertDealFinancialFact({
          dealId: args.dealId,
          bankId: args.bankId,
          sourceDocumentId: null,
          factType: CANONICAL_FACTS.TOTAL_INCOME_TTM.fact_type,
          factKey: CANONICAL_FACTS.TOTAL_INCOME_TTM.fact_key,
          factValueNum: totalIncomeTtm ?? null,
          confidence: totalIncomeTtm === null ? null : baseConfidence,
          provenance: {
            source_type: "SPREAD",
            source_ref: sourceRef,
            as_of_date: asOfDate,
            extractor: "backfillCanonicalFactsFromSpreads:v2",
            confidence: totalIncomeTtm === null ? null : baseConfidence,
          },
        }),
      );

      writes.push(
        upsertDealFinancialFact({
          dealId: args.dealId,
          bankId: args.bankId,
          sourceDocumentId: null,
          factType: CANONICAL_FACTS.OPEX_TTM.fact_type,
          factKey: CANONICAL_FACTS.OPEX_TTM.fact_key,
          factValueNum: opexTtm ?? null,
          confidence: opexTtm === null ? null : baseConfidence,
          provenance: {
            source_type: "SPREAD",
            source_ref: sourceRef,
            as_of_date: asOfDate,
            extractor: "backfillCanonicalFactsFromSpreads:v2",
            confidence: opexTtm === null ? null : baseConfidence,
          },
        }),
      );

      writes.push(
        upsertDealFinancialFact({
          dealId: args.dealId,
          bankId: args.bankId,
          sourceDocumentId: null,
          factType: CANONICAL_FACTS.NOI_TTM.fact_type,
          factKey: CANONICAL_FACTS.NOI_TTM.fact_key,
          factValueNum: noiTtm ?? null,
          confidence: noiTtm === null ? null : baseConfidence,
          provenance: {
            source_type: "SPREAD",
            source_ref: sourceRef,
            as_of_date: asOfDate,
            extractor: "backfillCanonicalFactsFromSpreads:v2",
            confidence: noiTtm === null ? null : baseConfidence,
          },
        }),
      );

      // ── T12-derived computed metrics: REVENUE, COGS, GROSS_PROFIT, EBITDA, NET_INCOME ──
      // REVENUE = TOTAL_INCOME (in property context, total rental + other income)
      const revenue = totalIncomeTtm;
      writes.push(
        upsertDealFinancialFact({
          dealId: args.dealId,
          bankId: args.bankId,
          sourceDocumentId: null,
          factType: CANONICAL_FACTS.REVENUE.fact_type,
          factKey: CANONICAL_FACTS.REVENUE.fact_key,
          factValueNum: revenue ?? null,
          confidence: revenue === null ? null : baseConfidence,
          provenance: {
            source_type: "SPREAD",
            source_ref: sourceRef,
            as_of_date: asOfDate,
            extractor: "backfillCanonicalFactsFromSpreads:v5",
            calc: "TOTAL_INCOME_TTM",
            confidence: revenue === null ? null : baseConfidence,
          },
        }),
      );

      // COGS — not available in property T12 (look for row, will be null for RE)
      const cogs =
        tryFindRowNumberForCol(t12.rendered_json, { rowKey: "COGS", colKey: "TTM" }) ??
        tryFindRowNumberForCol(t12.rendered_json, { rowKey: "COST_OF_GOODS_SOLD", colKey: "TTM" }) ??
        tryFindRowNumber(t12.rendered_json, { key: "COGS" });
      writes.push(
        upsertDealFinancialFact({
          dealId: args.dealId,
          bankId: args.bankId,
          sourceDocumentId: null,
          factType: CANONICAL_FACTS.COGS.fact_type,
          factKey: CANONICAL_FACTS.COGS.fact_key,
          factValueNum: cogs ?? null,
          confidence: cogs === null ? null : baseConfidence,
          provenance: {
            source_type: "SPREAD",
            source_ref: sourceRef,
            as_of_date: asOfDate,
            extractor: "backfillCanonicalFactsFromSpreads:v5",
            confidence: cogs === null ? null : baseConfidence,
          },
        }),
      );

      // GROSS_PROFIT = REVENUE - COGS (computed if both available)
      let grossProfit: number | null = null;
      let grossProfitCalc: string | undefined;
      if (revenue !== null && cogs !== null) {
        grossProfit = revenue - cogs;
        grossProfitCalc = "REVENUE - COGS";
      }
      writes.push(
        upsertDealFinancialFact({
          dealId: args.dealId,
          bankId: args.bankId,
          sourceDocumentId: null,
          factType: CANONICAL_FACTS.GROSS_PROFIT.fact_type,
          factKey: CANONICAL_FACTS.GROSS_PROFIT.fact_key,
          factValueNum: grossProfit,
          confidence: grossProfit === null ? null : baseConfidence,
          provenance: {
            source_type: "SPREAD",
            source_ref: sourceRef,
            as_of_date: asOfDate,
            extractor: "backfillCanonicalFactsFromSpreads:v5",
            calc: grossProfitCalc,
            confidence: grossProfit === null ? null : baseConfidence,
          },
        }),
      );

      // EBITDA ≈ NOI for real estate (no depreciation in T12 cash-basis)
      const ebitda = noiTtm;
      writes.push(
        upsertDealFinancialFact({
          dealId: args.dealId,
          bankId: args.bankId,
          sourceDocumentId: null,
          factType: CANONICAL_FACTS.EBITDA.fact_type,
          factKey: CANONICAL_FACTS.EBITDA.fact_key,
          factValueNum: ebitda ?? null,
          confidence: ebitda === null ? null : baseConfidence,
          provenance: {
            source_type: "SPREAD",
            source_ref: sourceRef,
            as_of_date: asOfDate,
            extractor: "backfillCanonicalFactsFromSpreads:v5",
            calc: "NOI_TTM (RE proxy for EBITDA)",
            confidence: ebitda === null ? null : baseConfidence,
          },
        }),
      );

      // NET_INCOME = NET_CASH_FLOW_BEFORE_DEBT (closest T12 analogue)
      const netIncome =
        tryFindRowNumberForCol(t12.rendered_json, { rowKey: "NET_CASH_FLOW_BEFORE_DEBT", colKey: "TTM" }) ??
        tryFindRowNumber(t12.rendered_json, { key: "NET_CASH_FLOW_BEFORE_DEBT" }) ??
        tryFindRowNumberForCol(t12.rendered_json, { rowKey: "CASH_FLOW_AFTER_DEBT", colKey: "TTM" }) ??
        tryFindRowNumber(t12.rendered_json, { key: "CASH_FLOW_AFTER_DEBT" });
      writes.push(
        upsertDealFinancialFact({
          dealId: args.dealId,
          bankId: args.bankId,
          sourceDocumentId: null,
          factType: CANONICAL_FACTS.NET_INCOME.fact_type,
          factKey: CANONICAL_FACTS.NET_INCOME.fact_key,
          factValueNum: netIncome ?? null,
          confidence: netIncome === null ? null : baseConfidence,
          provenance: {
            source_type: "SPREAD",
            source_ref: sourceRef,
            as_of_date: asOfDate,
            extractor: "backfillCanonicalFactsFromSpreads:v5",
            calc: "NET_CASH_FLOW_BEFORE_DEBT (T12)",
            confidence: netIncome === null ? null : baseConfidence,
          },
        }),
      );
    }

    // Optional: Rent Roll-derived memo inputs
    const rr = await getLatestSpreadRow({ dealId: args.dealId, bankId: args.bankId, spreadType: "RENT_ROLL" });
    if (!rr?.rendered_json) {
      notes.push("RENT_ROLL spread missing (no spreads-to-facts backfill possible for IN_PLACE_RENT_MO/OCCUPANCY_PCT/VACANCY_PCT). ");
    } else {
      const asOfDate = extractAsOfDate(rr.rendered_json);
      const sourceRef = `deal_spreads:RENT_ROLL:v${rr.spread_version}`;

      const inPlaceRentMo =
        ((): number | null => {
          const v = tryFindRowCellValueForCol(rr.rendered_json, { rowKey: "TOTAL_OCCUPIED", colKey: "RENT_MO" });
          return cellToNumber(v);
        })() ?? null;

      const occPct = (() => {
        const t = (rr.rendered_json as any)?.totals;
        const v = t?.OCCUPANCY_PCT;
        return typeof v === "number" && Number.isFinite(v) ? v : null;
      })();

      const vacPct = (() => {
        const t = (rr.rendered_json as any)?.totals;
        const v = t?.VACANCY_PCT;
        return typeof v === "number" && Number.isFinite(v) ? v : null;
      })();

      writes.push(
        upsertDealFinancialFact({
          dealId: args.dealId,
          bankId: args.bankId,
          sourceDocumentId: null,
          factType: CANONICAL_FACTS.IN_PLACE_RENT_MO.fact_type,
          factKey: CANONICAL_FACTS.IN_PLACE_RENT_MO.fact_key,
          factValueNum: inPlaceRentMo,
          confidence: inPlaceRentMo === null ? null : baseConfidence,
          provenance: {
            source_type: "SPREAD",
            source_ref: sourceRef,
            as_of_date: asOfDate,
            extractor: "backfillCanonicalFactsFromSpreads:v3",
            confidence: inPlaceRentMo === null ? null : baseConfidence,
          },
        }),
      );

      writes.push(
        upsertDealFinancialFact({
          dealId: args.dealId,
          bankId: args.bankId,
          sourceDocumentId: null,
          factType: CANONICAL_FACTS.OCCUPANCY_PCT.fact_type,
          factKey: CANONICAL_FACTS.OCCUPANCY_PCT.fact_key,
          factValueNum: occPct,
          confidence: occPct === null ? null : baseConfidence,
          provenance: {
            source_type: "SPREAD",
            source_ref: sourceRef,
            as_of_date: asOfDate,
            extractor: "backfillCanonicalFactsFromSpreads:v3",
            confidence: occPct === null ? null : baseConfidence,
          },
        }),
      );

      writes.push(
        upsertDealFinancialFact({
          dealId: args.dealId,
          bankId: args.bankId,
          sourceDocumentId: null,
          factType: CANONICAL_FACTS.VACANCY_PCT.fact_type,
          factKey: CANONICAL_FACTS.VACANCY_PCT.fact_key,
          factValueNum: vacPct,
          confidence: vacPct === null ? null : baseConfidence,
          provenance: {
            source_type: "SPREAD",
            source_ref: sourceRef,
            as_of_date: asOfDate,
            extractor: "backfillCanonicalFactsFromSpreads:v3",
            confidence: vacPct === null ? null : baseConfidence,
          },
        }),
      );
    }

    // ── BALANCE SHEET: TOTAL_ASSETS, TOTAL_LIABILITIES, NET_WORTH ────────
    const bs = await getLatestSpreadRow({ dealId: args.dealId, bankId: args.bankId, spreadType: "BALANCE_SHEET" });
    if (!bs?.rendered_json) {
      notes.push("BALANCE_SHEET spread missing.");
    } else {
      const asOfDate = extractAsOfDate(bs.rendered_json);
      const sourceRef = `deal_spreads:BALANCE_SHEET:v${bs.spread_version}`;
      // Balance sheet uses valueByCol with date-keyed columns. Use the asOf date or first column.
      const bsColKey =
        asOfDate ??
        (bs.rendered_json as any)?.meta?.as_of_dates?.[0] ??
        (bs.rendered_json as any)?.columnsV2?.[0]?.key ??
        "VALUE";

      const bsFacts: Array<{
        canonical: keyof typeof CANONICAL_FACTS;
        rowKey: string;
      }> = [
        { canonical: "TOTAL_ASSETS", rowKey: "TOTAL_ASSETS" },
        { canonical: "TOTAL_LIABILITIES", rowKey: "TOTAL_LIABILITIES" },
        { canonical: "NET_WORTH", rowKey: "NET_WORTH" },
      ];

      for (const bf of bsFacts) {
        const val =
          tryFindRowNumberForCol(bs.rendered_json, { rowKey: bf.rowKey, colKey: bsColKey }) ??
          tryFindRowNumber(bs.rendered_json, { key: bf.rowKey });
        writes.push(
          upsertDealFinancialFact({
            dealId: args.dealId,
            bankId: args.bankId,
            sourceDocumentId: null,
            factType: CANONICAL_FACTS[bf.canonical].fact_type,
            factKey: CANONICAL_FACTS[bf.canonical].fact_key,
            factValueNum: val ?? null,
            confidence: val === null ? null : baseConfidence,
            provenance: {
              source_type: "SPREAD",
              source_ref: sourceRef,
              as_of_date: asOfDate,
              extractor: "backfillCanonicalFactsFromSpreads:v4",
              confidence: val === null ? null : baseConfidence,
            },
            ownerType: "DEAL",
          }),
        );
      }

      // ── BS-derived computed metrics: WORKING_CAPITAL, CURRENT_RATIO, DEBT_TO_EQUITY ──
      const totalCurrentAssets =
        tryFindRowNumberForCol(bs.rendered_json, { rowKey: "TOTAL_CURRENT_ASSETS", colKey: bsColKey }) ??
        tryFindRowNumber(bs.rendered_json, { key: "TOTAL_CURRENT_ASSETS" });
      const totalCurrentLiabilities =
        tryFindRowNumberForCol(bs.rendered_json, { rowKey: "TOTAL_CURRENT_LIABILITIES", colKey: bsColKey }) ??
        tryFindRowNumber(bs.rendered_json, { key: "TOTAL_CURRENT_LIABILITIES" });

      // WORKING_CAPITAL = Current Assets - Current Liabilities
      let workingCapital: number | null = null;
      if (totalCurrentAssets !== null && totalCurrentLiabilities !== null) {
        workingCapital = totalCurrentAssets - totalCurrentLiabilities;
      }
      writes.push(
        upsertDealFinancialFact({
          dealId: args.dealId,
          bankId: args.bankId,
          sourceDocumentId: null,
          factType: CANONICAL_FACTS.WORKING_CAPITAL.fact_type,
          factKey: CANONICAL_FACTS.WORKING_CAPITAL.fact_key,
          factValueNum: workingCapital,
          confidence: workingCapital === null ? null : baseConfidence,
          provenance: {
            source_type: "SPREAD",
            source_ref: sourceRef,
            as_of_date: asOfDate,
            extractor: "backfillCanonicalFactsFromSpreads:v5",
            calc: "TOTAL_CURRENT_ASSETS - TOTAL_CURRENT_LIABILITIES",
            confidence: workingCapital === null ? null : baseConfidence,
          },
          ownerType: "DEAL",
        }),
      );

      // CURRENT_RATIO = Current Assets / Current Liabilities (from BS spread row or computed)
      const currentRatio =
        tryFindRowNumberForCol(bs.rendered_json, { rowKey: "CURRENT_RATIO", colKey: bsColKey }) ??
        tryFindRowNumber(bs.rendered_json, { key: "CURRENT_RATIO" }) ??
        (totalCurrentAssets !== null && totalCurrentLiabilities !== null && totalCurrentLiabilities !== 0
          ? totalCurrentAssets / totalCurrentLiabilities
          : null);
      writes.push(
        upsertDealFinancialFact({
          dealId: args.dealId,
          bankId: args.bankId,
          sourceDocumentId: null,
          factType: CANONICAL_FACTS.CURRENT_RATIO.fact_type,
          factKey: CANONICAL_FACTS.CURRENT_RATIO.fact_key,
          factValueNum: currentRatio,
          confidence: currentRatio === null ? null : baseConfidence,
          provenance: {
            source_type: "SPREAD",
            source_ref: sourceRef,
            as_of_date: asOfDate,
            extractor: "backfillCanonicalFactsFromSpreads:v5",
            calc: "TOTAL_CURRENT_ASSETS / TOTAL_CURRENT_LIABILITIES",
            confidence: currentRatio === null ? null : baseConfidence,
          },
          ownerType: "DEAL",
        }),
      );

      // DEBT_TO_EQUITY = Total Liabilities / Net Worth (from BS spread row or computed)
      // Reuse TOTAL_LIABILITIES and NET_WORTH values already extracted above
      const bsTotalLiabilities =
        tryFindRowNumberForCol(bs.rendered_json, { rowKey: "TOTAL_LIABILITIES", colKey: bsColKey }) ??
        tryFindRowNumber(bs.rendered_json, { key: "TOTAL_LIABILITIES" });
      const bsNetWorth =
        tryFindRowNumberForCol(bs.rendered_json, { rowKey: "NET_WORTH", colKey: bsColKey }) ??
        tryFindRowNumber(bs.rendered_json, { key: "NET_WORTH" });

      const debtToEquity =
        tryFindRowNumberForCol(bs.rendered_json, { rowKey: "DEBT_TO_EQUITY", colKey: bsColKey }) ??
        tryFindRowNumber(bs.rendered_json, { key: "DEBT_TO_EQUITY" }) ??
        (bsTotalLiabilities !== null && bsNetWorth !== null && bsNetWorth !== 0
          ? bsTotalLiabilities / bsNetWorth
          : null);
      writes.push(
        upsertDealFinancialFact({
          dealId: args.dealId,
          bankId: args.bankId,
          sourceDocumentId: null,
          factType: CANONICAL_FACTS.DEBT_TO_EQUITY.fact_type,
          factKey: CANONICAL_FACTS.DEBT_TO_EQUITY.fact_key,
          factValueNum: debtToEquity,
          confidence: debtToEquity === null ? null : baseConfidence,
          provenance: {
            source_type: "SPREAD",
            source_ref: sourceRef,
            as_of_date: asOfDate,
            extractor: "backfillCanonicalFactsFromSpreads:v5",
            calc: "TOTAL_LIABILITIES / NET_WORTH",
            confidence: debtToEquity === null ? null : baseConfidence,
          },
          ownerType: "DEAL",
        }),
      );
    }

    // ── PERSONAL INCOME: TOTAL_PERSONAL_INCOME (per owner) ────────────────
    const piSpreads = await getAllSpreadsForType({ dealId: args.dealId, bankId: args.bankId, spreadType: "PERSONAL_INCOME" });
    if (piSpreads.length === 0) {
      notes.push("PERSONAL_INCOME spreads missing.");
    } else {
      for (const pi of piSpreads) {
        if (!pi.rendered_json) continue;
        const asOfDate = extractAsOfDate(pi.rendered_json);
        const sourceRef = `deal_spreads:PERSONAL_INCOME:v${pi.spread_version}:${pi.owner_entity_id ?? "default"}`;

        const totalPersonalIncome =
          tryFindRowNumber(pi.rendered_json, { key: "TOTAL_PERSONAL_INCOME" }) ??
          tryFindRowNumber(pi.rendered_json, { key: "total_personal_income" });

        writes.push(
          upsertDealFinancialFact({
            dealId: args.dealId,
            bankId: args.bankId,
            sourceDocumentId: null,
            factType: CANONICAL_FACTS.PERSONAL_TOTAL_INCOME.fact_type,
            factKey: CANONICAL_FACTS.PERSONAL_TOTAL_INCOME.fact_key,
            factValueNum: totalPersonalIncome ?? null,
            confidence: totalPersonalIncome === null ? null : baseConfidence,
            provenance: {
              source_type: "SPREAD",
              source_ref: sourceRef,
              as_of_date: asOfDate,
              extractor: "backfillCanonicalFactsFromSpreads:v4",
              confidence: totalPersonalIncome === null ? null : baseConfidence,
            },
            ownerType: pi.owner_type,
            ownerEntityId: pi.owner_entity_id,
          }),
        );
      }
    }

    // ── PFS: PFS_TOTAL_ASSETS, PFS_TOTAL_LIABILITIES, PFS_NET_WORTH (per owner)
    const pfsSpreads = await getAllSpreadsForType({ dealId: args.dealId, bankId: args.bankId, spreadType: "PERSONAL_FINANCIAL_STATEMENT" });
    if (pfsSpreads.length === 0) {
      notes.push("PERSONAL_FINANCIAL_STATEMENT spreads missing.");
    } else {
      for (const pfs of pfsSpreads) {
        if (!pfs.rendered_json) continue;
        const asOfDate = extractAsOfDate(pfs.rendered_json);
        const sourceRef = `deal_spreads:PFS:v${pfs.spread_version}:${pfs.owner_entity_id ?? "default"}`;

        const pfsFacts: Array<{
          canonical: keyof typeof CANONICAL_FACTS;
          rowKey: string;
        }> = [
          { canonical: "PFS_TOTAL_ASSETS", rowKey: "PFS_TOTAL_ASSETS" },
          { canonical: "PFS_TOTAL_LIABILITIES", rowKey: "PFS_TOTAL_LIABILITIES" },
          { canonical: "PFS_NET_WORTH", rowKey: "PFS_NET_WORTH" },
        ];

        for (const pf of pfsFacts) {
          const val = tryFindRowNumber(pfs.rendered_json, { key: pf.rowKey });
          writes.push(
            upsertDealFinancialFact({
              dealId: args.dealId,
              bankId: args.bankId,
              sourceDocumentId: null,
              factType: CANONICAL_FACTS[pf.canonical].fact_type,
              factKey: CANONICAL_FACTS[pf.canonical].fact_key,
              factValueNum: val ?? null,
              confidence: val === null ? null : baseConfidence,
              provenance: {
                source_type: "SPREAD",
                source_ref: sourceRef,
                as_of_date: asOfDate,
                extractor: "backfillCanonicalFactsFromSpreads:v4",
                confidence: val === null ? null : baseConfidence,
              },
              ownerType: pfs.owner_type,
              ownerEntityId: pfs.owner_entity_id,
            }),
          );
        }
      }
    }

    // ── GCF additions: GCF_GLOBAL_CASH_FLOW, GCF_DSCR ────────────────────
    // These come from the same GLOBAL_CASH_FLOW spread already loaded above.
    if (gcf?.rendered_json) {
      const asOfDate = extractAsOfDate(gcf.rendered_json);
      const sourceRef = `deal_spreads:GLOBAL_CASH_FLOW:v${gcf.spread_version}`;

      const gcfGlobalCashFlow =
        tryFindRowNumber(gcf.rendered_json, { key: "GCF_GLOBAL_CASH_FLOW" }) ??
        tryFindRowNumber(gcf.rendered_json, { key: "gcf_global_cash_flow" });

      const gcfDscr =
        tryFindRowNumber(gcf.rendered_json, { key: "GCF_DSCR" }) ??
        tryFindRowNumber(gcf.rendered_json, { key: "gcf_dscr" });

      writes.push(
        upsertDealFinancialFact({
          dealId: args.dealId,
          bankId: args.bankId,
          sourceDocumentId: null,
          factType: CANONICAL_FACTS.GCF_GLOBAL_CASH_FLOW.fact_type,
          factKey: CANONICAL_FACTS.GCF_GLOBAL_CASH_FLOW.fact_key,
          factValueNum: gcfGlobalCashFlow ?? null,
          confidence: gcfGlobalCashFlow === null ? null : baseConfidence,
          provenance: {
            source_type: "SPREAD",
            source_ref: sourceRef,
            as_of_date: asOfDate,
            extractor: "backfillCanonicalFactsFromSpreads:v4",
            confidence: gcfGlobalCashFlow === null ? null : baseConfidence,
          },
        }),
      );

      writes.push(
        upsertDealFinancialFact({
          dealId: args.dealId,
          bankId: args.bankId,
          sourceDocumentId: null,
          factType: CANONICAL_FACTS.GCF_DSCR.fact_type,
          factKey: CANONICAL_FACTS.GCF_DSCR.fact_key,
          factValueNum: gcfDscr ?? null,
          confidence: gcfDscr === null ? null : baseConfidence,
          provenance: {
            source_type: "SPREAD",
            source_ref: sourceRef,
            as_of_date: asOfDate,
            extractor: "backfillCanonicalFactsFromSpreads:v4",
            confidence: gcfDscr === null ? null : baseConfidence,
          },
        }),
      );
    }

    const results = await Promise.all(writes);
    for (const r of results) {
      if (r?.ok) factsWritten += 1;
      else notes.push(`fact_upsert_failed:${r?.error ?? "unknown"}`);
    }

    return { ok: true, factsWritten, notes };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
