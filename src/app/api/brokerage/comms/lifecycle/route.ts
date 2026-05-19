import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireBrokerageCommsAdmin, redactResponseSecrets } from "@/lib/brokerage/commsAuth";
import { getRecentLifecycleCommsEvents, getLifecycleCommsSummary } from "@/lib/brokerage/commsLifecycleObservability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireBrokerageCommsAdmin();
    if (!auth.authorized) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const dealId = url.searchParams.get("dealId") ?? undefined;
    const rawLimit = Number(url.searchParams.get("limit") ?? "25");
    const limit = Math.min(Math.max(rawLimit || 25, 1), 100);

    const sb = supabaseAdmin() as any;

    const events = await getRecentLifecycleCommsEvents(sb, { dealId, limit });

    let summary = null;
    if (dealId) {
      summary = await getLifecycleCommsSummary(dealId, sb);
    }

    return NextResponse.json(redactResponseSecrets({ ok: true, events, summary, limit }));
  } catch (err: any) {
    console.error("[GET /api/brokerage/comms/lifecycle]", err);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
