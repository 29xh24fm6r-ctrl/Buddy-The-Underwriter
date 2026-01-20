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
    const legalName = String(body?.legal_name ?? "").trim();
    const entityType = String(body?.entity_type ?? "").trim();
    const primaryContactName = String(body?.primary_contact_name ?? "").trim();
    const primaryContactEmail = String(body?.primary_contact_email ?? "").trim();
    const ein = String(body?.ein ?? "").trim();

    if (!legalName) {
      return NextResponse.json({ ok: false, error: "legal_name_required" }, { status: 400 });
    }
    if (!entityType) {
      return NextResponse.json({ ok: false, error: "entity_type_required" }, { status: 400 });
    }
    if (!primaryContactName || !primaryContactEmail) {
      return NextResponse.json({ ok: false, error: "primary_contact_required" }, { status: 400 });
    }

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const sb = supabaseAdmin();

    const { data: borrower, error: createError } = await sb
      .from("borrowers")
      .insert({
        bank_id: access.bankId,
        legal_name: legalName,
        entity_type: entityType,
        primary_contact_name: primaryContactName,
        primary_contact_email: primaryContactEmail,
        ein: ein || null,
      })
      .select("id, legal_name")
      .single();

    if (createError || !borrower) {
      return NextResponse.json(
        { ok: false, error: createError?.message ?? "create_failed" },
        { status: 500 },
      );
    }

    const { error: attachError } = await sb
      .from("deals")
      .update({ borrower_id: borrower.id, borrower_name: borrower.legal_name ?? null })
      .eq("id", dealId)
      .eq("bank_id", access.bankId);

    if (attachError) {
      return NextResponse.json(
        { ok: false, error: attachError.message },
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
        borrower_id: borrower.id,
        created: true,
      },
    });

    return NextResponse.json({ ok: true, borrowerId: borrower.id });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/borrower/create]", error);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
