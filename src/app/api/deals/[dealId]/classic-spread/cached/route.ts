import "server-only";

import { NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SENTINEL_UUID } from "@/lib/financialFacts/writeFact";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import type { ClassicPdfCachedPayload } from "@/lib/classicSpread/classicPdfWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * SPEC-B3 — Cached Classic Spread PDF retrieval.
 *
 * Returns the pre-rendered PDF from deal_spreads if available.
 * Includes x-buddy-classic-pdf-stale header for UI defense-in-depth.
 *
 * Returns:
 *   200 + PDF bytes — cache hit
 *   404 — no cached PDF exists (UI should call /ensure or fall back to sync route)
 *   409 — cached PDF exists but is in error/queued state
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    const bankId = (access as any).bankId as string;

    const sb = supabaseAdmin();

    // Look up the cached CLASSIC_PDF row
    const { data: row, error: selectErr } = await (sb as any)
      .from("deal_spreads")
      .select("status, rendered_json, finished_at, updated_at")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("spread_type", "CLASSIC_PDF")
      .eq("spread_version", 1)
      .eq("owner_type", "DEAL")
      .eq("owner_entity_id", SENTINEL_UUID)
      .maybeSingle();

    if (selectErr) {
      return NextResponse.json({ error: "DB lookup failed" }, { status: 500 });
    }

    if (!row) {
      return NextResponse.json(
        { error: "No cached classic spread PDF", status: "not_found" },
        { status: 404 },
      );
    }

    if (row.status !== "ready") {
      return NextResponse.json(
        { error: "Classic spread PDF is not ready", status: row.status },
        { status: 409 },
      );
    }

    const payload = row.rendered_json as ClassicPdfCachedPayload;
    if (!payload?.pdf_base64) {
      return NextResponse.json(
        { error: "Cached row missing PDF data", status: "corrupt" },
        { status: 409 },
      );
    }

    // Staleness check: compare canonicalFactsTimestamp with latest fact
    let isStale = false;
    if (payload.canonicalFactsTimestamp) {
      const { data: latestFact } = await (sb as any)
        .from("deal_financial_facts")
        .select("updated_at")
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestFact?.updated_at && latestFact.updated_at > payload.canonicalFactsTimestamp) {
        isStale = true;
      }
    }

    const pdfBuffer = Buffer.from(payload.pdf_base64, "base64");

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="FinancialSpread_${dealId.slice(0, 8)}.pdf"`,
        "x-buddy-classic-pdf-stale": isStale ? "true" : "false",
        "x-buddy-classic-pdf-sha256": payload.pdf_sha256,
        "x-buddy-classic-pdf-generated-at": payload.generatedAt,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    rethrowNextErrors(err);
    console.error("[classic-spread/cached] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
