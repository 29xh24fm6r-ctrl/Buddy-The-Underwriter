import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
type Params = Promise<{ dealId: string }>;

export async function PATCH(req: NextRequest, ctx: { params: Params }) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) return NextResponse.json({ ok: false }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const newMode = body.deal_mode;
  if (newMode !== "full_underwrite" && newMode !== "quick_look") {
    return NextResponse.json({ ok: false, error: "invalid_mode" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // Block downgrade once underwriting workspace exists — upgrade always allowed
  if (newMode === "quick_look") {
    const { data: workspace } = await sb
      .from("underwriting_workspaces")
      .select("id")
      .eq("deal_id", dealId)
      .maybeSingle();
    if (workspace) {
      return NextResponse.json(
        {
          ok: false,
          error: "downgrade_blocked",
          reason: "Cannot downgrade to Quick Look after underwriting has been formally launched.",
        },
        { status: 409 },
      );
    }
  }

  const { error } = await sb.from("deals").update({ deal_mode: newMode }).eq("id", dealId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const { reconcileDealChecklist } = await import("@/lib/checklist/engine");
  await reconcileDealChecklist(dealId);

  await logLedgerEvent({
    dealId,
    bankId: access.bankId,
    eventKey: "deal.mode.changed",
    uiState: "done",
    uiMessage: `Deal mode changed to ${newMode}`,
    meta: { new_mode: newMode },
  });

  return NextResponse.json({ ok: true, deal_mode: newMode });
}
