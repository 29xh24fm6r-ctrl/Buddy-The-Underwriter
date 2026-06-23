import "server-only";

import { NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SENTINEL_UUID } from "@/lib/financialFacts/writeFact";
import { CLASSIC_PDF_RENDER_VERSION } from "@/lib/classicSpread/classicPdfRenderVersion";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * SPEC-B3 — Ensure Classic Spread PDF exists.
 *
 * Cockpit-mount fallback: if no cached CLASSIC_PDF row exists (or it's stale),
 * enqueue a CLASSIC_PDF job. If a fresh cache exists, return immediately.
 *
 * This is a POST because it has side effects (enqueues a job).
 *
 * Returns:
 *   200 { status: "cached" }     — fresh cache exists, no action needed
 *   202 { status: "enqueued" }   — job enqueued, PDF will be ready soon
 *   200 { status: "generating" } — job already in progress
 */
export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    const bankId = (access as any).bankId as string;

    const sb = supabaseAdmin();

    // Check existing cached row
    const { data: row } = await (sb as any)
      .from("deal_spreads")
      .select("status, rendered_json, updated_at")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("spread_type", "CLASSIC_PDF")
      .eq("spread_version", 1)
      .eq("owner_type", "DEAL")
      .eq("owner_entity_id", SENTINEL_UUID)
      .maybeSingle();

    // If ready and fresh, return immediately
    if (row?.status === "ready" && row.rendered_json?.pdf_base64) {
      // Quick staleness check
      let isStale = false;
      // Code-version invalidation (mirrors the /cached route): a blob rendered by an older
      // renderer version is stale even when no fact changed, so a code-only render fix (e.g. a
      // CLASSIC_PDF_RENDER_VERSION bump) re-enqueues a regeneration instead of reporting "cached".
      if ((row.rendered_json?.renderVersion ?? 0) !== CLASSIC_PDF_RENDER_VERSION) {
        isStale = true;
      }
      if (!isStale && row.rendered_json?.canonicalFactsTimestamp) {
        const { data: latestFact } = await (sb as any)
          .from("deal_financial_facts")
          .select("updated_at")
          .eq("deal_id", dealId)
          .eq("bank_id", bankId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestFact?.updated_at && latestFact.updated_at > row.rendered_json.canonicalFactsTimestamp) {
          isStale = true;
        }
      }

      if (!isStale) {
        return NextResponse.json({ status: "cached" }, { status: 200 });
      }
      // Fall through to enqueue if stale
    }

    // If queued or generating, don't double-enqueue
    if (row?.status === "queued" || row?.status === "generating") {
      return NextResponse.json({ status: "generating" }, { status: 200 });
    }

    // Enqueue CLASSIC_PDF job
    const { enqueueSpreadRecompute } = await import(
      "@/lib/financialSpreads/enqueueSpreadRecompute"
    );
    await enqueueSpreadRecompute({
      dealId,
      bankId,
      spreadTypes: ["CLASSIC_PDF"],
      ownerType: "DEAL",
      ownerEntityId: SENTINEL_UUID,
      meta: { source: "ensure_endpoint" },
    });

    return NextResponse.json({ status: "enqueued" }, { status: 202 });
  } catch (err) {
    rethrowNextErrors(err);
    console.error("[classic-spread/ensure] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
