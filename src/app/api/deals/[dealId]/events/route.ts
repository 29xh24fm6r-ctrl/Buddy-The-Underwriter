import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import type { AuditLedgerRow } from "@/types/db";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ dealId: string }>;
};

/**
 * Normalized event shape for the Deal Story Timeline.
 */
type NormalizedEvent = {
  id: string;
  kind: string;
  created_at: string;
  meta?: Record<string, unknown>;
  source: "audit_ledger" | "deal_events";
};

/**
 * GET /api/deals/[dealId]/events
 *
 * Returns recent deal events for activity feed.
 * Sources:
 *   - public.audit_ledger (canonical event ledger for AI/document events)
 *   - public.deal_events (lifecycle and pipeline events)
 *
 * Contract: { ok:true, events:[...] } - compatible with EventsFeed and DealStoryTimeline
 *
 * Query params:
 *   - limit: number of events (default: 20)
 *   - format: "raw" | "normalized" (default: normalized for timeline)
 */
export async function GET(req: NextRequest, ctx: Context) {
  try {
    const { dealId } = await ctx.params;

    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, events: [], error: "Unauthorized" }, { status: 401 });
    }

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status = access.error === "deal_not_found" ? 404 : access.error === "tenant_mismatch" ? 403 : 400;
      return NextResponse.json({ ok: false, events: [], error: access.error }, { status });
    }

    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const format = searchParams.get("format") || "normalized";

    const sb = supabaseAdmin();

    // Fetch from audit_ledger (document/AI events)
    const { data: auditEvents, error: auditError } = await sb
      .from("audit_ledger")
      .select(
        "id, deal_id, actor_user_id, scope, action, kind, input_json, output_json, confidence, evidence_json, requires_human_review, created_at",
      )
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (auditError) {
      console.error("[/api/deals/[dealId]/events] audit_ledger error:", auditError.message);
    }

    // Fetch from deal_events (lifecycle/pipeline events)
    const { data: dealEvents, error: dealEventsError } = await sb
      .from("deal_events")
      .select("id, deal_id, kind, payload, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (dealEventsError) {
      console.error("[/api/deals/[dealId]/events] deal_events error:", dealEventsError.message);
    }

    // If raw format requested, return audit_ledger events only (backwards compatible)
    if (format === "raw") {
      return NextResponse.json({
        ok: true,
        events: auditEvents || [],
      });
    }

    // Normalize and merge events for timeline
    const normalizedAuditEvents: NormalizedEvent[] = (auditEvents || []).map((e: any) => ({
      id: e.id,
      kind: e.kind || `${e.scope}.${e.action}`,
      created_at: e.created_at,
      meta: {
        ...((e.input_json as object) || {}),
        ...((e.output_json as object) || {}),
        actor_user_id: e.actor_user_id,
      },
      source: "audit_ledger" as const,
    }));

    const normalizedDealEvents: NormalizedEvent[] = (dealEvents || []).map((e: any) => ({
      id: e.id,
      kind: e.kind,
      created_at: e.created_at,
      meta: (e.payload as Record<string, unknown>) || {},
      source: "deal_events" as const,
    }));

    // Merge and sort by created_at descending
    const allEvents = [...normalizedAuditEvents, ...normalizedDealEvents]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);

    // Deduplicate by kind+timestamp (within 1 second)
    const deduped = allEvents.filter((event, idx, arr) => {
      const isDupe = arr.slice(0, idx).some((e) => {
        const timeDiff = Math.abs(
          new Date(e.created_at).getTime() - new Date(event.created_at).getTime()
        );
        return e.kind === event.kind && timeDiff < 1000;
      });
      return !isDupe;
    });

    return NextResponse.json({
      ok: true,
      events: deduped,
    });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/events]", error);
    return NextResponse.json({
      ok: false,
      events: [],
      error: "Failed to load events",
    });
  }
}
