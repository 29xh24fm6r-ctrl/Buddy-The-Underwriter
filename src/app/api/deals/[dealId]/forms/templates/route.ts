import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUnderwriterOnDeal } from "@/lib/deals/participants";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authzError(err: any) {
  const msg = String(err?.message ?? err);
  if (msg === "unauthorized")
    return { status: 401, body: { ok: false, error: "unauthorized" } };
  if (msg === "forbidden")
    return { status: 403, body: { ok: false, error: "forbidden" } };
  return null;
}

/**
 * GET /api/deals/[dealId]/forms/templates
 *
 * Lists bank_document_templates available for the deal's bank.
 * Underwriter-scoped (not admin-only).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;

    await requireUnderwriterOnDeal(dealId);

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status =
        access.error === "deal_not_found"
          ? 404
          : access.error === "tenant_mismatch"
            ? 403
            : 401;
      return NextResponse.json(
        { ok: false, error: access.error },
        { status },
      );
    }

    const sb = supabaseAdmin();

    const { data: templates, error } = (await sb
      .from("bank_document_templates")
      .select("id, bank_id, document_type, created_at")
      .eq("bank_id", access.bankId)
      .order("created_at", { ascending: false })) as any;

    if (error) throw error;

    return NextResponse.json({ ok: true, templates: templates ?? [] });
  } catch (err: any) {
    const a = authzError(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
