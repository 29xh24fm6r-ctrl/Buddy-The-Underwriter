import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { runId: string } };

export async function GET(_req: Request, ctx: Ctx) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { runId } = ctx.params;
  if (!runId) {
    return NextResponse.json({ ok: false, error: "missing_run_id" }, { status: 400 });
  }

  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("buddy_signal_ledger")
    .select("id, created_at, deal_id, type, source, payload")
    .eq("bank_id", bankId)
    .filter("payload->>runId", "eq", runId)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const events = (data ?? []).map((row: any) => {
    const payload = row.payload ?? {};
    const kind = payload.kind ?? row.type;
    const route = payload.route ?? payload.path ?? null;
    return {
      ts: new Date(row.created_at).getTime(),
      kind,
      type: row.type,
      source: row.source,
      dealId: row.deal_id ?? null,
      route,
      payload,
    };
  });

  const counts: Record<string, number> = {};
  for (const ev of events) {
    const key = String(ev.kind ?? ev.type ?? "unknown");
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return NextResponse.json({
    ok: true,
    runId,
    startedAt: events.length ? new Date(events[0].ts).toISOString() : null,
    events,
    counts,
    notes: null,
  });
}
