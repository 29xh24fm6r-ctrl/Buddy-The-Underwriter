import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { runId: string } };

export async function GET(req: Request, ctx: Ctx) {
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

  const url = new URL(req.url);
  const includeAegis = url.searchParams.get("include_aegis") === "1";

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

  // Optionally merge Aegis system events for the run's time window
  let aegisEvents: any[] = [];
  if (includeAegis && events.length > 0) {
    const startTs = new Date(events[0].ts).toISOString();
    const endTs = new Date(events[events.length - 1].ts + 60_000).toISOString();

    const { data: aegisData } = await sb
      .from("buddy_system_events" as any)
      .select(
        "id, created_at, event_type, severity, error_class, error_message, " +
          "source_system, resolution_status",
      )
      .eq("bank_id", bankId)
      .gte("created_at", startTs)
      .lte("created_at", endTs)
      .in("event_type", [
        "error",
        "warning",
        "suppressed",
        "stuck_job",
        "lease_expired",
      ])
      .order("created_at", { ascending: true })
      .limit(100);

    aegisEvents = ((aegisData ?? []) as any[]).map((e) => ({
      ts: new Date(e.created_at).getTime(),
      kind: "aegis." + e.event_type,
      type: "aegis.finding",
      source: e.source_system ?? "aegis",
      dealId: null,
      route: null,
      payload: {
        severity: e.severity,
        errorClass: e.error_class,
        errorMessage: e.error_message,
        resolutionStatus: e.resolution_status,
      },
    }));
  }

  const allEvents = [...events, ...aegisEvents].sort((a, b) => a.ts - b.ts);

  const counts: Record<string, number> = {};
  for (const ev of allEvents) {
    const key = String(ev.kind ?? ev.type ?? "unknown");
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return NextResponse.json({
    ok: true,
    runId,
    startedAt: allEvents.length ? new Date(allEvents[0].ts).toISOString() : null,
    events: allEvents,
    counts,
    notes: null,
  });
}
