import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { revalidateDealDocuments } from "@/lib/extraction/revalidateDealDocuments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ dealId: string }> };

// ---------------------------------------------------------------------------
// POST — Re-run the IRS arithmetic gate against the deal's COMPLETE current
// facts, refreshing stale mid-flight deal_document_validation_results rows.
// No re-extraction. SPEC-VALIDATION-GATE-RESTORE-PROGRAM-1 Phase 2.
// ---------------------------------------------------------------------------

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const summary = await revalidateDealDocuments(dealId);
    return NextResponse.json({ ok: true, summary });
  } catch (err: unknown) {
    rethrowNextErrors(err);
    console.error("[revalidate] POST error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
