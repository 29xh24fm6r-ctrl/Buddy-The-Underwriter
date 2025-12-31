// src/app/api/deals/[dealId]/auto-seed/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { reconcileDealChecklist } from "@/lib/checklist/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 🔥 CANONICAL AUTO-SEED ENDPOINT
 * 
 * NEVER CRASHES. Handles all states:
 * - OCR not started
 * - OCR running
 * - OCR complete
 * - No uploads
 * 
 * Returns deterministic status, UI renders accordingly.
 */
export async function POST(req: Request, ctx: any) {
  try {
    const params = ctx?.params?.then ? await ctx.params : ctx.params;
    const dealId = params?.dealId;
    if (!dealId) {
      return NextResponse.json(
        { ok: false, error: "invalid_deal_id" },
        { status: 400 },
      );
    }

    // 🔥 Bank-grade deal+bank enforcement (same contract as /context)
    const ensured = await ensureDealBankAccess(dealId);
    if (!ensured.ok) {
      const statusCode = 
        ensured.error === "deal_not_found" ? 404 :
        ensured.error === "tenant_mismatch" ? 403 :
        400;
      
      return NextResponse.json(
        { 
          ok: false, 
          error: ensured.error,
          message: 
            ensured.error === "tenant_mismatch" ? "You don't have access to this deal's bank" :
            ensured.error === "bank_context_missing" ? "No bank membership found for your user" :
            ensured.error === "deal_not_found" ? "Deal not found in this environment" :
            "Failed to ensure bank access",
          details: ensured.details,
        },
        { status: statusCode },
      );
    }

    const bankId = ensured.bankId;
    const sb = supabaseAdmin();

    console.log("[auto-seed] Processing request for dealId:", dealId);

    // 1️⃣ Get deal intake info (loan_type lives in deal_intake table, NOT deals table)
    const { data: intake, error: intakeErr } = await sb
      .from("deal_intake")
      .select("loan_type, sba_program")
      .eq("deal_id", dealId)
      .single();

    console.log("[auto-seed] Intake data:", { intake, intakeErr });

    if (intakeErr || !intake || !intake.loan_type) {
      console.warn("[auto-seed] No intake data found or missing loan_type");
      return NextResponse.json({
        ok: true,
        status: "pending",
        message: "Deal intake incomplete. Please set loan type first.",
        checklist: { seeded: 0, matched: 0, total: 0 },
      });
    }

    // 2️⃣ 🔥 Checklist Engine v1: reconcile checklist (seed + match docs)
    console.log("[auto-seed] Running checklist reconciliation engine");
    const result = await reconcileDealChecklist(dealId);

    console.log("[auto-seed] Reconciliation result:", result);

    // 3️⃣ Log to canonical ledger
    await sb.from("deal_pipeline_ledger").insert({
      deal_id: dealId,
      bank_id: bankId,
      stage: "checklist_seeded",
      status: "ok",
      payload: result,
    });

    return NextResponse.json({
      ok: true,
      dealId,
      status: "ok",
      message: `Checklist reconciled. ${result.seeded} items seeded, ${result.docsMatched} docs matched.`,
      checklist: {
        seeded: result.seeded || 0,
        matched: result.docsMatched || 0,
        total: result.seeded || 0,
      },
      pipeline_state: "checklist_seeded",
    });

  } catch (error: any) {
    console.error("[auto-seed] unexpected error:", error);
    
    // Even on error, return graceful response
    return NextResponse.json({
      ok: false,
      status: "error",
      error: "Auto-seed failed. Please try again or contact support.",
    }, { status: 500 });
  }
}
