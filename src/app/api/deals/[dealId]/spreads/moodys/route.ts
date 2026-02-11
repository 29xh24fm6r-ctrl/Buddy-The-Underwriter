import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
import { renderMoodysSpreadWithValidation } from "@/lib/financialSpreads/moodys/renderMoodysSpread";
import { buildDealFinancialSnapshotForBank } from "@/lib/deals/financialSnapshot";
import type { FinancialFact } from "@/lib/financialSpreads/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);

    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const sb = supabaseAdmin();

    // Load all financial facts for this deal
    const { data: facts, error: factsErr } = await (sb as any)
      .from("deal_financial_facts")
      .select("*")
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId);

    if (factsErr) {
      return NextResponse.json(
        { ok: false, error: `facts_load_failed: ${factsErr.message}` },
        { status: 500 },
      );
    }

    // Build snapshot for validation (non-fatal if it fails)
    let snapshot = null;
    try {
      snapshot = await buildDealFinancialSnapshotForBank({ dealId, bankId: access.bankId });
    } catch {
      // Snapshot build failure is non-fatal — render without validation
    }

    // Render Moody's spread from facts with validation
    const { validation, ...rendered } = renderMoodysSpreadWithValidation({
      dealId,
      bankId: access.bankId,
      facts: (facts ?? []) as FinancialFact[],
      snapshot,
    });

    // Persist to deal_spreads (best-effort, non-blocking for response)
    const SENTINEL_UUID = "00000000-0000-0000-0000-000000000000";
    (sb as any)
      .from("deal_spreads")
      .upsert(
        {
          deal_id: dealId,
          bank_id: access.bankId,
          spread_type: "MOODYS",
          spread_version: 1,
          owner_type: "DEAL",
          owner_entity_id: SENTINEL_UUID,
          status: "ready",
          inputs_hash: null,
          rendered_json: rendered,
          rendered_html: null,
          rendered_csv: null,
          error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "deal_id,bank_id,spread_type,spread_version,owner_type,owner_entity_id" },
      )
      .then(() => {})
      .catch((err: any) => {
        console.warn("[moodys/route] persist failed (non-fatal)", err?.message);
      });

    return NextResponse.json({
      ok: true,
      dealId,
      spread: rendered,
      validation: validation ?? null,
    });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/spreads/moodys]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
