import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireBrokerageCommsAdmin, redactResponseSecrets } from "@/lib/brokerage/commsAuth";
import { batchLatestTimelineEvents } from "@/lib/brokerage/dealTimelineBatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireBrokerageCommsAdmin();
    if (!auth.authorized) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const rawDealIds = url.searchParams.get("dealIds");

    const sb = supabaseAdmin() as any;
    const result = await batchLatestTimelineEvents(rawDealIds, sb);

    return NextResponse.json(
      redactResponseSecrets({
        ok: true,
        requested: result.requested,
        accepted: result.accepted,
        truncated: result.truncated,
        entries: result.entries,
      }),
    );
  } catch (err: any) {
    console.error("[GET /api/brokerage/deals/timeline/latest]", err);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
