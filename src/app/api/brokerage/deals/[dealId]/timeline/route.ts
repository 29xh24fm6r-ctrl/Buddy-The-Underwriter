import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireBrokerageCommsAdmin, redactResponseSecrets } from "@/lib/brokerage/commsAuth";
import { getDealTimeline, type TimelineOptions } from "@/lib/brokerage/dealTimeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ dealId: string }> };

function parseList(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  const arr = raw.split(",").map(s => s.trim()).filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}

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
    const rawLimit = Number(url.searchParams.get("limit") ?? "100");
    const limit = Math.min(Math.max(rawLimit || 100, 1), 200);

    const opts: TimelineOptions = {
      limit,
      categories: parseList(url.searchParams.get("categories")) as TimelineOptions["categories"],
      severities: parseList(url.searchParams.get("severities")) as TimelineOptions["severities"],
      actorTypes: parseList(url.searchParams.get("actorTypes")) as TimelineOptions["actorTypes"],
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    };

    const sb = supabaseAdmin() as any;
    const events = await getDealTimeline(dealId, sb, opts);

    return NextResponse.json(redactResponseSecrets({ ok: true, events, count: events.length }));
  } catch (err: any) {
    console.error("[GET /api/brokerage/deals/[dealId]/timeline]", err);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
