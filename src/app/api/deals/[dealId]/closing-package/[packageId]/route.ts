import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; packageId: string }> };

/**
 * POST /api/deals/[dealId]/closing-package/[packageId]
 * Actions: approve, supersede
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { dealId, packageId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const action = body.action as string;
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  if (action === "approve") {
    await sb.from("closing_packages")
      .update({ status: "approved_for_send", updated_at: now })
      .eq("id", packageId).eq("deal_id", dealId);

    await logLedgerEvent({
      dealId, bankId: auth.bankId,
      eventKey: "closing_package.approved",
      uiState: "done",
      uiMessage: "Closing package approved for send",
      meta: { package_id: packageId, actor: auth.userId },
    }).catch(() => {});

    return NextResponse.json({ ok: true, newStatus: "approved_for_send" });
  }

  if (action === "supersede") {
    await sb.from("closing_packages")
      .update({ status: "superseded", updated_at: now })
      .eq("id", packageId).eq("deal_id", dealId);

    await logLedgerEvent({
      dealId, bankId: auth.bankId,
      eventKey: "closing_package.superseded",
      uiState: "done",
      uiMessage: "Closing package superseded",
      meta: { package_id: packageId, actor: auth.userId },
    }).catch(() => {});

    return NextResponse.json({ ok: true, newStatus: "superseded" });
  }

  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
