import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUnderwriterOnDeal } from "@/lib/deals/participants";
import { reconcileConditionsFromOcrResult } from "@/lib/conditions/reconcileConditions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/deals/[dealId]/conditions/reconcile
 *
 * Manual condition reconciliation endpoint (for testing/debugging)
 *
 * Simulates OCR/classify completion with mock payload
 * Useful for:
 * - Testing condition match rules
 * - Debugging auto-satisfaction logic
 * - Live demo of reconciliation engine
 *
 * Body:
 * {
 *   doc_type: "BANK_STATEMENT",
 *   confidence: 0.95,
 *   reasons?: ["found account numbers", "detected monthly transactions"]
 * }
 *
 * Returns: { ok: true, matched: number, satisfied: number }
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    // Enforce underwriter access
    await requireUnderwriterOnDeal(dealId);

    // Parse request body
    const body = await req.json();
    const { doc_type, confidence = 0.95, reasons = [] } = body;

    if (!doc_type) {
      return NextResponse.json(
        { ok: false, error: "doc_type is required" },
        { status: 400 },
      );
    }

    // Create admin client (reconciliation needs elevated privileges)
    const sb = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    // Run reconciliation with mock payload
    const result = await reconcileConditionsFromOcrResult({
      sb,
      dealId,
      jobId: "manual-reconcile",
      payload: {
        classification: {
          doc_type,
          confidence,
          reasons,
        },
        file_id: null,
        stored_name: "manual-trigger",
      },
      source: "classify",
    });

    return NextResponse.json({
      ok: true,
      ...result,
      message: `Matched ${result.matched} rule(s), satisfied ${result.satisfied} condition(s)`,
    });
  } catch (err: any) {
    console.error("Manual reconcile error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
