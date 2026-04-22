import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

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

    const url = new URL(req.url);
    const typesRaw = url.searchParams.get("types") ?? "";
    const types = typesRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let q = (sb as any)
      .from("deal_spreads")
      .select("deal_id, bank_id, spread_type, spread_version, status, rendered_json, updated_at, error, owner_type, owner_entity_id")
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .neq("error_code", "SUPERSEDED_BY_NEWER_VERSION");

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
