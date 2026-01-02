// src/app/api/deals/[dealId]/timeline/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerPlaybookForStage } from "@/lib/deals/playbook";
import { computeChecklistHighlight } from "@/lib/borrower/highlightChecklist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// This is intentionally server-only read.
// You can later split into banker vs borrower auth.
// For now:
// - Banker UI can call with header x-user-id (optional)
// - Borrower portal can call with invite token and you can validate upstream
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    const sb = supabaseAdmin();

    const { data: status, error: sErr } = await sb
      .from("deal_status")
      .select("deal_id, stage, eta_date, eta_note, updated_at")
      .eq("deal_id", dealId)
      .maybeSingle();

    if (sErr) throw sErr;

    const { data: events, error: eErr } = await sb
      .from("deal_timeline_events")
      .select("id, kind, title, detail, meta, visible_to_borrower, created_at")
      .eq("deal_id", dealId)
      .eq("visible_to_borrower", true)
      .order("created_at", { ascending: false })
      .limit(100);

    if (eErr) throw eErr;

    const stage = status?.stage ?? "intake";
    const playbook = await getBorrowerPlaybookForStage(stage);

    const latestDoc =
      (events ?? []).find((e) => e.kind === "doc_received") ?? null;

    const highlight = playbook?.borrower_steps?.length
      ? computeChecklistHighlight({
          playbookSteps: playbook.borrower_steps,
          latestDocReceivedEvent: latestDoc
            ? {
                title: latestDoc.title,
                detail: latestDoc.detail,
                meta: (latestDoc as any).meta,
              }
            : null,
        })
      : null;

    return NextResponse.json({
      ok: true,
      status: status ?? null,
      playbook,
      highlight,
      events: events ?? [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}
