// src/app/api/portal/deals/[dealId]/guided/route.ts
import { NextResponse } from "next/server";
import { requireValidInvite } from "@/lib/portal/auth";
import {
  ensureDefaultPortalStatus,
  listChecklist,
} from "@/lib/portal/checklist";
import { listBorrowerReceipts } from "@/lib/portal/receipts";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Missing authorization header");
    const token = authHeader.replace(/^Bearer\s+/i, "");

    const invite = await requireValidInvite(token);
    const { dealId } = await ctx.params;
    // Verify deal matches invite
    if (invite.deal_id !== dealId) throw new Error("Deal ID mismatch");

    await ensureDefaultPortalStatus(dealId);

    const sb = supabaseAdmin();

    const [{ data: statusRow }, checklist, receipts] = await Promise.all([
      sb
        .from("deal_portal_status")
        .select("stage, eta_text, updated_at")
        .eq("deal_id", dealId)
        .maybeSingle(),
      listChecklist(dealId),
      listBorrowerReceipts(dealId),
    ]);

    // Borrower-safe display fields: deal name + borrower name
    // Best-effort: if your deals schema differs, we fail soft.
    let display = { dealName: "Your application", borrowerName: "Borrower" };
    try {
      const { data: d } = await sb
        .from("deals")
        .select("id, name, borrower_name")
        .eq("id", dealId)
        .maybeSingle();
      if (d?.name) display.dealName = d.name;
      if ((d as any)?.borrower_name)
        display.borrowerName = (d as any).borrower_name;
    } catch {
      // keep defaults
    }

    // Compute progress
    const rows = checklist ?? [];
    const required = rows.filter((r: any) => r.item?.required);
    const completed = required.filter(
      (r: any) => r.state?.status !== "missing",
    );

    const progress = {
      requiredTotal: required.length,
      requiredDone: completed.length,
      percent: required.length
        ? Math.round((completed.length / required.length) * 100)
        : 100,
    };

    return NextResponse.json({
      ok: true,
      display,
      status: {
        stage: statusRow?.stage ?? "Intake",
        etaText: statusRow?.eta_text ?? null,
      },
      progress,
      checklist: rows.map((r: any) => ({
        id: r.item.id,
        code: r.item.code,
        title: r.item.title,
        description: r.item.description,
        group: r.item.group_name,
        required: r.item.required,
        sort: r.item.sort_order,
        status: r.state.status,
        completedAt: r.state.completed_at,
      })),
      receipts,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}
