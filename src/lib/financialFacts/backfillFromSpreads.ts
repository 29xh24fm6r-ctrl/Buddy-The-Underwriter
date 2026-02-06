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
      notes.push("T12 spread missing (no spreads-to-facts backfill possible for NOI_TTM/TOTAL_INCOME_TTM/OPEX_TTM). ");
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
