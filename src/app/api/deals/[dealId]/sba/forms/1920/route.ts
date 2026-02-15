import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { buildSbaForm1920 } from "@/lib/sba/forms/build1920";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import type { DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
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

    const { data: snapshotRow } = await sb
      .from("financial_snapshots")
      .select("id, snapshot_json")
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!snapshotRow) {
      return NextResponse.json({ ok: false, error: "snapshot_not_found" }, { status: 404 });
    }

    const snapshot = snapshotRow.snapshot_json as DealFinancialSnapshotV1;

    const [{ data: deal }, { data: loanRequest }] = await Promise.all([
      sb
        .from("deals")
        .select("*")
        .eq("id", dealId)
        .eq("bank_id", access.bankId)
        .maybeSingle(),
      sb
        .from("deal_loan_requests")
        .select("requested_amount")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const form = buildSbaForm1920({
      snapshot,
      borrowerName: (deal as any)?.borrower_name ?? (deal as any)?.name ?? null,
      loanAmount: (loanRequest as any)?.requested_amount ?? null,
    });

    await logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "sba_form_1920_built",
      uiState: "done",
      uiMessage: "SBA Form 1920 generated",
      meta: { missing: form.missing.length },
    });

    return NextResponse.json({ ok: true, dealId, form });
  } catch (e: any) {
    rethrowNextErrors(e);

    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403 },
      );
    }

    console.error("[/api/deals/[dealId]/sba/forms/1920]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
