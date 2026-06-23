import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { getCanonicalGlobalCashFlow } from "@/lib/financialFacts/getCanonicalGlobalCashFlow";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {

    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const sb = supabaseAdmin();
    const url = new URL(req.url);

    // SPEC-GCF-SYSTEM-WIDE-PERMANENT-FIX-1: canonical Global Cash Flow read mode.
    // The GCF page consumes the canonical contract (state/value/diagnostics) as
    // its single state source. This branch is intentionally folded into the
    // existing /spreads GET (no route-count increase) and runs BEFORE the pricing
    // gate — a banker must see precise upstream diagnostics (e.g. "missing annual
    // debt service" when pricing is absent) instead of a 422 wall.
    if (url.searchParams.get("canonical") === "gcf") {
      const [canonical, { data: gcfRows, error: gcfErr }] = await Promise.all([
        getCanonicalGlobalCashFlow(dealId, access.bankId),
        (sb as any)
          .from("deal_spreads")
          .select(
            "deal_id, bank_id, spread_type, spread_version, status, rendered_json, updated_at, error, error_code, error_details_json, owner_type, owner_entity_id",
          )
          .eq("deal_id", dealId)
          .eq("bank_id", access.bankId)
          .eq("spread_type", "GLOBAL_CASH_FLOW")
          .or("error_code.is.null,error_code.neq.SUPERSEDED_BY_NEWER_VERSION")
          .order("updated_at", { ascending: false }),
      ]);
      if (gcfErr) {
        return NextResponse.json({ ok: false, error: gcfErr.message }, { status: 500 });
      }
      return NextResponse.json({
        ok: true,
        dealId,
        canonical,
        spreads: gcfRows ?? [],
      });
    }

    // --- PRICING GATE ---
    const { data: pricingRow, error: pricingErr } = await (sb as any)
      .from("deal_structural_pricing")
      .select("id, annual_debt_service_est")
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pricingErr) {
      console.error("[spreads] pricing check error", pricingErr.message);
    }

    const pricingComplete =
      pricingRow != null && pricingRow.annual_debt_service_est != null;

    if (!pricingComplete) {
      return NextResponse.json(
        {
          ok: false,
          error: "pricing_assumptions_required",
          message:
            "Pricing assumptions must be saved before spreads can be generated. Set pricing on the Pricing tab first.",
        },
        { status: 422 },
      );
    }
    // --- END PRICING GATE ---

    const typesRaw = url.searchParams.get("types") ?? "";
    const types = typesRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let q = (sb as any)
      .from("deal_spreads")
      // error_code / error_details_json surface real failure diagnostics to the
      // GCF page (SPEC-GCF-COMPUTE-QUEUED-POLLING-AND-STATUS-1).
      .select("deal_id, bank_id, spread_type, spread_version, status, rendered_json, updated_at, error, error_code, error_details_json, owner_type, owner_entity_id")
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      // SPEC-SPREADS-GET-NULL-ERROR-CODE-FILTER-1: null-safe supersession filter.
      // A bare not-equal on error_code drops rows where error_code IS NULL
      // (PostgREST/SQL: NULL != x is unknown → excluded), which hides every
      // healthy queued/generating/ready row (their error_code is null) — so the
      // GCF page never saw its own queued row. Keep null + non-superseded rows;
      // exclude only rows explicitly marked superseded.
      .or("error_code.is.null,error_code.neq.SUPERSEDED_BY_NEWER_VERSION");

    if (types.length) {
      q = q.in("spread_type", types);
    }

    const ownerType = url.searchParams.get("owner_type");
    if (ownerType) {
      q = q.eq("owner_type", ownerType);
    }

    const { data, error } = await q.order("updated_at", { ascending: false });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, dealId, spreads: data ?? [] });
  } catch (e: any) {
    rethrowNextErrors(e);

    console.error("[/api/deals/[dealId]/spreads]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
