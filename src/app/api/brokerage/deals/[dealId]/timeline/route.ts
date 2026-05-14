import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireBrokerageCommsAdmin, redactResponseSecrets } from "@/lib/brokerage/commsAuth";
import { getDealTimeline } from "@/lib/brokerage/dealTimeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ dealId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const auth = await requireBrokerageCommsAdmin();
    if (!auth.authorized) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const { dealId } = await context.params;
    if (!dealId) {
      return NextResponse.json({ ok: false, error: "missing_deal_id" }, { status: 400 });
    }

    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get("limit") ?? "50");
    const limit = Math.min(Math.max(rawLimit || 50, 1), 200);

    const sb = supabaseAdmin() as any;
    const events = await getDealTimeline(dealId, sb, { limit });

    return NextResponse.json(redactResponseSecrets({ ok: true, events, count: events.length }));
  } catch (err: any) {
    console.error("[GET /api/brokerage/deals/[dealId]/timeline]", err);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
