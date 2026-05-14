import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runBrokerageCommsForDeal } from "@/lib/brokerage/commsOrchestrator";
import type { BankerAlertPurpose } from "@/lib/brokerage/bankerAlerts";
import { requireBrokerageCommsAdmin, redactResponseSecrets } from "@/lib/brokerage/commsAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ dealId: string }> },
) {
  try {
    const auth = await requireBrokerageCommsAdmin();
    if (!auth.authorized) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const { dealId } = await params;
    let body: Record<string, any> = {};
    try { body = await request.json(); } catch { /* empty body ok */ }

    const result = await runBrokerageCommsForDeal(dealId, supabaseAdmin() as any, {
      processOutbox: body.processOutbox === true,
      purposes: {
        borrowerNudges: body.purposes?.borrowerNudges !== false,
        bankerAlerts: body.purposes?.bankerAlerts !== false,
      },
      alertPurpose: typeof body.alertPurpose === "string" ? (body.alertPurpose as BankerAlertPurpose) : undefined,
    });

    return NextResponse.json(redactResponseSecrets({ ok: true, ...result }));
  } catch (err: any) {
    console.error("[POST /api/brokerage/deals/:dealId/comms/run]", err);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
