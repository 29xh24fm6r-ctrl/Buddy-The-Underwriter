import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { processDueCommsOutbox } from "@/lib/brokerage/commsOutbox";
import { buildOutboxAdapterFactory } from "@/lib/brokerage/commsAdapters";
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
    try { body = await request.json(); } catch {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    if (body.confirmProcessOutbox !== true) {
      return NextResponse.json(
        { ok: false, error: "missing_confirmation", message: "Set confirmProcessOutbox: true to process outbox items" },
        { status: 400 },
      );
    }

    const limit = typeof body.limit === "number" && body.limit > 0 ? Math.min(body.limit, 100) : 25;
    const sb = supabaseAdmin() as any;

    const result = await processDueCommsOutbox(sb, buildOutboxAdapterFactory(), limit);

    return NextResponse.json(redactResponseSecrets({ ok: true, ...result }));
  } catch (err: any) {
    console.error("[POST /api/brokerage/comms/outbox/process]", err);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
