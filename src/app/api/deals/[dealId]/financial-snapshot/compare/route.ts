import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { diffSnapshots } from "@/lib/deals/financialSnapshotDiff";
import type { DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(req: Request, ctx: Ctx) {
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

    const url = new URL(req.url);
    const fromId = url.searchParams.get("from");
    const toId = url.searchParams.get("to");
    if (!fromId || !toId) {
      return NextResponse.json({ ok: false, error: "from_and_to_required" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const { data: fromRow, error: fromErr } = await sb
      .from("financial_snapshots")
      .select("id, snapshot_json")
      .eq("id", fromId)
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .maybeSingle();

    const { data: toRow, error: toErr } = await sb
      .from("financial_snapshots")
      .select("id, snapshot_json")
      .eq("id", toId)
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .maybeSingle();

    if (fromErr || toErr || !fromRow || !toRow) {
      return NextResponse.json({ ok: false, error: "snapshot_not_found" }, { status: 404 });
    }

    const diff = diffSnapshots({
      fromId: fromRow.id,
      toId: toRow.id,
      from: fromRow.snapshot_json as DealFinancialSnapshotV1,
      to: toRow.snapshot_json as DealFinancialSnapshotV1,
    });

    return NextResponse.json({ ok: true, dealId, diff });
  } catch (e: any) {
    rethrowNextErrors(e);

    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403 },
      );
    }

    console.error("[/api/deals/[dealId]/financial-snapshot/compare]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
