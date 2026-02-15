import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { RenderedSpread } from "@/lib/financialSpreads/types";
import { REQUIRED_CANONICAL_FACT_KEYS, CANONICAL_FACTS } from "@/lib/financialFacts/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

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

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);

    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const sb = supabaseAdmin();

    const [factsRes, spreadsRes] = await Promise.all([
      (sb as any)
        .from("deal_financial_facts")
        .select("fact_type,fact_key,created_at,confidence,provenance")
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId)
        .in(
          "fact_key",
          Array.from(new Set(REQUIRED_CANONICAL_FACT_KEYS.map((k) => CANONICAL_FACTS[k].fact_key))),
        )
        .order("created_at", { ascending: false })
        .limit(500),
      (sb as any)
        .from("deal_spreads")
        .select("spread_type,spread_version,updated_at,rendered_json,status")
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId)
        .in("spread_type", ["GLOBAL_CASH_FLOW", "T12"] as any)
        .order("updated_at", { ascending: false })
        .limit(10),
    ]);

    const factRows = factsRes.error ? [] : (factsRes.data ?? []);
    const spreadRows = spreadsRes.error ? [] : (spreadsRes.data ?? []);

    const present = new Set<string>();

    // Mark facts present
    for (const r of factRows) {
      const factType = String(r.fact_type);
      const factKey = String(r.fact_key);
      for (const ck of REQUIRED_CANONICAL_FACT_KEYS) {
        const def = CANONICAL_FACTS[ck];
        if (def.fact_type === factType && def.fact_key === factKey) {
          present.add(ck);
        }
      }
    }

    // Mark spread-provided metrics as present (best-effort)
    const gcf = spreadRows.find((s: any) => String(s.spread_type) === "GLOBAL_CASH_FLOW");
    const gcfJson: RenderedSpread | null = gcf?.rendered_json && typeof gcf.rendered_json === "object" ? (gcf.rendered_json as any) : null;

    if (gcfJson) {
      const dscr =
        tryFindRowNumber(gcfJson, { key: "DSCR" }) ??
        tryFindRowNumber(gcfJson, { key: "dscr" }) ??
        tryFindRowNumber(gcfJson, { labelIncludes: ["dscr"] });
      if (dscr !== null) present.add("DSCR");

      const cfa =
        tryFindRowNumber(gcfJson, { key: "CASH_FLOW_AVAILABLE" }) ??
        tryFindRowNumber(gcfJson, { key: "cash_flow_available" }) ??
        tryFindRowNumber(gcfJson, { labelIncludes: ["cash flow", "available"] });
      if (cfa !== null) present.add("CASH_FLOW_AVAILABLE");

      const ads =
        tryFindRowNumber(gcfJson, { key: "ANNUAL_DEBT_SERVICE" }) ??
        tryFindRowNumber(gcfJson, { key: "annual_debt_service" }) ??
        tryFindRowNumber(gcfJson, { key: "debt_service" }) ??
        tryFindRowNumber(gcfJson, { labelIncludes: ["debt", "service"] });
      if (ads !== null) present.add("ANNUAL_DEBT_SERVICE");

      const dscrStressed =
        tryFindRowNumber(gcfJson, { key: "DSCR_STRESSED_300BPS" }) ??
        tryFindRowNumber(gcfJson, { key: "dscr_stressed_300bps" }) ??
        tryFindRowNumber(gcfJson, { key: "dscr_stressed" }) ??
        tryFindRowNumber(gcfJson, { labelIncludes: ["dscr", "stressed"] });
      if (dscrStressed !== null) present.add("DSCR_STRESSED_300BPS");

      // Excess CF can be computed if CFA+ADS present
      if (cfa !== null && ads !== null) present.add("EXCESS_CASH_FLOW");
    }

    const requiredKeys = REQUIRED_CANONICAL_FACT_KEYS;
    const presentKeys = requiredKeys.filter((k) => present.has(k));
    const missingKeys = requiredKeys.filter((k) => !present.has(k));

    const suggestions = missingKeys.map((k) => {
      if (["TOTAL_PROJECT_COST", "BORROWER_EQUITY", "BANK_LOAN_TOTAL", "BORROWER_EQUITY_PCT"].includes(k)) {
        return { key: k, suggestion: "Upload/verify a Sources & Uses doc (TERM_SHEET, LOI, or CLOSING_STATEMENT) and run facts backfill." };
      }
      if ([
        "COLLATERAL_GROSS_VALUE",
        "COLLATERAL_NET_VALUE",
        "COLLATERAL_DISCOUNTED_VALUE",
        "COLLATERAL_DISCOUNTED_COVERAGE",
        "LTV_GROSS",
        "LTV_NET",
      ].includes(k)) {
        return { key: k, suggestion: "Upload/verify collateral docs (APPRAISAL or COLLATERAL_SCHEDULE) and run facts backfill with includeDocs." };
      }
      if (["DSCR", "DSCR_STRESSED_300BPS", "CASH_FLOW_AVAILABLE", "ANNUAL_DEBT_SERVICE", "EXCESS_CASH_FLOW"].includes(k)) {
        return { key: k, suggestion: "Recompute spreads (GLOBAL_CASH_FLOW) then POST /facts/backfill to write normalized facts." };
      }
      return { key: k, suggestion: "Provide the underlying source document/spread and re-run backfill." };
    });

    return NextResponse.json({
      ok: true,
      dealId,
      bankId: access.bankId,
      required_keys: requiredKeys,
      present_keys: presentKeys,
      missing_keys: missingKeys,
      suggestions,
    });
  } catch (e: any) {
    rethrowNextErrors(e);

    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403 },
      );
    }

    console.error("[/api/deals/[dealId]/credit-memo/canonical/missing]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
