import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const borrowerId = body?.borrowerId as string | undefined;

    if (!borrowerId) {
      return NextResponse.json({ ok: false, error: "missing_borrower_id" }, { status: 400 });
    }

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const sb = supabaseAdmin();
    const { data: borrower } = await sb
      .from("borrowers")
      .select("id, legal_name")
      .eq("id", borrowerId)
      .eq("bank_id", access.bankId)
      .maybeSingle();

    const { data, error } = await sb
      .from("deals")
      .update({
        borrower_id: borrowerId,
        borrower_name: borrower?.legal_name ?? null,
      })
      .eq("id", dealId)
      .eq("bank_id", access.bankId)
      .select("id, borrower_id")
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json(
        { ok: false, error: error?.message ?? "attach_failed" },
        { status: 500 },
      );
    }

    await logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "deal.borrower.attached",
      uiState: "done",
      uiMessage: "Borrower attached",
      meta: {
        deal_id: dealId,
        borrower_id: borrowerId,
      },
    });

    return NextResponse.json({ ok: true, dealId, borrowerId });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/borrower/attach]", error);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
