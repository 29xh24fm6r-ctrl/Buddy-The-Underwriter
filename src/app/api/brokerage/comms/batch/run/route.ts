import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runBrokerageCommsBatch } from "@/lib/brokerage/commsOrchestrator";
import { requireBrokerageCommsAdmin, redactResponseSecrets } from "@/lib/brokerage/commsAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const auth = await requireBrokerageCommsAdmin();
    if (!auth.authorized) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    let body: Record<string, any> = {};
    try { body = await request.json(); } catch { /* empty body ok */ }

    const limit = typeof body.limit === "number" && body.limit > 0 ? Math.min(body.limit, 100) : 25;

    const result = await runBrokerageCommsBatch(supabaseAdmin() as any, {
      processOutbox: body.processOutbox === true,
      limit,
      purposes: {
        borrowerNudges: body.purposes?.borrowerNudges !== false,
        bankerAlerts: body.purposes?.bankerAlerts !== false,
      },
    });

    return NextResponse.json(redactResponseSecrets({ ok: true, ...result }));
  } catch (err: any) {
    console.error("[POST /api/brokerage/comms/batch/run]", err);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
