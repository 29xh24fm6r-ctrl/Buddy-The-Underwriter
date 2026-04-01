import "server-only";

import { NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { loadClassicSpreadData } from "@/lib/classicSpread/classicSpreadLoader";
import { renderClassicSpread } from "@/lib/classicSpread/classicSpreadRenderer";
import { generateSpreadNarrative } from "@/lib/classicSpread/narrativeEngine";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const input = await loadClassicSpreadData(dealId);
    // Narrative is optional — graceful fallback if API key missing or call fails
    const narrative = await generateSpreadNarrative(input).catch(() => null);
    const pdf = await renderClassicSpread(input, narrative);

    const bankId = (access as any).bankId as string;

    // Bridge: persist computed debt service metrics → facts → snapshot.
    // Awaited before response — Vercel kills background promises on response send.
    // Non-fatal: PDF always returns regardless of bridge outcome.
    try {
      const sb = (await import("@/lib/supabase/admin")).supabaseAdmin();

      const { data: pricingRow } = await (sb as any)
        .from("deal_structural_pricing")
        .select("annual_debt_service_est")
        .eq("deal_id", dealId)
        .order("computed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const proposedAds = pricingRow?.annual_debt_service_est
        ? Number(pricingRow.annual_debt_service_est)
        : null;

      if (proposedAds !== null && proposedAds > 0) {
        const { data: factRows } = await (sb as any)
          .from("deal_financial_facts")
          .select("fact_key, fact_value_num, fact_period_end")
          .eq("deal_id", dealId)
          .eq("is_superseded", false)
          .neq("resolution_status", "rejected")
          .in("fact_key", ["EBITDA", "ORDINARY_BUSINESS_INCOME", "NET_INCOME"])
          .not("fact_value_num", "is", null)
          .order("fact_period_end", { ascending: false })
          .limit(10);

        let ncads: number | null = null;
        if (factRows && factRows.length > 0) {
          const latestPeriod = (factRows as any[])[0].fact_period_end;
          const periodFacts = (factRows as any[]).filter(
            (r: any) => r.fact_period_end === latestPeriod,
          );
          ncads =
            periodFacts.find((r: any) => r.fact_key === "EBITDA")?.fact_value_num ??
            periodFacts.find((r: any) => r.fact_key === "ORDINARY_BUSINESS_INCOME")?.fact_value_num ??
            periodFacts.find((r: any) => r.fact_key === "NET_INCOME")?.fact_value_num ??
            null;
        }

        const dscrValue =
          ncads !== null && isFinite(Number(ncads))
            ? Math.round((Number(ncads) / proposedAds) * 100) / 100
            : null;

        const SENTINEL_UUID = "00000000-0000-0000-0000-000000000000";
        const SENTINEL_DATE = "1900-01-01";
        const persistDate = new Date().toISOString().slice(0, 10);

        const factsToWrite = [
          { key: "ANNUAL_DEBT_SERVICE", value: proposedAds },
          { key: "DSCR", value: dscrValue },
          ...(ncads !== null && Number(ncads) > 0 ? [
            { key: "CASH_FLOW_AVAILABLE", value: Number(ncads) },
            { key: "EXCESS_CASH_FLOW", value: Number(ncads) - proposedAds },
          ] : []),
        ].filter((f): f is { key: string; value: number } =>
          f.value !== null && Number.isFinite(f.value)
        );

        for (const f of factsToWrite) {
          const { error: upsertErr } = await (sb as any)
            .from("deal_financial_facts")
            .upsert({
              deal_id: dealId,
              bank_id: bankId,
              source_document_id: SENTINEL_UUID,
              fact_type: "FINANCIAL_ANALYSIS",
              fact_key: f.key,
              fact_period_start: SENTINEL_DATE,
              fact_period_end: persistDate,
              fact_value_num: f.value,
              fact_value_text: null,
              currency: "USD",
              confidence: 0.95,
              provenance: {
                source_type: "STRUCTURAL",
                source_ref: "computed:classic_spread:v1",
                as_of_date: persistDate,
                extractor: "classicSpread:debtService:v1",
              },
              owner_type: "DEAL",
              owner_entity_id: SENTINEL_UUID,
              is_superseded: false,
            }, {
              onConflict: "deal_id,bank_id,source_document_id,fact_type,fact_key,fact_period_start,fact_period_end,owner_type,owner_entity_id",
            } as any);

          if (upsertErr) {
            console.warn(`[classic-spread] upsert failed for ${f.key}:`, upsertErr.message);
          }
        }

        const { buildDealFinancialSnapshotForBank } = await import("@/lib/deals/financialSnapshot");
        const { persistFinancialSnapshot } = await import("@/lib/deals/financialSnapshotPersistence");
        const freshSnapshot = await buildDealFinancialSnapshotForBank({ dealId, bankId });
        await persistFinancialSnapshot({ dealId, bankId, snapshot: freshSnapshot });
      }
    } catch (bridgeErr: any) {
      console.warn("[classic-spread] bridge persist failed (non-fatal):", bridgeErr?.message);
    }

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="FinancialSpread_${dealId.slice(0, 8)}.pdf"`,
      },
    });
  } catch (err) {
    rethrowNextErrors(err);
    console.error("[classic-spread] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
